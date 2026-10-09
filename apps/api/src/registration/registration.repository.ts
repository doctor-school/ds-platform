import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { DrizzleHandle } from "@ds/db";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  auditLedger,
  consentRecords,
  events,
  registrationAttendance,
  registrations,
  specialtiesMinzdrav,
  users,
} from "@ds/db";
import {
  CONGRESS_SIGN_UP_CONSENT_PURPOSES,
  type CongressAttendanceHistoryEntry,
  type CongressDayAttendance,
  type CongressParticipantCard,
  type CongressParticipantDay,
  type CongressRosterQuery,
  type CongressRosterRow,
  CONGRESS_ROSTER_SORT_DEFAULT,
  type EventLifecycleState,
  type EventRosterEntry,
  type MyEventItem,
  type MyEventsCounts,
  type MyEventsTab,
  normaliseContactPhone,
  REGISTRABLE_EVENT_STATES,
} from "@ds/schemas";
import { and, asc, desc, eq, gte, inArray, or, type SQL, sql } from "drizzle-orm";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import { isParticipant } from "../auth/staff-role.js";
import { withRequestAuditContext } from "../audit/audit-context.tx.js";

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

/**
 * One «Мои события» row as it leaves SQL: every `MyEventItem` field EXCEPT
 * `recording` and `roomHref` (the calling host's room path, which the service
 * resolves from the route table the controller passes in). The recording projection is feature 014's own canonical resolver
 * (`RecordingsProjectionService`, #1340) — 005's repository does not re-derive it
 * from `event_recordings`, because a second derivation is exactly how the badge on
 * a doctor's own row starts disagreeing with the badge on the public card. The
 * service composes the two.
 */
export type MyEventRow = Omit<MyEventItem, "recording" | "roomHref">;

/**
 * The SQL membership predicate of one «Мои события» tab (014 EARS-9,
 * 014-design §8.3) — the single place either tab's membership is defined, shared
 * by the row query and the count query so a listed row and a counted row can never
 * be different sets.
 *
 * - `upcoming` — `published`/`live` still inside the 004 upcoming window
 *   (`starts_at ≥ now − AIR_WINDOW_MS`): an event appears here iff it would still
 *   appear as upcoming/live publicly (the shipped EARS-6 rule).
 * - `recordings` — every `ended` registration, with NO temporal window: the Записи
 *   tab is the doctor's whole finished history, so a two-year-old эфир is listed.
 *
 * `hidden` satisfies NEITHER predicate — feature 004's visibility policy hides an
 * hidden event from every listing, so it is in neither tab and in neither count.
 */
function tabMembership(tab: MyEventsTab, cutoff: Date): SQL {
  if (tab === "upcoming") {
    return and(
      inArray(events.state, [...REGISTRABLE_EVENT_STATES]),
      gte(events.startsAt, cutoff),
    )!;
  }
  return eq(events.state, "ended");
}

/**
 * 044 EARS-30 — the «возможный дубль» derivation: a window count over the
 * normalised contact phone (EARS-29) across the rows of the enclosing query.
 * The caller scopes that query to ONE event (`WHERE event_id = …` runs before
 * the window), so the partition is the event's registrations. A NULL/empty key
 * (an answer-less platform-origin row, EARS-16) is forced to `false`: SQL
 * partitions all NULLs together, so without the guard every answer-less row on
 * an event would mark every other one. Shared by the PII-free roster fact and
 * the participant card so the two can never disagree.
 */
function possibleDuplicateOverScope() {
  const phoneKey = sql`nullif(${registrations.answers}->>'contactPhoneNormalised', '')`;
  return sql<boolean>`case
    when ${phoneKey} is null then false
    else count(*) over (partition by ${phoneKey}) > 1
  end`.as("possible_duplicate");
}

/**
 * The registration's answer-derived cells, with the EARS-16 account fallback
 * (`users` joined on `registrations.user_id`). One definition for the roster
 * row and the participant card, so a field reads the same in both.
 */
