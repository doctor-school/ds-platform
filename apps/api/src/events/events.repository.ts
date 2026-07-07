import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle, Event, NewEvent, NewEventSpeaker } from "@ds/db";
import { auditLedger, eventSpeakers, events } from "@ds/db";
import { and, asc, desc, eq, gte, inArray, or } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

/**
 * The terminal `audit_ledger` row a named lifecycle transition appends (EARS-4;
 * ADR-0003 §6). `eventType` is the canonical domain event id (e.g.
 * `event.published`); `subjectId` is the acting `platform_admin` Zitadel `sub`
 * (or `null` when unavailable). The `from`/`to` states + the aggregate id land
 * in `metadata` — no PD is ever stored (ADR-0001 §7, ADR-0003 §6).
 */
export interface TransitionAudit {
  eventType: string;
  subjectId: string | null;
  from: Event["state"];
}

/** Canonical UUID v-agnostic shape — used to decide whether `:idOrSlug` can match the uuid `id` column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Db = DrizzleHandle["db"];

/** One event aggregate with its ordered speaker rows. */
export interface EventWithSpeakers {
  event: Event;
  speakers: { name: string; regalia: string; position: number }[];
}

/**
 * Drizzle data access for the 007 event aggregate (design §3). The write is one
 * transaction — the event row plus its ordered speaker rows land together or not
 * at all, so a partial aggregate is never persisted.
 */
@Injectable()
export class EventsRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async insert(
    event: NewEvent,
    speakers: Omit<NewEventSpeaker, "eventId">[],
  ): Promise<EventWithSpeakers> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(events).values(event).returning();
      if (!row) throw new Error("event insert returned no row");
      if (speakers.length > 0) {
        await tx
          .insert(eventSpeakers)
          .values(speakers.map((s) => ({ ...s, eventId: row.id })));
      }
      return {
        event: row,
        speakers: speakers.map((s) => ({
          name: s.name,
          regalia: s.regalia ?? "",
          position: s.position,
        })),
      };
    });
  }

  async listAll(): Promise<Event[]> {
    return this.db.select().from(events).orderBy(desc(events.createdAt));
  }

  /**
   * 004 EARS-7 — the upcoming-broadcasts read. Returns every `published` or
   * `live` event whose `starts_at` is at or after `cutoff` (`now − airWindow`, so
   * a recently-started live event still lists), ordered NEAREST air date first
   * (`starts_at ASC`). The state filter is applied in SQL — an `ended`/`archived`
   * event drops from the listing by state, never by time. Speaker rows for the
   * matched events are read in one batched query (no N+1) and grouped back by
   * event in `position` order. An empty match is a valid empty list (EARS-11).
   */
  async listUpcoming(cutoff: Date): Promise<EventWithSpeakers[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(
        and(
          inArray(events.state, ["published", "live"]),
          gte(events.startsAt, cutoff),
        ),
      )
      .orderBy(asc(events.startsAt));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(inArray(eventSpeakers.eventId, ids))
      .orderBy(asc(eventSpeakers.position));

    const byEvent = new Map<string, EventWithSpeakers["speakers"]>();
    for (const s of speakerRows) {
      const list = byEvent.get(s.eventId) ?? [];
      list.push({ name: s.name, regalia: s.regalia, position: s.position });
      byEvent.set(s.eventId, list);
    }
    return rows.map((event) => ({
      event,
      speakers: byEvent.get(event.id) ?? [],
    }));
  }

  /**
   * Persist a lifecycle state change and bump `updated_at`. The caller (the
   * EARS-7 guard in `EventsService`) has already validated the move against the
   * closed transition set — this is the bare write. Returns the updated
   * aggregate, or `null` when the id does not exist.
   */
  async updateState(
    id: string,
    state: Event["state"],
  ): Promise<EventWithSpeakers | null> {
    const [row] = await this.db
      .update(events)
      .set({ state, updatedAt: new Date() })
      .where(eq(events.id, id))
      .returning();
    if (!row) return null;
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(eq(eventSpeakers.eventId, id))
      .orderBy(asc(eventSpeakers.position));
    return {
      event: row,
      speakers: speakerRows.map((s) => ({
        name: s.name,
        regalia: s.regalia,
        position: s.position,
      })),
    };
  }

  /**
   * Apply a lifecycle state change AND append exactly one terminal
   * `audit_ledger` row (EARS-4; ADR-0003 §6) in a single transaction — the state
   * write and its audit row land together or not at all, so a transition can
   * never be applied without its ledger row (nor a spurious row written without
   * the state change). The caller (the named transition command in
   * `EventsService`) has already validated the move against the closed
   * transition set (the EARS-7 guard). Returns the updated aggregate, or `null`
   * when the id does not exist.
   */
  async updateStateWithAudit(
    id: string,
    state: Event["state"],
    audit: TransitionAudit,
  ): Promise<EventWithSpeakers | null> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(events)
        .set({ state, updatedAt: new Date() })
        .where(eq(events.id, id))
        .returning();
      if (!row) return null;
      await tx.insert(auditLedger).values({
        eventId: randomUUID(),
        eventType: audit.eventType,
        subjectId: audit.subjectId,
        // No PD — only the aggregate id + the from/to states (ADR-0003 §6).
        metadata: { aggregateId: id, from: audit.from, to: state },
      });
      const speakerRows = await tx
        .select()
        .from(eventSpeakers)
        .where(eq(eventSpeakers.eventId, id))
        .orderBy(asc(eventSpeakers.position));
      return {
        event: row,
        speakers: speakerRows.map((s) => ({
          name: s.name,
          regalia: s.regalia,
          position: s.position,
        })),
      };
    });
  }

  async findById(id: string): Promise<EventWithSpeakers | null> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id));
    if (!row) return null;
    return this.withSpeakers(row);
  }

  /**
   * Resolve one event by its stable public slug OR its id (004 EARS-1 — the
   * sponsor-distributed link keys on the slug; id is the fallback). A non-UUID
   * `idOrSlug` matches the slug only — never fed to the uuid `id` column, whose
   * comparison would raise on a malformed value.
   */
  async findByIdOrSlug(idOrSlug: string): Promise<EventWithSpeakers | null> {
    const where = UUID_RE.test(idOrSlug)
      ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
      : eq(events.slug, idOrSlug);
    const [row] = await this.db.select().from(events).where(where);
    if (!row) return null;
    return this.withSpeakers(row);
  }

  private async withSpeakers(row: Event): Promise<EventWithSpeakers> {
    const speakerRows = await this.db
      .select()
      .from(eventSpeakers)
      .where(eq(eventSpeakers.eventId, row.id))
      .orderBy(asc(eventSpeakers.position));
    return {
      event: row,
      speakers: speakerRows.map((s) => ({
        name: s.name,
        regalia: s.regalia,
        position: s.position,
      })),
    };
  }
}
