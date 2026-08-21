import type { DrizzleHandle, EventSpeaker } from "@ds/db";
import { eventSpeakers } from "@ds/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * #1278 — the diff-based reconcile of one event's speaker list (ADR-0003 design
 * §3.6).
 *
 * The old write path replaced the list wholesale (`DELETE` every row, re-`INSERT`
 * the new one), which physically destroyed the historical fact that a person had
 * been announced for a broadcast — forbidden by §3.6 rule 1. The list is now
 * reconciled: a speaker who stays is UPDATED in place, a speaker who returns is
 * RESTORED in place (§3.6 rule 2), a speaker who leaves is RETIRED
 * (`record_status = 'retired'` + `deleted_at = now()`), and only a genuinely new
 * speaker is INSERTed. No path deletes a row.
 *
 * Identity is the speaker's NAME within the event, not the position: position is
 * presentation order and is freely re-orderable (#1278 reshape gave the row a
 * stable `id`), so matching on it would make «B left slot 1, C took slot 1» look
 * like «B was renamed to C» and would overwrite B's retired row instead of
 * keeping it. Names are compared trimmed + case-insensitively; duplicates in the
 * desired list consume distinct existing rows in order.
 */

/** The desired shape of one entry — what the caller (admin edit / seed) authored. */
export interface DesiredSpeaker {
  readonly position: number;
  readonly name: string;
  readonly regalia?: string | null | undefined;
}

/** One in-place write against an existing row. */
interface SpeakerWrite {
  readonly id: string;
  readonly position: number;
  readonly name: string;
  readonly regalia: string;
}

/** The resolved plan — pure data, so the matching rules are unit-testable. */
export interface SpeakerReconcilePlan {
  /** Active rows that survive the edit (name matched) — position/text refreshed. */
  readonly update: SpeakerWrite[];
  /** Retired rows whose speaker returned — restored in place (§3.6 rule 2). */
  readonly restore: SpeakerWrite[];
  /** Genuinely new entries — the only INSERTs. */
  readonly insert: { position: number; name: string; regalia: string }[];
  /** Active rows whose speaker left — retired, never deleted. `position` is the row's current one. */
  readonly retire: { id: string; position: number }[];
}

/**
 * Positions are temporarily shifted by this offset before the target positions
 * are written, so a pure re-ordering (A@0,B@1 → A@1,B@0) cannot transiently
 * violate the partial `UNIQUE (event_id, position) WHERE record_status='active'`
 * index — that index is non-deferrable, so the writer, not the constraint, has
 * to sequence the moves. One bulk `position = position + OFFSET` keeps the set
 * collision-free while it is parked.
 */
const PARK_OFFSET = 1_000_000;

const key = (name: string): string => name.trim().toLocaleLowerCase("ru-RU");

/**
 * Resolve the desired list against the rows currently stored for the event.
 * `existing` MUST be every row of the event (active AND retired) — a retired row
 * is what makes a returning speaker a restore rather than a duplicate insert.
 */
export function planSpeakerReconcile(
  existing: readonly Pick<
    EventSpeaker,
    "id" | "position" | "name" | "recordStatus"
  >[],
  desired: readonly DesiredSpeaker[],
): SpeakerReconcilePlan {
  const activeByName = new Map<string, { id: string; position: number }[]>();
  const retiredByName = new Map<string, { id: string; position: number }[]>();
  for (const row of existing) {
    const bucket = row.recordStatus === "active" ? activeByName : retiredByName;
    const list = bucket.get(key(row.name)) ?? [];
    list.push({ id: row.id, position: row.position });
    bucket.set(key(row.name), list);
  }

  const update: SpeakerWrite[] = [];
  const restore: SpeakerWrite[] = [];
  const insert: SpeakerReconcilePlan["insert"] = [];

  for (const want of desired) {
    const name = want.name;
    const regalia = want.regalia ?? "";
    const matchedActive = activeByName.get(key(name))?.shift();
    if (matchedActive) {
      update.push({
        id: matchedActive.id,
        position: want.position,
        name,
        regalia,
      });
      continue;
    }
    const matchedRetired = retiredByName.get(key(name))?.shift();
    if (matchedRetired) {
      restore.push({
        id: matchedRetired.id,
        position: want.position,
        name,
        regalia,
      });
      continue;
    }
    insert.push({ position: want.position, name, regalia });
  }

  // Whatever is still queued under an active name was not claimed by the desired
  // list — those speakers left the line-up.
  const retire: SpeakerReconcilePlan["retire"] = [];
  for (const leftovers of activeByName.values()) {
    for (const row of leftovers)
      retire.push({ id: row.id, position: row.position });
  }

  return { update, restore, insert, retire };
}

/** Anything that can run the reconcile writes — the request `db` or an open transaction. */
export type SpeakerWriter = DrizzleHandle["db"];

/**
 * Apply the reconcile for one event. Safe to call inside an open transaction —
 * the caller owns the transaction boundary (the admin edit runs it together with
 * the `events` update so a partial aggregate is never persisted).
 */
export async function reconcileEventSpeakers(
  tx: SpeakerWriter,
  eventId: string,
  desired: readonly DesiredSpeaker[],
): Promise<void> {
  const existing = await tx
    .select()
    .from(eventSpeakers)
    .where(eq(eventSpeakers.eventId, eventId));
  const plan = planSpeakerReconcile(existing, desired);
  const now = new Date();

  const hasActive = existing.some((r) => r.recordStatus === "active");
  const movesRows = plan.update.length > 0 || plan.restore.length > 0;
  if (hasActive && (movesRows || plan.insert.length > 0)) {
    // Park every active row out of the way first (see PARK_OFFSET).
    await tx
      .update(eventSpeakers)
      .set({ position: sql`${eventSpeakers.position} + ${PARK_OFFSET}` })
      .where(
        and(
          eq(eventSpeakers.eventId, eventId),
          eq(eventSpeakers.recordStatus, "active"),
        ),
      );
  }

  for (const row of plan.retire) {
    // Retire, restoring the row's own position: a retired row is outside the
    // partial unique index, so it never squats on a slot the live list reuses.
    await tx
      .update(eventSpeakers)
      .set({
        recordStatus: "retired",
        deletedAt: now,
        position: row.position,
        updatedAt: now,
      })
      .where(eq(eventSpeakers.id, row.id));
  }

  for (const row of plan.update) {
    await tx
      .update(eventSpeakers)
      .set({
        position: row.position,
        name: row.name,
        regalia: row.regalia,
        updatedAt: now,
      })
      .where(eq(eventSpeakers.id, row.id));
  }

  for (const row of plan.restore) {
    await tx
      .update(eventSpeakers)
      .set({
        recordStatus: "active",
        deletedAt: null,
        position: row.position,
        name: row.name,
        regalia: row.regalia,
        updatedAt: now,
      })
      .where(eq(eventSpeakers.id, row.id));
  }

  if (plan.insert.length > 0) {
    await tx
      .insert(eventSpeakers)
      .values(plan.insert.map((row) => ({ ...row, eventId })));
  }
}
