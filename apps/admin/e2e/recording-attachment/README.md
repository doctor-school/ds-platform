# Recording mutation originals

This strict Admin contour executes nine source originals from feature 014 with
inherited Academy host and all six lifecycle Background clauses: thirteen cases
and seventy-eight Background groups. The attachment outline contributes two,
publication one, non-ended publication four, generic recording audit one, and
legacy archive/refusal/hide three. The three newly selected legacy originals use
`@recording-legacy-transitions` (three cases/eighteen Background groups).
`@recording-publication-audit` retains the previous six-case publication/audit selection.

The Admin app supplies the real administrator session, anonymous Academy read
and SQL adapter. Canonical shared assertions live in
`packages/e2e/lib/recording-lifecycle.ts` and `legacy-transition.ts`. Legacy
fixtures are created through the real API with audience `experts`; their held-at
day derives from the public API horizon. Archive/hide success uses the actual
Admin buttons and captures their POST protocol. Draft-only refusal checks the
honestly absent action and the real API 409. Each receipt retains full before
and after event rows, named command audit deltas with actor/transition metadata,
independent generic event audit diffs, and pre/post public membership and counts.
Hide also drives the same fixture's direct Academy link to the feature 004 notice.
Recording commands validate/store provider references; no provider playback is claimed.
Native recording/legacy lifecycle suites and broader Admin UI flows remain
complementary; no native duplicate was removed.

Run against compiled API, Admin and Academy apps with a fresh owned branch DB
and dev IdP credentials loaded privately. Required env:
`E2E_RECORDING_ATTACHMENT_DATABASE`, `E2E_RECORDING_ATTACHMENT_PORTAL_URL`,
`E2E_RECORDING_ATTACHMENT_LOG`, `DATABASE_URL`, `E2E_ADMIN_URL`, and `IDP_*`.
The SQL adapter accepts explicitly named historical/owned DBs (including fresh
`ds_dev_3932`) or the CI DB under `CI=true`. Every SQL/session fixture is logged.

```sh
pnpm --filter @ds/admin test:e2e --project recording-attachment --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-recording-attachment-report.ts /path/results.json
```

For only the new three cases append `--grep @recording-legacy-transitions` to the
test command and `--new` to the report assertion. The default guard requires all
thirteen cases with exact feature/rule/outline/example/project identities,
kind/state receipts, substantive legacy transition evidence, six ordered
nonempty Background groups per case, and zero failure/skip/flake/retry/error.
Synthetic reports belong only to guard negative tests, never runtime acceptance.
