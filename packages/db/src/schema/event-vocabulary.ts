import { pgEnum } from "drizzle-orm/pg-core";

// The two closed event vocabularies shared by `events` (events.ts) and the
// taxonomy rows that constrain or prefill them (taxonomy.ts: `event_kinds`,
// `projects`). They live in this import-free leaf module because the two
// schema files reference each other (`events.kind_id → event_kinds.id`,
// `event_projects.event_id → events.id`): an enum evaluated at the top level of
// either file would be read before that file finished loading.

/**
 * 020 EARS-1 / LD-5 (#1764) — the event's **participation format**: where the
 * doctor actually attends. A real Postgres enum mirroring
 * `EventParticipationFormatSchema` in `@ds/schemas`, on the same
 * DB-owns-the-column-type / schema-owns-the-wire-contract split as
 * `eventLifecycleState`.
 *
 * It is a SEPARATE axis from the event kind (012 LD-11 — the open
 * `event_kinds` dictionary), which is editorial: a Конгресс is routinely
 * hybrid. Each kind declares the formats it allows; the event's own format is
 * checked against that set on every create and save (012 EARS-26).
 */
export const eventParticipationFormat = pgEnum("event_participation_format", [
  "online",
  "offline",
  "hybrid",
]);

/**
 * 012 LD-12 (#2509) — the event **audience**, the only selector of the
 * storefront that shows the event: `doctors` → the doctor storefront (web and
 * mobile), `experts` → the Academy. Independent of the kind and the format. A
 * project's `default_audience` prefills it for the project's new events; the
 * event's own value is what every public listing read filters on (012 EARS-29);
 * a read of one event by its slug is not audience-scoped.
 */
export const eventAudience = pgEnum("event_audience", ["doctors", "experts"]);
