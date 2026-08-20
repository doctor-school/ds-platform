import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { events, streamProvider } from "./events.js";

// 014 EARS-1 / EARS-2 (#1339) — retained `event_recordings` (014-design §2, §3;
// ADR-0003 §4 retained-row lifecycle).
//
// A recording is a FIRST-CLASS ROW attached to an event, never a URL column on
// `events`: the two kinds have their own publication lifecycle, their own audit
// history and their own retention, none of which a scalar column can carry.
//
// The playable source reuses feature 006's existing provider abstraction
// (`stream_provider` + `embed_ref`, the same pair `stream_config` carries for the
// live room). 014 adds NO second provider abstraction and stores no media bytes:
// the API hands out a provider-scoped embed reference and never fetches it.

/**
 * The two recording kinds (014-design §2). `raw` is the unedited broadcast
 * capture; `edited` is the later montage. A closed Postgres enum, not free text —
 * the at-most-one-per-kind rule below is an index over this column, and the
 * edited-over-raw display rule (EARS-3) reads it.
 */
export const recordingKind = pgEnum("recording_kind", ["edited", "raw"]);

/**
 * The recording's OWN publication lifecycle (014-design §3), deliberately
 * separate from `event_lifecycle_state`: publishing a recording never moves the
 * event, and the event reaching `ended` never publishes a recording. As in 012,
 * `retired ⇔ deleted_at IS NOT NULL` is a DB CHECK — nothing in 014 is ever
 * physically deleted, and no DELETE route exists.
 */
export const recordingStatus = pgEnum("recording_status", [
  "draft",
  "published",
  "retired",
]);

export const EMBED_REF_MAX = 500;
export const POSTER_REF_MAX = 500;
/** 24 hours — the same practical ceiling `events.duration_min` carries. */
export const RECORDING_DURATION_SEC_MAX = 24 * 60 * 60;

/**
 * `event_recordings` — one retained row per attached recording (014 EARS-1).
 *
 * `event_id` is `RESTRICT` per ADR-0003 §4 and 014-design §2: no 014 path issues
 * a DELETE, and an event may not be deleted out from under its recordings.
 * `first_published_at` is set once by the first publish and pinned by the
 * `event_recordings_first_published_at_set_once` trigger (migration) — unpublish,
 * retire and restore never clear it, so "when did this recording first become
 * visible" survives every later lifecycle move.
 */
export const eventRecordings = pgTable(
  "event_recordings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    kind: recordingKind("kind").notNull(),
    /** The 006 provider abstraction, reused verbatim — never a sniffed URL. */
    provider: streamProvider("provider").notNull(),
    /** Provider-scoped source id. The API never fetches what it points at. */
    embedRef: text("embed_ref").notNull(),
    /** Optional poster reference; `null` renders the provider's own still. */
    posterRef: text("poster_ref"),
    /** Optional runtime in seconds; `null` until the operator knows it. */
    durationSec: integer("duration_sec"),
    status: recordingStatus("status").notNull().default("draft"),
    /** Set once on the first publish; trigger-pinned thereafter. */
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Optimistic-concurrency counter behind the admin ETag; `++` per write. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // LD-1 at-most-one-per-kind, written so a RETIRED row frees the slot: the
    // partial predicate is `deleted_at IS NULL`, which is exactly the retained
    // set. A retired row keeps its id and its history and stops competing.
    uniqueIndex("event_recordings_event_kind_active_uniq")
      .on(t.eventId, t.kind)
      .where(sql`${t.deletedAt} IS NULL`),
    // The read path of the §4 projection and the listing badge: published,
    // non-retired rows of an event, by kind.
    index("event_recordings_event_published_idx")
      .on(t.eventId, t.kind)
      .where(sql`${t.status} = 'published' AND ${t.deletedAt} IS NULL`),
    check(
      "event_recordings_retired_iff_deleted",
      sql`(${t.status} = 'retired') = (${t.deletedAt} IS NOT NULL)`,
    ),
    check(
      "event_recordings_published_has_first_published_at",
      sql`${t.status} <> 'published' OR ${t.firstPublishedAt} IS NOT NULL`,
    ),
    check(
      "event_recordings_embed_ref_bounds",
      sql`char_length(${t.embedRef}) BETWEEN 1 AND ${sql.raw(String(EMBED_REF_MAX))}`,
    ),
    check(
      "event_recordings_poster_ref_bounds",
      sql`${t.posterRef} IS NULL OR char_length(${t.posterRef}) BETWEEN 1 AND ${sql.raw(String(POSTER_REF_MAX))}`,
    ),
    check(
      "event_recordings_duration_bounds",
      sql`${t.durationSec} IS NULL OR (${t.durationSec} > 0 AND ${t.durationSec} <= ${sql.raw(String(RECORDING_DURATION_SEC_MAX))})`,
    ),
    check("event_recordings_version_positive", sql`${t.version} >= 1`),
  ],
);

export type EventRecording = typeof eventRecordings.$inferSelect;
export type NewEventRecording = typeof eventRecordings.$inferInsert;
