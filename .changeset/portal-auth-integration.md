---
"@ds/portal": minor
---

feat(portal): #131 wire the portal auth journeys against the live BFF (003 F7)

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
