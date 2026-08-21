import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events.js";
import { users } from "./users.js";

// 006 EARS-4 — the durable append-only presence table (design §5; ADR-0003 §3
// Data Layer). One immutable row per accepted server-authoritative heartbeat:
// `(doctor, event, instant)`. It is the durable basis for the per-doctor sponsor
// minutes — EARS-5 derives them from the beat timestamps (parameterized over the
// server cadence N, concurrent-tab-coalesced); 006 EARS-4 only captures them.
//
// **Append-only, server-authoritative (requirements Constraints).** Each beat is
// one immutable row — there is no mutable column, so there is nothing to update
// in place: the derivation reads the timestamps, it never mutates them. The
// `beat_at` instant is **server-stamped** (`defaultNow()`), never client-supplied,
// so a client can neither backdate a beat nor inflate a minute count (there is no
// count column — the count/minutes are a server-side read over these rows, never
// a client-trusted value, and no exposed service key writes here: the row is
// appended only behind the room gate, RoomService.recordHeartbeat). Beats join to
// the `users` mirror (003) at read/export time; no registrant PII is denormalized
// onto the row (EARS-8).
//
// Unlike `audit_ledger` this table is NOT partitioned and carries no UPDATE/DELETE
// trigger: the append-only contract here is structural (no mutable column) + the
// repository's INSERT-only surface. Retention/partitioning is a wave-2
// operational concern, not a shape EARS-4 pre-builds.
//
// **#1278 classification: IMMUTABLE / APPEND-ONLY — removal is unsupported**
// (ADR-0003 design §3.6, rule 4: "telemetry/evidence streams remain
// append-only"). This table deliberately carries NO `record_status` and NO
// `deleted_at`, and that absence is the contract, not an omission: a beat is a
// measurement of a moment that either happened or did not, so there is no
// domain act that "removes" one and therefore no lifecycle transition to model.
// Adding a retired state would invent a way to make sponsor minutes disappear
// without an audit trail. Consequently:
//
//   * there is no delete path and no soft-delete path — the only write is INSERT;
//   * both FKs are `RESTRICT` (§3.6 rule 4), so a `users` or `events` row can
//     never take the attendance evidence with it;
//   * a doctor's erasure request is served by ADR-0009 PD erasure on the `users`
//     mirror, which is orthogonal to row retention (§3.6 rule 6) — the beats
//     themselves carry no PD, only opaque ids and instants.
export const presenceBeats = pgTable(
  "presence_beats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** FK users.id (003 UserMirror) — the gated doctor the beat is attributed to. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** FK events.id (004/007 read model) — the live event presence is captured for. */
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    /** Server-stamped canonical UTC instant the beat was appended — append-only. */
    beatAt: timestamp("beat_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The EARS-5 derivation reads every beat for one `(event, doctor)` timeline
    // ordered by instant; this composite index serves that read (and the
    // per-event roster-minutes scan) without a full-table sort.
    index("presence_beats_event_user_beat_idx").on(
      table.eventId,
      table.userId,
      table.beatAt,
    ),
  ],
);

export type PresenceBeat = typeof presenceBeats.$inferSelect;
export type NewPresenceBeat = typeof presenceBeats.$inferInsert;
