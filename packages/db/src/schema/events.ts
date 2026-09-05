import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { recordStatus } from "./lifecycle.js";

// 007 — the event-admin aggregate (the authoring vertical's write model, design
// §3; ADR-0003 Data Layer). 007 owns this write model; 004/005/006 read
// projections of it. The program-PDF *binary* lives in object storage (Timeweb /
// MinIO on the dev stand) — only its storage key (`program_pdf_ref`) is on the
// row, never the bytes.
//
// #1278 — all three tables here are RETAINED, soft-removable rows (ADR-0003
// design §3.6): `record_status` + `deleted_at` express removal, the child FKs to
// `events.id` are `RESTRICT`, and nothing on this aggregate is ever physically
// deleted. `record_status` is deliberately NOT the same axis as `events.state`:
// `state` is the 007 EARS-7 domain machine (a `hidden` event is a present,
// readable row), `record_status` is presence-vs-removal.

/**
 * The event-lifecycle state vocabulary — the union of BOTH machines' states
 * (007 design §2 EARS-7 + 014 design §3.1 EARS-23). A real Postgres enum type
 * mirroring the `EventLifecycleStateSchema` API contract in `@ds/schemas` (the
 * DB owns the column type; the schema owns the wire contract) — drizzle-kit
 * emits the `CREATE TYPE` in the migration.
 *
 * It is deliberately ONE column and ONE type across two machines rather than a
 * per-machine column: an event holds exactly one state at a time, and
 * {@link eventOrigin} — not a second nullable column — says which machine that
 * state belongs to. Which values are legal for a given row is therefore a
 * domain rule (`@ds/schemas` `LIFECYCLE_TRANSITIONS`, enforced server-side and
 * verified by 014 EARS-23/27), not something the enum can express:
 *
 * * `platform` — `draft → published → live → ended → hidden` (007);
 * * `legacy` — `hidden ⇄ in_archive` (014 §3.1 machine 2).
 *
 * `hidden` is the one value both machines share, and it means the same thing in
 * both: no public surface lists the event.
 */
export const eventLifecycleState = pgEnum("event_lifecycle_state", [
  "draft",
  "published",
  "live",
  "ended",
  "hidden",
  "in_archive",
]);

/**
 * 014 EARS-23 (#1741) — the lifecycle DISCRIMINATOR: which machine this event
 * runs on. `platform` is a broadcast the platform hosts end to end (007);
 * `legacy` is an эфир held before features 006/007 existed, or run off-platform,
 * that exists only to carry its recording into the public archive.
 *
 * Set once at creation and rejected by every update path — no command moves an
 * event between machines, so a `legacy` row can never acquire a room record, a
 * stream config, a presence window or a `live` state (014-design §3.1).
 *
 * `platform` is the DEFAULT and the back-fill for every row that predates this
 * column: every event authored so far came through 007's own create path, so
 * «platform» is the truthful value for the existing corpus rather than a
 * placeholder. The platform create paths never send `origin` at all.
 */
export const eventOrigin = pgEnum("event_origin", ["platform", "legacy"]);

/**
 * 020 EARS-1 / LD-5 (#1764) — the event's **participation format**: where the
 * doctor actually attends. A real Postgres enum mirroring
 * `EventParticipationFormatSchema` in `@ds/schemas`, on the same
 * DB-owns-the-column-type / schema-owns-the-wire-contract split as
 * {@link eventLifecycleState}.
 *
 * It is a SEPARATE axis from 019's five-value catalogue format
 * (`webinar` · `online-meeting` · `offline-meetup` · `congress` · `podcast`),
 * which is editorial kind, not attendance mode: a `congress` is routinely
 * hybrid. Folding the two together would make «are there seats to run out of» a
 * property of an editorial label (020-design §4).
 */
