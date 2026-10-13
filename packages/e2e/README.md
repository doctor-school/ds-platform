# `@ds/e2e` — the C6 regression contract

The end-to-end regression contract of the staging/regression-contour tech spec
([`2026-09-08-staging-previews-and-regression-contour-en.md`](../../apps/docs/content/specs/tech/2026-09-08-staging-previews-and-regression-contour-en.md)
§6, Issue #2067): **one** step package shared by both storefronts, the spec's own
feature files as the suite, and the navigation model both storefronts' chrome
is configured from.

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

The walk reads `.next/server/app-paths-manifest.json`, which the standalone
bundle does not carry. Both `apps/portal/Dockerfile` and `apps/doctor/Dockerfile`
copy it into the image's `public/` tree at

```
/__contour/app-paths-manifest.json
```

exported from `hosts.ts` as `MANIFEST_PATH` — one constant shared by the two
Dockerfiles, the walk and this README. The copy is guarded by the
`CONTOUR_MANIFEST` build arg, which defaults to `0`: **slot images only**, because
`infra/deploy/compose/slot/compose.yml` is the one build that passes `"1"`.
Production images therefore carry no `public/__contour/` and serve no
`/__contour/*`. Reading it from the SLOT rather than from the repo is the whole
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
The EARS-17 pair is tagged `@editor-write`: it publishes and retires a kind and
an event through the real admin screens (`admin/event-kinds.ts`,
`admin/events.ts`), so it runs only where `E2E_ADMIN_URL` names an admin this run
owns (a local dev stand on a branch DB), is skipped otherwise — never on the
read-only slot run — and its After hook retires what it created.

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
skips with a named reason. The stage box runs a sink but its Caddy publishes
only Mailpit, so a slot run skips these scenarios (stage publishes no sink yet —
#2878); run them on a local dev stand
(`E2E_SMS_SINK_URL=http://<stand host>:8090`). The sibling `@sms-reset`
scenarios — the indistinguishable unknown/unconfirmed-phone answer with its
50 ms timing clause, EARS-56 counter and absent ledger row, the mirror/IdP
mismatch, and the email reset of a phone-holding account — are not bound here;
their api e2e coverage is `apps/api/test/auth/password-reset.e2e-spec.ts` (fake
IdP: response/timing parity, no SMS/mail, no ledger row, the email path) and
`apps/api/test/me/phone*.e2e-spec.ts` / `user-mirror-phone-conflict.e2e-spec.ts`
(EARS-58 confirmed-only resolution and mirror clearing).
This coverage change has no render surface and requires no Stage-B request or
slot.
