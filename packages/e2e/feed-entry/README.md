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
executes this contour on the native PR head and uploads `public-feed-originals-3751`
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

## Specialty feed states — 018 EARS-1 / EARS-4

Set `E2E_PUBLIC_FEED_STATES=1` to reuse this runner for exactly the originals at
018 lines 35, 129 and 137. The canonical feature stays unchanged. The dedicated
configuration generates the original feature with missing scenarios visible as
skips, then selects the three exact titles. The strict actual report refuses
any missing binding, extra or duplicate title, wrong project, skip, failure,
retry, flake or runner error. Ordinary `playwright.config.ts` excludes those
exact titles even when `E2E_GREP` is provided; it still excludes the existing
017 resource-dependent tag. Selection never adds a tag to the source feature.

Use the same commands and environment above with `ds_dev_3772` (or the CI-owned
`ds_probe_3772`) and a separate command log/report directory. The shared workflow
has two isolated Linux jobs: the previous 017 three and these 018 three. Each
job boots its own compiled API/Doctor and disposable Postgres, uploads the
actual report and head receipt, and reaps its resources.

Every 018 scenario verifies the real 017 shell and specialty book, resolves
«Травматология и ортопедия», and creates its own published directions, active
specialty link and adjacency. The compiled owning `TargetingRepository` reads
both relationships before commit. Three real published doctors-audience events
are linked to that own direction, dated one hour ahead, and verified as the
actual nearest three. One hides its count; two explicitly show it. Real
participant registration rows make the shown count one. All fixture mutations
are parameterized, confined to the exact task database, logged and removed by
exact generated ids in `After`, including failed journeys. No shared golden
data, provider accounts, object storage or successful upstream mocks are used.

The real projection currently serves `nmo: false` for every event. The offline
original requires an offline event, not an accredited one: requirements EN/RU
allow НМО to mark an event, and require the attribute to remain at event level.
The real proof checks card chip presence against each actual boolean and bans
screen headings and filters. It does not prove positive НМО authoring/rendering.
The distinct mocked positive-chip test in `apps/doctor/e2e/feed-events.spec.ts`
and mapper `nmo: true` boundary remain. The layout mock also retains its
unmatched personalization assertion; API owning-layer tests remain.

The previous `feed-events.spec.ts` hidden-counter case is the one exact local
duplicate removed after committed real proof. Its no-line/no-zero/no-slot and
visible-neighbor assertions now belong to canonical 018:129 via
`public-feed-states.steps.ts`. Canonical 018:35 also checks the real envelope;
its local layout case remains because it additionally checks the absence of a
personalization claim. Canonical 018:137 checks real offline projection and
same-card rendering; its local case remains for the otherwise unavailable
positive НМО chip. First-block ordering, all-events navigation, failed-read
retry, axe and API tests retain their separate boundaries.

## Public read-only originals — 004 / 017 / 018

`E2E_PUBLIC_READONLY=1` selects exactly the three originals at 004:253,
017:450 and 018:316 without editing their canonical feature files. The matrix is
Academy 1 and Doctor 2; the closed-book scenario keeps its Doctor Background
before opening a separate real Admin context. The strict report checks each
title once on its canonical host with zero failures, skips, retries, flakes or
runner errors. Ordinary storefront runs exclude these owned-fixture identities.
The existing 3751 and 3772 selections remain separate and unchanged.

Build API, Doctor, Academy and Admin with `API_PROXY_TARGET` pointing to the
owned API. Use `ds_dev_3785` (the snapshot/migrate branch wrapper) or the CI-owned
`ds_probe_3785`. In addition to the environment above, supply `E2E_PORTAL_URL`,
`E2E_ADMIN_URL` and the development `IDP_ISSUER`, `IDP_SERVICE_TOKEN` and
`IDP_PROJECT_ID`. Playwright owns all four compiled listeners and refuses reuse.
The same three commands above generate, execute and validate this contour.

The calendar fixture derives a future October from the API's actual horizon
day, commits two owned events at the same instant, and reads the explicit
October range through the actual Academy. The feed scenario reuses all four
real specialty-feed Background assertions and preserves the footer's single
Academy crossing. The book scenario retains all six real 017 Backgrounds,
walks every seeded record across pagination, checks loading/search/empty/list
states and inert rows, then verifies authenticated writes are refused and the
exact public book is unchanged.

An operator is test access infrastructure, not a new auth scenario. The existing
compiled Zitadel adapter proves a unique email absent, returns the newly-created
subject and grants its existing admin role; the normal browser helper completes
the real MFA session. A duplicate create authorizes no deletion. `After` deletes
only the returned owned subject and verifies absence, including setup failures.
Its branch-only user mirror is removed with the owned branch database after
proof. Never delete a shared actor or reset the stand. The workflow's 3785 arm
reuses the existing Admin CI IdP provisioning recipe and uploads the actual
`public-feed-originals-3785` report and head receipt.
