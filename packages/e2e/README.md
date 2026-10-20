# `@ds/e2e` — the C6 regression contract

The end-to-end regression contract of the staging/regression-contour tech spec
([`2026-09-08-staging-previews-and-regression-contour-en.md`](../../apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md)
§6, Issue #2067): **one** step package shared by both storefronts, the spec's own
feature files as the suite, and the navigation model both storefronts' chrome
is configured from.

### Wrong password preserves the independent owner (003 EARS-5/8/16)

`Academy refuses a wrong password without disturbing the independently authenticated owner`
(`steps/password-owner-preservation.steps.ts`, #3084,
`@password-owner-preservation`) registers and verifies a uniquely owned password
account through the actual UI and addressed delivered email. A separate guest
submits one valid-format wrong password through the actual password form. The
exact generic 401 sets no session cookie and denies private session/profile
reads. Before any later successful login, the original owner survives reload
with the identical opaque cookie, subject and complete private profile. The
actual correct owned password then authenticates that guest as the same doctor,
persists through reload and leaves the original session intact.

The default cross-worker login gate closes with a real successful owned-account
login and exact logout; it needs no golden password. Trace-off fixtures and safe
boolean evidence protect credentials and private data. Cleanup revokes exact
owned sessions in every context, supports local HTTP and stage HTTPS origins,
and preserves an original failure. No TTL/window waits, default rate-limit
ceiling, counter mutation or refresh-chain claim is involved; the case runs
unchanged in the stage Academy suite. Retain the broader generic wrong-password
declaration and native EARS-5/8/16 contracts in the API auth/session suites.
This test-only projection has no render surface or owner Stage-B slot.

### Independent-session logout isolation (003 EARS-10)

`Academy logout revokes only its requested independently established session`
(`steps/logout-session-isolation.steps.ts`, #3071, `@logout-session-isolation`)
registers and verifies one uniquely owned account using the shared addressed
mail delivery-ID checkpoint helper. After discarding the registration session,
two independent browser contexts each sign in through the actual password form.
Both private reads must succeed simultaneously with distinct opaque cookies.
Logging out the first clears its cookie and denies private session/profile reads;
replaying that exact retained cookie with its original browser fingerprint is
also generically refused. The second browser keeps its identical secure cookie,
subject and complete private profile through reload, renders its own account,
and then logs out with denied private reads.

Trace-off fixtures and boolean evidence keep passwords, cookies and private
bodies out of diagnostics. Cleanup revokes only exact owned sessions, closes
both contexts on every outcome and preserves any original scenario failure.
No TTL/window waits, rate-limit assumptions, cloned second session or session
store changes are used; the same case runs unchanged in the stage Academy suite.
Retain the broader account-control logout scenario and native
`apps/api/src/auth/session/session.service.spec.ts` revocation/audit contracts.
This browser projection makes no refresh-chain or internal-audit claim and has
no render surface or Stage-B slot.

### Consumed password-reset code (003 EARS-12/16)

`Academy refuses a consumed password reset code and preserves the accepted password`
(`steps/password-reset-code-reuse.steps.ts`, #3070) registers and verifies one
unique owned account, logs out its registration session, and completes the real
Academy reset form with an addressed delivered code and a distinct password.
An independent guest replays that exact consumed code through the ordinary
browser endpoint without requesting a replacement. The exact generic 400 must
mint no session or private access; the recovered owner's same subject and cookie
must survive a reload before further sign-ins. The replay-proposed password is
refused, the accepted password signs in independently to the same owner, and the
recovered session still survives. This asserts no rate-limit ceiling or expiry
duration and uses no TTL wait, provider mutation or manufactured challenge.

The broader reset declarations and native EARS-12/16 contracts in
`apps/api/test/auth/password-reset.e2e-spec.ts` remain complementary. Traces stay
off, secret-bearing assertions use safe projections, and cleanup revokes exact
owned sessions and closes every owned context while preserving an original
failure. Run the single `@password-reset-code-reuse` case on the lead-owned real
runtime. This test-only change has no render surface or owner Stage-B slot.

### Actual phone-code resend (003 EARS-47/48/42)

`Academy resends the actual phone SMS and confirms the same owner with its newest delivery`
(`steps/phone-code-resend.steps.ts`, #3035) registers and verifies a unique owned
account and requests a phone code through the real Academy profile UI. It reads
one actual recipient/event-bound SMS and its stable sink delivery ID, then
requires the actual resend control to be disabled. Playwright's page clock runs
only the existing thirty UI countdown ticks; no wall-clock cooldown wait, server
clock, provider lifetime, stored challenge or counter is changed. Advancing the
UI timer itself must make no phone request.

Clicking the real enabled resend must send exactly the second phone request for
the same number, return the ordinary acknowledgement, restart the disabled
cooldown and clear the code field. A distinct stable SMS ID proves a new actual
recipient/event-bound delivery even if randomly generated code digits
coincide. A complete delivery-ID checkpoint observed immediately before each
request establishes freshness independently of runner/sink clock differences;
received timestamps must still be valid. Submitting only that newest delivered code must confirm the same phone,
subject and original secure host-only session, including a reload. Missing sink
access fails proof. Traces remain off; cleanup revokes only the owned session
and closes its context on failure. Native service EARS-47 resend and the shared
countdown/component contracts remain complementary; this browser case makes no
IdP expiry or real-time cooldown-duration claim. Run the single
`@phone-code-resend` case on the lead-owned runtime. This test-only coverage has
no render surface or owner Stage-B slot.

### Consumed phone confirmation code (003 EARS-48/16)

`Academy refuses the consumed phone code without changing its verified owner`
(`steps/phone-code-reuse.steps.ts`, #3025) registers and verifies one uniquely
owned account, then confirms its fresh phone through the real account UI and
one actual addressed SMS. It retains that exact consumed six-digit code in
memory. The same authenticated page replays it through the ordinary
`/v1/me/phone/confirm` endpoint without requesting another challenge, requiring
the exact generic 400. The verified phone row, complete profile, subject and
original secure host-only session must survive, including a real reload.

An addressed mailbox checkpoint first observes the original phone-success
notice; no additional addressed mail may arrive over the full 20-second replay
observation, including a final query started at or after its deadline. Traces
stay off and assertions expose only safe projections; cleanup revokes the owned
session and closes its context even after failure. Missing SMS/Mailpit access
fails proof. Run only `@phone-code-reuse` on the lead-owned runtime. The broader
wrong/expired/reused declaration remains retained; native consumed refusal and
write/audit/notice exclusions remain in `apps/api/test/me/phone.e2e-spec.ts`
EARS-48. This browser case makes no expiry, internal counter or audit claim.
This test coverage change has no render surface or owner Stage-B slot.

### Another account's confirmed phone (003 EARS-51/49/48/16)

`Academy neutrally accepts another owned account's confirmed phone without sending SMS`
(`steps/phone-collision.steps.ts`, #3017) registers and verifies two unique owned
accounts and confirms distinct fresh phones through the actual Academy UI and
SMS sink. The second account requests the first account's confirmed phone:
exactly the ordinary `code_sent` acknowledgement and pending controls must
appear, its own confirmed phone must clear to null API phone/verification fields,
and the first account must retain its confirmed phone and private identity.
A complete 20-second recipient/time-bound sink horizon, including a final
query started at or after the deadline, proves no SMS to the holder.
Submitting six digits next must produce only the generic wrong-code response and
UI while both owned profiles retain their post-request phone states.
Traces stay off; cleanup revokes both owned sessions and closes both contexts,
even on failure. Missing real Mailpit or SMS prerequisites fail the proof.
The broader original scenario and native phone API IdP no-write, timing, limits
and audit coverage remain unchanged. Select the single `@phone-collision` case
on the lead-owned runtime. This coverage change has no render surface or
owner Stage-B slot.

### Abandoned phone replacement (003 EARS-49/58)

`Academy abandons phone replacement without restoring either phone as an SMS identifier`
(`steps/phone-abandoned.steps.ts`, #3016) verifies one uniquely owned Academy
account and confirms phone A through real mail and SMS. It requests replacement
B, observes its actual delivered confirmation SMS without entering it, logs out
and signs in by email/password. A reload must retain the same subject and verified
email with null profile phone and phoneVerified. Guest SMS sign-in requests for
both numbers receive the exact neutral acknowledgement, no private access and
no addressed SMS over the full 20-second horizon, including a final sink query
at or after the deadline. Returning by email/password permits another actual
confirmation SMS request for B; that fresh code also remains unconsumed.
The BFF keeps no pending-phone record, so this case makes no claim that the
unconfirmed number remains rendered after navigation. Native displacement,
password-identifier lookup and audit proofs remain in
`apps/api/test/me/phone.e2e-spec.ts` EARS-49, with generic reset-response equality
in EARS-51. Unconfirmed-phone reset refusal with no SMS or email remains in
`apps/api/test/auth/password-reset.e2e-spec.ts` EARS-53/16.
Trace-off fixtures and canonical registration/phone/session helpers are reused;
cleanup revokes the owned session and closes its context even on failure.
Missing mail or SMS access fails proof. Select `@phone-abandoned` on the
lead-owned runtime. This test coverage change has no render surface or Stage-B slot.

### Wrong phone confirmation code (003 EARS-48/16/52)

`Academy refuses a wrong phone code and accepts the retained real code`
(`steps/phone-code-refusal.steps.ts`, #3007) registers and verifies a unique
owned account through the real Academy UI, requests a fresh phone and reads its
actual six-digit confirmation SMS. A guaranteed different six-digit code must
receive the exact generic refusal and keep the existing code screen; the same
private identity and unconfirmed profile remain unchanged. A complete addressed
mail-ID checkpoint before submission and the full 15-second negative horizon
prove no notice mail. Only afterwards does the retained real SMS code confirm
that phone on the same account. Traces stay off and cleanup revokes only the
owned session and closes its context. Missing SMS or Mailpit access fails proof.
This narrow browser projection leaves the broader wrong/expired/reused scenario,
native `apps/api/test/me/phone.e2e-spec.ts` EARS-48 audit/counter/state proofs
and `account-profile-card.test.tsx` EARS-48 component coverage intact. It makes
no browser expiry, reuse, IdP-internal or notice-artifact claim. Run the selected
`@phone-code-refusal` case on the lead-owned runtime. This coverage change has
no render surface or owner Stage-B slot.

### Email reset with a confirmed phone (003 EARS-53)

`Academy keeps email reset delivery when the account also confirms a phone`
(`steps/password-reset-email-with-phone.steps.ts`, #2962) registers and verifies
one unique account, confirms a fresh phone through the real profile and SMS
sink using `lib/owned-phone-confirmation.ts`, then observes and settles the
phone-confirmation notice mailbox. An independent guest submits the email to
`/reset` and receives the exact neutral acknowledgement. A fresh addressed
six-digit reset email and the truthful email-code UI precede a full 20-second
check for any addressed SMS; exactly one email is added to the settled baseline.
The selected `@email-reset-with-phone` clause ends at delivery. The original
fixed-address scenario, native `apps/api/test/auth/password-reset.e2e-spec.ts`
EARS-53 email-with-phone test and existing real email/SMS reset-completion
journeys remain complementary and unchanged. Traces stay off; cleanup revokes
the owned session and closes owned contexts. Requires a real readable
`E2E_SMS_SINK_URL` and Mailpit; a missing sink is an explicit skip, never proof.
This test coverage change has no render surface or owner Stage-B slot.

### Reset with unconfirmed phone states (003 EARS-53/16)

`Academy silently accepts reset for unknown, congress-contact and pending phones`
(`steps/reset-unconfirmed-phones.steps.ts`, #3018) prepares three distinct fresh
numbers: unknown, raw contact phone accepted by the real congress intake, and a
phone requested through a real verified account's profile but never confirmed.
The pending confirmation SMS is observed without submitting its code. Three
independent guests submit the actual reset form and require the same exact
`reset_requested` acknowledgement and ordinary conditional SMS code step.

Complete addressed mail-ID checkpoints for both known accounts are captured
immediately before each request. All addressed SMS and both addressed mailboxes
are observed over a full 20-second horizon, including final queries started at
or after the deadline. No reset code is submitted and every guest remains
without private profile/session access. The per-case 180-second budget covers
real congress mail, registration and negative delivery horizons. Traces stay
off; cleanup revokes the owned registration session and closes every owned
context even after failure. Missing intake, Mailpit or sink prerequisites fail.

The broader native declaration remains unchanged. The browser claims no 50 ms
timing parity, internal counter or audit observation. Native
`apps/api/test/auth/password-reset.e2e-spec.ts` EARS-53/16 proves response/timing
parity and absent reset audit rows. Unit tests in
`apps/api/src/auth/sms-unconfirmed-counter.spec.ts` EARS-56 prove increments by
flow, including reset; `apps/api/test/auth/login-otp.e2e-spec.ts` separately proves
request-level sign-in counting. These pointers claim no reset request-level
counter proof. Confirmed-phone reset delivery and completion remain separate
existing journeys. Run only the
`@reset-unconfirmed-phones` case on the lead-selected contour. This test-only
coverage has no render surface and needs no owner Stage-B request or slot.

### Reset SMS hint and email transition (003 EARS-54/55)

`Academy reset explains SMS eligibility and returns to email without claiming delivery`
(`steps/reset-sms-hint.steps.ts`, #2989) drives `/reset` as an independent guest
with a fresh unknown phone. It proves the shipped static eligibility hint is
accessible from the identifier input, the exact neutral acknowledgement, and the
conditional SMS code-step wording with the typed phone in bold. A readable real
SMS sink must show no addressed SMS over a full 20-second horizon; missing sink
access fails the proof rather than skipping it. The actual `Начать заново`
control returns to the identifier form, where typing an owned email removes the
SMS hint without another auth command or private session/profile access. Traces
stay off and the owned guest context is closed. No recipient email belongs to
the unknown phone, so this browser projection makes no global inbox-silence
claim: no-email, response timing, counter and audit assertions remain in
`apps/api/test/auth/password-reset.e2e-spec.ts` EARS-53/56. The broader native
`The reset step and the hint tell the truth about the SMS` declaration,
`packages/auth-flow/src/reset/reset-door.test.tsx` EARS-54/55 and confirmed-phone
SMS delivery/reset completion in `steps/password-reset-sms.steps.ts` remain
retained. This coverage-only change has no render surface or owner Stage-B slot.

## What is in here

| File                   | What it is                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation-model.ts`  | The model TYPE (`NavigationItem`, `NavigationModel`, `Audience`) plus the pure projections `itemsFor` / `landingEvidence` / `byId`.                                                                  |
| `hosts.ts`             | The `HostConfig` registry: one entry per storefront (`academy` = `apps/portal`, `doctor` = `apps/doctor`) with its base-URL env var, its login surface, and the PATH of its navigation-model module. |
| `route-params.ts`      | Dynamic-segment resolution for the route walk (§6.3): route pattern → the golden entity that renders it, keyed per host.                                                                             |
| `derived/`             | The two derived walks (§6.3): `navigation.walk.spec.ts` and `routes.walk.spec.ts`. Plain Playwright specs, run by the `walks` project.                                                               |
| `steps/`               | The shared Gherkin vocabulary: `support/fixtures.ts` (the `host` fixture), `golden.steps.ts`, `navigation.steps.ts`.                                                                                 |
| `lib/`                 | The pure, unit-tested seams (`golden.ts`: seed name → `@ds/db` golden account; `routes.ts`: route-manifest → visitable addresses) plus `sign-in.ts`, the package's one login path.                   |
| `admin/`               | The admin-side writers (export `@ds/e2e/admin-events`): `platform_admin` bootstrap, browser sign-in with TOTP, and the event writers over the real 007 screens.                                      |
| `playwright.config.ts` | `bddgen` over the spec feature files + the two host projects + the `walks` project.                                                                                                                  |

## Running it

The suite drives a RAISED slot; it starts nothing itself (the slot topology
belongs to `tools/staging`, never to a test config).

```sh
E2E_PORTAL_URL=https://pr-123.stage.doctor.school \
E2E_DOCTOR_URL=https://d-pr-123.stage.doctor.school \
DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED=… \
pnpm --filter @ds/e2e test:e2e            # bddgen && playwright test
```

`pnpm --filter @ds/e2e bddgen` alone regenerates the runnable specs; `pnpm
--filter @ds/e2e test` runs only the pure unit seams (no browser, no slot).
An unset `E2E_*_URL` fails by NAME — a run that silently defaulted to localhost
would report a green pass against nothing.

## The suite is the spec's feature file

`features` points at `apps/docs/content/specs/features/*/*-scenarios.feature`
(§6.1). There is no second copy of a scenario in a test folder: a scenario cannot
exist without the requirement it verifies, and `author-ears-spec` step 7 already
produces the file for every new feature.

### Host tags

Every spec feature file declares, once at Feature level, which storefront runs
it: `@host:academy`, `@host:doctor`, `@host:both`, or `@host:admin`. The
projects select **positively** — `@host:academy or @host:both` on academy,
`@host:doctor or @host:both` on doctor (`lib/host-tags.ts` builds both
expressions, so the vocabulary and the selection can never drift apart).

`@host:admin` is selected by no storefront project on purpose. An admin-surface
journey (007, 011, 012) or a backend-only one (010) belongs to the admin suite in
`apps/admin`; running it against a storefront reports a false red, which is the
one thing this suite must not teach the team to ignore. A pure API spec (001, 002) drives its checks through ONE storefront's API proxy and is tagged
`@host:academy` — never `@host:both`, which would pay double runtime for one API.

Positive selection is what makes the tag structural: an untagged file is selected
by NEITHER project, so its scenarios silently stop existing. The `bddgen` script
therefore runs `bin/check-host-tags.ts` first — it exits 1 naming every feature
file that carries no Feature-level host tag, or more than one, so generation
fails loudly instead of quietly shrinking the suite.

Adding or retargeting a host tag is a suite-selection edit, not scenario
authorship: `tools/lint/lib/diff.ts` keeps such a file OUT of the §6.4/§6.5
«touched» set, so annotating a spec does not make the annotating PR inherit that
spec's §8 backfill debt. Change one scenario line in the same file and it counts
as touched again.

## Missing-step policy: `skip-scenario`

Most spec feature files still carry the pre-contract step prose the §8 backfill
rewords, so most scenarios have no matching step definition yet. Of the three
policies `playwright-bdd` 9.2 offers:

- `fail-on-gen` would make `bddgen` exit non-zero permanently — a gate nobody can
  keep green teaches the team to skip it;
- `fail-on-run` would report those scenarios as FAILURES, making a red suite the
  normal state and destroying the signal of a real regression;
- **`skip-scenario`** keeps generation green _and_ lists every unimplemented
  scenario in the run output as skipped — visible and countable, never silently
  dropped. That is what lets the §6.4 coverage lint tell «not written yet» from
  «gone».

`retries: 0` (§6.5): a retry turns a flake into a pass and a regression into a
slow pass.

## The navigation-model contract

Each storefront exports its navigation as DATA from a React-free module next to
its shell configuration:

- `apps/portal/lib/navigation-model.ts` → `portalNavigationModel`
- `apps/doctor/lib/navigation-model.ts` → `doctorNavigationModel`

The chrome itself is the shared `@ds/storefront-shell` (#2180) and each host
supplies only VALUES, so the host's `lib/shell-config.ts` **derives** the
wordmark's target and the nav from that array and the host's auth-cluster mapping
derives `loginHref` / `profileHref` from it — `apps/portal` resolving `label` as a
`shell` message key, `apps/doctor` rendering it as the Russian literal it already
carried. The derived navigation walk reads the same array. A new chrome link
therefore enters the regression suite with zero edits to any list, and the model
cannot drift from what the bar paints.

A destination the chrome does not paint has **no row**: the model is what the
shell offers, not a catalogue of routes. `/register` on the doctor storefront and
`/account/events` on the academy are reached from inside a page, not from the
chrome, so the walk does not assert them as chrome destinations.

Each item carries the §6.2 landing evidence: the `h1` the destination actually
renders, or a `data-surface` marker for a page that owns none. Asserting the
address alone is what let «200 on the wrong page» (#2012) stay green.

**Why the model is registered by PATH, not imported.**
`local/package-import-boundary` forbids any `packages/**` module from reaching
into `apps/**`, so `@ds/e2e` cannot import a host's model. `hosts.ts` records the
module path and `loadNavigationModel()` resolves it against the repo root with a
dynamic import at run time. The boundary stays intact and the walk still reads
the host's own single list. The type travels the other way, which is allowed and
is how a host pins its model to the contract: `import type { NavigationModel }
from "@ds/e2e/navigation-model"` + `satisfies`.

## Derived walks

Two specs under `derived/`, both of which contain **no list of destinations** —
they read the host's own artifacts, which is what «ten new links in a release
enter both walks with zero edits to any list» (§6.3) means in practice.

**`navigation.walk.spec.ts`** loads each host's navigation model and visits every
item twice: as a guest (`itemsFor(model, "guest")`) and as the golden signed-in
doctor. Per item it asserts status 200, the pathname, and the item's declared
landing evidence. A guest item that redirects to the host's login surface instead
asserts the login `h1` and that `returnTo` still carries the original href — a
redirect that loses `returnTo` strands the guest after sign-in.

**`routes.walk.spec.ts`** fetches the slot's own route manifest, filters it to
the addresses a visitor can type (`lib/routes.ts` — route handlers, `/api/**`,
`/_not-found`, `/_next/**`, parallel slots and intercepting routes are out; route
groups are stripped from the address), resolves dynamic segments through
`route-params.ts`, and asserts 200 + a non-empty `h1`. Three conditions are
FAILING tests rather than skips, each titled with what is missing: an
unconfigured base URL, a manifest the slot does not serve, and a dynamic route
with no `route-params.ts` entry.

Dynamic segments come from the catalogue the ROUTE'S OWN PAGE reads, not from one
global source. `/webinars/[slug]` and `/events/[slug]` render DB rows and resolve
from the golden seed; `/documents/[slug]` renders a FILE, so it resolves from
`@ds/legal-content` — the very package both hosts' `generateStaticParams`
enumerate. The first slug in that catalogue's slug-sorted order is the
deterministic pick, which is why `/documents/[slug]` — the exact route whose
runtime files went missing from the standalone image in #2012 — walks green on
both hosts instead of standing permanently red.

### The route manifest is published by the image

The walk reads `.next/server/app-paths-manifest.json`, which every image's
standalone bundle carries at that non-public path, and each app's route
handler (`app/%5F_contour/app-paths-manifest.json/route.ts`) serves it at

```
/__contour/app-paths-manifest.json
```

exported from `hosts.ts` as `MANIFEST_PATH` — one constant shared by the two
route handlers, the walk and this README. The handler answers only when the
container's RUNTIME env sets `CONTOUR_MANIFEST=1` (#2981 — one image serves stage
and prod, so the gate cannot be a build arg): **slot containers only**, because
`infra/deploy/compose/slot/compose.yml` is the one compose that sets it.
Production therefore answers 404 at `/__contour/*`. Reading it from the SLOT rather than from the repo is the whole
point: the repo says what the source declares, the slot says what the image
actually serves.

Both hosts run inside ONE Playwright project (`walks`). The Gherkin projects are
per host because `bddgen` writes a different generated directory per host tag
filter; the walks have no such artifact — the host is data, read from `HOSTS`,
and each test title names the host it walked.

## Golden entities by seed name

The 004 public-discovery journey (`steps/webinar-discovery.steps.ts`) follows
`golden.events.upcoming` from the Academy listing to its public page. It asserts
the cookie-free server-rendered listing, the card's fixed golden title, school,
specialties and speaker, its actual slot date/time in Moscow, and the destination
pathname **and** matching heading. The date comes from the public read because
each slot's seed is relative to its own golden-now pin. Pagination uses the visible
listing controls when the named card is not on the first page. The separate 004
empty-state test remains app-local; this journey does not claim the broader
listing ordering/filtering or authentication scenarios.

The 019 doctor events journeys (`steps/events-feed.steps.ts`, Issue #2256) run
the `/events` feed of the doctor storefront from its golden data: the guest
reading, the day groups and «Показать ещё», the compact month's day pick, the
month view of the same page, the facet panel and its 390 px sheet, the URL
round trip in a fresh context and through Back, «Прошедшие» with its count
paging and recording link, and the «Идёт сейчас» block into the room (the
signed-in `verified-cardiologist`, registered for `golden.events.live`) or to the
event page (a guest). The only named facts are `golden.events.live` and the
experts-audience `golden.events.upcoming`, which the doctor feed must never list
(019 EARS-16); every other count, date and title is read from the slot. The
fixture-tier states a slot cannot reach on demand — nothing live, a failed read,
three live strips, the full 390 accessibility matrix — stay in
`apps/doctor/e2e/events-*.spec.ts`.

The same Rule carries 019 EARS-9 (an empty feed by filters names the facet whose
removal helps; a refused feed read stays inside its block with «Повторить»),
EARS-15 (one shared composition at 1440/390 in light and dark), EARS-17 (a kind
an editor publishes or retires) and EARS-18 (doctor and Academy render one
module, differing only in header copy, filter set and content set; Issue #1530).
The three EARS-17 scenarios are tagged `@editor-write`: they publish and retire
kinds and events through the real admin screens (`admin/event-kinds.ts`,
`admin/events.ts`), so they run only where `E2E_ADMIN_URL` names an admin this run
owns (a local dev stand on a branch DB), are skipped otherwise — never on the
read-only slot run — and the After hook takes down what they created, each record
on its own, even when the scenario failed (`ensureEventKindRetired` skips a kind
whose retire already landed). The 3/9 scenario publishes 9 kinds, each carried by
one event whose title holds a per-run token, opens the feed narrowed by that token
(`q`), so the kind facet counts exactly this run's kinds, checks the panel, the
sheet and every card at 1440 and 390 by layout (option count, boxes inside the
panel/sheet/viewport, no horizontal overflow), then retires 6 and checks that all 9
are still offered (a retired kind stays a filter value while its events are listed —
019 «Amendment — 2026-10-13»), then takes those 6 kinds' events off the storefronts
and checks the 3. On
a local stand the api runs with bot protection off and the slot's test-runner
`RATE_LIMIT_*` ceilings (`infra/deploy/compose/slot/compose.yml`); otherwise the
admin sign-ins of a whole-feature run trip the per-IP auth window.

`Given the golden doctor "verified-cardiologist" is signed in` (§6.1). A feature
file never carries an email or a password. `lib/golden.ts` is the one place a
seed name becomes a real `@ds/db` golden account plus the env var holding its IdP
password (`DS_GOLDEN_PASSWORD_DOCTOR_*` — the seed never invents a password). A
mistyped name fails loudly with the accepted names listed.

**Parallel workers (#2805).** The suite runs `fullyParallel` on `E2E_WORKERS`
workers (default 4, at most `GOLDEN_WORKER_POOL_SIZE` = 6 — more is refused when
the config loads). Each worker signs in as its OWN golden account: steps and walks
resolve a seed name through `lib/worker-golden.ts`, which picks
`golden.workerPool.<seed>[testInfo.parallelIndex]` (worker 0 = the catalogue
account, workers 1–5 = `golden.doctor.verified.w<n>@example.test`, all with the
same `DS_GOLDEN_PASSWORD_DOCTOR_VERIFIED`). A logout, a reset request or a sign-in
code in one worker therefore never reaches another worker's session or inbox read.
Every other journey registers its own `randomUUID` account or only reads, and the
per-IP auth limit is already lifted on every stage slot (#2684). The derived
navigation walk signs the doctor in once per worker and host and reuses that
session's cookies for the remaining items (the login itself is covered by its own
scenarios, which keep their per-scenario UI sign-in). Run serially for debugging
with `E2E_WORKERS=1`.

The sign-in adds no auth primitive: it drives the host's real login surface the
way the shipped 008 shell journey does (`apps/portal/e2e/steps/shell.steps.ts`).
It lives in `lib/sign-in.ts` and is the package's ONE login path — the Gherkin
step and the navigation walk's doctor pass both call it, so they cannot drift
into two different notions of «signed in». It waits for the login route to
finish loading AND for the network to go idle before touching a field, because
the login card is server-rendered as a real `<form>`: clicked before its client
chunks execute, the browser submits it natively and `/v1/auth/login` is never
called. That case now throws a named error naming the walk as the defect rather
than timing out on a URL that will never change.

## Captcha-gated journeys: `installCaptchaStub` (#2605)

Registration, login-OTP request, verification resend and password reset carry the
invisible Yandex SmartCaptcha, which never yields a token in headless Playwright.
`lib/captcha-stub.ts` (export `@ds/e2e/captcha-stub`) routes ONLY the Yandex
`captcha.js` request to an inline stand-in implementing the `window.smartCaptcha`
surface `@yandex/smart-captcha` calls, resolving every `execute` with the stand's
non-production test token — the widget wrapper, header plumbing, api guard and
provider all run for real.

```ts
import { installCaptchaStub } from "@ds/e2e/captcha-stub";

await installCaptchaStub(page); // or a BrowserContext; before the first navigation
```

`prepareCaptchaForJourney(target, baseURL, botProtectionEnabled)` retains that
strict adapter by default. It omits the adapter only for a valid HTTP(S) URL
whose literal hostname is exactly `localhost`, `127.0.0.1` or `[::1]` and an
explicit boolean `false`; aliases, remote/stage URLs, malformed targets and
missing/true flags retain the token requirement. The account-profile scenario
passes Playwright's resolved `baseURL` and maps only the exact process value
`BOT_PROTECTION_ENABLED=false` to OFF. No token is inferred or invented, and
existing `installCaptchaStub` callers keep their strict behavior.

The token comes from `E2E_CAPTCHA_TEST_TOKEN` (set by `pnpm e2e:stage` from the box,
or exported by hand — `tools/staging/README.md` → «Driving captcha-gated auth on a
slot»). Absent ⇒ `CaptchaTestTokenMissingError`, never a silent skip. No walk in this
suite drives a captcha-gated step yet; the first one calls the helper.

## Admin-side writers: `@ds/e2e/admin-events` (#2751)

`admin/` holds what an e2e flow needs to produce admin-side state through the real
admin screens: `bootstrapAdminSession` (a fresh `platform_admin` granted on the
stand's IdP; the registrar/committee variants alongside), `signInAsAdmin` (the
browser login with its TOTP enrollment/challenge, `totp.ts` being the independent
RFC 6238 generator), the event writers `createPublishedEvent`, `retireEventFromStorefronts`,
`openEventLive`, the kind writers `createPublishedEventKind` / `retireEventKind` and the slug read-backs `eventSlugFromDetail` /
`eventSlugFromRoster`. The admin flow specs consume them, and so does a
storefront spec that needs an event in a given state — it drives them on the
admin origin in its own browser context instead of depending on a fixed seed whose
wall clock drifts:

```ts
import {
  ADMIN_ORIGIN,
  createPublishedEvent,
  eventSlugFromDetail,
  openEventLive,
  signInAsAdmin,
} from "@ds/e2e/admin-events";

const context = await browser.newContext({ baseURL: ADMIN_ORIGIN });
const admin = await context.newPage();
await signInAsAdmin(admin);
const id = await createPublishedEvent(admin, title, { startsInMs: 5 * 60_000 });
await openEventLive(admin);
const slug = await eventSlugFromDetail(admin, id);
```

Dev-stand-gated: needs a running admin (`E2E_ADMIN_URL`) and `IDP_ISSUER` /
`IDP_SERVICE_TOKEN` / `IDP_PROJECT_ID`.

## Running this suite against a staging slot

The 003 expired email-verification code (EARS-3 / EARS-13) is not a browser
scenario: it is proven in CI `api-e2e` by
`apps/api/test/auth/zitadel-email-code-expiry.e2e-spec.ts`. That job's throw-away
Zitadel carries a short `SECRET_GENERATOR_TYPE_VERIFY_EMAIL_CODE` lifetime
(`IDP_VERIFY_EMAIL_CODE_TTL_S`, read back before the suite and again by the spec),
so the real delivered code expires in seconds; staging and production keep 3600s.
A staging slot run therefore never waits out a code lifetime. The browser refusal
UI for a refused code is covered by the wrong-code scenario; OTP limiter debit is
separate HTTP evidence in `apps/api/test/auth/abuse-limits.e2e-spec.ts` (EARS-13).

`pnpm --filter @ds/e2e test:e2e` runs whatever `E2E_PORTAL_URL` / `E2E_DOCTOR_URL` point
at. The supported way to point them at a converged staging slot is
[`pnpm e2e:stage <slot>`](../../tools/staging/README.md#regression-run-pnpm-e2estage-slot):
it derives both hostnames from the slot name, reads the stand's basic-auth pair (which this
config turns into Playwright `httpCredentials`), refuses a slot that is not converged,
keeps the HTML + JSON report under `packages/e2e/playwright-report/<slot>-<timestamp>/`,
and prints the verdict block the operator pastes into the PR body or the release record.
`--project walks` selects the derived walks alone (the two storefront a11y legs belong to
the host projects, so that selection runs neither).

`E2E_PUBLIC_LOG=1` (set only by `.github/workflows/stage.yml`, whose log is public)
replaces the console reporter `list` with `reporters/summary.ts` — one line per test:
status, project, title path, duration, retry; never an error message, test output,
attachment or URL — and requires `E2E_REPORT_DIR`, the only place the JSON and HTML
reports are then written (`lib/reporters.ts`). Unset, the console stays `list`.

The suite runs on the operator's machine while Mailpit and the SMS sink stamp
deliveries with the stage box's clock, so no delivery reader compares a runner
instant with a store timestamp (#3057): a runner clock a few hundred
milliseconds ahead hid every code its own request caused. Every reader takes the
store-side checkpoint observed just before the triggering action —
`captureAddressedMailCheckpoint` (recipient-bound Mailpit IDs) or
`captureSmsCheckpoint` (phone-bound sink IDs; `smsOrigin(phone)` when every
delivery counts) — and a delivery is fresh exactly when its ID is not in it.

### Registration without consent (003 EARS-20)

`Registration is refused without consent` uses unique owned credentials and a
real same-origin browser request to `/v1/auth/register` with `consent: []` and
the stage CAPTCHA test token. Academy's approved form records `tos/2026-01`
from its read-only terms statement; this scenario tests the BFF's omission
refusal, without claiming an unchecked-checkbox UI path. It asserts the generic
400, no private session or profile access, and no credential/token exposure.
The retained API `register.e2e-spec.ts` EARS-20 proof remains intact.

`lib/consent-refusal.ts` reads only the count for that journey's exact generated
`register-2704-<UUID>@example.test` address, before and after refusal. It verifies
the browser origin against the canonical stage hostnames, uses the shared SSH
transport and slot database name, and runs a read-only transaction with a
five-second statement timeout. SSH access is required; missing access or an
invalid count fails closed. Every remote command is appended to
`.scratch/stand-ops-2704.log`; the probe emits no mirror fields or credentials.

Run on a lead-owned, converged PR slot:

```sh
pnpm e2e:stage pr-<N> --project academy --grep "Registration is refused without consent"
```

### Exact minimum password (003 EARS-36)

`A password of eight characters with no character classes is accepted` submits
exactly eight lowercase letters through the real Academy registration form for
a unique owned address. It reads the actual staging IdP complexity policy first:
minimum length eight, with all four character-class flags off. This read uses the
canonical staging SSH/IdP helpers, validates the Academy and IdP origins before
loading the operator PAT, and changes no policy. SSH access is required. Commands
are appended to the absolute TEMP `E2E_STAND_COMMAND_LOG` (or the system temporary
directory's `ds-e2e-stand-ops/password-policy.jsonl`), without response secrets.

Fresh owned verification mail supplies one six-digit code. One accepted
confirmation must establish the secure host-only session and the same
email-verified private profile; registration acceptance alone is insufficient.
The scenario reuses `owned-registration.ts`, `secure-session.ts` and the auth
fixtures, keeps traces off, and revokes only its own session during cleanup.

```sh
pnpm e2e:stage pr-<N> --project academy --grep "A password of eight characters with no character classes is accepted"
```

### Short password refusal (003 EARS-36)

`A password shorter than the minimum length is rejected by the single rule`
uses a clean owned Academy browser context, a unique never-registered email and
the account return target. It enters seven lowercase letters, blurs and clicks
the normal submit control, then requires only the length error and zero
`/v1/auth/register` POSTs. Correcting the same field to exactly eight lowercase
letters clears the rejection and leaves submission available, preserving the
address, password and registration context without creating an account. Private
session/profile and readable-secret checks run before and after the refusal and
correction. `steps/password-refusal.steps.ts` reuses the secret-safe input helper,
auth fixtures and CAPTCHA test-token harness, closes its context during cleanup,
and retains the existing schema and portal blur-only tests. Run this selected
case together with the existing exact-eight acceptance regression on the
lead-owned converged slot:

```sh
pnpm e2e:stage pr-<N> --project academy --grep "A password shorter than the minimum length is rejected by the single rule|A password of eight characters with no character classes is accepted"
```

### Initial password hint (003 EARS-37)

`The single password rule is visible before submission` opens the Academy
registration form without touching any control. `steps/password-hint.steps.ts`
records form focus, input, blur and submit events from document load and requires
none before checking the empty password field's associated, visible single
minimum-length message. It rejects a second password message, additional text
in that field group, a requirement checklist or a strength meter, and requires
zero registration POSTs. This is NEW live preinteraction coverage; the existing
`PasswordField` one-slot unit contract and portal identifier-validation blur/error
checks remain intact. The selected case creates no account, sends no code and
needs no CAPTCHA test token.

```sh
pnpm e2e:stage main --project academy --grep "The single password rule is visible before submission"
```

### Password message replacement (003 EARS-37)

`The validation error replaces the hint in the one message slot` captures the
untouched Academy password field's `aria-describedby`, message ID and single
minimum-length rule, then attempts a normal registration submit with seven
characters. `steps/password-message-slot.steps.ts` requires the original message
element to remain connected as its helper ID becomes the error ID, associated
with that one live alert naming the original rule, with no
coexisting hint, checklist or meter. It also requires zero registration POSTs
and no private session or profile access. The auth fixture keeps traces off;
the scenario creates no account and needs no CAPTCHA test token. Existing
PasswordField unit, identifier-validation blur, initial-hint and short-password
refusal coverage remains intact. Run the selected scenario on the lead-selected
stand; this test-only change requires no owner Stage-B request or new slot.

### Sign-in method switching (003 EARS-43)

`The typed address survives a switch between the sign-in methods` drives the
Academy password and code tabs without submitting an auth command. It asserts
the exact email in both directions, an empty password on return, and the same
account return target in the address bar and registration/reset links. It also
asserts that the typed E.164 phone selects SMS and survives the return switch:
Academy's `LoginDoor` serves the shared `AUTH_FLOW_CHANNELS` email/SMS constant.
This is channel-selection proof, without an SMS send or sign-in claim.

`steps/identifier-switch.steps.ts` reuses the host/auth fixtures and secret-safe
input helper. The existing `login-card.test.tsx` EARS-43 component and request
tests remain; no exactly matching app-local browser test was removed. The
separate direct code-link login journey remains unchanged.

```sh
pnpm e2e:stage pr-<N> --project academy --grep "The typed address survives a switch between the sign-in methods"
```

### Password reveal (003 EARS-38)

`Every password field carries a keyboard-operable reveal toggle` runs all three
outline rows on real Academy registration, password-login and reset-complete
forms. Each field starts masked, is revealed with Tab/Space and masked again
with Enter, retaining its entered value and selection while the localized
accessible action and pressed state change. The reset row reaches the complete
form through one real, neutrally acknowledged reset request for its unique
unregistered address and the canonical stage CAPTCHA helper; no code or reset
completion is submitted. All rows assert no other auth command or private
access, reuse the auth fixtures and secret-safe registration helpers, and close
their owned contexts before snapshots. The existing primitive and app-local
backend-free tests remain as separate coverage.

### Password reveal side effects and reload (003 EARS-38)

`Revealing a password has no side effect and never survives a reload` opens a
clean Academy registration form with the `/account` return target, enters one
owned unsubmitted password and selects a caret range. After readiness it brackets
the actual reveal with a 500ms observation of all requests, console/browser logs,
local/session storage mutations, cookie writes and history writes. The action
must preserve the value/caret, issue no observed side effect and grant no private
session or profile access. A cache-bypassing real document reload must restore the
masked field and unpressed localized show action; a document marker proves this
was a new document rather than a client route update.

`steps/password-reveal-reload.steps.ts` uses the existing secret-safe input and
absent-private-access helpers with the trace-off auth fixture. The narrow observer
forwards native APIs unchanged and restores them before reload; assertions expose
only counts and boolean projections, with cookie comparison retaining a digest.
Existing three-surface keyboard reveal coverage and PasswordField value/caret/
no-change unit invariants remain. The guest never submits registration, and
cleanup closes only its owned context. The case also guards the shared
PasswordField caret restoration. The PR records the full auth-canvas comparison
and the lead's behavioral-only Stage-B certification, with real browser runs
and unchanged-render captures:

```sh
pnpm e2e:stage <slot> --project academy --grep "Revealing a password has no side effect and never survives a reload"
```

### Cold email confirmation (003 EARS-39/41)

`A cold verification step still signs in by the code` registers a unique owned
account with the supported `/account` return target, then genuinely reloads the
verification document before entering its fresh six-digit mail code. It asserts
one code-only confirmation request, the same email-verified profile and secure
host-only session at `/account`, no registration or login replay, and no second
addressed mail for 15 seconds. A separate clean guest browser then submits the
original registration password and proves its generic refusal without private
session or profile access.

`steps/cold-verification.steps.ts` reuses the registration, mail, secret-safe
input and session helpers. Only the hard-reload trigger is claimed here; the
existing auth-flow cold-state and IdP password-invalidation unit tests remain.
The test revokes its owned session and closes both contexts on completion.

```sh
pnpm e2e:stage pr-<N> --project academy --grep "A cold verification step still signs in by the code"
```

### Address-less verification (003 EARS-40)

`A /verify opened with no address goes to the registration door` drives two
clean Academy tabs, first with a bare URL and then with the same-origin
`/webinars/ahilles-042` return target. Both must replace onto registration;
actual Back/Forward navigation proves the invalid entry is absent from history.
A document-start DOM observer and the real server HTML check require no
address-less verification card, generic account description or auth frame.
Neither arrival may send an auth request, establish a private session or read
the private profile. The first three portal `verify-bare-entry.e2e.spec.ts`
cases move to `steps/bare-verification.steps.ts` with every original assertion
retained; its fragment and positive addressed-entry cases remain app-local,
along with the existing auth-flow unit contracts. No account is created.

```sh
pnpm e2e:stage <slot> --project academy --grep "A /verify opened with no address goes to the registration door"
```

### Wrong verification code across account states (003 EARS-41/16)

`A wrong code fails identically for every identifier` is one Academy scenario
with fresh verified, unverified and unknown identifiers in distinct browsers.
`steps/wrong-verification-code.steps.ts` creates its two owned accounts through
real registration and Mailpit, verifies one, and revokes that prerequisite
session. Every browser opens a cold `/verify` document and submits the same
complete wrong six-digit code through the UI; status, exact response bytes,
the generic error and absent private cookie/profile/principal must match.
These three UI submissions form the discarded warm-up round. Five measured
round-robin rounds then submit the same code-only request from each browser.
Their class medians must differ by no more than 50 ms and every measured request
must satisfy the native 30 ms floor. Eighteen failures plus one fixture
confirmation fit the unchanged 20/IP verification budget; selected local runs
need a fresh window and a serialized runtime lease, never a counter reset.

`lib/wrong-verification-observation.ts` accepts only issue-2928 UUID fixtures.
Before and after refusal, it checks exact account/verification/consent counts
and hashes every complete owned user and consent row. The unknown stays absent.
Local reads validate the actual isolated database binding and run parameterized
SQL in a verified read-only transaction; canonical Stage reads reuse the slot
hostname/database/SSH mechanism with the same read-only guards. They require
the local topology variables described below or working Stage SSH access.
Sanitized operation records go to the absolute TEMP `E2E_STAND_COMMAND_LOG`
(default `ds-e2e-stand-ops/wrong-verification-2928.jsonl`); snapshots expose no
identifiers or private rows. Traces stay off and screenshots mask the email and
code field. Cleanup closes only owned browsers and revokes an owned session if
failure interrupted fixture preparation. Native `verify.e2e-spec.ts` EARS-41
interleaved timing and `auth.service.spec.ts` refusal/IdP mutation contracts
remain intact. Run the single `@wrong-verification-code` Academy declaration on
the lead-selected contour. The verification-route timing fix is Ask-tier auth
logic, so the agent also verifies it on its own PR slot. No render source changes
or owner Stage-B request are needed.

### Registration password persistence (003 EARS-39)

`The held registration password is never persisted anywhere` observes one unique
owned Academy registration from before the form is submitted, through `/verify`,
a real document reload, and abandonment through «← Изменить почту». It leaves the
fresh delivered code unconsumed and requires exactly one registration POST and
no other auth POST. Each phase asserts no private session or profile access and
no password in URLs, localStorage, sessionStorage or cookies, including HttpOnly
cookies. Local write/history hooks, Chromium DOMStorage events and response
Set-Cookie observation retain only boolean violations, including transient writes
removed before the next snapshot and percent/base64/JSON-escaped representations.
The auth fixture keeps traces off; cleanup closes only this owned context.
`steps/registration-password-memory.steps.ts` reuses the owned registration and
absent-private-access helpers. The existing isolated `pending-registration.test.ts`
snapshots and registration/cold-confirmation journeys remain intact. Run only
this scenario on the lead-selected converged stand; a test-only PR creates no
owner Stage-B request or new slot:

```sh
pnpm e2e:stage main --project academy --grep "The held registration password is never persisted anywhere"
```

### Account profile surface (003 EARS-28)

`The /account page renders the profile surface instead of raw claims` registers
one unique owned Academy account, accepts its fresh addressed confirmation code,
and proves the secure session and its own verified profile with no attached phone.
`steps/account-profile.steps.ts` prepares a known name through the existing
authenticated display-name PUT, then checks the rendered name/initials, inline
edit affordance, verified email, explicit no-phone state, my-events link and
sign-out control. A real change-password click opens the existing reset form
carrying `/account`; it submits no reset or logout. Raw claims are checked against
visible page content, excluding API responses and hydration data. The trace-off
auth fixture and secret-safe helpers are reused; cleanup closes only its owned
context. Existing mocked profile, inline-edit and accessibility coverage remains
intact. Run only this selected scenario on the lead-selected stand; this test-only
change needs no owner Stage-B request or new slot. Its CAPTCHA preparation uses
the explicit local-OFF route above only when the actual target and process flag
qualify; registration, code acceptance and profile requests remain real. Profile
links are located within the page's main landmark, alongside the shared header's
separate navigation links.

### Inline display-name persistence (003 EARS-28)

`Inline display-name edit persists through the existing endpoint` registers a
separate unique owned Academy account, accepts its fresh addressed code and
proves the secure session and the same verified profile with no phone. Through
the ordinary account controls, `steps/display-name-edit.steps.ts` edits and
confirms the name, observes exactly one authenticated display-name PUT with the
expected body and successful response, and checks the rendered name and initials.
A real document reload must trigger a new profile GET; a further no-store read
proves the same identity and saved name before the rendered name and initials
are checked again. A purely optimistic render cannot satisfy this scenario.
The trace-off auth fixture and secret-safe registration/session helpers remain
in use; CAPTCHA preparation reuses the explicit local-OFF route above only for
a qualifying target and process flag. Cleanup revokes only this owned session
and closes its context. Existing mocked trimming, Enter/Escape, header and
accessibility coverage remains intact. Run this selected scenario on the
lead-selected stand; this test-only change requires no owner Stage-B request or
new slot.

### Unverified-account code sign-in (003 EARS-34/41/16)

`An unverified account signs in with the code from the sign-in mail` leaves a
unique owned Academy registration code unconsumed, requests a fresh email code
through the ordinary sign-in method, and requires an exact `otp_sent` response
without private access. `steps/login-email-unverified.steps.ts` reuses the
canonical fresh-addressed mail helper and projects only booleans from its detail
to check the same six-digit code in both link-free bodies. Entering those digits
on the actual six-cell step must accept once and open the same verified
doctor_guest profile with a secure host-only session and no readable auth tokens.
The native challenge, issued-code audit, no-DB-write and triad timing assertions
remain explicitly owned by the existing API/IdP tests named in the scenario;
the verified golden EARS-6 browser journey remains distinct. Trace-off fixtures,
strict CAPTCHA preparation and owned-session cleanup follow existing journeys.
Run this selected case on the lead-selected stand; a test-only PR requires no
owner Stage-B request or new slot.

### Unsafe login return target (003 EARS-8/43; 014 EARS-6)

`Academy discards an external return target after successful owned-account password login`
(`steps/login-unsafe-return.steps.ts`, #3061) creates and email-verifies a unique
owned account through the real registration form and store-side addressed-mail
ID checkpoint, proves its private subject, and revokes that prerequisite session.
It opens the actual password-login route with a cross-origin HTTPS `.invalid`
`returnTo`, submits the same owned credentials, and requires Academy's current
default listing (`HOSTS.academy.eventsPath`, matching the host config's
`landing.afterLogin`). A context request observer counts attempts to the hostile
host even when DNS fails; navigation observation complements it. No auth or
navigation response is mocked. The scenario requires zero hostile-host attempts,
a fresh secure host-only opaque session cookie, and the same verified subject
and email through both private endpoints and the rendered account page.

Trace-off auth fixtures and boolean evidence keep secrets out of diagnostics.
The successful journey logs out; failure cleanup revokes only its owned session
and closes the owned context, retaining any original failure. No real TTL waits,
rate-limit ceilings or environment overrides are involved, so the same case runs
unchanged in the Academy stage suite. Retain native unsafe-target coverage in
`packages/auth-flow/src/login/login-door.test.tsx` and
`packages/auth-flow/src/verify/verify-door.test.tsx`; this browser case complements
their parser/door branches. Select `@login-unsafe-return`. This test coverage
change has no render surface and requires no owner Stage-B slot.

### Verified-account login-code request (003 EARS-34/16/41/8)

`A login-email-code request for a verified account arms the challenge unchanged`
registers and verifies a unique owned Academy account, reads its verified private
identity, and signs out through the ordinary account control. After a real email
code request, `steps/login-email-verified.steps.ts` requires exactly the neutral
acknowledgement, the six-cell step and no private session or profile access. The
canonical mail helper reads a fresh recipient-addressed login code;
`assertNoVerificationMail` observes the full 15-second delivery horizon without
accepting a separate verification mail or malformed Mailpit evidence. Entering
those delivered digits must restore a fresh secure session and the same verified
email and session subject. Native challenge and triad timing proof stay in the
API/IdP tests named in the scenario, and the golden verified EARS-6 journey stays
intact. Trace-off fixtures and secret-safe registration/mail/session helpers are
reused; cleanup revokes only the owned session and closes its context. The mail
absence helper accepts the existing minimal `MailRequest` contract, allowing the
native adapter without changing absence-check behavior. Run this selected case
on the lead-selected stand; this test-only change requires no owner Stage-B
request or new slot.

### Unknown-address login-code request (003 EARS-34/16)

`A login-email-code request for a nonexistent identifier is a silent no-op`
compares a fresh visitor's unique unknown email with one newly owned account
before and after its first real code sign-in. `steps/login-email-nonexistent.steps.ts`
binds each actual request's exact identifier/channel body to the intended email,
requires the same neutral `200`/`otp_sent` acknowledgement and six-digit code-entry
controls in all three states, and first proves fresh addressed login-mail delivery
for both existing-account observations. The canonical `assertNoAddressedMail`
helper then observes a full 15-second window with no mail for the unknown address;
that visitor obtains no private cookie, profile or session principal. Native
no-challenge, no-audit/no-users/no-consent-write and deterministic triad timing
assertions remain in the API/IdP tests named in the scenario. Trace-off fixtures,
secret-safe inputs, fresh-mail helpers and strict CAPTCHA preparation are reused;
cleanup revokes only the owned comparison session and closes both contexts.
The golden verified EARS-6 journey remains distinct. Run this selected scenario
on the lead-selected stand; this test-only change requires no owner Stage-B
request or new slot.

### Copied session fingerprint refusal (003 EARS-8)

`Academy refuses a copied session cookie from a different browser fingerprint while its owner stays signed in`
(`steps/session-fingerprint.steps.ts`, #3060) registers and verifies one uniquely
owned Academy account with its actual addressed email code. It copies only that
account's real opaque session cookie into a fresh context with a different
User-Agent, retaining the language, Academy origin and staging basic credentials.
Both actual private session and profile requests must carry that cookie and the
changed User-Agent, receive the complete generic 401, and disclose no private
identity or tokens. The original browser must retain the same complete profile,
subject and secure cookie, including after a real document reload.

Trace-off auth fixtures and existing registration, delivery-ID checkpoint and
secure-session helpers are reused. Cleanup logs out only the original owned
session and closes both contexts even after failure; any cleanup failure remains
visible without masking the original test failure. Native
`apps/api/test/auth/session.e2e-spec.ts` EARS-8 and design section 3 remain the
complementary session-binding contract. This case claims neither IP spoofing
protection nor server-side refresh-chain behavior. It assumes no rate-limit
ceiling, waits for no lifetime or window, and runs unchanged in the Academy stage
suite. Select `@session-fingerprint` on the lead-selected contour. This test-only
coverage has no render surface or owner Stage-B slot.

### SMS sign-in eligibility hint (003 EARS-55 / EARS-56)

`Academy shows the static SMS sign-in hint and neutrally accepts an unconfirmed phone`
(`steps/signin-sms-hint.steps.ts`, #2990) opens the actual Academy
`/login?method=code` door, chooses SMS and verifies the exact shared eligibility
sentence and its radiogroup description. The sentence is invariant while typing
and absent on the email channel. A fresh owned phone is checked against the
isolated branch account mirror in a read-only transaction before its real SMS
request. The exact `{status:'otp_sent'}` acknowledgement leads to the unchanged
six-digit code step; no SMS may reach that phone over the complete 20-second
sink-delivery horizon, and session/profile access stays unauthorized before and
after. A missing sink or mirror contour fails rather than skipping. Traces stay
off and no code is supplied. `login-door.channels.test.tsx` retains the shared
component contract; `apps/api/test/auth/login-otp.e2e-spec.ts` EARS-56 retains
unconfirmed-counter and no-audit assertions, with native EARS-16 timing proof
remaining there. Browser proof claims neither internal counter/timing invariants
nor a real Yandex challenge. The broader native feature declaration is preserved.
This coverage change has no render surface or owner Stage-B slot.

### Verified re-registration password preservation (003 EARS-23/41)

`Academy verified re-registration preserves the original password and display name`
registers and verifies a unique owned account, saves an original name through
the ordinary account editor and logs out. An independent guest submits that same
address with a distinct replacement password and `/account` return target. The
fresh strictly addressed re-registration mail must contain the six-digit code,
already-registered notice and «Ваш пароль не изменился» in both complete,
link-free bodies. One accepted code opens the same verified subject and original
name with a fresh secure host-only session and no password sign-in replay.

`steps/registration-verified-password.steps.ts` then drives two independent guest
password sign-ins: the original password opens that same named account, while
the replacement receives the complete generic 401 and no private access. It
reuses the canonical registration, mail and session helpers, asserts only safe
evidence and keeps traces off; cleanup revokes its sessions and closes its owned
contexts. This Academy case proves preservation of the already saved display
name. Academy offers no display-name input during registration, so the broader
spec scenario remains distinct, along with `auth.service.spec.ts` EARS-23
verified-credential preservation proof and the app-local journeys.
Run only this selected case on the lead-selected stand; the coverage change has
no render surface and requires no owner Stage-B request or slot.

### Abandoned registration replacement (003 EARS-23/41)

`An abandoned registrant who registers again gets the new password, not the
abandoned one` registers a unique owned Academy address without consuming its
first confirmation, then submits the real form again with a distinct new
password. `steps/registration-abandoned.steps.ts` binds both requests to that
address, proves no private access before the code, and reads the fresh addressed
re-registration artifact through `fetchRecoveryMail`. Both link-free bodies must
carry the same six digits and say the entered password is saved after the code,
without claiming the password is unchanged. One accepted code must open the same
verified private identity and a secure host-only session at the account return
target. Two independent guest contexts then prove the new password reaches that
same subject and the abandoned password receives the actual generic rejection
without private access. Traces remain off, only safe boolean evidence is asserted,
and cleanup revokes the owned sessions and closes all owned contexts. The
existing API/IdP replacement proof and broader app-local registration journeys
remain intact. Run only this selected case on the lead-selected stand; this
coverage change has no render surface and requires no Stage-B request or slot.

### Uniform registration code screen and Back (003 EARS-24/42/16)

`The post-registration screen is the one code step for new and existing visitors`
prepares one real verified Academy account, revokes its prerequisite session,
then drives new and existing addresses through the ordinary registration form
in separate clean guest browsers. `steps/registration-code-screen.steps.ts`
observes each actual arrival immediately: the same heading and exact mixed-case
typed address, six visible code cells, disabled resend countdown and no separate
sign-in/reset block or account-existence disclosure. Each has a fresh addressed
code that remains unconsumed and no private session or profile access. Clicking
the actual «← Изменить почту» control must carry the account return target and
restore the originally entered email and password without test-side refilling;
the Academy's read-only consent statement and absence of checkboxes remain.
Password/code assertions retain only safe booleans, traces stay off, and cleanup
revokes any owned prerequisite session before closing the owned contexts.
The broader app-local re-registration/mail/code-acceptance/session journey,
auth-flow draft/consent unit contract and native API privacy proof remain intact.
Run only this selected case on the lead-selected stand; this coverage change has
no render surface and requires no Stage-B request or slot.

### Duplicate-registration inbox suppression (003 EARS-23)

`Repeated duplicate registrations do not flood the inbox` first creates a unique
owned Academy account through the real registration form and observes its
never-registered acknowledgement. `steps/registration-duplicate-mail.steps.ts`
then submits the same form for that existing address, proves fresh addressed
re-registration code delivery, and repeats the submission inside the unchanged
900-second throttle. The canonical `assertNoAddressedMail` helper observes the
full 15-second delivery horizon with no second mail. Before the repeat,
`captureAddressedMailCheckpoint` records exactly the two distinct already-delivered
recipient-bound IDs; every subsequently unseen addressed ID fails, regardless of
the inbox/client clock difference. Both duplicate responses must match the
original neutral status and exact acknowledgement. Actual request
bodies bind the intended credentials and consent, while the unconsumed code step
grants no private session or profile access. Trace-off auth fixtures, secret-safe
inputs and strict CAPTCHA preparation remain in use, and cleanup closes only the
owned context. Existing API suppression, enumeration and timing tests remain
intact. Run only this selected case on the lead-selected stand; this coverage
change has no render surface and requires no Stage-B request or slot.

### Congress contact-phone suggestion (003 EARS-50)

`Academy prefills the congress contact phone without confirming it or sending SMS`
creates a fresh owned intake through `createOwnedCongressSignup` with the raw
`8 (999) 123-45-67`, then signs in with an ordinary delivered email code. It uses
no handoff redemption. `steps/congress-phone-prefill.steps.ts` proves the exact
raw API suggestion, null API phone/verification fields and the existing formatted
`+7 999 123-45-67` display without a confirmed badge. The editor initially retains
the raw value; actual input applies the existing E.164 mask. Editing to a distinct
owned phone and canceling restores the original suggestion, with no fetch/XHR or
phone mutation. Both numbers receive no addressed SMS over the full 20-second
SMS delivery horizon, and a final profile read stays unchanged. A missing readable
SMS sink fails instead of skipping. Traces stay off; cleanup revokes only the
owned session and closes its context. Intake fixtures remain in the lead-owned
isolated database inventory until its authorized cleanup.

This is an API/UI projection. The broader original scenario and native
`apps/api/test/me/profile.e2e-spec.ts` EARS-50 latest-answer/internal no-write proof
remain intact, alongside the existing account row and phone-mask unit contracts.
The congress helper accepts an optional fourth `{ contactPhone }` argument;
three-argument callers retain their original default. Run the single
`@congress-phone-prefill` Academy case on the lead-selected runtime. This coverage
change has no render surface and needs no Stage-B request or staging slot.

### SMS password reset (003 EARS-53/12/35)

`Password reset by a confirmed phone delivers the code by SMS` registers a unique
owned Academy account through the real form, confirms a fresh `+7999…` number
through the real `/account` phone row with the code the stand's SMS sink
received, then requests a reset at `/reset` with that number.
`steps/password-reset-sms.steps.ts` reads the reset code from the sink's
`user.human.password.code.added` event (`lib/sms-sink.ts`, structured
`args.code`, never an api response), proves exactly one SMS after the request
and no new addressed mail over the 15-second horizon against the mailbox settled
after the EARS-52 phone notice, completes the reset through the form, and checks
the fresh secure session, the revoked earlier session, new-password sign-in,
old-password refusal and the unchanged `emailVerified`/confirmed phone. The
number is fresh per run because a fixed one exhausts the EARS-14 per-phone
budget (3 SMS an hour) on the second run and is answered with no SMS once an
earlier run's account holds it confirmed (EARS-51).

The SMS sink root is `E2E_SMS_SINK_URL`; unset, every `@sms-reset` scenario
skips with a named reason. A stage slot run sets it to the box's gated sink
read API (`https://sms-sink.<base domain>`, `tools/staging/e2e-stage.mjs`, #2878)
and the read carries the stand's `E2E_HTTP_USER` / `E2E_HTTP_PASS` pair; on a
local dev stand use `E2E_SMS_SINK_URL=http://<stand host>:8090`. The sibling `@sms-reset`
scenarios — the indistinguishable unknown/unconfirmed-phone answer with its
50 ms timing clause, EARS-56 counter and absent ledger row, the mirror/IdP
mismatch, and the email reset of a phone-holding account — are not bound here;
their api e2e coverage is `apps/api/test/auth/password-reset.e2e-spec.ts` (fake
IdP: response/timing parity, no SMS/mail, no ledger row, the email path) and
`apps/api/test/me/phone*.e2e-spec.ts` / `user-mirror-phone-conflict.e2e-spec.ts`
(EARS-58 confirmed-only resolution and mirror clearing).
This coverage change has no render surface and requires no Stage-B request or
slot.

### Repeated confirmed-phone request (003 EARS-47/51)

`Academy keeps the owned confirmed phone when its confirmation is requested again`
registers one unique short-address Academy account, verifies its delivered mail
code, and confirms a fresh owned phone through the real account row and SMS sink.
`lib/owned-phone-confirmation.ts` is the canonical test-only setup shared with
the existing SMS-reset journey; that consumer retains all its profile, mail and
session assertions. Callers own registration, contexts and mailbox settling.

`steps/confirmed-phone-noop.steps.ts` requests that exact same number through
the ordinary phone editor and requires the complete `already_confirmed` reply.
The confirmed row remains visible without code controls or a second phone
command. All addressed SMS are checked for a complete 20-second delivery window,
including a final query started at or after the deadline. A real document reload
must preserve the same confirmed profile, verified email, private subject and
secure host-only session cookie. Traces remain off, assertions project secrets
to safe evidence, and cleanup revokes only the owned session and context.

This is a narrow dynamic-number Academy projection. The broader fixed-number
scenario, native `apps/api/test/me/phone.e2e-spec.ts` EARS-47 no-op proof and
`account-profile-card.test.tsx` EARS-51 component case remain intact. Run the one
`@confirmed-phone-noop` Academy case on the lead-selected contour; no runtime
render source changes, owner Stage-B request or staging slot are involved.

### Confirmed phone replacement (003 EARS-49/47/48)

`Academy clears the old confirmed phone while confirming its replacement`
(`steps/phone-change.steps.ts`, #3009) registers and email-verifies one unique
owned account, then confirms phone A through the actual account row and SMS
sink. Requesting a fresh phone B must immediately clear the profile phone: the
public self-profile API returns `phone: null` and `phoneVerified: null` for that
absent identifier, while the existing code-step UI awaits confirmation. The
same verified email, private subject and secure host-only session cookie remain.
The actual six-digit confirmation SMS addressed to phone B completes the
change; the profile must retain only verified B, including after a real reload.
Traces stay off and cleanup revokes only the owned session and context.

This narrow `@phone-change` Academy projection preserves the broader native
scenario. Phone-identifier sign-in/reset refusal for both numbers, abandonment,
internal audit and notice content remain attributed to the native phone API
suites and `packages/design-system/src/blocks/account-profile-card.test.tsx`.
It changes no runtime render source and needs no owner Stage-B request or slot.

### Existing consent preservation (003 EARS-23/41)

`Re-registration never overwrites an existing platform consent` creates and
verifies a unique owned Academy account, establishes its secure session, and
logs out through the ordinary account control. The real registration form then
submits that same address in mixed case with a distinct password and Academy's
read-only terms statement. A fresh addressed re-registration code remains
unconsumed while private access is refused and the persisted consent remains
unchanged. One accepted code opens the same verified profile and subject at
`/account`, with a fresh secure session and no password sign-in replay.

`steps/registration-consent-preservation.steps.ts` compares the consent row ID,
total consent count, purpose, version, full PostgreSQL timestamp and relevant
user mirror fields before submission, before code acceptance and after it.
For a local contour, `lib/owned-auth-observation.ts` uses the public `@ds/db` pool
in a read-only transaction; it accepts only consistent literal local Academy/API origins and
an explicitly named isolated `ds_dev_<issue>` database on the trusted host and
port from the actual runtime recipe, verifying
`current_database()` before the data read. Fixture prefix, UUID, normalized
email, session subject and observed profile ID bind every consent read.
On canonical HTTPS Academy staging, the reader derives the actual slot hostname
and database from the staging environment through the existing public SSH/slot
helpers. It needs no local API or DB environment variables. Before reading the
exact owned fixture, it checks the configured hostname; the read-only SQL guards
the projection by actual `current_database()` and `transaction_read_only`, and
the result must match both. Consent cardinality and typed projection checks are
shared by both routes. Missing SSH access fails explicitly with redacted errors.

`readOwnedPhoneAccountCount` is the request-bound mirror-absence observer: it
counts only rows for the actual submitted, distinct `+1999` plus eight-digit
synthetic phone identifiers bound to an owned fixture — two for the #2857
`phone-control-2857-<UUID>` registration refusal, one for the #2990
`sms-hint-2990-<UUID>` SMS sign-in hint (`signin-sms-hint.steps.ts`).
It supports local and staging contours, with no control-email filter or shared
global-user claim. `readOwnedUserCount` remains the additional total-users oracle
for the serialized isolated local database; it rejects staging before any query.
Malformed results, connection, cleanup and ledger failures fail closed.

The lead supplies `E2E_API_URL`, `E2E_AUTH_DATABASE_URL`,
`E2E_AUTH_DATABASE_NAME`, `E2E_AUTH_DATABASE_HOST` and `E2E_AUTH_DATABASE_PORT`
from the actual owned runtime recipe; PostgreSQL may be on its LAN host while
Academy/API remain local. The observer refuses any DB host or port that differs
from that trusted binding, as well as production/shared database targets.
When supplied, the absolute
`E2E_STAND_COMMAND_LOG` receives only operation, database and read-only completion
metadata with `nativeExit: null` for local JavaScript SQL calls. Staging always
records sanitized operations in the TEMP log (default
`ds-e2e-stand-ops/owned-auth-observation.jsonl`); successful native SSH exits are 0,
and no SQL, identifiers, rows or secret diagnostics are logged. Browser command
exits are recorded separately by the lead. The existing `consent-refusal.ts` staging
contract remains unchanged. Traces stay off, assertions project only safe evidence,
and cleanup revokes only the owned session. Native API consent proofs and broader
registration journeys remain intact. The same scenario stays active in the
canonical full Academy staging/release suite and in the lead-owned local contour;
this coverage change has no render surface and requires
no Stage-B request or slot.

### Phone-only registration refusal (003 EARS-2/16)

`Phone-only registration is not offered and never 500s` checks the real Academy
email/password registration form, with no phone input, then sends two distinct
phone-without-email payloads through ordinary same-origin browser fetches to the
real BFF. `steps/phone-only-registration.steps.ts` requires the exact generic
missing-email DTO validation 400, identical complete responses across the two identifiers, no 500 or
identifier/password/token echo, and no private session or profile access.
The CAPTCHA proof uses the existing `captchaTestTokenFromEnv` and
`x-smartcaptcha-token` carrier whenever required; only the owned local HTTP
contour with explicit bot protection OFF omits it. The HTML form is not modified
to submit a payload it does not offer.

The canonical `readOwnedPhoneAccountCount` observes only the two actual
submitted synthetic phone identifiers before and after refusal, requiring zero
both times. A pre-existing collision fails before either POST. The serialized
isolated local contour additionally requires `readOwnedUserCount` before and
after the refusals with an unchanged total; missing local topology variables
fail closed. Canonical HTTPS Stage uses its existing read-only slot/SSH route
for the submitted-phone count and never queries a shared global users total.
The unrelated unique control email does not select phone rows. Observer target
validation and sanitized `E2E_STAND_COMMAND_LOG` behavior are described above.

The same visitor then submits the real registration form with that unique valid
email, requiring neutral acceptance and fresh addressed six-digit registration
mail at an unconsumed code step without pre-code private access. This is an
acceptance control without an additional code-confirmation journey. Trace-off
auth fixtures and the existing registration/mail helpers are reused; cleanup
closes only the owned context. Native `RegisterRequestSchema` and API
`register.e2e-spec.ts` EARS-2 actual-phone absence/DTO/IdP robustness proofs remain
intact as separate upstream evidence. Run only this selected case with
`E2E_WORKERS=1` on the lead-selected contour; the coverage change has no render
surface and requires no Stage-B request or new slot.

### Verification-mail artifact (003 EARS-29)

`The verification code email is composed and sent by the BFF mailer, code-only`
registers one unique owned Academy address through the real form with the
`/account` return target. `steps/verification-mail.steps.ts` captures recipient
message IDs before registration, reads the strictly fresh addressed BFF artifact
and requires exactly one added delivery. The canonical `assertNoAddressedMail`
helper then observes every mail purpose over a full 15-second horizon, including
a final query started at or after its deadline; a second IdP mail cannot hide
behind a verification-purpose filter.

The actual subject leads with six digits; HTML and plain text carry that same
unbroken code, the approved 3600-second verification-purpose expiry and the
instruction to enter it in the already-open requesting tab. Both complete bodies,
footer included, contain no link, button or navigation URL. In that same tab,
one different code must receive the real generic refusal without private access
or a session; entering the delivered code once must open the same email-verified
profile at `/account` with a secure BFF session and no sign-in/password replay.
Assertions retain only safe evidence, traces stay off, and cleanup revokes only
the owned session and closes its context. The native `returnCode` and
IdP-no-native-send mechanism ownership remains explicitly mapped to
`apps/api/test/auth/zitadel-email-verify.e2e-spec.ts:192`; the browser makes no
provider HTTP or internal SMTP observation claim. Broader app-local registration
and confirmation journeys remain intact. Run this selected case on the
lead-selected stand; this coverage change has no render surface and requires no
owner Stage-B request or slot.

### Password-reset mail artifact (003 EARS-29/12)

`Academy receives the code-only password-reset mail and completes the real reset`
creates one uniquely owned verified account through actual Academy registration
and its delivered verification code. `steps/password-reset-mail.steps.ts` opens
an independent guest `/reset` form with `/account` carried as the return target,
submits that exact owned identifier, captures the recipient message-ID checkpoint
and reads strictly fresh reset-purpose complete HTML/plain-text details through
canonical `fetchRecoveryMail`. The subject leads with the six numeric digits
that both bodies carry. The complete branded layout and footer include the
actual 3600-second lifetime and instruction to use the already-open requesting
tab; neither body contains a link, button or navigation URL in any block.

A guaranteed different six-digit code is generically rejected without private
access, and an independent sign-in proves the original password still works.
The requester observes that refusal automatically cleared the rejected digits
and focused the first code cell, then submits the delivered code once with a
distinct valid password. Reset completion opens
the same verified account at `/account` with a secure BFF session. Independent
guest sign-ins prove the new password succeeds and the old password receives a
generic 401 with no private access. Assertions project secrets to booleans,
traces stay off, and cleanup revokes only owned sessions and closes all owned
contexts even on failure.

This browser proof covers the received artifact and real reset, not provider
HTTP or internal SMTP. The broader `The password-reset code email is BFF-sent
and link-free` scenario and native returnCode/no-native-mail wire tests in
`apps/api/src/auth/idp/zitadel.idp.spec.ts:895` remain retained, as do native
reset/session tests in `apps/api/test/auth/password-reset.e2e-spec.ts`. Run the
single `@password-reset-mail` Academy case on the lead-selected stand; this test
coverage change has no render surface and needs no owner Stage-B request or slot.

### Passwordless congress registration (003 EARS-23/41)

`A password-less congress account that registers gets the entered password after
the code` creates a unique `congress-registration-2927-<UUID>@example.test`
identity through the real configured congress intake. The account has its original
display name, one congress-personal-data consent and no platform consent. The Academy
registration form sends a new password with its read-only accepted platform terms
and reaches the actual fresh addressed re-registration code. Before consuming it,
an exact snapshot proves the profile, intake and consent unchanged. A guaranteed
different six-digit code receives the actual generic refusal without private access;
the same snapshot remains unchanged and an independent guest proves the submitted
password still fails. One delivered code opens the same
email-verified subject with a secure host-only BFF session at `/account`.

`steps/congress-registration.steps.ts` then proves the original congress consent,
profile and intake survive, exactly one `tos/2026-01` consent was added after the
code, and an explicit logout followed by the submitted password opens that same
named account. `lib/owned-congress-observation.ts` admits only this issue's exact
owned UUID address and fixed display-name fixture. It reuses the existing public
`@ds/db` pool locally and canonical SSH/slot transport on stage, verifying the
actual isolated branch/slot database and READ ONLY before the exact account read.
Profile/intake preservation fingerprints exclude only verification/update fields
and the asynchronous confirmation-mail outcome; consent IDs, purposes, versions
and full PostgreSQL timestamps are compared directly. Local target bindings use
the existing `E2E_API_URL` and `E2E_AUTH_DATABASE_*` variables described above.
Sanitized started/completed operations go to the absolute TEMP
`E2E_STAND_COMMAND_LOG` (default `ds-e2e-stand-ops/owned-congress-2927.jsonl`).

This is new real congress-to-Academy credential/consent coverage. Retain
`apps/api/src/auth/auth.service.spec.ts:1465` (password installation), `:1489`
(missing consent purposes) and the distinct congress hand-off journey at
`apps/portal/e2e/auth-journeys.e2e.spec.ts:314`. No native proof is removed or
claimed as a new browser assertion. Traces remain off; cleanup revokes only
owned sessions and closes owned contexts. The stand needs its existing
`CONGRESS_SIGNUP_*` configuration and a real registrable event; the test creates
neither a fake event nor an account through SQL. Run the single
`@congress-registration` Academy case on the lead-selected contour. This coverage
change has no render surface and needs no owner Stage-B request or slot.

### Valid congress handoff (003 EARS-44)

`A valid hand-off reference opens the code step with the code already sent`
uses the real congress intake to create a fresh `valid-handoff-2929-` account
and reference. `steps/valid-handoff.steps.ts` opens that reference on Academy
with its actual `/account` return route; the Doctor congress contract's
`/account/congress` target is unchanged. The API must have its documented
`CONGRESS_SIGNUP_*` configuration pointing to a real existing event. No event,
provider, reference or session is substituted by the scenario.

The actual signup first delivers its code-free congress confirmation notice
(044 EARS-11/13, `congress-signup.service.ts` and `notice-emails.ts`). Its exact
recipient/message-ID checkpoint and notice-purpose subject are observed before
handoff, followed by a full 15-second check for any additional mail. The real
redemption must return the exact original address and add exactly one fresh
addressed sign-in code mail to that baseline, with another full 15-second check
for additional delivery of any purpose. The six-cell code step offers neither method selection
nor captcha. The browser response carries `no-referrer`; Chromium navigation
history and the address bar contain no reference. There is one redemption and
one mailed-code submission, with no ordinary code request, resend or registration
replay. Only that delivered code opens the same account's private profile at
`/account` with the secure host-only BFF session. Cleanup revokes only the owned
session and closes its context; traces remain off and screenshots stay in the
selected run's private artifact directory.

Migration mapping: `apps/portal/e2e/auth-journeys.e2e.spec.ts` EARS-44 valid
handoff (the test ending in `lands on /account`) maps to this BDD case and remains
as app-local coverage until equivalent host-suite migration is complete. The
Doctor app-local configurable handoff journey and API native expiry, redemption
budget and other-account session tests remain complementary; this single case
makes no claim to cover them. Run the selected `@valid-handoff` Academy case on
the lead-selected contour. This coverage change has no render surface and needs
no owner Stage-B request or new staging slot.

### Other-account congress handoff (003 EARS-44)

`Academy switches from another signed-in account to the hand-off account`
uses `lib/owned-congress-signup.ts` for real congress Y intake and its actual
reference, then registers and verifies a different owned Academy X through
the real browser and addressed confirmation mail. An independent context
retains X's exact live session cookie and proves private profile/session access
before the handoff. Opening Y's link must add exactly one fresh sign-in mail
to Y's congress-notice checkpoint and send no new mail to X. Entering that
delivered Y code once must replace the browser session with one secure BFF
cookie and return to Academy's actual `/account` page showing Y's verified
profile and a subject different from X. The retained X cookie must receive
401 from both actual private profile and session reads after the switch.

`steps/handoff-other-account.steps.ts` owns only its contexts and sessions;
cleanup revokes them, traces remain off, and secret-bearing inputs are projected
to booleans in assertions. The original Doctor `/account/congress` scenario
and `apps/api/test/auth/login-handoff.e2e-spec.ts:381` native replacement test
remain unchanged and complementary. No provider/internal mail mechanism claim
is inferred from this browser proof. Run the selected `@handoff-other-account`
Academy case on the lead-selected contour. This test coverage change has no
render surface and needs no owner Stage-B request or new staging slot.

### First sign-in code invalidates the preverification password (003 EARS-41)

`Academy refuses the preverification password after the owner's first sign-in code`
uses `steps/signin-first-code.steps.ts` to register one unique owned
`signin-first-code-2941-<UUID>@example.test` account without consuming its
registration code. The ordinary Academy email-code login requests a fresh
addressed six-digit sign-in mail. Its code-free acknowledgement grants no private
access. One submission verifies that same account and opens `/account` with a
secure host-only session and no readable tokens. An independent guest submits
the exact original registration password once and receives the generic refusal
without a private session or profile access. Traces remain off; cleanup revokes
only owned sessions and closes owned contexts.

This is a narrow Academy projection of `A password set before verification does
not survive the owner's first code`; that broader scenario remains unchanged.
Retain `apps/api/test/auth/zitadel-email-verify.e2e-spec.ts:272` for the real IdP
first-sign-in-code/password invalidation round trip and
`apps/api/src/auth/auth.service.spec.ts:1402` for revocation of every prior
session. The browser cannot establish a session on this unverified registration
and makes no revoke-all claim from that absence. Existing cold `/verify`,
unverified login, and other broader cases remain complementary. Select the one
`@signin-first-code` Academy case on the lead-selected contour. This test coverage
change has no render surface and needs no owner Stage-B request or staging slot.

## Verification resend across owned account states (#2988)

`Academy resend delivers the code fitting each account state without a private session`
is the narrow browser projection of 003 EARS-25/16. It prepares independent
unknown, unverified and verified addresses; only the latter two are registered.
The verified prerequisite accepts its real registration code, checks its own
verified profile, then logs out with HTTP 200 and absent profile/session access.
Three guest `/verify` screens wait for their real cooldowns concurrently and
click the actual resend control. Each request must contain only its exact
identifier and return HTTP 200 with exactly `{ status: "resend_requested" }`.
The approved notice, empty six-digit field and restarted cooldown stay visible.
Fresh addressed verification mail reaches the unverified account, fresh login
mail reaches the verified account. A pre-click complete mailbox ID checkpoint
binds fresh positive delivery independently of client/inbox clocks; the canonical
mail helper still validates the new message's recipient, purpose, detail and code.
The same checkpoint proves no new addressed mail reaches the unknown address
throughout 15 seconds. No
reissued code is entered; all three profiles and sessions remain HTTP 401.

`steps/verification-resend.steps.ts` uses the trace-off auth fixture, canonical
registration/mail/CAPTCHA/secret-input/session helpers and owned-context cleanup.
Its per-case 180-second timeout accommodates real setup, the unchanged 30-second
screen cooldown and the full negative delivery horizon; no runner or clock is
changed. The broader feature declaration remains native: API verify EARS-25/16
owns timing, issued-only audit and no users/consent writes, API abuse tests own
counters/rate limits, and auth-flow verify-door tests own native control and
cooldown contracts. This case adds no accepted-code or persisted-state claim.

### Confirmed-phone SMS sign-in (003 EARS-7/8)

`Academy signs in the same owned doctor with the confirmed phone SMS code`
(`steps/login-sms-confirmed.steps.ts`, #3008) registers a unique Academy doctor,
verifies the actual email code and confirms a fresh phone through the account
UI and delivered SMS. The registration session is revoked with logout HTTP 200
and profile/session HTTP 401 before the real `/login?method=code` SMS request.
The neutral acknowledgement grants no private access. The sink lookup binds the
actual six-digit login code to the owned recipient, request time and
`session.otp.sms.challenged` event, separately from phone confirmation.

Entering that code must auto-submit, return only the authentication status,
mint a fresh secure host-only BFF cookie and restore the same subject, verified
email and confirmed phone. Final logout proves private access is removed.
Traces are off; assertion evidence projects secrets to booleans and cleanup
revokes only the owned session/context. The broader native SMS-budget scenario
remains intact: `apps/api/test/auth/login-otp.e2e-spec.ts` owns IdP delegation
and the global circuit-breaker; `sms-budget.service.spec.ts` owns EARS-14
thresholds. This narrow browser case consumes
ordinary sends without exhausting or claiming to inspect those counters. No
runtime surface changes or owner Stage-B request are involved.

### Wrong SMS login code with retained-code recovery (003 EARS-7/8/41/16)

`Academy refuses a wrong SMS login code and accepts the retained real code for the same owner`
(`steps/login-sms-code-refusal.steps.ts`, #3085) registers a uniquely owned
verified Academy doctor, confirms a fresh phone through actual UI/SMS, then
revokes that registration session. A genuine guest requests an SMS login code;
the sink checkpoint binds its fresh delivery to the owned recipient and
`session.otp.sms.challenged` event using store-side message IDs.

A different valid six-digit code must receive the exact generic HTTP 401,
without Set-Cookie or private session/profile access. The operation plate shows
the refusal while the code cells clear and refocus. Without resend, the retained
actual code must establish a fresh secure session for the same subject, verified
email and confirmed phone, persisting through reload. Exact owned logout removes
private access, including failure-path cleanup on the configured HTTP/HTTPS
origin. Traces are off and secret assertions use booleans.

The case uses one ordinary rejected attempt and two normal SMS deliveries; it
assumes no default rate-limit ceiling, changes no counters and waits for no
TTL/window. Native `apps/api/test/auth/login-otp.e2e-spec.ts` owns IdP delegation
and enumeration timing; `apps/api/src/auth/sms-budget/sms-budget.service.spec.ts`
owns EARS-14 thresholds. Existing broader scenarios remain intact. This adds no
runtime or visual change and requires no owner Stage-B slot.

### Unusable congress handoff (003 EARS-44/16)

`Academy falls back silently for unknown, malformed and exhausted handoff references`
(`steps/handoff-unusable.steps.ts`, #3026) mints a real owned congress reference
and exhausts it through exactly three legitimate guest page-load redemptions.
Each returns the original address and adds one fresh recipient/time-bound code
mail to the owned congress-notice checkpoint. No code is entered or counter
seeded. Independent guest pages then open a unique well-formed unknown reference,
a malformed reference and the exhausted reference. Unknown and exhausted return
byte-identical neutral `handoff_refused` bodies without an address; malformed
input deliberately makes zero redemption calls, matching the approved mount
contract. Every fallback keeps empty selected email-code entry, the password
option and the same-origin `/account` return target, with no alert, owned address,
private session/profile or reference in the address bar or Chromium history.

Complete owned-recipient mail checkpoints and full 15-second absence horizons,
including final queries at or after each deadline, exclude new addressed mail.
Trace-off fixtures and canonical congress/mail/captured-response helpers are
reused; cleanup revokes any unexpected owned session and closes its context even
on failure. Missing intake or Mailpit prerequisites fail. The broader feature
scenario remains intact. Native `apps/api/test/auth/login-handoff.e2e-spec.ts`
`:257/278/286` retains exhaustion, expiry and statistical timing proof;
`packages/auth-flow/src/login/login-door.handoff.test.tsx:145/181` retains fallback
and malformed zero-call proof. This browser projection makes no expiry or
statistical timing claim. Select the single `@handoff-unusable` case on the
lead-owned runtime. This coverage change has no render surface or Stage-B slot.

### Phone-confirmation security notice (003 EARS-47/48/52)

`Academy receives one safe phone-confirmation notice for the same verified account`
(`steps/phone-confirmation-notice.steps.ts`, #3027) registers and email-verifies
one unique owned Academy account, then confirms one fresh phone through the
actual profile UI and its addressed SMS using the canonical phone helper.
A complete addressed mailbox-ID checkpoint precedes the action. The scenario
requires one fresh phone-success notice throughout a full 20-second observation,
with the final query started at or after the deadline, then reads that exact
message's complete actual text and HTML. Both bodies name the phone addition or
change, the same truthful Moscow date/time within the action interval, and the
existing password-reset advice that all sessions end. Neither body carries a
six-digit code, the phone number, a link or a button. Existing layout CSS hex
colors are excluded from the raw-HTML numeric-code scan; complete rendered text
is still checked. The recipient must be exactly the owned account email.

The same subject, secure session cookie, verified email and confirmed phone
survive notice observation and a profile reload. Trace-off auth fixtures and
boolean evidence keep credentials, codes, phone numbers and message bodies out
of diagnostics; no screenshots are taken. Cleanup revokes only the owned session
and closes its context even on failure. Missing Mailpit or SMS access fails.
Retain the broader profile-confirmation scenario and native
`apps/api/test/me/phone.e2e-spec.ts` EARS-48/52 IdP, mirror, audit and notice
exclusion contracts; this browser proof claims only the actual delivered
artifact and account/session outcome. Select the single
`@phone-confirmation-notice` Academy case on the lead-owned runtime. This test
coverage change has no render surface and requires no owner Stage-B slot.

### Explicit provider-backed session refresh (003 EARS-8/9)

`Academy explicitly refreshes the same private session through its real provider`
(`steps/session-refresh.steps.ts`, #3059, `@session-explicit-refresh`) registers
and verifies one uniquely owned account using actual addressed email and the
shared store-side delivery-ID checkpoint helper. The authenticated browser calls
`POST /v1/auth/refresh` without waiting for token expiry. The actual provider-backed
endpoint must return exactly `{status: "refreshed"}`, no token and no new cookie.
The same secure opaque cookie, subject and complete private verified profile
survive refresh and page reload. A fresh cookie-free context receives generic401
and cannot read a session or profile; the original owner remains authenticated.

Trace-off fixtures and boolean diagnostics keep private values out of evidence.
The after-hook logs out only the owned session, verifies denied private reads and
closes its context even on failure; cleanup failure annotates an existing test
failure without replacing it. This case neither depends on rate-limit ceilings
nor waits for an expiry window, so the same selection runs unchanged in the
stage Academy suite. Native `apps/api/test/auth/refresh-logout.e2e-spec.ts:92`
and session service/adapter tests retain token rotation/reuse invariants. The
broader automatic-expiry and consumed-token scenarios remain intact: this
projection proves explicit endpoint refresh, not automatic expiry-triggered
rotation or server-only token-chain reuse. No render surface or Stage-B slot.

### Consumed email login code (003 EARS-6/41/16)

`Academy refuses a consumed email login code without disturbing its original session`
(`steps/login-email-code-reuse.steps.ts`, #3069) registers and verifies one unique
owned account through real UI and addressed mail. It signs out, requests a fresh
email login code using a store-side recipient/message-ID checkpoint, and accepts
that exact delivered code once through the actual six-cell form. An independent
cookie-free guest then submits the retained consumed code to the ordinary BFF
endpoint without requesting another challenge: exact generic 401, no new cookie
and denied private session/profile access are required. Reloading the original
owner must retain the same verified subject, rendered email and secure cookie.

Trace-off fixtures, canonical registration/mail/session helpers and safe boolean
assertions are reused. Cleanup revokes only the owned session and closes its
contexts even after failure, preserving the original failure. No expiry wait,
cooldown, limit ceiling or configuration override is involved; the same selected
`@login-email-code-reuse` case runs unchanged in the Academy stage suite. Native
`apps/api/src/auth/idp/zitadel.idp.spec.ts` EARS-6 single-use challenge coverage and
the broader wrong-code/timing and verified-request journeys remain complementary.
This test coverage change has no render surface or owner Stage-B slot.

### Confirmed-phone password login (003 EARS-5/8/58)

`Academy signs in the same owned doctor with the confirmed phone and password`
(`steps/login-phone-password.steps.ts`, #3086, `@login-phone-password`) registers
and verifies a unique owned password account through the real UI and addressed
email, then confirms a fresh phone through the real account UI and SMS. After
actual logout, the Academy password form submits that confirmed phone with the
owned password. The actual password endpoint must accept the exact command and
mint a fresh secure opaque session. The original subject, email and verified
phone must survive account reload; final owned logout denies session and profile
reads and removes the private cookie.

The default cross-worker login gate closes with a real successful owned login
and revokes that separate session; no golden password is needed. Trace-off auth
fixtures and boolean assertions keep credentials, OTPs and session values out of
diagnostics. Every owned browser/request context remains reachable for cleanup
on failure, which preserves the original failure. No expiry wait, limit ceiling,
counter override or helper/config change is involved, so this single Academy
selection runs unchanged with stage's raised ceilings and basic authentication.
Retain the broader password scenario, native IdP phone identifier resolution,
and the existing confirmed-phone SMS login/phone-change cases: those remain
complementary and do not submit the confirmed phone through the password form.
No render surface or owner Stage-B slot is introduced.

### Same-account congress handoff (003 EARS-44)

`@handoff-own-account` is the Academy projection of the same-account handoff
contract; the broader Doctor `/account/congress` scenario remains unchanged.
`steps/handoff-own-account.steps.ts` uses `lib/owned-congress-signup.ts`, the
canonical real configured-event intake also used by `@valid-handoff`, with a
unique `handoff-own-2942-` address. It independently authenticates through the
ordinary Academy email-code form and its actual addressed delivery before
opening the still-unconsumed handoff reference with `returnTo=/account`.

The portal server's read-only ownership check (#2951) must answer the hand-off
document request with a 3xx whose Location is the carried `/account` target; the
step keeps only that status and a target match, never the reference-bearing URL.
The `/login` page is never committed, the browser sends no auth command at all
(no handoff redemption, code request, resend or acceptance), and the mailbox
checkpoint (congress notice plus independent sign-in code) remains unchanged for
the full 15-second delivery horizon. Passive DOM observation from document
creation checks that no sign-in form becomes visible during the transition. The private profile, session subject
and original secure cookie still identify the same owned account at `/account`.
Only that owned session is revoked on cleanup; traces are disabled and the account
capture stays in the selected run's private artifacts.

No mail and no handoff request do not inspect the internal redemption count.
Retain `apps/api/test/auth/login-handoff.e2e-spec.ts`, EARS-44 same-account test
(#2659): four signed-in answers leave all three guest redemptions available.
That native test owns the exact counter proof, while this case adds actual
Academy browser/request/mail/session evidence. Broader app-local and Doctor
handoff journeys remain. This test-only coverage has no render surface and needs
no owner Stage-B request or slot.

### Academy email login resend (#3102)

The single `@login-email-resend` scenario
(`steps/login-email-resend.steps.ts`) projects 003 EARS-6/17/34/41/42. It registers
and verifies a unique owned account through actual Academy UI and addressed mail,
logs out, then requests and resends a real email login code. Mailpit message-ID
checkpoints prove each recipient-bound delivery without cross-machine timestamp
comparisons. Only the owning page clock advances its thirty-second UI cooldown;
server/provider clocks and ordinary quotas remain unchanged. The actual resend
click sends exactly the second request, restarts the disabled countdown, and
creates a delivery beyond the immediately preceding mailbox checkpoint.

The newest delivered code restores the original verified subject and unchanged
profile through reload, followed by exact owned logout. Before acceptance both
requests leave private profile/session access unavailable. Codes may randomly
coincide; this test asserts fresh delivery IDs, not differing digits or old-code
expiry. Cleanup revokes only owned sessions on every outcome and preserves the
original failure. Authentication traces remain disabled and secret assertions
use only boolean evidence. The scenario runs unchanged in the Academy stage
suite, without skipped paths, mocked authentication or real TTL/window waits.
