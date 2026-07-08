---
"@ds/schemas": minor
"@ds/portal": minor
---

feat(events): 005 EARS-2 — guest-through-auth completion carrying event context (003 round-trip)

A guest activating «Участвовать» is now carried through the shipped 003
login/signup flow with the **event context** and comes out **registered for that
same event**, landing back on that event page — no re-search, no second
«Участвовать» tap (feature 005, EARS-2; realizes US-2). This retires the legacy
"postponed registration" parking mechanism: there is **no** server-side pending
record — the intent lives only in the round-trip and the real `RegisterForEvent`
(EARS-1) fires once, after the session exists.

- `@ds/schemas` (additive) — `RegistrationIntent` / `RegistrationIntentSchema`
  (strict: the intent carries the event slug + a same-origin
  `returnTo=/webinars/:slug` only — **never** PII or a credential; any extra
  field is rejected) and the `parseReturnTarget` / `isSafeReturnTarget`
  open-redirect guard: a cross-origin, protocol-relative, backslash,
  multi-segment, traversal, or percent-encoded-separator return target resolves
  to `null`, and a safe one reconstructs the canonical `/webinars/<slug>` from
  the validated slug.
- `@ds/portal` — the returnTo survives every hop of the auth round-trip
  (`/register → /verify`, the `/verify → /login` fallback, and the cross links
  between the auth pages) via the guard-cleaning `withReturnTarget`; on auth
  success — password login, OTP login, or the post-verify auto-login replay —
  `completeReturnTarget` fires the same `RegisterForEvent` through the
  same-origin BFF path (`lib/registration-client`) and lands the doctor on the
  event page registered (best-effort: a transient register failure still lands
  on the event page, where the per-user state read / idempotent retry recovers).
  Without a carried context the shipped `/account` landing is unchanged; a
  hostile returnTo is dropped at every hop and never navigated to.

The live browser E2E for the full guest journey is batched at the 005
portal-integration slice (#574).
