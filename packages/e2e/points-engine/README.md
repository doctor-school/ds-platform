# 025 engine originals

The `points-engine.config.ts` contour executes exactly three unchanged source
originals from `025-scenarios.feature`, including both Background clauses:

- An offline lesson earns Bre only and never a second Bre.
- A producer fact carrying an amount is refused and writes nothing.
- A fact no rule applies to is journaled with no effect.

This is a Node-only Playwright-BDD projection of the backend contract. It creates
no browser, page, HTTP server or authentication session. The compiled, shipping
`PointsEngine`, rule book, ledger and publisher run against real Postgres.
The native Vitest dedupe, engine and journal suites remain complementary and are
not deleted. This does not establish lesson-producer delivery (#3844).

The fixture accepts only an explicitly bound `ds_dev_3876`, or `ds_test` with
`CI=true`, and checks `current_database()` before creating data. Each scenario
verifies current migrated rule/settings bodies against `POINTS_ENGINE_SEED`,
persists its own doctor with the canonical Кардиология specialty and verified
phone, and records `phone.verified` through the real engine. The standard specialty
seed fills an empty owned reference book. It never alters a shared database.
All SQL is logged without bound values. Append-only facts and postings are
retained until the owned database is disposed; every pool closes on failure.

Build `@ds/api` and its workspace dependencies first. Provision an owned branch
database through `pnpm dev:db:branch 3876` (the wrapper snapshots before migration),
then export its `DATABASE_URL`, `E2E_POINTS_DATABASE=ds_dev_3876`, an existing
scratch directory's `E2E_POINTS_OPS_LOG`, and `E2E_POINTS_REPORT` JSON destination:

```powershell
pnpm --filter @ds/e2e exec bddgen --config points-engine.config.ts
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT
```

Generation fails on missing selected steps. The report gate requires the exact
three titles in the Admin project, each passing once without a skip, flake or
retry. CI runs this contour on its disposable `ds_test` before the native API
suites can publish different rule versions, and uploads JSON plus operation log.
No visual artifact or owner Stage-B stand is involved.
