# Event count visibility originals (007 / #4035)

The contour selects exactly three unchanged individual definitions from
`007-scenarios.feature`: the untouched hidden registrant default, an operator
showing the registrant count, and an operator showing live participants.
The common Background and introductory comment are synchronized with the
already approved 2026-09-02 amendment: one six-value enum, two disjoint machines
selected by origin, and no `archived` alias. No other original is selected or
rewritten. Existing native and app-local complementary tests remain enabled.

Each case owns a separate Background witness event/PDF and its action event/PDF,
plus an operator and a non-staff doctor. The witness is authored, published and
opened through the real Admin, registered through the real API and given a real
heartbeat before the case's Given. Five ordered receipts prove the configured
Admin/session, actual stored PDF bytes, live DB enum plus the compiled native
transition matrix, actual MSK input/stored instant, and public page/listing,
registration and doctor's room reads. The matrix is contract proof, not a claim
of additional legacy HTTP acceptance.

The default case saves untouched in draft and reopens before a separate,
recorded publish precondition permits its public read. The other two cases use
real registrations. The presence case is already live with a heartbeat and a
doctor's null room count before the checkbox is changed. Both checkbox writes
use the actual editor and save/reopen. Native reads require exact counts of one.
Resource receipts distinguish each case's producer counts from its Background
witness's counts.

The runner boots the compiled production `createApiApplication` on an OS-assigned
loopback port against only `ds_dev_4035` (local) or `ds_probe_4035` (CI). It reuses
the running Admin. A URL-only Playwright transport matches **only** that Admin
origin's `/v1/` requests and forwards method, path, query, body, headers and
session unchanged to the verified owned API, retaining the cookie hostname.
There is no response synthesis, role header, shipping guard override or app/API
change. The Admin event screens are client-side consumers; their state requests
all cross this transport. Local transport readiness also passed with the baked
baseline API port unavailable. This proves the count journeys, not the Admin's
deployment proxy wiring or any sign-in, factor or provider journey.

Fixture authorization uses real, unique IdP accounts and shipping native
AdminSessionService pending/upgrade and storefront transaction/redeem paths.
These are setup only. Session roles and subjects are read back, and the browser
receives the native cookies privately. Authentication is not accepted by this
contour. No fake IdP/provider is installed.

The worker needs the registered `IDP_REDIRECT_URI` as well as the IdP/client
configuration. CI supplies the same callback as its separate API launch; a
step-local API environment does not propagate to this in-process worker.

Build the affected dependencies/API/Admin and start an owned production Admin
with its required configured `ACADEMY_PUBLIC_ORIGIN`. Provision the dedicated
branch DB with the supported wrapper, export its printed URL privately and
choose a fresh external attempt directory:

```sh
pnpm exec turbo run build --filter=@ds/api --filter=@ds/admin
pnpm dev:db:branch 4035
# E2E_EVENT_COUNT_DATABASE_URL = the dedicated URL (never commit it)
# E2E_EVENT_COUNT_DIR = a fresh private attempt directory
# E2E_EVENT_COUNT_OPS_LOG = the task's canonical prelogged operations JSONL
# E2E_ADMIN_URL = the owned, already running Admin origin
pnpm --filter @ds/e2e exec bddgen --config event-count-visibility.config.ts
pnpm --filter @ds/e2e exec playwright test --config event-count-visibility.config.ts
pnpm --filter @ds/e2e exec tsx api-probes/assert-event-count-report.ts "$E2E_EVENT_COUNT_DIR"
```

One worker, zero retries and fail-on-generation missing steps are mandatory.
The strict guard rejects missing/extra/duplicate/foreign or reordered witnesses,
wrong identities, database/head mismatch, skipped/retried/flaky runs, incorrect
counts and incomplete cleanup. Both events retire through their supported
platform transitions to hidden. Rows, registrations and beats remain, with a
private row witness before exact owned PDFs are removed. Only the exact fixture
identities and sessions are cleaned. Final local database drop is a separate
supported operation after a complete private schema/catalog/all-table witness
and zero-connection quiescence; never reset, global rollback or raw destructive
SQL. Shared services and other suites remain untouched.

Authenticated traces, HAR, video and automatic screenshots are disabled. Raw
Playwright results, room responses (which can contain chat credentials), dynamic
fixture credentials/cookies, retained rows and process diagnostics stay private.
The certificate exports only actual result counters, ordered Background/ops/
resource receipts, source/build/database provenance and hashes under `safe/`.
It scans configured and dynamically issued credentials, including cookie values,
and inventories UTF-8/UTF-16 evidence. Unexpected ZIP/HAR evidence blocks export
for private review. CI uploads only `safe/` under the distinct
`event-count-visibility-originals-4035` artifact name. No visual product artifact
or owner Stage-B approval is required for this test/tooling-only change.

On a failed browser run CI separately uploads an allowlisted `failure.json`:
static editor subphase, configuration-presence booleans, error categories,
allowlisted selector names and repository source locations, result counters,
fixed route/origin classes with HTTP status (zero means no response), and
raw-report/operation hashes. Navigation, default assertions, individual field
input, PDF, classification and save have separate prelogged phases. Only the
configured Admin and owned API origins are observed; URLs, query strings, IDs,
response bodies and headers are not diagnostic output. It never copies raw
messages, stacks, titles or credentials. Its `accepted: false` cannot replace the strict success certificate;
missing Background/resource evidence and the original failed step remain red.

Every Background clause has its own prelogged phase. The lifecycle schema load
resolves `@ds/schemas` through the API package and imports its actual ESM file URL,
using the same native dynamic-import mechanism as the compiled API modules.
It distinguishes package resolution from native import and records Node version/platform;
on failure it exports only allowlisted native error codes/types through a bounded
cause chain, then rethrows the original error. An absent or unrecognized native
code is explicit, never replaced with guessed exception text or a successful
lifecycle receipt.
