# 025 engine originals

The strict `points-engine.config.ts` contour executes six unchanged source
originals from `025-scenarios.feature`, including both Background clauses.
The preceding three remain regression coverage:

- An offline lesson earns Bre only and never a second Bre.
- A producer fact carrying an amount is refused and writes nothing.
- A fact no rule applies to is journaled with no effect.

The `@points-record-boundaries` wave adds exactly three:

- The same lesson reported from two storefronts and an offline sync accrues once.
- A closed account accepts no posting.
- A completed module accrues all three units once.

This is a Node-only Playwright-BDD projection of the backend contract. It creates
no browser, page, HTTP server or authentication session. The compiled, shipping
`PointsEngine`, rule book, ledger and publisher run against real Postgres.
Native Vitest dedupe, ledger, rule-book, engine and journal suites remain
complementary and are not deleted. Calls named for the two storefronts and the
offline sync exercise the engine intake: the first two have distinct event IDs,
and the third replays the exact first fact. This does not establish producer
delivery (#3844) or the complete erasure flow. The erasure Given creates real
prior awards and calls the real ledger `close`; refusal preserves every posting
field and commits no new ledger key or fact. Module reports use distinct event
IDs for the same module and exercise both seeded award rules' once-per keys.

The fixture accepts only an explicitly bound `ds_dev_3878`, or `ds_test` with
`CI=true`, and checks `current_database()` before creating data. Each scenario
verifies current migrated rule/settings bodies against `POINTS_ENGINE_SEED`,
persists its own doctor with the canonical Кардиология specialty and verified
phone, and records `phone.verified` through the real engine. The standard specialty
seed fills an empty owned reference book. It never alters a shared database.
All SQL is logged without bound values. Append-only facts and postings are
retained until the owned database is disposed; every pool closes on failure.

Build `@ds/api` and its workspace dependencies first. Provision an owned branch
database through `pnpm dev:db:branch 3878` (the wrapper snapshots before migration),
then export its `DATABASE_URL`, `E2E_POINTS_DATABASE=ds_dev_3878`, an existing
scratch directory's `E2E_POINTS_OPS_LOG`, and `E2E_POINTS_REPORT` JSON destination:

```powershell
pnpm --filter @ds/e2e exec bddgen --config points-engine.config.ts
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT
```

For the exact new-wave receipt, choose another `E2E_POINTS_REPORT` destination:

```powershell
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts --grep @points-record-boundaries
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT --record-boundaries
```

Generation fails on missing selected steps. The default report gate requires
all six titles in the Admin project; `--record-boundaries` requires exactly the
new three, never the preceding three. Both reject missing, extra, duplicate,
wrong-host, skipped, failed, flaky or retried results. CI runs all six on disposable
`ds_test` before native API suites can publish different rule versions, and
uploads JSON plus operation log. Run local BDD proofs before mutable native
rule-book tests as well; later BDD proof needs a fresh owned database.
No visual artifact or owner Stage-B stand is involved.
