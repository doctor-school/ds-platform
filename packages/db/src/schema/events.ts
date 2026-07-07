import {
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// 007 — the event-admin aggregate (the authoring vertical's write model, design
// §3; ADR-0003 Data Layer). 007 owns this write model; 004/005/006 read
// projections of it. The program-PDF *binary* lives in object storage (Timeweb /
// MinIO on the dev stand) — only its storage key (`program_pdf_ref`) is on the
// row, never the bytes.

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

export const events = pgTable("events", {
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Ordered free-text speaker entries (LD-1). Wave 1 is text only; the list shape
 * is deliberately extensible so a wave-2 real-record reference variant is an
 * additive migration, not a reshape. `position` is the presentation order; the
 * composite PK `(event_id, position)` keeps the ordering unique per event.
 */
export const eventSpeakers = pgTable(
  "event_speakers",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    regalia: text("regalia").notNull().default(""),
  },
  (t) => [
    primaryKey({
      name: "event_speakers_pkey",
      columns: [t.eventId, t.position],
    }),
  ],
);

/**
 * The closed stream-provider enum (design §3, EARS-3). A real Postgres enum
 * mirroring `StreamProviderSchema` in `@ds/schemas` — wave 1 is exactly
 * `rutube | youtube`; extending it later is an additive migration, never a
 * URL-sniffed inference. drizzle-kit emits the `CREATE TYPE` in the migration.
 */
export const streamProvider = pgEnum("stream_provider", ["rutube", "youtube"]);

/**
 * The event's stream config (design §3, EARS-3) — the `{ provider, embed_ref }`
 * the 006 room instantiates the player from, authored in 007. One config per
 * event: `event_id` is the PK **and** the FK, so `ConfigureStream` is an
 * idempotent upsert (a correction replaces the single row, never a state
 * reversal). `embed_ref` is the provider-scoped stream id — never a URL to be
 * sniffed. Cascade-deleted with its event.
 */
export const streamConfig = pgTable("stream_config", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  provider: streamProvider("provider").notNull(),
  embedRef: text("embed_ref").notNull(),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventSpeaker = typeof eventSpeakers.$inferSelect;
export type NewEventSpeaker = typeof eventSpeakers.$inferInsert;
export type StreamConfigRow = typeof streamConfig.$inferSelect;
export type NewStreamConfigRow = typeof streamConfig.$inferInsert;
