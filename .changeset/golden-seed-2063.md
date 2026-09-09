---
"@ds/db": minor
---

#2063 — `@ds/db` gains the golden dataset and its seed (`src/seed/golden`), the
deterministic fixture the staging regression contour restores from.

Every row is pinned: fixed UUIDs (`goldenUuid`), timestamps derived from one
`GOLDEN_NOW` (default `2026-01-15T12:00:00.000Z`, overridable for the drift
check), and a typed `golden` catalogue of the entities scenarios address by name
(`golden.events.upcoming.slug`, `golden.doctors.verifiedCardiologist`, …).
`seedGolden` upserts the whole set in one transaction keyed on those ids, so a
second run rewrites the same values into the same rows and changes nothing
observable; it refuses to run when a golden IdP account's subject is missing
rather than inventing one.

New scripts: `pnpm seed:golden` (fills the database `DATABASE_URL` points at) and
`pnpm staging:golden-db` (`tools/staging/golden-db.mjs` — builds `ds_golden_next`,
migrates, fills, then rotates it into `ds_golden` and keeps one `ds_golden_prev`;
it never migrates the live template in place).
