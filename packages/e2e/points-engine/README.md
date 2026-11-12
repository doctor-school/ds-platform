# 025 engine originals

The strict `points-engine.config.ts` contour executes twenty-seven unchanged source
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
clauses emit post-assertion receipts for every case (6 for the trio, 54 for all 27).

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
no browser or page. The starter-bonus case boots the compiled Fastify application
and makes real injected HTTP requests with the native admin-session fixture;
other cases call compiled owning services directly. The compiled, shipping
`PointsEngine`, rule book, ledger and publisher run against real Postgres.
Native Vitest dedupe, ledger, rule-book, engine and journal suites remain
complementary and are not deleted. Calls named for the two storefronts and the
offline sync exercise the engine intake: the first two have distinct event IDs,
and the third replays the exact first fact. This does not establish producer
delivery (#3844) or the complete erasure flow. The erasure Given creates real
prior awards and calls the real ledger `close`; refusal preserves every posting
field and commits no new ledger key or fact. Module reports use distinct event
IDs for the same module and exercise both seeded award rules' once-per keys.

The fixture accepts only an explicitly bound `ds_dev_3968`, `ds_dev_3983`,
`ds_dev_3989`, or `ds_points_originals_3989` with
`CI=true`, and checks `current_database()` before creating data. Each scenario
verifies current migrated rule/settings bodies against `POINTS_ENGINE_SEED`,
persists its own doctor with the canonical Кардиология specialty and verified
phone, and records `phone.verified` through the real engine. The standard specialty
seed fills an empty owned reference book. It never alters a shared database.
All SQL is logged without bound values. Append-only facts and postings are
retained until the owned database is disposed; every pool closes on failure.

Build `@ds/api` and its workspace dependencies first. Provision an owned branch
database through `pnpm dev:db:branch 3968` (the wrapper snapshots before migration),
then export its `DATABASE_URL`, `E2E_POINTS_DATABASE=ds_dev_3968`, an existing
scratch directory's `E2E_POINTS_OPS_LOG`, and `E2E_POINTS_REPORT` JSON destination:

```powershell
pnpm --filter @ds/e2e exec bddgen --config points-engine.config.ts
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT
```

For the exact new-wave receipt, choose another `E2E_POINTS_REPORT` destination:

```powershell
pnpm --filter @ds/e2e exec playwright test --config points-engine.config.ts --grep @points-lifecycle-boundaries
pnpm --filter @ds/e2e exec tsx api-probes/assert-points-engine-report.ts $env:E2E_POINTS_REPORT --lifecycle-boundaries
```

Generation fails on missing selected steps. The default report gate requires
all twenty-seven titles in the Admin project; `--lifecycle-boundaries` requires the new trio; `--rulebook-boundaries` retains its preceding trio; `--referral-boundaries` retains the preceding referral trio; `--advance-boundaries` still checks the advance trio; `--reserve-boundaries` requires exactly the
reserve trio; `--record-boundaries` still checks the preceding trio. All modes
reject missing, extra, duplicate,
wrong-host, skipped, failed, flaky or retried results. CI runs all twenty-seven on disposable
`ds_points_originals_3989` separately from the native API database, and
uploads JSON plus operation log. Run local BDD proofs before mutable native
rule-book tests as well; later BDD proof needs a fresh owned database.
No visual artifact or owner Stage-B stand is involved.

The `@points-rulebook-boundaries` wave adds exactly three originals:

- An admin attaches a new reward to an existing fact type without a release.
- A rule reading an undeclared or ill-typed operand is refused at publish.
- Publishing a second stacking credit rule warns the admin.

The harness exposes the same compiled `RuleBookService` instance the engine uses.
A real owned admin user supplies `actorSub`, resolving `published_by` to its UUID.
Calls are direct and preauthorized: there is no HTTP, role/session or permission
acceptance claim. The actual row-audit trigger honestly records `db-direct` with
a null audit actor; the publisher and audit actor are distinct evidence.
The literal `accrual.webinar-feedback` must have zero versions before publication.
Its version 1 credits 2 Bre on `event.rated`, once per subject/ref; the actual fact
for A on an owned event also creates the separate seeded `accrual.rating` 1 Bre.
The two catalog violations report exact paths `condition.eq.0.attr` and
`condition.eq`; the retired `cap.engagement` is refused without a fake retired row.
Complete rule-version and matching audit snapshots and hashes prove each refused
publish wrote nothing. A unique active lesson credit stores version 1 and returns
a real stacking warning naming `accrual.lesson`.

Successfully published owned rules are registered before assertions and retired
through real `publish(active:false)` in fixture `finally`, before closing the pool.
The latest stored version must be inactive. Seed rule/settings histories, including
bodies, epoch timestamps and publishers, are compared byte-for-byte in serialized
snapshots with matching SHA-256 receipts. Seed rows remain untouched in these custom-rule cases; the rule-change cases below restore defaults by native forward publication.
Publication bodies, persisted rows, actual audit rows, errors, postings, warnings,
retirement and seed invariants are appended to the uploaded operation log.

The new trio and full twenty-seven each require an independently fresh owned database,
because the literal version 1 cannot be reused after immutable history exists.
Run both from the same committed source. Preserve each raw report and operation log;
after acceptance of the trio receipts, sanctioned `dev:db:drop 3968` followed by
`dev:db:branch 3968` prepares the full run. No automatic reset, alias or skip exists.
CI runs the full twenty-seven once on fresh `ds_points_originals_3989`. Run native rule-book/stacking
complements afterwards; they use unique test slugs. Background receipts total
6 for the trio and 54 for all twenty-seven. Owned events are retired before pool close.

The `@points-lifecycle-boundaries` wave adds exactly three source originals:

- A no-show releases an advance-backed reserve and a late attendance awards participation without settlement.
- Exclusive campaign rules choose the highest priority in November, with the other rule winning in December.
- The admin grants the starter bonus once to pre-engine doctors, with the registration grant sharing its welcome key.

The no-show fixture creates a real 20/30 balance/advance reserve, puts its owned
scheduled event end more than 24 hours in the past and invokes the actual compiled
`PointsNoShowSweep.runOnce(explicitNow)`. It checks the stored no-show fact,
compensation targets and amounts, released hold, annulled obligation, unchanged
20 Pul balance and no participation posting. A real later attendance records
`no-open-hold`, leaves the hold released and posts the separate 2 Bre/1 Con award.
This proves the sweep and engine boundary, not the deferred cancellation producer.

Campaign publication and facts use a scoped historical Date-only application
clock: November and December of the preceding year. Real service publication uses
its normal default `effectiveFrom` equal to the observed application clock. This
keeps both the application's future/past validation and Postgres's future-posting
constraint active. No wall-clock wait, database clock change, seed rewrite or
explicit backdated `effectiveFrom` is used. Every clock scope resets in `finally`
before real-time retirement. Literal campaign IDs, priorities 10/5, shared group,
November window, persisted publication, traces and exact winning postings are
retained as receipts. Owned rules retire normally; seed histories remain identical.

The starter case uses actual compiled `AppModule`, Fastify, controller, admin guard,
`AdminSessionService`, engine and Postgres. Its only provider substitutions are the
existing external `FakeIdpClient` credential/role fixture and bot-verification setup.
The native admin-session setup calls real login then `upgradePending`, the same
production seam used by factor handlers. No guard, controller, session store,
posting or grant is faked. This is grant HTTP acceptance, with no external IdP,
factor, auth or authorization acceptance claim. F and G are owned verified-phone
Cardiology doctors with the canonical participant mirror role, backdated fixture
registration times and only G's real registration grant. The actual POST grants
F 20 Pul, adds nothing to G, writes the exact admin/reason/cutoff/count audits and
answers duplicate for both on a rerun without new postings. No listener is bound;
the owned application and its pool/intervals close in the case cleanup.

The CLI report gate additionally requires `E2E_POINTS_OPS_LOG` and validates exactly
two ordered, nonempty, verified Background receipts per expected original, with
consistent person/application identity. Missing, repeated, reordered or unknown
receipts are refused as well as failed, skipped, flaky or retried test results.
The new trio requires 6 receipts; the full 27 requires 54. Native release, stacking,
limits and starter-bonus tests stay as complementary coverage. Nothing visual is
delivered, and production is not changed.

The Node-only starter fixture supplies random per-application `AUDIT_IDENTIFIER_PEPPER`
and `LIFECYCLE_IMPACT_TOKEN_SECRET` only when absent, before loading `AppModule`,
and restores the prior environment after closing the application. Native Vitest
has explicit fallbacks for these two dependencies; this Node runner does not set
`VITEST` or weaken their production fail-closed checks. A configured value always
wins. Missing-key local proof deletes both keys and `VITEST` before the actual
compiled HTTP case, exercising the same startup branch CI needs.

The `@points-rule-changes` wave adds exactly source originals 025:119/179/205:

- Re-tuning `accrual.lesson` from version 2/10 Pul to version 3/15 Pul affects
  only a new lesson. The original fact, trace, posting and posting key remain
  identical, and publication itself creates no financial change.
- Publishing `setting.presence.share` version 2/value 50 makes real attendance
  at 45 percent trace `condition-false`, with no participation posting and an
  unchanged `accrual.participation` history.
- The fresh active starter-trigger catalog contains only the seeded rule.
  Its native deactivation makes the real admin HTTP grant refuse 422 and
  `points-starter-bonus-no-rule`, with no run audit, fact or financial change.

`points-rule-changes.config.ts` selects exactly this trio (one worker, zero
retries, missing steps fail generation). Its strict CLI scope is
`--rule-changes`. Both the trio and the full 27 require an independently fresh
owned history. The full report has 54 ordered Background receipts and exactly
six resource receipts: the three retained first-release receipts plus the three
rule changes. The trio has six Background and three resource receipts. Missing,
extra, duplicate, foreign or unknown receipts fail closed.

Changed seeded defaults restore only through native `RuleBookService.publish`.
Every case retains the original complete seed-history/audit prefix, the exact
changed and restored bodies, gap-free versions, actor mirror identity and the
native call's effectivity bounds. Untouched seed histories remain identical;
cleanup preserves all six financial tables and the entire price history and
retires only the case's owned events. Initial seed provenance remains epoch/null;
subsequent Backgrounds verify both that provenance and the exact accepted
forward-restored history. Current-version selection uses the application's
clock, matching the native rule book, rather than the remote database clock.

CI runs all 27 in `ds_points_originals_3989`, explicitly checks that target before
migration and uploads `points-engine-originals-3989`. Native API suites keep
their separate fresh `ds_test` and their unchanged seeded-version assertions.
This is backend recorded-fact/grant acceptance; it proves no producer, browser,
provider, factor or authorization journey. No visual artifact is produced.
