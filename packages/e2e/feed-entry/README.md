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
Pure title/host selection lives in the existing `lib/host-tags.ts` control
module. Strict receipt validation stays outside the ordinary config's import
graph in `lib/public-readonly-originals.ts`.

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
`public-feed-originals-3785` report and head receipt. It uses the provisioner's
existing headless Admin mode: the project, admin client and admin secret support
the operator's real MFA, while the public Doctor/Academy originals remain
anonymous. It does not configure storefront clients, sign-in-host routes or
their internal credential; those belong to the separate auth contour. Supplying
that credential would start a real silent SSO navigation requiring a login host
this non-auth runner does not own.

## Remembered specialty and Admin link — 017 EARS-7 / EARS-16

`E2E_PUBLIC_SPECIALTY_MEMORY=1` selects exactly 017:212, 017:218 and 017:385
on their canonical Doctor project, preserving the source feature and all six
inherited Background conditions. Ordinary storefront runs exclude these exact
titles. The dedicated configuration and strict receipt retain the preceding
nine originals as separate selections; CI runs all four task matrix entries.

Use the same generation, Playwright and receipt commands with `ds_dev_3789`
(snapshot/migrate wrapper) or the CI-owned `ds_probe_3789`. Build API, Doctor
and Admin, and supply the owned `E2E_ADMIN_URL` and development IdP variables
listed above. This selection owns only those three compiled listeners; it does
not need an Academy listener or sign-in-host configuration.

The home scenario records the real public choice, reloads, and checks the
collapsed specialty name/change row with no search, list, chips or expand
control. Re-choice starts with a remembered book specialty, reopens the actual
catalog, clicks a different book entry, verifies the accepted POST body and
response, then checks the exact new feed route, heading, envelope and HTTP
document. Reload proves persistence; exactly one re-choice command and no save
control prove no separate save step. The Admin scenario first completes the
Doctor Background, then uses the existing owned operator/MFA infrastructure in
a separate context to check and follow the real «Связи специальностей» link.

Each completed Background assertion group is recorded in the test's
`public-feed-entry` attachment; each of these three requires all six groups.
The actual report therefore carries eighteen completed groups, alongside the
strict three-pass, zero-failure/skip/retry/flake/error receipt. The operator
fixture accepts only the explicit 3785 or 3789 task database, logs exact actor
ownership before mutation, deletes the created IdP actor and verifies absence.
The branch-only mirror remains in the owned database for canonical cleanup.
App-local specialty-memory, feed-layout and taxonomy author/reject/retire/restore
tests remain because they cover distinct mocked or broader boundaries.

## Record tabs, vocabulary and Field layout — 017 EARS-18

`E2E_PUBLIC_RECORD_FORMS=1` selects exactly 017:401, 017:407 and 017:415 on
Doctor. It preserves the canonical feature and executes all six real Doctor
Background groups before opening a separate Admin context. The strict receipt
requires all three passes and the eighteen completed groups in their actual
JSON attachments, with no failure, skip, retry, flake or runner error. Ordinary
storefront runs exclude these exact titles. CI adds task 3797 alongside the
preceding twelve cases.

Use the existing commands with `ds_dev_3797` (snapshot/migrate wrapper) or the
job-owned `ds_probe_3797`, compiled API/Doctor/Admin and development IdP variables.
Only the existing task-scoped operator infrastructure establishes access. The
browser creates unique direction records and adjacency edges through the normal
forms. The single-tab case checks loaded edge content and absent tabs, then
switches both real direction tabs and their panels. The vocabulary case checks
all three Russian labels and explanation lines, submits a choice, reads its
exact API and database slug, and requires a normal authenticated/CSRF-protected
invalid-kind PATCH to return a field-level 400 while preserving the whole row.

The form case checks one framed form, two fieldsets with statement legends and
associated descriptions, and the computed separating hairline. The existing
TypeScript provenance mechanism also verifies the owning imported Field-family
bindings are mounted in the returned form tree, including one terminal action
row; a dead import or local layout cannot establish that evidence.

The fixture permits only the exact 3797 database with the owning API application
name, records API-created IDs, and removes and reads back only those rows in
`After`, including failures. Created IdP subjects are deleted with absence
readbacks. Branch-only user mirrors and the database remain for the lead's
post-merge cleanup. Log every stand/SQL/process/port operation; preserve failed
reports and snapshots. App-local layout, lifecycle, API rejection and Field
primitive tests retain their distinct boundaries. No product visual changes or
owner Stage-B stand are introduced.

## Hidden fields, derived address and status readability — 017 EARS-18

`E2E_PUBLIC_BOOK_FIELDS=1` selects exactly three original templates at 017:423,
436 and 443. The Outline at 423 executes every Examples row: list (431), record
(432), and create form (433). This is **five actual cases**, each with all six
real Doctor Background groups, for thirty completed groups. CI retains the
previous fifteen cases and adds task 3804, making twenty actual cases overall.
The canonical feature bytes, host, prose, steps and Examples stay unchanged.

Use the same generation, execution and strict-report commands with the dedicated
`ds_dev_3804` or job-owned `ds_probe_3804`, compiled API/Doctor/Admin, and the
existing development operator fixture. All three surfaces inspect real direction,
adjacency and specialty-link content; guarded reads establish persisted slug,
internal weight and relation identity. Browser assertions exclude visible fields,
columns and derived-address notes. JSX and value-import provenance supplement
the actual DOM checks; technical hrefs and IDs are not operator fields.

The address case creates a unique Russian title through the real UI, checks an
independently spelled transliteration, publishes through the UI, renames through
the UI, reloads and compares normal authenticated GET and exact database reads.
Slug and first-publication instant must survive the rename. Status fixtures use
normal authenticated browser-origin authoring and lifecycle commands, including
the direction's impact preview. All seven family/status combinations run in both themes,
before and during real row hover. Computed colors must resolve to the semantic
foreground/background pair, maintain AA normal-text contrast, and remain distinct
from the hovered row ground. No color-equality constraint between interaction
states substitutes for that readability contract.

The receipt identifies each case by the entire generated-file/Feature/Rule path,
the Outline parent where applicable, and its leaf. Runtime BDD source row and
expanded surface must match the canonical row attachment; a bare `Example #1`
cannot identify a case. It requires five unique passes, thirty typed Background
groups, and zero failures, skipped, retries, flaky results or runner errors.
Ordinary runs exclude these exact dedicated-resource cases.

For every local execution derive both `E2E_FEED_ENTRY_ARTIFACT_DIR` and
`E2E_REPORT_DIR` from one unique head/run root. Refuse an existing root or report
before launch, record the chosen paths and head, and preserve every failed and
successful JSON/log/trace. Generation/listing use separate destinations and are
never execution proof. CI similarly reserves a head/run/attempt/task directory.
Clean only exact created records and IdP actors with absence readbacks, including
failures; retain the task DB, mirrors, snapshots and private DB receipt for the
lead's post-merge cleanup. App-local lifecycle, hidden-field and primitive/API
tests retain their distinct boundaries; none are deleted by this contour.
