# @ds/portal

## 0.5.0

### Minor Changes

- [#268](https://github.com/doctor-school/ds-platform/pull/268) [`83ff3fd`](https://github.com/doctor-school/ds-platform/commit/83ff3fd06559a24d73a0a8467a4d2ff6773c6ae0) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(237): rebuild the portal auth surfaces on the design system — the reference vertical slice. login / register / verify / reset are re-skinned onto tokens + blocks from `@ds/design-system`, wrapped in the new `AuthLayout` split-screen block (shadcn `login-03`, re-skinned to tokens) with the Doctor School brand applied (Inter, SVG wordmark logo). The brand panel uses the new AA-safe `primary-surface` token (blue.700 `#114D9E`, white 8.14:1) — `primary` (blue.500) only clears AA for large/bold text, so a colour panel carrying normal-weight copy uses `primary-surface` (ADR-0013 §7). Logos ship as SVG (ADR-0013 §8): the clean white variant sits directly on the panel (no `bg-card` chip), and the form-column logo is `lg:hidden` so there is exactly one logo per viewport. Passwordless OTP login now renders the `OtpFocusScreen` block once a code is requested — masked destination + auto-submit + resend-with-cooldown + change-method — closing the [#192](https://github.com/doctor-school/ds-platform/issues/192)/[#196](https://github.com/doctor-school/ds-platform/issues/196)/[#200](https://github.com/doctor-school/ds-platform/issues/200)/[#211](https://github.com/doctor-school/ds-platform/issues/211)/[#212](https://github.com/doctor-school/ds-platform/issues/212)/[#227](https://github.com/doctor-school/ds-platform/issues/227) papercut class. Masked destinations also applied to the verify/reset code steps. App glue (BFF `/v1/auth/*`, EARS-16 generic errors, i18n, auto-submit) is unchanged — only the presentation layer moved onto the system.

### Patch Changes

- [#289](https://github.com/doctor-school/ds-platform/pull/289) [`2253f43`](https://github.com/doctor-school/ds-platform/commit/2253f43a8337e2b64fbeb138784035209007f0ee) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - fix(237): brand panel left / form right — the recorded column-order decision. The `AuthLayout` split-screen shipped with the inherited shadcn `login-03` default (form-left / panel-right), but the [#237](https://github.com/doctor-school/ds-platform/issues/237) settled product-owner decision is brand-panel LEFT, form RIGHT. The form column stays first in source order (a11y — the interactive surface precedes the decorative panel) and is flipped visually on `lg+` via `lg:order-2` (panel `lg:order-1`); the `< lg` single-column layout (panel hidden, form fills) is unchanged.

- Updated dependencies [[`0df9312`](https://github.com/doctor-school/ds-platform/commit/0df9312d3333e81d49039146e4b23c8ca8ac777a), [`2253f43`](https://github.com/doctor-school/ds-platform/commit/2253f43a8337e2b64fbeb138784035209007f0ee), [`83ff3fd`](https://github.com/doctor-school/ds-platform/commit/83ff3fd06559a24d73a0a8467a4d2ff6773c6ae0), [`74508d6`](https://github.com/doctor-school/ds-platform/commit/74508d69d293fb3ca418dee638e4719f2fb7b7e7), [`8b986ff`](https://github.com/doctor-school/ds-platform/commit/8b986ffcad8e39e592c3be5db4c565211c18d185)]:
  - @ds/design-system@0.2.0

## 0.4.0

### Minor Changes

- [#223](https://github.com/doctor-school/ds-platform/pull/223) [`0413ad6`](https://github.com/doctor-school/ds-platform/commit/0413ad67fba93d3a3c10e04e70017ce42aec4319) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Relax password-recovery friction: auto-login after reset + forgiving auth rate-limit ([#221](https://github.com/doctor-school/ds-platform/issues/221), [#222](https://github.com/doctor-school/ds-platform/issues/222), 003 EARS-12/13).

  Two product-owner-approved refinements to feature 003 found in live testing, both
  shipped together.

  **Auto-login after password reset ([#221](https://github.com/doctor-school/ds-platform/issues/221), EARS-12).** Completing a password reset
  no longer drops the user back on `/login`. `POST /v1/auth/password/reset/complete`
  keeps the global force-logout (`revokeAllForSub`) and the `PasswordResetCompleted`
  audit, then mints a **fresh authenticated session** for the subject via the same
  `SessionService.establish` hop login uses — emitting the identical session-created
  `LoginSucceeded` audit row and setting the `__Host-ds_session` cookie. The
  response body stays token-free (`{status:"reset_completed"}`, EARS-8). The IdP
  port's `completePasswordReset` now returns a checked `IdpSession` (the real
  adapter runs a `POST /v2/sessions` password check with the new password; the
  `FakeIdpClient` is no more permissive). The portal `/reset` page routes to
  `/account` on success. A bad/expired code or unknown identifier is unchanged — the
  same generic 400, no session, no existence oracle (EARS-16).

  **Forgiving auth rate-limit ([#222](https://github.com/doctor-school/ds-platform/issues/222), EARS-13, ADR-0001 §7).** The per-user EARS-13
  ceiling is raised **5 → 10 / 15 min** so a normal forgot-password → login recovery
  flow is not throttled mid-journey (per-IP 20/15 min and per-ASN 100/h unchanged).
  A **successful** login AND a **successful** reset-complete now **forgive** (clear)
  the per-user window for that identifier (`RateLimitService.reset({ip, identifier})`,
  keyed identically to the guard), so a recovering user is never stranded. Only the
  per-user window is forgiven — per-IP / per-ASN are deliberately left intact. The
  throttled response stays generic (no account-existence oracle).

## 0.3.0

### Minor Changes

- [#199](https://github.com/doctor-school/ds-platform/pull/199) [`a381363`](https://github.com/doctor-school/ds-platform/commit/a38136342b366df2dcbac73f674e8f806cd3b6e9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): [#197](https://github.com/doctor-school/ds-platform/issues/197) enforce field validation/mask by construction — semantic field primitives + ESLint gate (003)

  Portal auth forms were assembled from raw design-system `<Input>` + a per-form
  loose resolver, so validation/mask was hand-wired field-by-field and easy to
  forget — the root cause of the live defects [#192](https://github.com/doctor-school/ds-platform/issues/192) (`/login` identifier) and [#196](https://github.com/doctor-school/ds-platform/issues/196)
  (`/reset` identifier). This lands the enforced-by-construction layer of EARS-22
  (003 design §8.2):

  - **Five semantic field primitives** (`apps/portal/components/fields`):
    `EmailField`, `PhoneField`, `OtpField`, `PasswordField`, and `IdentifierField`
    (the email-or-phone union box). Each bakes in validation + (where relevant) the
    E.164 phone mask + a11y + RU copy and co-locates its zod resolver fragment, so
    no per-call wiring. The loose `@ds/schemas` request contracts are unchanged.
  - **A custom ESLint gate** (`local/no-raw-auth-field-input`) that makes a raw
    credential `<Input>` — or a hand-rolled native `<input>` — impossible to render
    on the auth surfaces; the field must come from the primitives. Rides the
    existing `lint` CI job.
  - **All auth surfaces migrated** with behavior preserved ([#192](https://github.com/doctor-school/ds-platform/issues/192)/[#175](https://github.com/doctor-school/ds-platform/issues/175) intact), and
    **/reset identifier now validated + masked-aware** — the [#196](https://github.com/doctor-school/ds-platform/issues/196) fix.
  - **`@ds/schemas`** now exports the creation-password fragment as
    `NewPasswordSchema` (was a private `NewPassword`), so the portal composes the
    complexity baseline from the SSOT instead of re-declaring the regex — additive,
    the request schemas are unchanged.

- [#168](https://github.com/doctor-school/ds-platform/pull/168) [`f1e21ff`](https://github.com/doctor-school/ds-platform/commit/f1e21ffffdecdc26712fc6ae9ef92c19f1c53d01) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(portal): [#131](https://github.com/doctor-school/ds-platform/issues/131) wire the portal auth journeys against the live BFF (003 F7)

  Feature 003 shipped the auth BFF (`apps/api`, all `/v1/auth/*` routes live) but
  NO portal wiring — the login page only `console.log`ged, there was no
  register/verify/OTP/reset surface, the OTP input was a visual stub, and the form
  re-declared its own zod schema. No auth journey was completable in a browser.
  This is the milestone-completing vertical slice: the integrating UI layer plus a
  real browser E2E so the slice works end to end.

  **Same-origin BFF proxy (mandatory).** The session is the `__Host-ds_session`
  cookie, which `__Host-` locks to the exact origin that set it (no Domain). So the
  portal serves the BFF under its OWN origin: a Next `rewrites()` maps `/v1/:path*`
  to an env-driven upstream (`API_PROXY_TARGET`), and every form fetches the
  relative `/v1/auth/*` path with `credentials: "include"`. No CORS, no
  cross-origin cookie, and the access/refresh tokens never reach client JS (EARS-8).

  **Surfaces.** `/register` (EARS-1/2, email|phone toggle + consent + bot-protection
  → pending_verification), `/verify` (EARS-3/4, OTP from Mailpit), `/login` —
  password (EARS-5, single `identifier` box matching `LoginRequestSchema`, NOT the
  old `email` field) AND passwordless OTP (EARS-6 email / EARS-7 SMS, channel
  selector + request/verify), `/reset` (EARS-11/12, initiate → complete), and an
  `/account` session shell that reads `GET /v1/auth/session`, attempts one silent
  `POST /refresh`-then-retry on a 401 (EARS-9) before redirecting to `/login`, and
  logs out (EARS-10).

  **Schemas SSOT.** Every form validates with the `@ds/schemas` zod schemas via
  `@hookform/resolvers/zod`; the re-declared `signInSchema` is deleted. A small
  `lib/auth-client.ts` carries the token-free same-origin fetch surface typed by
  the `@ds/schemas` request/response types.

  **Browser E2E (real-Zitadel tier).** A new Playwright suite mirrors the api
  `zitadel-otp-login.e2e-spec.ts` pattern exactly: it drives a real browser through
  register→verify→login(password)→session→logout and the email-OTP journey, reading
  the REAL codes from Mailpit (never the FakeIdpClient `424242`), and asserts the
  no-token invariant (only `__Host-ds_session`, HttpOnly; no access/refresh token in
  `document.cookie`/`localStorage`/`sessionStorage`/JWT-shaped blob). It is gated on
  the dev-stand env (`IDP_*` + `E2E_PORTAL_URL`) and `test.skip`s otherwise, so it is
  NOT wired into CI or `pnpm test` — a manual dev-stand gate, same posture as the api
  LIVE_OIDC specs. SMS-OTP has no dev-stand provider: the UI is built but the E2E
  declares it a parity-only skip, not faked green.

### Patch Changes

- [#201](https://github.com/doctor-school/ds-platform/pull/201) [`1e45957`](https://github.com/doctor-school/ds-platform/commit/1e45957ac70d20c67b80b7f612d85d8421fafb67) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Localize the creation-password complexity error to RU and validate auth forms on blur ([#200](https://github.com/doctor-school/ds-platform/issues/200), 003).

  `@ds/schemas` now exports `NEW_PASSWORD_COMPLEXITY`, the bare creation-password
  complexity regex, as the single SSOT for the pattern. `NewPasswordSchema` is
  rebuilt from it and keeps its deliberately-generic English DTO message unchanged
  (no API behavior change). The portal's `NewPasswordFieldSchema` composes the regex
  **without** a message so the localized resolver maps the resulting `invalid_format`
  issue to the RU `errors.validation.passwordComplexity` copy — in zod v4 a
  schema-level message would otherwise outrank the contextual error map and leak
  English on `/register` and `/reset`.

  `/register` and `/reset` (complete step) now resolve from portal-composed,
  channel-specific schemas built from the field primitives (mirroring the existing
  OTP-login pattern) instead of the request schemas; the submitted body and the API
  contract are unchanged. All auth forms run in `mode: "onTouched"` so a malformed
  email/phone/password is flagged on blur, before submit.

- Updated dependencies [[`1e45957`](https://github.com/doctor-school/ds-platform/commit/1e45957ac70d20c67b80b7f612d85d8421fafb67), [`a381363`](https://github.com/doctor-school/ds-platform/commit/a38136342b366df2dcbac73f674e8f806cd3b6e9)]:
  - @ds/schemas@0.7.0

## 0.2.0

### Minor Changes

- [#116](https://github.com/doctor-school/ds-platform/pull/116) [`abca9ca`](https://github.com/doctor-school/ds-platform/commit/abca9ca9ee9d7f07dfbaffcbe4d3c131b0bfa14e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(api,portal): [#84](https://github.com/doctor-school/ds-platform/issues/84) bootstrap BotProtection abstraction + Yandex SmartCaptcha adapter

  003 is the platform's first consumer of bot protection, so it bootstraps the
  mechanism behind an interface rather than a separate package (design §10.1,
  ADR-0001 open-q [#7](https://github.com/doctor-school/ds-platform/issues/7)). Backend (`@ds/api`): a `BotProtection` provider interface
  (`verify(token, action, clientIp) → ok`) bound to the `BOT_PROTECTION` DI token,
  a Yandex SmartCaptcha adapter (RF-accessible; fail-closed on any error), a
  `@BotProtected(action)` decorator, and a global `BotProtectionGuard` that no-ops
  unless a handler opts in — so swapping the provider (DSO-26) never touches a call
  site. Disabled by default (`BOT_PROTECTION_ENABLED=false`) so the dev-stand runs
  without a Yandex account.

  Frontend (`@ds/portal`): a provider-neutral `BotProtectionField` wrapping a
  self-contained Yandex SmartCaptcha widget that emits the token the guard
  verifies, wired onto the sign-in scaffold. EARS-17 policy (which surfaces, when)
  is owned by 003 F1/F5/F6; this ships the mechanism only. Closes [#84](https://github.com/doctor-school/ds-platform/issues/84).

## 0.1.0

### Minor Changes

- [#114](https://github.com/doctor-school/ds-platform/pull/114) [`0feefc5`](https://github.com/doctor-school/ds-platform/commit/0feefc5a37768db4f03042688b22b64908a449c9) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - feat(frontend): scaffold apps/portal + graduate packages/design-system (auth-form set)

  Graduates `@ds/design-system` from a stub to the Tailwind CSS 4 + shadcn/ui
  owned-code component set the 003 inline auth forms need (ADR-0004 §6): a single
  token sheet (`globals.css`) whose one `--radius` derives the whole radius scale
  via `@theme inline`, plus `Button`, `Input`, `Label`, `Card`, the RHF `<Form>`
  binding (ADR-0004 §9), and `InputOTP`. Components ship as source and are
  transpiled by consumers (`transpilePackages`).

  Scaffolds `@ds/portal` as a Next.js 16 App Router app (`output: 'standalone'`,
  no Vercel runtime — ADR-0004 §2.3/§3/§7): app shell + a sign-in page wiring the
  RHF + `@hookform/resolvers/zod` + `<Form>` + `<InputOTP>` stack end to end. The
  BFF calls and the OIDC silent-re-auth middleware land with feature 003. Closes
  [#82](https://github.com/doctor-school/ds-platform/issues/82).

### Patch Changes

- Updated dependencies [[`0feefc5`](https://github.com/doctor-school/ds-platform/commit/0feefc5a37768db4f03042688b22b64908a449c9)]:
  - @ds/design-system@0.1.0