export const eventParticipationFormat = pgEnum("event_participation_format", [
  "online",
  "offline",
  "hybrid",
]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** URL-safe unique handle (title-derived); the 004 public page keys on it. */
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    /** Series / school kicker. */
    school: text("school").notNull(),
    /** Canonical UTC instant — entered + rendered as МСК (EARS-1, EARS-10). */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    description: text("description").notNull().default(""),
    /** Target specialty codes. */
    specialties: text("specialties").array().notNull().default([]),
    /** Sponsor / partner reference (free text in wave 1). */
    partnerRef: text("partner_ref"),
    /** Object-storage key for the current program PDF; null until one is uploaded. */
    programPdfRef: text("program_pdf_ref"),
    state: eventLifecycleState("state").notNull().default("draft"),
    /**
     * 014 EARS-23 (#1741) — the immutable lifecycle discriminator
     * ({@link eventOrigin}). Never patched: the update path refuses a client
     * `origin`, and the two legacy commands assert it rather than write it.
     */
    origin: eventOrigin("origin").notNull().default("platform"),
    /**
     * 020 EARS-1 (#1764) — attendance mode. `online` is the DEFAULT and the
     * back-fill for every row that predates this column: every event the
     * platform has run so far was a webinar, so «online» is the truthful value
     * for the existing corpus rather than a placeholder.
     */
    participationFormat: eventParticipationFormat("participation_format")
      .notNull()
      .default("online"),
    /**
     * 020 LD-5 (#1764) — the remaining offline seats. `null` means there is no
     * seat limit to run out of (an online event, or an offline/hybrid event
     * whose capacity the operator has not bounded) and is the back-fill for
     * every existing row; `0` means «мест нет» and is what drives
     * `switch-to-online` on a hybrid event and `sold-out` on a pure offline one.
     * The two are deliberately different values — conflating them would invent a
     * sold-out state for every online webinar.
     *
     * The seat TOTAL the format block renders beside it («N мест, осталось M»)
     * lands with that block at EARS-8 / #1771: modelling a column no read
     * projects yet would be the untracked seam F-22 forbids.
     */
    seatsLeft: integer("seats_left"),
    /**
     * #1593 — the optimistic-concurrency version of the event aggregate, the
     * same column `event_recordings` and every versioned taxonomy row already
     * carry (012-design §6). The 007 admin detail read projects it as the weak
     * `ETag` validator (`W/"<version>"`), and every admin mutation applies its
     * write CAS-guarded on the version the caller read at — `SET version =
     * version + 1 WHERE id = :id AND version = :expected`. A zero-row update is
     * the definition of "the row moved under the caller", answered 412.
     *
     * Starts at 1 and is monotonic per row, never reused: it is a change
     * COUNTER, not a content hash, so two edits that happen to restore the
     * original field values still produce different validators — a client
     * holding the pre-edit ETag must be told it is stale, because the audit
     * history it was reasoning about has moved on. Bumped on the committed
     * mutation only; a refused transition (409/412) writes nothing at all.
     */
    version: integer("version").notNull().default(1),
    /**
     * The actual go-live instant — server-stamped exactly once when the director
     * opens the room (the `published → live` transition, 007 EARS-5 `OpenRoom`),
     * `null` until then and on any event that never went live. Distinct from
     * `starts_at` (the *scheduled* wall-clock): the 006 room's live-elapsed
     * indicator («В эфире · N мин») is truthfully derived from the moment the room
     * actually opened, never from the schedule (a broadcast that starts late must
     * not show inflated elapsed minutes). Set once and never overwritten — the
     * closed lifecycle map forbids re-entering `live`, so there is no second
     * go-live to record; a legacy `live` row predating this column stays `null`
     * and the room renders the pill with no suffix (truthful, not back-filled).
     */
    liveAt: timestamp("live_at", { withTimezone: true }),
    /**
     * 014 EARS-1 (#1339) — the day the operator promises the recording by, shown
     * on the post-live «запись готовится» plaque (014-design §2). A `date`, not a
     * timestamp: the plaque promises a DAY, and a timezone-bearing instant would
     * invite a precision the operator never entered. `null` means «no date
     * promised» — the plaque then carries no date rather than a made-up one.
     */
    recordingExpectedBy: date("recording_expected_by"),
    /**
     * #1278 retained-row lifecycle (ADR-0003 design §3.6). Removing an event is
     * `record_status = 'retired'` + `deleted_at = now()` in one transaction; the
     * row, its id and its slug survive forever, so a bookmarked event URL can
     * never later resolve to a different broadcast (§3.6 rule 5).
     */
    recordStatus: recordStatus("record_status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "events_retired_iff_deleted",
      sql`(${t.recordStatus} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    // §3.6 rule 3: the default product/admin read path is the ACTIVE
    // projection, and a partial index serves exactly that path — the public
    // catalogue scan never pays for retired rows.
    //
    // The predicate MUST be spelled the same way the readers spell it —
    // `record_status = 'active'`, matching `ACTIVE_EVENT` in
    // `events.repository.ts`. `deleted_at IS NULL` is logically equivalent
    // through the CHECK above, but the planner proves partial-index
    // applicability from the query's own restriction clauses and never consults
    // a CHECK constraint to bridge the two, so an index predicated on the other
    // column would simply never be used.
    // 020 LD-5: seats are a count, never a negative. `null` (no limit) passes —
    // a CHECK is not violated by an unknown.
    check("events_seats_left_non_negative", sql`${t.seatsLeft} >= 0`),
    index("events_active_starts_at_idx")
      .on(t.startsAt)
      .where(sql`${t.recordStatus} = 'active'`),
  ],
);

/**
 * The closed stream-provider enum (design §3, EARS-3). A real Postgres enum
 * mirroring `StreamProviderSchema` in `@ds/schemas` — `rutube | youtube | vk |
 * cdnvideo` (all RU-reachable, embeddable providers; vk/cdnvideo added #1134).
 * Extending it is an additive migration (`ALTER TYPE … ADD VALUE`), never a
 * URL-sniffed inference. drizzle-kit emits the enum change in the migration.
 */
export const streamProvider = pgEnum("stream_provider", [
  "rutube",
  "youtube",
  "vk",
  "cdnvideo",
]);

/**
 * The event's stream config (design §3, EARS-3) — the `{ provider, embed_ref }`
 * the 006 room instantiates the player from, authored in 007. One config per
 * event: `event_id` is the PK **and** the FK, so `ConfigureStream` is an
 * idempotent upsert (a correction replaces the single row, never a state
 * reversal). `embed_ref` is the provider-scoped stream id — never a URL to be
 * sniffed.
 *
 * #1278 (ADR-0003 design §3.6): the FK is `RESTRICT`, so a stream config can no
 * longer be swept away as a side effect of touching its event, and "this event
 * has no stream any more" is the transition `record_status = 'retired'` +
 * `deleted_at = now()` on the retained row. Because the PK is the event id there
 * is exactly one config row per event for all time: re-configuring a retired
 * stream is the explicit restore of §3.6 rule 2 — the same row returns to
 * `active` with `deleted_at` cleared and the new provider/embed values — never a
 * second row and never a delete-then-insert.
 */
export const streamConfig = pgTable(
  "stream_config",
  {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => events.id, { onDelete: "restrict" }),
    provider: streamProvider("provider").notNull(),
    embedRef: text("embed_ref").notNull(),
    recordStatus: recordStatus("record_status").notNull().default("active"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "stream_config_retired_iff_deleted",
      sql`(${t.recordStatus} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type StreamConfigRow = typeof streamConfig.$inferSelect;
export type NewStreamConfigRow = typeof streamConfig.$inferInsert;
