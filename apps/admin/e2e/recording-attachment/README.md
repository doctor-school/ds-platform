# Recording mutation originals

This strict Admin contour executes eighteen source originals from feature 014 with
the inherited Academy host and all six ordered lifecycle Background clauses:
twenty-nine cases and 174 Background groups. Existing attachment, publication,
audit, legacy lifecycle and wrong-machine boundary coverage is retained.
`@recording-backfill-originals` selects exactly three new cases: published-never-live
refusal, legacy-target refusal and the mutation-free dry-run.
`@recording-origin-invariants` selects exactly three further originals (four
cases): the two immutable-origin Examples, the legacy lifecycle bar and the
same-manifest rerun. Original prose, Examples, host and Background order stay
unchanged.

The origin proof reads every own-machine state and independently checks its
literal next-state set, including shared `hidden`, then submits every foreign
lifecycle command with real HTTP protocol. Both origins use the supported
`PATCH /v1/admin/events/:id`: the attempted origin change must return 400 without
changing the complete event row; an otherwise identical authored-field control
must succeed. Internal service calls are not represented as origin-edit routes.
The legacy bar is read in the real Admin browser in both `hidden` and
`in_archive`, with a published recording and exact API transitions, button IDs
and Russian labels. The rerun first invokes the real operator CLI over two fresh
ended targets, then invokes the exact same manifest file and requires all rows
skipped, unchanged complete snapshots, no duplicate kind and no added audit.

The backfill selection executes the existing operator CLI
`apps/api/scripts/recordings-backfill.ts` against the explicitly owned database.
The shared `packages/e2e/lib/recording-backfill.ts` assertions independently parse
its raw JSON lines and summary, bind every result to the manifest and actor, and
compare complete events, recordings and audit rows read before and after. The
never-live refusal includes a subsequent eligible row proving continuation and
ordinary attributed recording writes. The dry-run includes fresh, already
backfilled and published targets and requires complete snapshots to remain equal.
The CLI reports domain refusal codes and exits zero; canonical 409 mappings are
read from the compiled owning error table. No HTTP response is claimed for a CLI.

The Admin adapter supplies real administrator fixtures, anonymous Academy reads
and SQL. Shared lifecycle and boundary assertions remain in
`packages/e2e/lib/recording-lifecycle.ts` and `legacy-transition.ts`. Wrong-machine
receipts bind the command to its exact source Example, origin and state; record
actual HTTP protocol; and compare complete event and room-side-effect rows.
No-Delete inspects the published edited panel and every source/command dialog,
proves real DELETE 404 and retention. Legacy archive/hide uses actual Admin buttons,
independent audit diffs and public membership/count checks. These remain
complementary to native lifecycle and wider Admin suites; no native test was removed.
Provider reference acceptance is proven; provider playback and deferred duration
enrichment are outside this selection.

Run against compiled API, Admin, Academy and Login apps with a fresh owned branch
DB and dev IdP credentials loaded privately. Required env:
`E2E_RECORDING_ATTACHMENT_DATABASE`, `E2E_RECORDING_ATTACHMENT_PORTAL_URL`,
`E2E_RECORDING_ATTACHMENT_LOG`, `DATABASE_URL`, `E2E_ADMIN_URL`, and `IDP_*`.
The operator CLI also requires explicit `AUDIT_IDENTIFIER_PEPPER` and
`LIFECYCLE_IMPACT_TOKEN_SECRET`; CI shares its existing runner-only fixtures
between the API and the command through the Admin job environment. Failed CLI
starts retain stdout, stderr and process status beside the manifest and remain
test failures.
The SQL adapter accepts explicitly named owned DBs (including `ds_dev_3951`) or
the CI DB under `CI=true`. Every SQL/session/CLI fixture command is logged.
Manifests and raw CLI stdout/stderr are preserved beside the operation log.
Forced-colour proof runs set `FORCE_COLOR=1`, remove `NO_COLOR` and require actual
ANSI bytes in the captured owning CLI stdout before the unchanged strict reader
parses it.

```sh
pnpm --filter @ds/admin test:e2e --project recording-attachment --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-recording-attachment-report.ts /path/results.json
```

For only the new three cases append `--grep @recording-backfill-originals` to the
test command and `--new` to the report assertion. The default guard requires all
twenty-nine cases, exact source feature/rule/outline/example/project identities,
substantive receipts and six ordered nonempty Background groups per case, with
zero failures/skips/flakes/retries/errors. Synthetic reports belong only to guard
tests, never runtime acceptance. No visual artifact is produced by this test-only work.
For only the current four invariant cases append
`--grep @recording-origin-invariants` and use `--invariants` for the report guard.
