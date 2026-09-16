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

| Subpath                        | What it owns                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ds/auth-flow/host-config`    | `AuthFlowHostConfig` — the data a host states about itself.                                                                                                                                                                                                                                                                                                           |
| `@ds/auth-flow/client`         | `createAuthClient`, `AuthError`, `BOT_PROTECTION_TOKEN_HEADER`, and the browser `returnTo` store (`readStoredReturnTarget` / `clearStoredReturnTarget` / `resolveReturnTarget`).                                                                                                                                                                                      |
| `@ds/auth-flow/server`         | Server-only (#2027 PR 1.4): `resolveServerAuth` + `fetchSessionClaims` (the ONE session read), `SESSION_COOKIE_NAME` / `hasSessionCookie` / `forwardedSessionFrom` / `forwardedHeaders` / `serverApiBase`, `guardAuthRoute` + `resolveAuthRouteGuard` (the ONE signed-in guard), `parkReturnTarget` (the ONE `returnTo` parking rule) and `parseAccountReturnTarget`. |
| `@ds/auth-flow/errors`         | `authErrorMessage` — the one status/code → sentence dictionary.                                                                                                                                                                                                                                                                                                       |
| `@ds/auth-flow/bot-protection` | `botProtectionSiteKey`, `botProtectionMessages` read off the config.                                                                                                                                                                                                                                                                                                  |
| `@ds/auth-flow/fields`         | The identifier / password / promo / code rules and the RHF projection.                                                                                                                                                                                                                                                                                                |
| `@ds/auth-flow/test-support`   | Host-config fixtures for host suites — test code only, never shipped.                                                                                                                                                                                                                                                                                                 |

The bot-protection WIDGET, its resume-one-action orchestration
(`useBotProtectedAction`) and the error predicates stay in
`@ds/design-system/blocks` — this package owns only the auth composition around
them.

## Host config

`AuthFlowHostConfig` is DATA ONLY — no function-valued field, and the wave-1
adapter list is closed and empty (gate §4.3). A divergence that fits none of
these fields is a question for the owner, never a host-local variant.

| Field                   | Why it is data                                                                                                                                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.basePath`          | The 003 auth root — `/v1/auth` on both hosts today.                                                                                                                                                  |
| `api.registerPath`      | `/v1/auth/register` vs the storefront registration command.                                                                                                                                          |
| `api.confirmPath`       | `/v1/auth/verify` vs the storefront confirm command.                                                                                                                                                 |
| `routes`                | Which paths ARE this host's auth screens, where `/account` is, and (`allowAuthenticated`) which of them a signed-in user may still complete. The doctor host states no `verify`: it confirms inline. |
| `returnTo`              | The parking cookie (name, `maxAgeSeconds`) the middleware parks a return target in — stated only by a host whose middleware parks one.                                                               |
| `copy.errors`           | Each host keeps its own sentences; the package keeps the branch.                                                                                                                                     |
| `copy.botProtection`    | The four-state challenge copy the shared block's failures map onto.                                                                                                                                  |
| `copy.fields`           | One entry per field the host SERVES; `promoCode` iff `register.promoField`.                                                                                                                          |
| `botProtection.siteKey` | The site key VALUE — see below.                                                                                                                                                                      |
| `channels`              | `['email']` on a host with no SMS: its identifier box refuses the phone shape.                                                                                                                       |
| `register.promoField`   | Whether the registration form carries the optional promo box.                                                                                                                                        |

**Why `siteKey` is a value, not an env name.** Next inlines `NEXT_PUBLIC_*` only
at a LITERAL `process.env.NEXT_PUBLIC_…` read in the app's own source. A package
handed an env NAME would read `undefined` in every built host, so each host does
its own literal read of `NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY` and states the result.

## The bot-protection header contract

The api guard reads `x-smartcaptcha-token` from the HEADER first and only then
from a `captchaToken` body field. The client sends the header when a token exists
and sends **no header at all** otherwise — never present-and-empty, which the
guard would read as a supplied-but-invalid token. The body therefore stays exactly
the contract schema on every call, and the `captchaToken` body field is no longer
sent by either host.

Which calls accept a token is the protected-route list, encoded in the signatures:
`register`, `login`, `requestOtp`, `requestPasswordReset` and `resendVerification`
take one; `confirm` deliberately does not — the confirmation submit is not a
bot-protected route on either host.

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
  at all.
- **The signed-in guard.** `guardAuthRoute` redirects a signed-in visitor off an
  auth screen BEFORE it renders — a server decision, never a post-paint client
  flash (#675). A host names its own exceptions in `routes.allowAuthenticated`.
- **The `returnTo` parking rule.** `parkReturnTarget` parks a validated return
  target in the host's own cookie from middleware; `@ds/auth-flow/client` reads
  and clears the same cookie in the browser.

## Paths are relative, always

Every call rides the CALLING host's origin through that host's `/v1/:path*`
rewrite, because the `__Host-ds_session` cookie is origin-locked. An absolute base
URL would mint the session on the wrong host — a defect no rendered screen shows.

## Mounted by

`apps/portal/lib/auth-flow-config.ts` and `apps/doctor/lib/auth-flow-config.ts`
for the transport, copy and captcha values; `apps/portal/lib/auth-flow-routes.ts`
and `apps/doctor/lib/auth-flow-routes.ts` for the ROUTE values, which are read by
server code (the auth-screen guards, the Academy middleware, the doctor
storefront layout) and so are kept out of the config module that binds the
browser auth client at module scope.

Both hosts also declare the dependency, list `@ds/auth-flow` in
`transpilePackages`, and `@source "../../../packages/auth-flow/src"` in
`app/globals.css` — a source-shipping package loses every Tailwind class in the
production image without that third line.
