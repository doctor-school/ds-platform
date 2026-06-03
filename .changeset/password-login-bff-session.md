---
"@ds/api": minor
"@ds/schemas": minor
---

feat(api): #86 password login + BFF session establishment + token exchange (003 F2)

Implements EARS-5 (password login) and EARS-8 (BFF session over a `__Host-`
cookie) — the single session-establishment step every login variant converges on
(design §3/§6).

`@ds/schemas`: adds the `LoginRequest` / `LoginResponse` contracts (single
`identifier` box, token-free response) and `SessionClaims` (the principal subset
`sub, roles[], mfa` the BFF surfaces).

`@ds/api`:

- Extends the `IdpClient` port with `passwordLogin` (Zitadel Session v2 check;
  unknown-identifier and wrong-password are indistinguishable, EARS-16; the
  native lockout counter increments on the IdP side, EARS-15) and
  `exchangeSessionForTokens` (OIDC exchange → access JWT + opaque rotating
  refresh + principal claims). The in-memory fake implements both; the real
  Zitadel adapter implements the session check and fails closed on the
  OIDC exchange until the per-recipe OIDC app config is plumbed (design §11).
- Adds a `SessionStore` port (server-side `ActiveSession`, design §3) with an
  in-memory fake (default / CI binding) and a Redis adapter bound only when
  `REDIS_URL` is set (the production binding, ADR-0001 §6) — mirroring the IdP
  fake/real split so the suite runs without a live Redis.
- `SessionService` establishes the session: OIDC exchange → fresh `sid` →
  server-side record (tokens never leave the BFF) → `__Host-` HttpOnly+Secure+
  SameSite=Lax cookie with a fingerprint (`hash(UA + IP/24 + accept-language)`).
- `POST /v1/auth/login` (public) sets the cookie and returns a token-free body;
  failures are a single generic 401 (EARS-16). `GET /v1/auth/session`
  (`doctor_guest`-protected, design §7.2) returns the principal claims.
- A Fastify `onRequest` hook populates the request subject the global `AuthzGuard`
  reads — the authentication seam left open in `authz.guard.ts` — rejecting a
  cookie whose re-derived fingerprint diverges from the bound one.

The login captcha-after-N-failures policy (EARS-17 login surface) and refresh
rotation / logout (EARS-9/10) are owned by F6 (#90) and F4 (#88). Closes #86.
