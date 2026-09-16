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

| Subpath                      | What it owns                                                              |
| ---------------------------- | ------------------------------------------------------------------------- |
| `@ds/auth-flow/host-config`  | `AuthFlowHostConfig` — the data a host states about itself.               |
| `@ds/auth-flow/client`       | `createAuthClient`, `AuthError`, `BOT_PROTECTION_TOKEN_HEADER`.           |
| `@ds/auth-flow/errors`       | `authErrorMessage` — the one status/code → sentence dictionary.           |
| `@ds/auth-flow/bot-protection` | `botProtectionSiteKey`, `botProtectionMessages` read off the config.    |
| `@ds/auth-flow/fields`       | The identifier / password / promo / code rules and the RHF projection.   |
| `@ds/auth-flow/test-support` | Host-config fixtures for host suites — test code only, never shipped.    |

The bot-protection WIDGET, its resume-one-action orchestration
(`useBotProtectedAction`) and the error predicates stay in
`@ds/design-system/blocks` — this package owns only the auth composition around
them.

## Host config

`AuthFlowHostConfig` is DATA ONLY — no function-valued field, and the wave-1
adapter list is closed and empty (gate §4.3). A divergence that fits none of
these fields is a question for the owner, never a host-local variant.

| Field                     | Why it is data                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `api.basePath`            | The 003 auth root — `/v1/auth` on both hosts today.                                |
| `api.registerPath`        | `/v1/auth/register` vs the storefront registration command.                        |
| `api.confirmPath`         | `/v1/auth/verify` vs the storefront confirm command.                               |
| `copy.errors`             | Each host keeps its own sentences; the package keeps the branch.                   |
| `copy.botProtection`      | The four-state challenge copy the shared block's failures map onto.                |
| `copy.fields`             | One entry per field the host SERVES; `promoCode` iff `register.promoField`.        |
| `botProtection.siteKey`   | The site key VALUE — see below.                                                    |
| `channels`                | `['email']` on a host with no SMS: its identifier box refuses the phone shape.     |
| `register.promoField`     | Whether the registration form carries the optional promo box.                      |

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

## Paths are relative, always

Every call rides the CALLING host's origin through that host's `/v1/:path*`
rewrite, because the `__Host-ds_session` cookie is origin-locked. An absolute base
URL would mint the session on the wrong host — a defect no rendered screen shows.

## Mounted by

`apps/portal/lib/auth-flow-config.ts` and `apps/doctor/lib/auth-flow-config.ts`.

Both hosts also declare the dependency, list `@ds/auth-flow` in
`transpilePackages`, and `@source "../../../packages/auth-flow/src"` in
`app/globals.css` — a source-shipping package loses every Tailwind class in the
production image without that third line.
