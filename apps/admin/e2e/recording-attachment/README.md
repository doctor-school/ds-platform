# Recording mutation originals

This strict Admin contour executes twelve source originals from feature 014 with
inherited Academy host and all six ordered lifecycle Background clauses:
twenty-two cases and 132 Background groups. Attachment contributes four cases,
publication/audit six, legacy archive/refusal/hide three, and the new boundary
selection nine. `@recording-command-boundaries` selects exactly three new
originals: published-edited no-Delete inspection, five broadcast-command refusals
on legacy events, and three legacy-command refusals on platform events.

The Admin app supplies the real administrator session, anonymous Academy reads
and SQL adapter. Canonical shared assertions live in
`packages/e2e/lib/recording-lifecycle.ts` and `legacy-transition.ts`. The boundary
receipt binds every command to its exact source outline, Example, origin and
state; captures the actual HTTP method, path, validator, key and refusal; and
compares complete event rows before/after. Each legacy refusal independently
reads stream configuration, presence rows and the live-at room signal before and
after. No-Delete uses a published edited fixture, inventories panel controls and
opens each source/command dialog without submitting, proves real DELETE 404 and
retention of the same row. These commands validate/store provider references;
no provider playback is claimed.

Legacy fixtures are created through the real API with audience `experts`; their
held-at day derives from the public API horizon. Archive/hide success uses actual
Admin buttons and captures their POST protocol. Draft-only refusal checks the
honestly absent action and real API 409. Receipts retain complete before/after
event rows, named audits with actor/transition metadata, independent generic audit
diffs, and pre/post public membership/counts. Hide drives the same fixture's
direct Academy link to the feature 004 notice. Native lifecycle suites and
broader Admin UI flows remain complementary; no native duplicate was removed.

Run against compiled API, Admin, Academy and Login apps with a fresh owned branch
DB and dev IdP credentials loaded privately. Required env:
`E2E_RECORDING_ATTACHMENT_DATABASE`, `E2E_RECORDING_ATTACHMENT_PORTAL_URL`,
`E2E_RECORDING_ATTACHMENT_LOG`, `DATABASE_URL`, `E2E_ADMIN_URL`, and `IDP_*`.
The SQL adapter accepts explicitly named owned DBs (including `ds_dev_3934`) or
the CI DB under `CI=true`. Every SQL/session fixture is logged.

```sh
pnpm --filter @ds/admin test:e2e --project recording-attachment --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-recording-attachment-report.ts /path/results.json
```

For only the new nine cases append `--grep @recording-command-boundaries` to the
test command and `--new` to the report assertion. The default guard requires all
twenty-two cases with exact feature/rule/outline/example/project identities,
kind/state and substantive transition/boundary receipts, six ordered nonempty
Background groups per case, and zero failure/skip/flake/retry/error. Synthetic
reports belong only to guard tests, never runtime acceptance.
