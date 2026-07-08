import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import { events } from "@ds/db";
import type { EventLifecycleState } from "@ds/schemas";
import { eq, or } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/** Canonical UUID shape — decides whether `:idOrSlug` can match the uuid `id` column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The room gate's view of an event: its id + the single lifecycle state. */
export interface EventForRoom {
  id: string;
  state: EventLifecycleState;
}

/**
 * Data access for the 006 room admission gate (design §2). It reads ONE thing —
 * the event's `{ id, state }` lifecycle view — from the `events` aggregate
 * (owned by 004/007), read-only: 006 reads the state 007 writes and never
 * mutates it. This is the `live` condition's SSOT read at the data layer, the
 * same thin pattern the 005 `RegistrationRepository.findEventForRegistration`
 * uses for its own gating; it is NOT a registration read — the `registered`
 * condition is delegated to the 005 `RegistrationService` (the `EventRoster`,
 * reused not reimplemented). Kept a RoomModule-local repository so the gate
 * carries no cross-module service injection (F-22 boundary).
 */
@Injectable()
export class RoomRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Resolve an event by its stable public slug OR its id (mirrors 004/005
   * resolution) to its `{ id, state }` gating view. A non-UUID `idOrSlug`
   * matches the slug only — never fed to the uuid `id` column, whose comparison
   * would raise on a malformed value. `null` when no event matches.
   */
  async findEventForRoom(idOrSlug: string): Promise<EventForRoom | null> {
    const where = UUID_RE.test(idOrSlug)
      ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
      : eq(events.slug, idOrSlug);
    const [row] = await this.db
      .select({ id: events.id, state: events.state })
      .from(events)
      .where(where)
      .limit(1);
    if (!row) return null;
    return { id: row.id, state: row.state as EventLifecycleState };
  }
}
