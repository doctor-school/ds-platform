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
  uniqueIndex,
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
// `state` is the 007 EARS-7 domain machine (an `archived` event is a present,
// readable row), `record_status` is presence-vs-removal.

/**
 * The single event-lifecycle state machine (design §2, EARS-7). A real Postgres
 * enum type — a `draft → published → live → ended → archived` closed set at the
 * DB level, mirroring the `EventLifecycleStateSchema` API contract in
 * `@ds/schemas`. The two agree on the same five values by convention (the DB
 * owns the column type; the schema owns the wire contract) — drizzle-kit emits
 * the `CREATE TYPE` in the migration.
 */
export const eventLifecycleState = pgEnum("event_lifecycle_state", [
  "draft",
  "published",
  "live",
  "ended",
  "archived",
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
    index("events_active_starts_at_idx")
      .on(t.startsAt)
      .where(sql`${t.recordStatus} = 'active'`),
  ],
);

/**
 * Ordered free-text speaker entries (LD-1). Wave 1 is text only; the list shape
 * is deliberately extensible so a wave-2 real-record reference variant is an
 * additive migration, not a reshape. `name` / `regalia` are ORDINARY editorial
 * text — the same public regalia the speaker already publishes on conference
 * sites — so there is no digest column, no key reference and no shadow copy.
 *
 * #1278 reshape (ADR-0003 design §3.6). The old composite PK
 * `(event_id, position)` made the row's identity its ORDERING, which had two
 * consequences: a speaker who moved from position 2 to position 1 was a
 * different row, and "replace the list" could only be expressed as
 * `DELETE` + re-`INSERT` — a physical delete on every edit, forbidden by §3.6
 * rule 1. Identity now lives in a stable `id` (§3.6 rule 5) and ordering is an
 * ordinary mutable column, so an edit is a diff-based upsert:
 *
 *   * a dropped speaker is RETIRED (`record_status = 'retired'` +
 *     `deleted_at = now()`), never deleted — the historical fact that this
 *     person was announced for this broadcast survives;
 *   * `event_speakers_event_position_active_uniq` is PARTIAL
 *     (`WHERE record_status = 'active'`), so retired rows do not squat on a
 *     position the live list needs to reuse, while the live list keeps its
 *     one-speaker-per-slot invariant in the database rather than in the writer;
 *   * `event_speakers_event_id_id_uniq` gives a composite `(event_id, id)`
 *     target so a future child table can reference a speaker WITHIN its event
 *     without a second lookup to prove the pair belongs together.
 */
export const eventSpeakers = pgTable(
  "event_speakers",
  {
    /** Stable speaker-entry identity — independent of the presentation order. */
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    /** Presentation order within the event's ACTIVE list; freely re-orderable. */
    position: integer("position").notNull(),
    name: text("name").notNull(),
    regalia: text("regalia").notNull().default(""),
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
    uniqueIndex("event_speakers_event_position_active_uniq")
      .on(t.eventId, t.position)
      .where(sql`${t.recordStatus} = 'active'`),
    uniqueIndex("event_speakers_event_id_id_uniq").on(t.eventId, t.id),
    check(
      "event_speakers_retired_iff_deleted",
      sql`(${t.recordStatus} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check("event_speakers_position_non_negative", sql`${t.position} >= 0`),
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
export type EventSpeaker = typeof eventSpeakers.$inferSelect;
export type NewEventSpeaker = typeof eventSpeakers.$inferInsert;
export type StreamConfigRow = typeof streamConfig.$inferSelect;
export type NewStreamConfigRow = typeof streamConfig.$inferInsert;