function registrationCells() {
  return {
    // `nullif(trim(...), '')` turns «nothing to show» into a NULL cell, so the
    // screen renders an empty cell rather than a stray space.
    fullName: sql<string>`coalesce(
      nullif(trim(concat_ws(' ',
        ${registrations.answers}->>'surname',
        ${registrations.answers}->>'firstName',
        ${registrations.answers}->>'patronymic'
      )), ''),
      nullif(trim(${users.displayName}), ''),
      ''
    )`,
    email: sql<
      string | null
    >`coalesce(nullif(${registrations.answers}->>'email', ''), ${users.email})`,
    // EARS-16 applies to the phone exactly as it does to the name and the
    // email: `users.phone` is one of «the account's own profile values», so a
    // platform-origin row renders it rather than an empty cell. EARS-29 forbids
    // WRITING a congress phone into `users.phone`; reading the account's own
    // number back is not that write.
    phone: sql<string | null>`coalesce(
      nullif(${registrations.answers}->>'contactPhone', ''),
      nullif(trim(${users.phone}), '')
    )`,
    workplace: sql<
      string | null
    >`nullif(${registrations.answers}->>'workplace', '')`,
    city: sql<string | null>`nullif(${registrations.answers}->>'city', '')`,
    region: sql<string | null>`nullif(${registrations.answers}->>'region', '')`,
  };
}

/** The `specialties_minzdrav` join by the id the answers carry (EARS-25). */
const specialtyJoin = sql`${specialtiesMinzdrav.id} = nullif(${registrations.answers}->>'specialtyId', '')::uuid`;

/**
 * «This registration is one of this event's» — the predicate every desk route
 * that names a registration id applies (EARS-38): the attendance write and the
 * participant card both read nothing of another event's row.
 */
