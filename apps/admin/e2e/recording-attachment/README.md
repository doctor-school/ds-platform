# Recording mutation originals

This strict Admin contour executes six source originals from feature 014 with
their inherited Academy host and all six lifecycle Background clauses. The
attachment outline contributes two cases; publication contributes one, the
non-ended publication outline four, and generic audit one: ten cases and sixty
Background groups in total. `@recording-publication-audit` selects only the three
publication/audit originals (six cases and thirty-six groups).

The Admin app supplies the real administrator session, anonymous Academy read
and SQL adapter. `packages/e2e/lib/recording-lifecycle.ts` owns publication,
unchanged-row and five-command audit assertions. Recording commands validate
and store provider references; this contour claims no external playback proof.
Native recording lifecycle/protocol suites and broader Admin UI flows remain
complementary; no native duplicate was removed.

Run against the compiled API, Admin and Academy apps with a fresh owned branch
database and the dev IdP credentials loaded privately. Required contour env:
`E2E_RECORDING_ATTACHMENT_DATABASE`, `E2E_RECORDING_ATTACHMENT_PORTAL_URL`,
`E2E_RECORDING_ATTACHMENT_LOG`, `DATABASE_URL`, `E2E_ADMIN_URL`, and `IDP_*`.
The SQL adapter accepts only the explicitly named owned databases or the CI
database under `CI=true`. Every SQL statement and session fixture is logged.

```sh
pnpm --filter @ds/admin test:e2e --project recording-attachment --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-recording-attachment-report.ts /path/results.json
```

For the new six cases append `--grep @recording-publication-audit` to the test
command and `--new` to the report assertion. The default report guard requires
all ten cases, exact feature/rule/outline/example/project identities, source
state/kind receipts, six ordered nonempty Background groups per case, and no
failure, skip, flake, retry or runner error. A synthetic report is used only in
the guard's negative tests and is never runtime acceptance evidence.
