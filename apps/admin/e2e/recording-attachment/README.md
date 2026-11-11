# Recording mutation originals

This strict Admin contour executes fifteen source originals from feature 014 with
the inherited Academy host and all six ordered lifecycle Background clauses:
twenty-five cases and 150 Background groups. Existing attachment, publication,
audit, legacy lifecycle and wrong-machine boundary coverage is retained.
`@recording-backfill-originals` selects exactly three new cases: published-never-live
refusal, legacy-target refusal and the mutation-free dry-run.

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
The SQL adapter accepts explicitly named owned DBs (including `ds_dev_3939`) or
the CI DB under `CI=true`. Every SQL/session/CLI fixture command is logged.
Manifests and raw CLI stdout/stderr are preserved beside the operation log.

```sh
pnpm --filter @ds/admin test:e2e --project recording-attachment --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-recording-attachment-report.ts /path/results.json
```

For only the new three cases append `--grep @recording-backfill-originals` to the
test command and `--new` to the report assertion. The default guard requires all
twenty-five cases, exact source feature/rule/outline/example/project identities,
substantive receipts and six ordered nonempty Background groups per case, with
zero failures/skips/flakes/retries/errors. Synthetic reports belong only to guard
tests, never runtime acceptance. No visual artifact is produced by this test-only work.
