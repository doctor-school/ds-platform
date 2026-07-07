import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import { events, registrations, users } from "@ds/db";
import type { EventLifecycleState } from "@ds/schemas";
import { and, eq, or } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/** Canonical UUID shape — decides whether `:idOrSlug` can match the uuid `id` column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The registration-gating view of an event: its id + the single lifecycle state. */
export interface EventForRegistration {
  id: string;
  state: EventLifecycleState;
}

/**
 * Drizzle data access for the 005 registration record (design §2). 005 owns the
 * `registrations` write; it **reads** the `events` lifecycle state (owned by 007)
 * read-only to gate the register affordance, and the `users` mirror (owned by
 * 003) read-only to resolve the authenticated Zitadel `sub` to its domain
 * `user_id`. It never writes those tables.
 */
@Injectable()
export class RegistrationRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  /**
   * Resolve the authenticated Zitadel `sub` to its domain `users.id` (the 003
   * mirror row). `null` when no mirror exists for the subject — the caller maps
   * that to a refusal rather than inventing a row.
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
   * Resolve an event by its stable public slug OR its id (mirrors 004's
   * `findByIdOrSlug`) to its `{ id, state }` gating view. A non-UUID `idOrSlug`
   * matches the slug only — never fed to the uuid `id` column, whose comparison
   * would raise on a malformed value. `null` when no event matches.
   */
  async findEventForRegistration(
    idOrSlug: string,
  ): Promise<EventForRegistration | null> {
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

  /**
   * Record one registration for `(userId, eventId)` and return its canonical
   * `registeredAt` instant. EARS-1 is a plain insert; the `(user_id, event_id)`
   * uniqueness + `ON CONFLICT DO NOTHING` upsert that make a repeat an idempotent
   * no-op are the sibling EARS-3 handler.
   */
  async insertRegistration(userId: string, eventId: string): Promise<Date> {
    const [row] = await this.db
      .insert(registrations)
      .values({ userId, eventId })
      .returning({ registeredAt: registrations.registeredAt });
    if (!row) throw new Error("registration insert returned no row");
    return row.registeredAt;
  }

  /**
   * The caller's registration instant for `(userId, eventId)`, or `null` when
   * they are not registered — the per-user `EventRegistrationState` read.
   */
  async findRegisteredAt(
    userId: string,
    eventId: string,
  ): Promise<Date | null> {
    const [row] = await this.db
      .select({ registeredAt: registrations.registeredAt })
      .from(registrations)
      .where(
        and(
          eq(registrations.userId, userId),
          eq(registrations.eventId, eventId),
        ),
      )
      .limit(1);
    return row?.registeredAt ?? null;
  }
}
