# Registry originals

`registry-contracts` is a strict native Admin BDD project over the unchanged
030:39 and 032:20/52 originals. The original Academy/Admin host tags are asserted
and included in the report. It does not extend the storefront host registry.
030 and 032:20 drive the real Admin; 032:52 uses fresh anonymous request contexts
for the existing public relationship/count API boundary specified by 032 V-5.

Build and boot the API and Admin from the same checkout against an owned branch
database. Set `DATABASE_URL`, `E2E_ADMIN_URL`, the normal development IdP settings,
`E2E_REGISTRY_CONTRACTS_DATABASE=ds_dev_3831`, and
`E2E_REGISTRY_CONTRACTS_LOG` to an absolute private command-log path. The fixture
also accepts the disposable `ds_admin_e2e` database only when `CI=true`.
Never reset or roll back the shared stand. The ordinary migration wrapper takes
its snapshot before creating/migrating a branch database.

Run from the repository root, quoting the reporter argument on PowerShell:

```sh
pnpm --filter @ds/admin test:e2e --project registry-contracts --reporter=list,json
pnpm --filter @ds/e2e exec tsx api-probes/assert-registry-report.ts "$PLAYWRIGHT_JSON_OUTPUT_NAME"
```

`PLAYWRIGHT_JSON_OUTPUT_NAME` must name a new head/run directory. Keep failed and
successful reports separately. The validator requires exactly three single-pass
results, all nine actual Background groups, original host identities and two
distinct results-editor instances. There is no missing-step fallback or retry.

The count fixture adds only the missing owned published organisations needed for
the literal 14 baseline and refuses a baseline above 14. CI therefore runs this
project before other Admin flows author organisations. Test cleanup removes only
tracked entity ids, restores the renamed seed kind, and deletes each owned IdP
account. The actor mirrors and their consent rows remain in the owned database
until that database is removed; their ids are recorded in the command log.
All app-local and API tests remain complementary and retained.
