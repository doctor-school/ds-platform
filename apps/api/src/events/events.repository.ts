import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle, Event, NewEvent, NewEventSpeaker } from "@ds/db";
import { eventSpeakers, events } from "@ds/db";
import { asc, desc, eq, or } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

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
