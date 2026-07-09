import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import type { DoctorPresenceMinutes } from "@ds/schemas";
import { presenceBeats, users } from "@ds/db";
import { eq, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/**
 * Data access for the 006 EARS-4 durable append-only presence capture (design
 * §5; ADR-0003 §3). Its ONLY write is an INSERT — there is no update or delete
 * surface, which is the structural half of the append-only contract (the other
 * half is the table shape: `presence_beats` has no mutable column). It reads the
 * `users` mirror (003) read-only to resolve the authenticated `sub` to the
 * domain `user_id` the beat is attributed to (the same thin pattern the 005
 * `RegistrationRepository.findUserIdBySub` uses) and appends one immutable
 * `(user_id, event_id, beat_at)` row per accepted beat.
 *
 * RoomModule-local so the gated command carries no cross-module service
 * injection for its own write (F-22 boundary); the `registered ∧ live` gate is
 * evaluated in {@link RoomService} (reusing the 005 roster read) BEFORE this
 * append is ever reached — an ungated caller never touches this table.
 */
@Injectable()
export class PresenceRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Resolve the authenticated Zitadel `sub` to its domain `users.id` (the 003
   * mirror row). `null` when no mirror exists — the caller maps that to a
   * refusal (401) rather than inventing a row (EARS-8). Read-only.
   */
  async findUserIdBySub(sub: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.zitadelSub, sub))
      .limit(1);
    return row?.id ?? null;
  }

  /**
   * Append exactly one immutable presence beat for `(userId, eventId)` and return
   * the row's server-stamped canonical instant. INSERT-only — the append-only
   * contract (no update path). `beat_at` defaults to the server clock, so the
   * instant is server-authoritative, never client-supplied (requirements
   * Constraints). Every call is a NEW row (never an upsert): concurrent-tab
   * coalescing is an EARS-5 read-time derivation over the raw beats, not a write
   * suppression here.
   */
  async appendBeat(userId: string, eventId: string): Promise<{ beatAt: Date }> {
    const [row] = await this.db
      .insert(presenceBeats)
      .values({ userId, eventId })
      .returning({ beatAt: presenceBeats.beatAt });
    // A single-row INSERT always returns one row; the guard is fail-closed
    // defence, never a silent no-op that would lose a captured beat.
    if (!row) throw new Error("presence beat insert returned no row");
    return { beatAt: row.beatAt };
  }

  /**
   * Derive per-doctor presence minutes for one event from the append-only beats
   * (006 EARS-5; design §5). Read-only — the durable beats are never mutated.
   *
   * The derivation is **parameterized over N** (`intervalSeconds`, the server
   * heartbeat cadence): each beat is bucketed to the N-second grid
   * (`floor(epoch(beat_at) / N)`) and the minutes are the count of **distinct**
   * buckets a doctor emitted a beat in, `× N / 60`. Two consequences the design
   * makes load-bearing fall straight out of the DISTINCT count:
   *
   * - **Concurrent tabs never inflate.** A doctor's parallel-session beats for the
   *   same event land in the same buckets and collapse under `DISTINCT` — two tabs
   *   beating in the same N-second bucket count once, not twice (the coalescing is
   *   this read-time derivation, not a write-time suppression — every raw beat is
   *   still durably appended by {@link appendBeat}).
   * - **No stored count.** The minutes are computed here at read time; there is no
   *   client-supplied or client-trusted count column (requirements Constraints).
   *
   * Passing a different `intervalSeconds` recomputes the SAME beats with no code
   * change — an operator-confirmed different cadence changes CONFIG, not this
   * query. Only doctors with at least one beat appear (a `GROUP BY user_id` over
   * the event's beats); the composite `(event, user, beat_at)` index serves the
   * scan. Minutes are rounded to whole seconds' worth of precision (3 dp) so a
   * fractional cadence — e.g. N=30 ⇒ 0.5-minute buckets — carries no float noise.
   */
  async deriveEventMinutes(
    eventId: string,
    intervalSeconds: number,
  ): Promise<DoctorPresenceMinutes[]> {
    const result = await this.db.execute<{ userId: string; buckets: string }>(
      sql`
        SELECT
          ${presenceBeats.userId} AS "userId",
          count(DISTINCT floor(
            extract(epoch from ${presenceBeats.beatAt}) / ${intervalSeconds}
          )) AS buckets
        FROM ${presenceBeats}
        WHERE ${presenceBeats.eventId} = ${eventId}
        GROUP BY ${presenceBeats.userId}
        ORDER BY ${presenceBeats.userId}
      `,
    );
    return result.rows.map((row) => ({
      userId: row.userId,
      eventId,
      minutes:
        Math.round(((Number(row.buckets) * intervalSeconds) / 60) * 1000) / 1000,
    }));
  }
}
