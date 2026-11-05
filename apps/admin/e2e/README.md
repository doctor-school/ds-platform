# Admin spec-owned materials originals

`--project materials` in `../playwright.config.ts` executes the three existing
048 originals tagged `@material-admin-authoring`. The source retains
`@host:academy`; the Admin project selects the authoring originals explicitly
and uses strict generation. The source Background publishes the named Expert
through the real Admin before the business steps run.

Run against an owned Admin/API/database and the existing IdP fixtures:

```sh
pnpm --filter @ds/admin test:e2e --project materials --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-report.ts "$PLAYWRIGHT_JSON_OUTPUT_NAME" materials
```

Set `E2E_ADMIN_URL`, `DATABASE_URL`, `E2E_MATERIAL_ADMIN_DATABASE`,
`E2E_MATERIAL_ADMIN_LOG` and `PLAYWRIGHT_JSON_OUTPUT_NAME`, plus the existing
`IDP_*` fixture settings. The explicit database must match the connection and be
an owned `ds_dev_<issue>` database, or `ds_admin_e2e` in CI. The Admin build must
proxy to that API; its runtime also needs `ACADEMY_PUBLIC_ORIGIN`.

The first original verifies the actual stored row set is unchanged after the
expert-field refusal. The conflict original logs in two newly bootstrapped
accounts in isolated browser contexts, proves distinct retained User and IdP
identities, reads the same version, observes real 200 then 412 responses, and
checks the first change and its acting administrator in storage. The list
original uses the source's literal published news, draft column and published
Expert and observes the real `kind=column` read.

The existing operational receipt gate requires each exact title once with no
missing/extra original, skip, retry or flake. The Admin CI job runs and uploads
that report independently of the legacy flows result. Keep the legacy
same-account/two-tab conflict test: it covers a different identity boundary.
