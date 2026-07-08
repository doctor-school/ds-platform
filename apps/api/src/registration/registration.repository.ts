import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import { auditLedger, events, registrations, users } from "@ds/db";
import {
  type EventLifecycleState,
  type EventRosterEntry,
  type MyEventItem,
  REGISTRABLE_EVENT_STATES,
} from "@ds/schemas";
import { and, asc, eq, gte, inArray, or } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";

type Db = DrizzleHandle["db"];

/** Canonical UUID shape — decides whether `:idOrSlug` can match the uuid `id` column. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Canonical `audit_ledger` event id for a recorded webinar registration (design
 * §5; ADR-0003 §6). The `webinar.<class>.<event>` namespace mirrors the events
 * aggregate's `event.<transition>` and the auth ledger's `auth.<class>.<event>`
 * taxonomies (ADR-0001 §7.3). Written exactly once — on the first insert of a
 * `(user_id, event_id)` pair — never on an idempotent repeat (EARS-3). It is the
 * durable form of the `DoctorRegisteredForEvent` event; a repeat emits none.
 */
export const REGISTRATION_CREATED_AUDIT_TYPE = "webinar.registration.created";

/** The outcome of the idempotent upsert: the canonical instant + whether this call inserted the row. */
export interface RegistrationUpsert {
  registeredAt: Date;
  /** `true` only on the first insert for the pair — the sole path that emits the terminal audit row. */
  created: boolean;
}

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
   * The one-registration invariant as an idempotent upsert (EARS-3; design §2,
   * §5; ADR-0003 §5). `INSERT … ON CONFLICT (user_id, event_id) DO NOTHING` keyed
   * on the DB uniqueness constraint, then a read-back on the conflict path — so a
   * repeat via **any** path (one-tap, guest-through-auth, «мои события» re-entry)
   * returns the existing row and creates no duplicate. Correct under the
   * insert-race: two concurrent first-registers both key the same constraint, one
   * inserts and the other falls through to the read-back — never a duplicate row
   * nor a lost registration.
   *
   * On the **first insert only** — the sole moment `created` is true — one
   * terminal `audit_ledger` row ({@link REGISTRATION_CREATED_AUDIT_TYPE}) is
   * appended in the **same transaction** as the insert, so the row and its audit
   * entry commit atomically (design §5; ADR-0003 §6). An idempotent repeat
   * appends none — the exactly-one-then-none invariant (EARS-3, EARS-8). The
   * ledger row carries only the opaque Zitadel `sub` + the two ids; no PD.
   */
  async upsertRegistration(
    userId: string,
    eventId: string,
    sub: string,
  ): Promise<RegistrationUpsert> {
    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(registrations)
        .values({ userId, eventId })
        .onConflictDoNothing({
          target: [registrations.userId, registrations.eventId],
        })
        .returning({
          id: registrations.id,
          registeredAt: registrations.registeredAt,
        });

      if (inserted) {
        // First insert → exactly one terminal audit_ledger row, atomically.
        await tx.insert(auditLedger).values({
          eventId: randomUUID(),
          eventType: REGISTRATION_CREATED_AUDIT_TYPE,
          subjectId: sub,
          // No PD — only the opaque subject + the aggregate/event ids.
          metadata: { registrationId: inserted.id, eventId },
        });
        return { registeredAt: inserted.registeredAt, created: true };
      }

      // Conflict → the pair is already registered; read back the existing
      // instant. No second audit row, no second DoctorRegisteredForEvent.
      const [existing] = await tx
        .select({ registeredAt: registrations.registeredAt })
        .from(registrations)
        .where(
          and(
            eq(registrations.userId, userId),
            eq(registrations.eventId, eventId),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("registration upsert found no row after conflict");
      }
      return { registeredAt: existing.registeredAt, created: false };
    });
  }

  /**
   * The `MyEvents` read (EARS-6; design §4/§5): the caller's registered
   * **upcoming** events — `published`/`live` (the {@link REGISTRABLE_EVENT_STATES}
   * SSOT, the same closed set the {@link MyEventItem} `state` type derives from, so
   * the query and the projection can never disagree about what may appear) whose
   * `starts_at` is at or after `cutoff` (`now − airWindow`, so a recently-started
   * live event still lists — mirrors the 004 upcoming listing) — ordered NEAREST
   * air date first (`starts_at ASC`). A `draft`/`ended`/`archived` registration
   * drops by STATE, never by time (EARS-6: ended/archived never list). Joined on
   * `registrations.event_id` filtered to `user_id = userId`, so it returns ONLY the
   * caller's own registrations — never another doctor's (EARS-10). An empty match
   * is a valid empty list (design §5). No registrant PII, no roster — only the thin
   * per-event choose-set the «мои события» card renders.
   */
  async findMyEvents(userId: string, cutoff: Date): Promise<MyEventItem[]> {
    const rows = await this.db
      .select({
        eventId: events.id,
        slug: events.slug,
        title: events.title,
        school: events.school,
        startsAt: events.startsAt,
        state: events.state,
      })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(
        and(
          eq(registrations.userId, userId),
          inArray(events.state, [...REGISTRABLE_EVENT_STATES]),
          gte(events.startsAt, cutoff),
        ),
      )
      .orderBy(asc(events.startsAt));
    return rows.map((r) => ({
      eventId: r.eventId,
      slug: r.slug,
      title: r.title,
      school: r.school,
      startsAt: r.startsAt.toISOString(),
      // Narrowed to the registrable set by the SQL state filter above.
      state: r.state as MyEventItem["state"],
    }));
  }

  /**
   * The `EventRoster` read (EARS-8; design §2/§4): the set of **current**
   * registrations for one event, each carrying no more than the `(doctor, event,
   * registeredAt)` fact — `{ userId, eventId, registeredAt }`. Owned by 005;
   * **consumed** by feature 006 (room admission) and the wave-2 sponsor report.
   *
   * Because wave 1 has **no** cancelled state and no soft-delete (owner
   * decision), the roster is simply every registration row for the event — no
   * `status`/`cancelled` filter, and every row is current (Invariants). Selects
   * ONLY the three record columns — no join to the `users` mirror, so no
   * registrant PII is ever read here (a consumer that needs identity joins to 003
   * itself, EARS-8/EARS-10). Ordered nearest-registered first
   * (`registered_at ASC`); an event with no registrations returns an empty list.
   */
  async findEventRoster(eventId: string): Promise<EventRosterEntry[]> {
    const rows = await this.db
      .select({
        userId: registrations.userId,
        eventId: registrations.eventId,
        registeredAt: registrations.registeredAt,
      })
      .from(registrations)
      .where(eq(registrations.eventId, eventId))
      .orderBy(asc(registrations.registeredAt));
    return rows.map((r) => ({
      userId: r.userId,
      eventId: r.eventId,
      registeredAt: r.registeredAt.toISOString(),
    }));
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
