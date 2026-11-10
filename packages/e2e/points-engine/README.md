# 025 engine originals

The strict `points-engine.config.ts` contour executes fifteen unchanged source
originals from `025-scenarios.feature`, including both Background clauses.
The preceding three remain regression coverage:

- An offline lesson earns Bre only and never a second Bre.
- A producer fact carrying an amount is refused and writes nothing.
- A fact no rule applies to is journaled with no effect.

The `@points-record-boundaries` wave adds exactly three:

- The same lesson reported from two storefronts and an offline sync accrues once.
- A closed account accepts no posting.
- A completed module accrues all three units once.

The `@points-reserve-boundaries` wave adds exactly three more:

- A fourth concurrent limited-seat reserve is refused.
- A quote equals the enforced decision and writes nothing.
- Concurrent reserves never overdraw the balance.

The `@points-advance-boundaries` wave adds exactly three:

- Advance covers the shortfall and later earnings settle it.
- A doctor who arrived on a medical representative's link gets the same conditions.
- Beyond the advance cap the event behaves as threshold.

The `@points-referral-boundaries` wave adds exactly three:

- Pul amounts never read as money.
- Referral awards stop for the inviter above the monthly cap.
- The invitee's first completed lesson counts itself for the referral.

The unit case quotes a real event without a price row and validates the strict
approved response: zero Pul, with no free/money field and no financial write.
Referral cases prepare real verified doctors, journal `referral.attributed`
pointing to the inviter's person UUID and record actual first online lessons.
Five seeded inviter awards credit 30 Pul/2 Bre each in the same Moscow month;
the sixth invitee still receives its separate 30-Pul referral posting while the
inviter rule is `limit-reached` and the inviter's financial snapshot is unchanged.
The ordinary lesson's additional 10 Pul is checked separately, never confused
with the referral amount. This proves seeded engine intake, not link acquisition.

For the first-lesson evaluation, a narrowly scoped pass-through observer calls
the compiled `JournalPredicateResolver.resolve` unchanged and retains its real
result for the target fact/person only. It restores the original prototype in
`finally`. Zero prior distinct lesson refs, actual observed value 1, the target
journal row and the referral posting on that same fact establish the timing.
No predicate value or rule is supplied by the test. Narrow quote/referral/context
receipts append to the operation log that CI uploads. Both unchanged Background
clauses emit post-assertion receipts for every case (6 for the trio, 30 for all 15).

The advance cases fund both independent doctors through seeded module facts,
price the same real event, compare normalized posting legs and persisted member
and organisation attribution. This proves engine attribution handling, not the
public-link acquisition journey. A 20/30 balance/advance split opens a 30-Pul
obligation; a real online lesson nets 10 first and leaves 20. Two real advance
registrations open 150 owed; the next reserve refuses without journal, keys,
postings, holds or obligations. The real quote returns 200 Pul/20 lessons while
open events and lesson gating stay open. Safe receipts append to
`E2E_POINTS_ADVANCE_REPORT` (or the operation log in CI). Cleanup retires only
owned events and proves both doctors' financial snapshots unchanged.

These cases fund 20/40/50 Pul through seeded module/lesson facts and price fresh
published non-NMO events with the real price service. The fourth reserve is
affordable after the first three; its refusal preserves the full account,
journal, postings, dedupe keys and hold snapshots. Gating is the service's real
engine quote, followed by the real `registration.created` builder and record;
both preserve state and agree on the 30 Pul shortfall. This proves the 025
engine/price boundary, not the complete 005 HTTP/UI producer journey.

The reserve race holds the funded person's account row in a separate Postgres
coordinator transaction. Two real engine transactions must both appear blocked
in `pg_stat_activity` under their unique per-scenario `application_name`, with
`pg_blocking_pids` paths reaching that coordinator before it commits. The
three-connection engine pool leaves a third connection for observation. A
bounded three-second poll proves overlap; a timeout fails the case. Finally
cleanup rolls back only that coordinator transaction and closes its pool.
The committed result has one hold/posting, one shortfall refusal with no loser
journal/key/posting/hold, and nonnegative posting prefixes. Safe overlap and
outcome JSONL is appended to `E2E_POINTS_OVERLAP_REPORT` (or the operation log in
CI), with no parameters or credentials. The native reserve/gating/ledger suites
remain complementary and retained.

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

The fixture accepts only an explicitly bound `ds_dev_3921`, or `ds_test` with
`CI=true`, and checks `current_database()` before creating data. Each scenario
verifies current migrated rule/settings bodies against `POINTS_ENGINE_SEED`,
persists its own doctor with the canonical Кардиология specialty and verified
phone, and records `phone.verified` through the real engine. The standard specialty
seed fills an empty owned reference book. It never alters a shared database.
All SQL is logged without bound values. Append-only facts and postings are
retained until the owned database is disposed; every pool closes on failure.

Build `@ds/api` and its workspace dependencies first. Provision an owned branch
database through `pnpm dev:db:branch 3921` (the wrapper snapshots before migration),
then export its `DATABASE_URL`, `E2E_POINTS_DATABASE=ds_dev_3921`, an existing
scratch directory's `E2E_POINTS_OPS_LOG`, and `E2E_POINTS_REPORT` JSON destination:

```powershell
pnpm --filter @ds/e2e exec bddgen --config points-engine.config.ts
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT
```

For the exact new-wave receipt, choose another `E2E_POINTS_REPORT` destination:

```powershell
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts --grep @points-referral-boundaries
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT --referral-boundaries
```

Generation fails on missing selected steps. The default report gate requires
all fifteen titles in the Admin project; `--referral-boundaries` requires exactly the new trio; `--advance-boundaries` still checks the advance trio; `--reserve-boundaries` requires exactly the
reserve trio; `--record-boundaries` still checks the preceding trio. All modes
reject missing, extra, duplicate,
wrong-host, skipped, failed, flaky or retried results. CI runs all fifteen on disposable
`ds_test` before native API suites can publish different rule versions, and
uploads JSON plus operation log. Run local BDD proofs before mutable native
rule-book tests as well; later BDD proof needs a fresh owned database.
No visual artifact or owner Stage-B stand is involved.
