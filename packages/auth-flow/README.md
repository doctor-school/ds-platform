# `@ds/auth-flow`

The ONE auth flow both storefronts mount (ADR-0013 A1, epic #2020 wave 1, #2027).

Before wave 1 the Academy (`apps/portal`) and the doctor storefront
(`apps/doctor`) each carried their own auth client, their own error mapper, their
own bot-protection glue and their own field rules. The rules were the same
product decisions; the copies had already drifted — only one of the two mappers
knew the bot-protection codes. This package owns the RULE once. Each host keeps
its own DATA.

## Subpaths

There is deliberately **no `"."` root barrel**: a surface imports the unit it
uses, so nothing can reach the whole flow through one export (PR 1.1 rework D20).

| Subpath                        | What it owns                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ds/auth-flow/host-config`    | `AuthFlowHostConfig` — the data a host states about itself.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@ds/auth-flow/client`         | `createAuthClient`, `AuthError`, `BOT_PROTECTION_TOKEN_HEADER`, and the browser `returnTo` store (`readStoredReturnTarget` / `clearStoredReturnTarget` / `resolveReturnTarget`).                                                                                                                                                                                                                                                                                    |
| `@ds/auth-flow/server`         | Server-only (#2027 PR 1.4): `resolveServerAuth` + `fetchSessionClaims` (the ONE session read), `serverApiBase`, the session declaration re-exported from `@ds/events-storefront/server` (`SESSION_COOKIE_NAME` / `hasSessionCookie` / `forwardedSessionFrom` / `forwardedHeaders` / `ForwardedSession`), `guardAuthRoute` + `resolveAuthRouteGuard` (the ONE signed-in guard), `parkReturnTarget` (the ONE `returnTo` parking rule) and `parseAccountReturnTarget`. |
| `@ds/auth-flow/errors`         | `authErrorMessage` — the one status/code → sentence dictionary.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `@ds/auth-flow/bot-protection` | `botProtectionSiteKey`, `botProtectionMessages` read off the config.                                                                                                                                                                                                                                                                                                                                                                                                |
| `@ds/auth-flow/fields`         | The identifier / password / promo / code rules and the RHF projection.                                                                                                                                                                                                                                                                                                                                                                                              |
| `@ds/auth-flow/test-support`   | Host-config fixtures for host suites — test code only, never shipped.                                                                                                                                                                                                                                                                                                                                                                                               |
| `@ds/auth-flow/shell`          | `AuthShell` — the frame every auth screen on both storefronts sits in (#2027 PR 1.5).                                                                                                                                                                                                                                                                                                                                                                               |
| `@ds/auth-flow/login`          | The sign-in door (#2027 PR 1.5): `LoginDoor`, `LoginGlyph`, and the return-context card (`ReturnContextPanel` / `ReturnContextPlate` / `returnContextSlots`).                                                                                                                                                                                                                                                                                                       |
| `@ds/auth-flow/login/route`    | `LoginRoute` — the ONE server mount of that door: `guardAuthRoute`, then the door; `?method=code` opens it on «По коду» (003 EARS-43, closed allow-list via `resolveLoginMethod`).                                                                                                                                                                                                                                                                                  |
| `@ds/auth-flow/register`       | The sign-up door (#2027 PR 1.6): `RegisterDoor` (an accepted registration hops to `routes.verify`), `RegisterGlyph`.                                                                                                                                                                                                                                                                                                                                                |
| `@ds/auth-flow/verify`         | The confirmation step (#2027 PR 1.7), one body on both hosts — the canvas «Подтверждение» screen: `VerifyDoor`, `VerifyEntry` / `VerifyAddressGate` + `VerifyStep` (the `?email=` seed; without it, a replace onto `/register` carrying `returnTo`, nothing painted — 003 EARS-40), `VerifyGlyph`, `VERIFY_TEST_IDS`.                                                                                                                                               |
| `@ds/auth-flow/verify/route`   | `VerifyRoute` — the ONE server mount of that step on every host (003 EARS-24): the same arrival decision `RegisterRoute` takes (`guardAuthRoute`, the landing, the эфир to complete, the carry), the return-context panel, then the step.                                                                                                                                                                                                                           |
| `@ds/auth-flow/reset`          | The password-recovery flow (#2027 PR 1.8), one body on both hosts — the canvas «Сброс» screen: `ResetDoor` (both stages over `PasswordRecoveryCard`), `ResetGlyph`.                                                                                                                                                                                                                                                                                                 |
| `@ds/auth-flow/reset/route`    | `ResetRoute` — the ONE server mount of recovery: `guardAuthRoute` (let through by the derived reset-route exemption), the carried exit and the post-reset landing, then the door.                                                                                                                                                                                                                                                                                   |
| `@ds/auth-flow/register/route` | `RegisterRoute` — the ONE server mount of that door: `guardAuthRoute`, the registration arrival (landing, carried target), then the door.                                                                                                                                                                                                                                                                                                                           |

The bot-protection WIDGET, its resume-one-action orchestration
(`useBotProtectedAction`) and the error predicates stay in
`@ds/design-system/blocks` — this package owns only the auth composition around
them.

## Host config

`AuthFlowHostConfig` is DATA ONLY — no function-valued field, and the wave-1
adapter list is closed and empty (gate §4.3). A divergence that fits none of
these fields is a question for the owner, never a host-local variant.

| Field                                               | Why it is data                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.basePath`                                      | The 003 auth root — `/v1/auth` on both hosts today.                                                                                                                                                                                                                                   |
| `api.registerPath`                                  | `/v1/auth/register` vs the storefront registration command.                                                                                                                                                                                                                           |
| `routes`                                            | Which paths ARE this host's auth screens, where `/account` is. `verify` is required: every host confirms on its own route.                                                                                                                                                            |
| `copy.errors`                                       | Each host keeps its own sentences; the package keeps the branch.                                                                                                                                                                                                                      |
| `copy.botProtection`                                | The four-state challenge copy the shared block's failures map onto.                                                                                                                                                                                                                   |
| `copy.fields`                                       | One entry per field the host SERVES; `promoCode` iff `register.promoField`.                                                                                                                                                                                                           |
| `botProtection.siteKey`                             | The site key VALUE — see below.                                                                                                                                                                                                                                                       |
| `register.promoField`                               | Whether the registration form carries the optional promo box.                                                                                                                                                                                                                         |
| `copy.register`                                     | The sign-up door's words — headings, field labels, the «Уже есть аккаунт? Войти» way out (#2331).                                                                                                                                                                                     |
| `copy.verify`                                       | The confirmation step's words on every host — the canvas «Подтверждение» strings, with `{destination}` / `{seconds}` templates the package fills on the client.                                                                                                                       |
| `brand.loginIcon` / `brand.registerIcon`            | Which door glyph this host shows, as a closed ENUM value rather than a component — a host states WHICH glyph, never draws its own door.                                                                                                                                               |
| `register.attribution?` / `register.pointsPromise?` | The «кто платит» line above the form and the NMO-points promise above the submit. Honest-empty SLOTS: unfilled means the line is ABSENT, never a placeholder.                                                                                                                         |
| `consents`                                          | The whole consent block of the sign-up door as DATA: `tiers`, `medicalWorkerDeclaration`, `partnerDataItem`, `marketingOptIn`, `wordingVersion`, `accessGroupHeading`, and the read-only `statement` a host renders instead of controls. Absent = this host asks for no consent here. |

**Why `siteKey` is a value, not an env name.** Next inlines `NEXT_PUBLIC_*` only
at a LITERAL `process.env.NEXT_PUBLIC_…` read in the app's own source. A package
handed an env NAME would read `undefined` in every built host, so each host does
its own literal read of `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` and states the result.
The site key is ENVELOPE (which SmartCaptcha resource this build talks to); the
challenge itself is package behaviour, rendered wherever a key is configured.

**Mechanics are not host data (#2443).** The sign-in-code channels
(`AUTH_FLOW_CHANNELS` — e-mail and SMS), the auth routes a signed-in visitor
may still complete (`authenticatedAllowedRoutes(routes)` — the reset route,
003 EARS-28), the return-target parking (`RETURN_TARGET_PARKING`) and where
sign-out lands (`SIGN_OUT_DESTINATION` — the storefront home `/`, 003 EARS-10,
#2488) are package constants, so two storefronts cannot diverge on them.
The fields whose values MAY differ per storefront are exported as
`AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS`, each naming the spec clauses of its row in
021's «Differences between storefronts» table: `register.promoField`,
`landing.specialtyAware`, `consents`.

## The bot-protection header contract

The api guard reads `x-smartcaptcha-token` from the HEADER first and only then
from a `captchaToken` body field. The client sends the header when a token exists
and sends **no header at all** otherwise — never present-and-empty, which the
guard would read as a supplied-but-invalid token. The body therefore stays exactly
the contract schema on every call, and the `captchaToken` body field is no longer
sent by either host.

Which calls accept a token is the protected-route list, encoded in the signatures:
`register`, `login`, `requestOtp`, `requestPasswordReset` and `resendVerification`
take one; `verify` deliberately does not — the confirmation submit is not a
bot-protected route. `verify` is also not host data: both hosts confirm on the
one 003 command (#2455).

## The `./server` subpath

`@ds/auth-flow/server` is a subpath and not a package of its own because its
modules read the incoming request and the process environment, and one of them
hands a redirect to Next — none can ride into a browser bundle. `@ds/room/server`
and `@ds/events-storefront/server` draw the same line the same way, and that is
the repo convention (the `server-only` package is not in this repo).

Three rules live there, each stated once for both storefronts:

- **The session read.** `resolveServerAuth(headers)` recognises
  `__Host-ds_session` on a NAME boundary, issues the authenticated upstream read
  with the ADR-0001 §6 fingerprint headers (relaying an incoming
  `x-forwarded-for`, #2054), and degrades a 401 or an upstream failure to guest
  rather than taking the screen down. With no cookie it issues no upstream read
  at all. The cookie name and the fingerprint surface themselves are DECLARED in
  `@ds/events-storefront/server` and re-exported here, because the §4 dependency
  graph allows `@ds/auth-flow → @ds/events-storefront` and not the reverse; one
  declaration, one address for auth consumers.
- **The signed-in guard.** `guardAuthRoute` redirects a signed-in visitor off an
  auth screen BEFORE it renders — a server decision, never a post-paint client
  flash (#675). The one exception is derived from the host's reset route (`authenticatedAllowedRoutes`).
- **The `returnTo` parking rule.** `parkReturnTarget` parks a validated return
  target in the package cookie `RETURN_TARGET_PARKING` (`ds_return_to`, 900 s,
  host-only) from each host's middleware/proxy on `/login`, `/register` and
  `/verify` — the same on both storefronts (#2443); `@ds/auth-flow/client` reads
  and clears the same cookie in the browser. The query param wins when present;
  the parked copy is the fallback for a hop that lost it (014 EARS-6).

## The five rules of the auth flow (S1–S5)

One flow means one set of rules. These five are the STANDARD both storefronts are
held to (#2027, owner verdict on the PR 1.4 Stage-B round 1: «цель весь флоу
привести к единообразию и согласованности … Это вообще должно стать стандартом и
входить в тесты»). They are stated here because they span the hosts: no single
route owns them, and every one of them was broken on at least one route before the
sweep that wrote them down.

**S1 — a guest on a closed page is turned around on the SERVER, carrying where
they were.** The decision is a `redirect()` in a Server Component or layout, before
any paint, to THIS host's login route with `returnTo=<the visitor's own path>`
built by the shared carry helper. Never a client «Загружаем…» frame followed by a
`router.replace` — that flash is the visitor watching the app change its mind.
Applies to `/account`, `/account/events`, `/webinars/[slug]/room` on the Academy
and `/account`, `/events/[slug]/room` on the doctor storefront. The two rooms carry
the room return built by `buildRoomReturnHref` from each host's `routes.room`
template, so the door lands the guest back in the room and the room gate re-runs
(020 EARS-7 / §6.1).

**S2 — a signed-in visitor on an auth FORM is turned around on the server too.**
`guardAuthRoute` runs on `/login`, `/register` and `/verify` on both hosts, so a
doctor who still has a session never sees a sign-in form paint and then vanish. The
package derives the one exception from the host's reset route, so `/reset` is open
on both hosts — 003 EARS-28 hands a signed-in doctor here from «Сменить пароль».
An exemption that is the ABSENCE of a call cannot be read or tested; every route
calls the guard and the data decides.

**S3 — every transition BETWEEN auth screens carries the target forward.** The
«Войти» / «Зарегистрироваться» / «Забыли пароль» / «Вернуться ко входу» links, the
post-registration confirmation screen's two co-equal actions, and every
`router.push` between these surfaces go through the host's carry helper
(`withReturnTarget` for the Academy shapes, `withReturnContext` for the doctor
ones — both package modules since PR 1.6:
`packages/auth-flow/src/return-target-href.ts` and `src/return-context-href.ts`,
the latter re-exported by `src/server/return-context.ts`),
never a bare `"/login"` literal. Recovery and sign-up are INTERRUPTIONS of wherever
the visitor was going, not journeys of their own: a visitor who loses the target by
choosing the right-hand button instead of the left one has been dropped by the app,
not by their own choice. The helper re-appends only what the shared guards
reconstructed, so a hostile value is dropped rather than propagated.

**S4 — every landing honours the carried target through the shared landing rule.**
After login, registration, verification or a password reset, the destination comes
from the host's one landing resolver — the account family AND the event shapes,
not one of the two. The host's default landing applies exactly when the arrival
carried nothing, or carried something the guards refuse. On the Academy that
resolver is `completeReturnTarget` (it also completes a carried 005 registration
intent); on the doctor storefront it is `resolveReturnLandingPath`. `/reset` keeps
`routes.account` as its own no-target default (#221): `ResetRoute` projects the
arrival through `resolveReturnLandingPath` on both hosts, and only a target that
survives is completed through the shared rule.

**S5 — a confirmation that yields a session NAVIGATES; it does not paint a screen.**
When an email confirmation (or any verify step) completes and the visitor holds a
session, the host goes straight to the honoured destination with a REPLACING
navigation — no «Почта подтверждена» interstitial, no «вернуться к…» button the
visitor has to press to finish arriving, no secondary «в личный кабинет». The
destination is the one the CONFIRM ROUND TRIP honoured, because only the server
re-validated the carried target and therefore only the server knows it went stale;
the host's S4 default applies when the arrival carried nothing. `replace`, not
`push`: a spent code form must not be reachable by Back. The Academy `/verify` route
has always worked this way; the doctor storefront was brought to it on 2026-09-17
by the owner's verdict on PR #2239 («в Академии такого нет, сразу идёт редирект в
конечную точку. Бед доп. шагов и нажатий кнопок.»), amending 021 EARS-10. The
no-session branch is unchanged: the visitor goes to this host's sign-in door
carrying the target, per S3.

**Tested, not asserted.** Each rule is pinned per route: S1/S2 by a page-level test
that a guest (or a signed-in visitor) request REDIRECTS rather than returning a
screen, S3 by the rendered `href` of every inter-screen link, S4 by the path the
surface navigates to, S5 by the confirm case asserting a `replace` to the honoured
destination and the ABSENCE of any post-confirm surface. The ids carry `#2027 S3` /
`#2027 S4` so a later route cannot
quietly opt out of the standard.

## Paths are relative, always

Every call rides the CALLING host's origin through that host's `/v1/:path*`
rewrite, because the `__Host-ds_session` cookie is origin-locked. An absolute base
URL would mint the session on the wrong host — a defect no rendered screen shows.

## Mounted by

`apps/portal/lib/auth-flow.host-config.ts` and
`apps/doctor/lib/auth-flow.host-config.ts` for the transport, copy, consent and
captcha VALUES; `apps/portal/lib/auth-flow-client.ts` and
`apps/doctor/lib/auth-flow-client.ts` for the browser transport bound to them;
`apps/portal/lib/auth-flow-routes.ts`
and `apps/doctor/lib/auth-flow-routes.ts` for the ROUTE values, which are read by
server code (the auth-screen guards, the Academy middleware, the doctor
storefront layout) and so are kept out of the client module that binds the
browser auth client at module scope.

Both hosts also declare the dependency, list `@ds/auth-flow` in
`transpilePackages`, and `@source "../../../packages/auth-flow/src"` in
`app/globals.css` — a source-shipping package loses every Tailwind class in the
production image without that third line.
