/**
 * 012 EARS-26 / EARS-29 (#2509) — every event carries a required kind (an
 * `event_kinds` id) and a required audience (`doctors` | `experts`). Fixtures
 * that create events — raw SQL inserts and admin create payloads alike — take
 * their classification from here so the suites share one source.
 *
 * The kinds are the five migration 0046 seeds with FIXED ids
 * (`SEED_EVENT_KINDS`, the golden catalogue's single source), so every migrated
 * test database has them without a per-suite insert.
 */
import { SEED_EVENT_KINDS } from "@ds/db/seed/golden";

export { SEED_EVENT_KINDS };

/**
 * The default fixture kind: «Встреча клуба» allows every participation format,
 * so a fixture may set any `participation_format` without tripping the
 * kind/format rule it is not testing.
 */
export const TEST_EVENT_KIND_ID = SEED_EVENT_KINDS.vstrechaKluba.id;

/** Academy (004) reads select `experts`; doctor-storefront (019) reads select `doctors`. */
export type TestEventAudience = "doctors" | "experts";

/**
 * The classification fields of an admin create payload (`CreateEventRequest`).
 * Academy-side suites default to `experts` — the audience the Academy listing
 * selects.
 */
export function eventClassification(
  audience: TestEventAudience = "experts",
  kindId: string = TEST_EVENT_KIND_ID,
): { kindId: string; audience: TestEventAudience } {
  return { kindId, audience };
}

/**
 * The SQL value pair for a raw `INSERT INTO events (…, kind_id, audience)`
 * fixture — literals, so the caller's positional parameters stay unchanged.
 */
export function eventClassificationSql(
  audience: TestEventAudience = "experts",
  kindId: string = TEST_EVENT_KIND_ID,
): string {
  return `'${kindId}', '${audience}'`;
}
