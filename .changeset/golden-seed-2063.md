---
"@ds/db": minor
---

#2063 — `@ds/db` gains the golden dataset and its seed (`src/seed/golden`), the
deterministic fixture the staging regression contour restores from.

Every identity is pinned: fixed UUIDs (`goldenUuid`) and a typed `golden`
catalogue of the entities scenarios address by name
(`golden.events.upcoming.slug`, `golden.doctors.verifiedCardiologist`, …).
Timestamps are derived from one «now» that defaults to the seed run time — so an
«upcoming» event stays upcoming on a stand whose apps read the real clock — with
`GOLDEN_NOW` as the explicit pin for the unit suite and the drift check; the
set-once publication instants (`first_published_at`) are excluded from the
upsert's update set and keep the value of the first write. `seedGolden` upserts
the whole set in one transaction keyed on those ids, so a second run under the
same pin rewrites the same values into the same rows and changes nothing
observable; it refuses to run when a golden IdP account's subject is missing
rather than inventing one.

New scripts: `pnpm seed:golden` (fills the database `DATABASE_URL` points at) and
`pnpm staging:golden-db` (`tools/staging/golden-db.mjs` — builds `ds_golden_next`,
migrates, fills, then rotates it into `ds_golden` and keeps one `ds_golden_prev`;
it never migrates the live template in place).