function registrationOfEvent(eventId: string, registrationId: string): SQL {
  return and(
    eq(registrations.id, registrationId),
    eq(registrations.eventId, eventId),
  )!;
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
    // 010 EARS-3/5 — attribute the registrations write to the acting caller
    // (source portal-api) via the audit-context wrapper.
    return withRequestAuditContext(this.db, async (tx) => {
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
   * air date first (`starts_at ASC`). A `draft`/`ended`/`hidden` registration
   * drops by STATE, never by time (EARS-6: ended/hidden never list). Joined on
   * `registrations.event_id` filtered to `user_id = userId`, so it returns ONLY the
   * caller's own registrations — never another doctor's (EARS-10). An empty match
   * is a valid empty list (design §5). No registrant PII, no roster — only the thin
   * per-event choose-set the «мои события» card renders.
   */
  async findMyEvents(
    userId: string,
    tab: MyEventsTab,
    cutoff: Date,
  ): Promise<MyEventRow[]> {
    const rows = await this.db
      .select({
        eventId: events.id,
        slug: events.slug,
        title: events.title,
        school: events.school,
        startsAt: events.startsAt,
        state: events.state,
        participationFormat: events.participationFormat,
      })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(and(eq(registrations.userId, userId), tabMembership(tab, cutoff)))
      // Most-relevant-first on each side: the imminent эфир leads Предстоящие
      // (`starts_at ASC`, the shipped EARS-6 order), the most recent finished one
      // leads Записи (`starts_at DESC`, 014 EARS-9).
      .orderBy(
        tab === "upcoming" ? asc(events.startsAt) : desc(events.startsAt),
      );
    return rows.map((r) => ({
      eventId: r.eventId,
      slug: r.slug,
      title: r.title,
      school: r.school,
      startsAt: r.startsAt.toISOString(),
      // Narrowed to the tab's membership set by the SQL state filter above.
      state: r.state as MyEventRow["state"],
      participationFormat: r.participationFormat,
    }));
  }

  /**
   * Both tabs' row counts in ONE statement (014 EARS-9). The tab bar renders
   * «Предстоящие · N | Записи · N» in a single paint, so the count of the tab the
   * doctor is NOT looking at is needed on every read; issuing it as a second
   * round-trip per tab would make the two labels observably disagree while one
   * request is in flight. `FILTER` keeps it one index-backed pass over the
   * doctor's registrations.
   */
  async countMyEvents(
    userId: string,
    cutoff: Date,
  ): Promise<MyEventsCounts> {
    const [row] = await this.db
      .select({
        upcoming: sql<number>`count(*) FILTER (WHERE ${tabMembership("upcoming", cutoff)})::int`,
        recordings: sql<number>`count(*) FILTER (WHERE ${tabMembership("recordings", cutoff)})::int`,
      })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(eq(registrations.userId, userId));
    return { upcoming: row?.upcoming ?? 0, recordings: row?.recordings ?? 0 };
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
   *
   * 044 EARS-30 adds the `possibleDuplicate` marker, and adds it HERE rather
   * than as a column: it is derived per read by a window count over the
   * normalised contact phone (EARS-29) inside the event, so nothing is stored
   * and nothing is swept — when the team removes one of the sharing
   * registrations on request, the survivor simply stops being counted, with no
   * write to the surviving row. `WHERE event_id = …` is applied before the
   * window, so the partition is already scoped to this event. The phone itself
   * is neither selected nor returned: only the boolean leaves the query, so the
   * no-PII invariant above holds unchanged. Rows whose key is NULL or empty (a
   * platform-origin registration, EARS-16, has no answers at all) are forced to
   * `false` by the `CASE`: SQL partitions all NULLs together, so without that
   * guard every answer-less row on an event would mark every other one.
   */
  async findEventRoster(eventId: string): Promise<EventRosterEntry[]> {
    const rows = await this.db
      .select({
        userId: registrations.userId,
        eventId: registrations.eventId,
        registeredAt: registrations.registeredAt,
        possibleDuplicate: possibleDuplicateOverScope(),
      })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, eventId),
          // #2456 — staff sign-ups are not participants.
          isParticipant(registrations.userId),
        ),
      )
      .orderBy(asc(registrations.registeredAt));
    return rows.map((r) => ({
      userId: r.userId,
      eventId: r.eventId,
      registeredAt: r.registeredAt.toISOString(),
      possibleDuplicate: r.possibleDuplicate,
    }));
  }

  /**
   * 044 EARS-18 — the SAME roster read, widened for the registrar's desk.
   *
   * It is a second method rather than an option on {@link findEventRoster}
   * because the two readers differ in what they are ALLOWED to see: feature 006
   * admits a doctor to a room and must keep reading the PII-free fact, while this
   * one resolves the person standing at the desk. Keeping them apart means a
   * future change to the room gate can never quietly widen into participant
   * contact data.
   *
   * Two properties are load-bearing:
   *
   *   • **Every answer-derived cell falls back to the account** (EARS-16): a
   *     platform-origin registration has `answers = null`, so its name, email
   *     and phone come from `users`, and a cell with neither stays empty rather
   *     than rendering a placeholder.
   *   • **`total` counts the filtered set over the whole event**, not the page:
   *     it is the pager's denominator, so it must be the same predicate without
   *     `limit`/`offset`.
   *
   * The order is the EARS-22 sort ({@link rosterOrderBy}); without one it is
   * the `registered_at ASC` the read model has always had, tie-broken by `id` so
   * that a page boundary is stable when two rows share an instant. Per-column
   * filters are EARS-23, and the «возможный дубль» marker is EARS-30/EARS-31 —
   * neither is here.
   */
  async findEventRosterPage(
    eventId: string,
    query: CongressRosterQuery,
    congressDays: readonly string[],
  ): Promise<{ items: CongressRosterRow[]; total: number }> {
    // The answers payload is the primary source; the account mirror is the
    // EARS-16 fallback.
    const { fullName, email, phone, workplace, city, region } =
      registrationCells();
    // Never rendered — searched only. The normalised form exists for comparison
    // (EARS-29), so a registrar typing `89001112233` finds the row that renders
    // `+7 (900) 111-22-33`.
    const phoneNormalised = sql<
      string | null
    >`nullif(${registrations.answers}->>'contactPhoneNormalised', '')`;

    const where = and(
      eq(registrations.eventId, eventId),
      // #2456 — a staff account's registration is not a roster row (and not in
      // the pager's total).
      isParticipant(registrations.userId),
      this.rosterSearchPredicate(
        query.q,
        {
          fullName,
          email,
          phone,
          workplace,
          city,
          region,
          specialtyName: specialtiesMinzdrav.name,
        },
        phoneNormalised,
      ),
      this.rosterAttendancePredicate(query),
    );

    const pageSize = query.pageSize;
    const offset = (query.page - 1) * pageSize;

    const rows = await this.db
      .select({
        registrationId: registrations.id,
        fullName,
        specialtyName: specialtiesMinzdrav.name,
        workplace,
        city,
        region,
        phone,
        email,
        registeredAt: registrations.registeredAt,
        confirmationMailStatus: registrations.confirmationMailStatus,
      })
      .from(registrations)
      .leftJoin(users, eq(users.id, registrations.userId))
      .leftJoin(specialtiesMinzdrav, specialtyJoin)
      .where(where)
      .orderBy(
        ...this.rosterOrderBy(query, {
          fullName,
          city,
          phone,
          phoneNormalised,
        }),
      )
      .limit(pageSize)
      .offset(offset);

    const [counted] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(registrations)
      .leftJoin(users, eq(users.id, registrations.userId))
      .leftJoin(specialtiesMinzdrav, specialtyJoin)
      .where(where);

    const marks = await this.findAttendanceMarks(
      rows.map((r) => r.registrationId),
    );

    return {
      items: rows.map((r) => ({
        registrationId: r.registrationId,
        fullName: r.fullName,
        specialtyName: r.specialtyName ?? null,
        workplace: r.workplace ?? null,
        city: r.city ?? null,
        region: r.region ?? null,
        phone: r.phone ?? null,
        email: r.email ?? null,
        registeredAt: r.registeredAt.toISOString(),
        confirmationMailStatus: r.confirmationMailStatus ?? null,
        attendance: congressDays.map(
          (day): CongressDayAttendance => ({
            day,
            present: marks.get(r.registrationId)?.has(day) ?? false,
          }),
        ),
      })),
      total: counted?.total ?? 0,
    };
  }

  /**
   * 044 EARS-22 (narrowed by EARS-37) — the roster ORDER BY: the one requested
   * column in the requested direction, then registration date and id ascending
   * as the tie-break, so equal keys keep today's order and a page boundary is
   * deterministic. No `sort` is {@link CONGRESS_ROSTER_SORT_DEFAULT}, which
   * yields exactly `registered_at ASC, id ASC` — the order before EARS-22.
   *
   * - Text columns order under the ICU Russian collation (`ru-x-icu`, shipped
   *   by the pgvector/postgres image on every stand): case-insensitive, «ё»
   *   beside «е», rather than the database's `en_US` byte-ish order that would
   *   put «Ё» before «А» and lowercase after uppercase. An empty cell is NULL
   *   (`nullif`), and `NULLS LAST` keeps it at the end in BOTH directions.
   * - The phone orders by its digits: the normalised form (EARS-29) where the
   *   answers carry one, else the rendered value, stripped to digits — never
   *   by the text as typed, whose brackets and spaces would decide the order.
   * - присутствие is the `attendanceDay` mark (the schema refuses the key
   *   without a day): a missing row is «not marked», so ascending puts the
   *   unmarked first and descending the marked.
   */
  private rosterOrderBy(
    query: CongressRosterQuery,
    cells: {
      fullName: SQL<string>;
      city: SQL<string | null>;
      phone: SQL<string | null>;
      phoneNormalised: SQL<string | null>;
    },
  ): SQL[] {
    const sort = query.sort ?? CONGRESS_ROSTER_SORT_DEFAULT.sort;
    const dir =
      query.dir === "desc" ? sql.raw("desc") : sql.raw("asc");
    const russian = (cell: SQL | AnyPgColumn): SQL =>
      sql`${cell} collate "ru-x-icu"`;
    const tieBreak = [asc(registrations.registeredAt), asc(registrations.id)];
    let key: SQL;
    switch (sort) {
      case "registeredAt":
        return [sql`${registrations.registeredAt} ${dir}`, asc(registrations.id)];
      case "fullName":
        key = russian(sql`nullif(${cells.fullName}, '')`);
        break;
      case "specialty":
        key = russian(specialtiesMinzdrav.name);
        break;
      case "city":
        key = russian(cells.city);
        break;
      case "phone":
        key = sql`nullif(regexp_replace(coalesce(${cells.phoneNormalised}, ${cells.phone}), '[^0-9]', '', 'g'), '')`;
        break;
      case "presence":
        key = sql`exists (
          select 1 from ${registrationAttendance}
           where ${registrationAttendance.registrationId} = ${registrations.id}
             and ${registrationAttendance.day} = ${query.attendanceDay}
             and ${registrationAttendance.present} = true
        )`;
        break;
    }
    return [sql`${key} ${dir} nulls last`, ...tieBreak];
  }

  /**
   * 044 EARS-34 — the presence filter as an `EXISTS` over
   * `registration_attendance`: `marked` keeps the rows marked present on the
   * day, `unmarked` every other row (never marked, or cleared). It is one more
   * conjunct of the roster's WHERE, so it composes with the search, the paging
   * and the count by construction. The day itself was checked against the
   * configured congress days by the service.
   */
  private rosterAttendancePredicate(
    query: CongressRosterQuery,
  ): SQL | undefined {
    if (query.attendanceDay === undefined || query.present === undefined) {
      return undefined;
    }
    const markedPresent = sql`exists (
      select 1 from ${registrationAttendance}
       where ${registrationAttendance.registrationId} = ${registrations.id}
         and ${registrationAttendance.day} = ${query.attendanceDay}
         and ${registrationAttendance.present} = true
    )`;
    return query.present === "marked" ? markedPresent : sql`not ${markedPresent}`;
  }

  /** The days each of `registrationIds` is marked present on (EARS-34). */
  private async findAttendanceMarks(
    registrationIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const marks = new Map<string, Set<string>>();
    if (registrationIds.length === 0) return marks;
    const rows = await this.db
      .select({
        registrationId: registrationAttendance.registrationId,
        day: registrationAttendance.day,
      })
      .from(registrationAttendance)
      .where(
        and(
          inArray(registrationAttendance.registrationId, [...registrationIds]),
          eq(registrationAttendance.present, true),
        ),
      );
    for (const row of rows) {
      const days = marks.get(row.registrationId) ?? new Set<string>();
      days.add(row.day);
      marks.set(row.registrationId, days);
    }
    return marks;
  }

  /**
   * 044 EARS-36 — the participant card of one registration OF `eventId`, or
   * `undefined` when the registration is not one of that event's (EARS-38: a
   * guessed id of another event reads nothing).
   *
   * - The answers and the account fallback are {@link registrationCells}, the
   *   roster's own definitions; the name parts are the answers alone (the
   *   account has only a display name, which `fullName` already falls back to).
   * - «возможный дубль» is {@link possibleDuplicateOverScope} computed over the
   *   event's rows in a subquery, THEN narrowed to this registration — the
   *   window has to see the whole event to count a shared phone.
   * - Consents are the participant's congress sign-up consent rows.
   * - Attendance is the current `registration_attendance` value per configured
   *   day (`null` = never marked) plus the day's 010 audit history
   *   ({@link findAttendanceHistory}).
   *
   * `account_created_by_intake` is deliberately never selected (EARS-36).
   */
  async findParticipantCard(
    eventId: string,
    registrationId: string,
    congressDays: readonly string[],
  ): Promise<CongressParticipantCard | undefined> {
    const cells = registrationCells();
    const duplicates = this.db
      .select({
        id: registrations.id,
        possibleDuplicate: possibleDuplicateOverScope(),
      })
      .from(registrations)
      .where(eq(registrations.eventId, eventId))
      .as("duplicates");
    const [row] = await this.db
      .select({
        registrationId: registrations.id,
        userId: registrations.userId,
        surname: sql<
          string | null
        >`nullif(${registrations.answers}->>'surname', '')`,
        firstName: sql<
          string | null
        >`nullif(${registrations.answers}->>'firstName', '')`,
        patronymic: sql<
          string | null
        >`nullif(${registrations.answers}->>'patronymic', '')`,
        ...cells,
        specialtyName: specialtiesMinzdrav.name,
        registeredAt: registrations.registeredAt,
        intakeOrigin: registrations.intakeOrigin,
        confirmationMailStatus: registrations.confirmationMailStatus,
        confirmationMailAt: registrations.confirmationMailAt,
        possibleDuplicate: duplicates.possibleDuplicate,
      })
      .from(registrations)
      .innerJoin(duplicates, eq(duplicates.id, registrations.id))
      .leftJoin(users, eq(users.id, registrations.userId))
      .leftJoin(specialtiesMinzdrav, specialtyJoin)
      .where(registrationOfEvent(eventId, registrationId))
      .limit(1);
    if (!row) return undefined;

    const consents = await this.db
      .select({
        purpose: consentRecords.purpose,
        version: consentRecords.version,
        capturedAt: consentRecords.capturedAt,
        origin: consentRecords.origin,
      })
      .from(consentRecords)
      .where(
        and(
          eq(consentRecords.userId, row.userId),
          inArray(consentRecords.purpose, [
            ...CONGRESS_SIGN_UP_CONSENT_PURPOSES,
          ]),
        ),
      )
      .orderBy(asc(consentRecords.capturedAt), asc(consentRecords.id));

    const current = await this.db
      .select({
        day: registrationAttendance.day,
        present: registrationAttendance.present,
      })
      .from(registrationAttendance)
      .where(eq(registrationAttendance.registrationId, registrationId));
    const currentByDay = new Map(current.map((c) => [c.day, c.present]));
    const history = await this.findAttendanceHistory(
      registrationId,
      row.registeredAt,
    );

    return {
      registrationId: row.registrationId,
      surname: row.surname ?? null,
      firstName: row.firstName ?? null,
      patronymic: row.patronymic ?? null,
      fullName: row.fullName,
      specialtyName: row.specialtyName ?? null,
      workplace: row.workplace ?? null,
      city: row.city ?? null,
      region: row.region ?? null,
      phone: row.phone ?? null,
      email: row.email ?? null,
      registeredAt: row.registeredAt.toISOString(),
      intakeOrigin: row.intakeOrigin,
      consents: consents.map((c) => ({
        purpose: c.purpose,
        version: c.version,
        capturedAt: c.capturedAt.toISOString(),
        origin: c.origin ?? null,
      })),
      confirmationMail: {
        status: row.confirmationMailStatus ?? null,
        at: row.confirmationMailAt?.toISOString() ?? null,
      },
      possibleDuplicate: row.possibleDuplicate,
      attendance: congressDays.map(
        (day): CongressParticipantDay => ({
          day,
          present: currentByDay.get(day) ?? null,
          history: history.get(day) ?? [],
        }),
      ),
    };
  }

  /**
   * 044 EARS-36 — the history of one registration's attendance marks, per day,
   * oldest first, read from the 010 change audit: the `audit_row_change()`
   * rows the trigger on `registration_attendance` appended (`metadata.table`,
   * `metadata.pk` = the row key, `metadata.diff.present.new` = the value after
   * the change; a DELETE leaves no mark, i.e. `false`).
   *
   * This is the first reader of `audit_ledger`, so it stays narrow: one table,
   * one registration's row keys. `created_at >= registeredAt` lets Postgres
   * prune the monthly partitions older than the registration itself — no
   * attendance row can predate its registration. The actor is the ledger's
   * `subject_id` resolved to the matching `users` display name, else that
   * user's email, else the raw `sub` (an actor with no `users` row, e.g. a
   * direct DB write); the source is the label as stored.
   */
  private async findAttendanceHistory(
    registrationId: string,
    since: Date,
  ): Promise<Map<string, CongressAttendanceHistoryEntry[]>> {
    const rows = await this.db
      .select({
        day: sql<string>`${auditLedger.metadata}->'pk'->>'day'`,
        present: sql<boolean>`coalesce((${auditLedger.metadata}->'diff'->'present'->>'new')::boolean, false)`,
        at: auditLedger.createdAt,
        actor: sql<
          string | null
        >`coalesce(nullif(trim(${users.displayName}), ''), ${users.email}::text, ${auditLedger.subjectId})`,
        source: sql<string>`coalesce(${auditLedger.metadata}->>'source', 'db-direct')`,
      })
      .from(auditLedger)
      .leftJoin(users, eq(users.zitadelSub, auditLedger.subjectId))
      .where(
        and(
          sql`${auditLedger.metadata}->>'table' = 'registration_attendance'`,
          sql`${auditLedger.metadata}->'pk'->>'registration_id' = ${registrationId}`,
          gte(auditLedger.createdAt, since),
        ),
      )
      .orderBy(asc(auditLedger.createdAt), asc(auditLedger.id));
    const byDay = new Map<string, CongressAttendanceHistoryEntry[]>();
    for (const r of rows) {
      const entries = byDay.get(r.day) ?? [];
      entries.push({
        present: r.present,
        at: r.at.toISOString(),
        actor: r.actor ?? null,
        source: r.source,
      });
      byDay.set(r.day, entries);
    }
    return byDay;
  }

  /**
   * 044 EARS-34 — set one registration's attendance on one congress day, inside
   * the request audit context so the 010 trigger attributes the change to the
   * acting registrar (source `admin-ui`).
   *
   * Returns `false` — and writes nothing — when the registration is not a
   * registration OF `eventId`: the route never reveals, let alone mutates,
   * another event's row.
   *
   * A write that would not change the stored value touches no row, so the
   * ledger records changes, not touches:
   * - `present = true` is an upsert whose `DO UPDATE` only fires when the stored
   *   value differs (`IS DISTINCT FROM`);
   * - `present = false` only UPDATEs an existing `true` row — a day nobody
   *   marked already reads «not present», so clearing it inserts nothing.
   */
  async setAttendance(
    eventId: string,
    registrationId: string,
    day: string,
    present: boolean,
  ): Promise<boolean> {
    return withRequestAuditContext(this.db, async (tx) => {
      const [owned] = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(registrationOfEvent(eventId, registrationId))
        .limit(1);
      if (!owned) return false;

      if (present) {
        await tx
          .insert(registrationAttendance)
          .values({ registrationId, day, present: true })
          .onConflictDoUpdate({
            target: [
              registrationAttendance.registrationId,
              registrationAttendance.day,
            ],
            set: { present: true },
            setWhere: sql`${registrationAttendance.present} is distinct from excluded.present`,
          });
      } else {
        await tx
          .update(registrationAttendance)
          .set({ present: false })
          .where(
            and(
              eq(registrationAttendance.registrationId, registrationId),
              eq(registrationAttendance.day, day),
              eq(registrationAttendance.present, true),
            ),
          );
      }
      return true;
    });
  }

  /**
   * The EARS-21 instant search: one case-insensitive «contains» term over every
   * identifying cell of the row. The term is matched against the concatenation
   * rather than column-by-column so that «Иванов Москва» is not silently a
   * no-match on a per-column `OR` — and the caller's own `%`/`_`/`\` are escaped,
   * because a registrar typing a phone fragment must not be able to turn the
   * search into a wildcard that matches the whole event.
   *
   * The phone is the one cell where a literal «contains» is not enough: the row
   * renders the number exactly as it was typed (EARS-29), so `+7 (900) 111-22-33`
   * would be invisible to a registrar typing `89001112233`. The normalised value
   * EARS-29 stores beside it exists for exactly that comparison, so a term that
   * normalises to a phone of its own is ALSO matched against it, under the same
   * `8 → 7` and punctuation rules the intake applied to the stored value — which
   * is what makes the two comparable at all.
   */
  private rosterSearchPredicate(
    q: string | undefined,
    cells: Record<string, SQL<unknown> | SQL<string | null> | AnyPgColumn>,
    phoneNormalised: SQL<string | null>,
  ): SQL | undefined {
    const term = q?.trim();
    if (!term) return undefined;
    const escape = (value: string): string =>
      value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const blob = sql.join(
      Object.values(cells).map((cell) => sql`coalesce(${cell}, '')`),
      sql`, `,
    );
    const text = sql`concat_ws(' ', ${blob}) ilike ${`%${escape(term)}%`} escape '\\'`;

    // The leading `+` is dropped so a FRAGMENT matches too: the stored key is
    // `+79001112233`, and a registrar typing `9001112` means those digits
    // anywhere in the number, not a number that starts with them.
    const digits = normaliseContactPhone(term).replace(/^\+/, "");
    // Four digits is the shortest run that is plausibly a phone fragment rather
    // than a house number inside an address the text arm already covers.
    if (digits.length < 4) return text;
    return or(
      text,
      sql`coalesce(${phoneNormalised}, '') like ${`%${escape(digits)}%`} escape '\\'`,
    );
  }

  /**
   * 044 EARS-18 — the event header the roster page titles itself with. Read
   * separately from the rows because it must answer for an event with NO
   * registrations too: an empty roster is a valid page of a real event, not a 404.
   */
  async findEventHeader(
    idOrSlug: string,
  ): Promise<
    { id: string; slug: string; title: string; startsAt: Date } | undefined
  > {
    const [row] = await this.db
      .select({
        id: events.id,
        slug: events.slug,
        title: events.title,
        startsAt: events.startsAt,
      })
      .from(events)
      .where(
        UUID_RE.test(idOrSlug)
          ? or(eq(events.id, idOrSlug), eq(events.slug, idOrSlug))
          : eq(events.slug, idOrSlug),
      )
      .limit(1);
    return row;
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
