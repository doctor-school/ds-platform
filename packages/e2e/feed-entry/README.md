# Public specialty feed entry — 017 EARS-1 / EARS-6

`feed-entry.config.ts` selects exactly the three original `017-scenarios.feature`
journeys tagged `@public-feed-entry`. It retains their Rule and all six inherited
Background conditions, uses the normal shared Doctor step world, and fails
generation when a binding is absent. No identity-provider journey is involved.

The first journey chooses through the real catalog UI. The remembered-entry
journey prepares its public preference through `chooseGuestSpecialty`, then reads
it after a reload. Both verify the actual feed envelope, HTTP response, visible
specialty and `data-surface="specialty-feed"`. The no-choice journey activates
the real header link and verifies the open catalog in view and no empty feed.

Background evidence includes the repository Ministry book against the real API,
the compiled owning `TargetingRepository` reading managed relation rows in a
rolled-back transaction, actual guest home DOM, and accepted vendored home/shell
hashes and shared design-system composition. This provenance check records no
new design approval and does not require the deferred hero counters.

Build API and Doctor with `API_PROXY_TARGET` pointing to the task API address.
Prepare an owned `ds_dev_3751` locally through `pnpm dev:db:branch 3751` (the
wrapper snapshots before migration), or a disposable `ds_probe_3751` in CI.
Export `E2E_API_URL`, `E2E_DOCTOR_URL`, `E2E_FEED_ENTRY_DATABASE_URL`,
`E2E_FEED_ENTRY_BOOT=1`, `E2E_FEED_ENTRY_LOG`,
`E2E_FEED_ENTRY_ARTIFACT_DIR`, and `E2E_REPORT_DIR`. Keep `REDIS_URL` unset:
the public preference lives in its real browser cookie, and API technical stores
use their existing isolated in-memory configuration. Playwright owns and reaps
both compiled web servers, with `reuseExistingServer: false`.

```sh
pnpm --filter @ds/e2e exec bddgen --config feed-entry.config.ts
pnpm --filter @ds/e2e exec playwright test --config feed-entry.config.ts
pnpm --filter @ds/e2e exec tsx lib/assert-feed-entry-report.ts "$E2E_REPORT_DIR/results.json"
```

The strict report requires all three exact titles once, zero failures, skips,
flakes, retries and top-level errors. `.github/workflows/public-feed-entry.yml`
executes this contour on the native PR head and uploads `public-feed-entry-originals`
with `head.txt` and the actual report. The receipt also requires each actual
test's Doctor project name and id. Shared default BDD generation loads the
definitions but excludes `@public-feed-entry` through its existing selection
mechanism: ordinary local/stage runs do not supply this task-owned DB contract.
The dedicated configuration still selects all three originals strictly.

Listener ownership uses the actual socket's PID. On Linux, the process cwd must
be this worktree's app directory and `/proc/PID/exe` must be the running Node
binary. This preserves ownership when Next replaces its command line with its
`next-server` title. Windows continues to require the absolute worktree entry.

Stand commands and exact public-choice idempotency keys go into the task command
log. The Background transaction rolls back its own rows; browser contexts clear
their own preference. After local proof, drop only the owned branch DB and remove
private task files. Never reset the shared stand, flush Redis, or kill a foreign
listener. Existing mock transport and unmatched feed-entry coverage stays unless
committed real equivalence proves a precise duplicate removal.
