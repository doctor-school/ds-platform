import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle, Event, NewEvent, NewEventSpeaker } from "@ds/db";
import { eventSpeakers, events } from "@ds/db";
import { asc, desc, eq } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

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

  async findById(id: string): Promise<EventWithSpeakers | null> {
    const [row] = await this.db.select().from(events).where(eq(events.id, id));
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
}
