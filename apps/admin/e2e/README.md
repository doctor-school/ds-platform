# Admin spec-owned materials originals

`--project materials` in `../playwright.config.ts` executes the six existing
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

The empty-body original observes the real publish refusal, the unchanged stored
draft and the public feed's lack of its card. The paste original writes an HTML
fragment to the browser clipboard and uses the editor's native paste command;
it checks that its paragraph remains and no image/table element survives. The
unsaved-preview original drives the real reading-page preview and banner, then
compares the stored material row set and the real public feed before and after.
These are three new originals; the previous expert refusal, two-administrator
conflict and kind filter remain in the same six-title receipt.

## Admin and Academy material journeys

`--project material-journeys` executes the eight 048 originals tagged
`@material-academy-journeys` (V-9, V-10, V-12, EARS-18). The administrator signs
in behind the second factor and writes through the real Admin; a visitor reads
the Academy home rail and the reading page on the running Academy storefront in
the same run. Steps live in `material-journeys/steps.ts`; the shared stand
helpers in `support/material-stand.ts` and `support/admin-write.ts`.

```sh
pnpm --filter @ds/admin test:e2e --project material-journeys --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-report.ts "$PLAYWRIGHT_JSON_OUTPUT_NAME" materialJourneys
```

Set the same variables as the `materials` project plus `E2E_PORTAL_URL` (the
Academy storefront, built against the same API). The storefront group of
`materials-reading-page.spec.ts` in the flows tier also reads `E2E_PORTAL_URL`;
locally it skips without it, in CI (`CI=true`) it has no skip path. The receipt
refuses a missing/extra title, skip, retry or flake. The phone original swipes
the rail with CDP touch events and opens a card with a click, because headless
Chromium sends no click after a touch drag.
