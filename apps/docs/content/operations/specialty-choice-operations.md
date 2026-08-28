---
title: "Doctor specialty choice operations"
description: "Verification and recovery for guest specialty memory, profile adoption, and retained doctor-specialty history."
lang: en
---

# Doctor specialty choice operations

This runbook covers the Feature 017 specialty-choice state carried by the
anonymous Doctor storefront session and the retained `doctor_specialties`
profile relation. Canon: [Feature 017 design](../specs/features/017-doctor-shell-specialties/017-design.md)
§§3–4 and ADR-0002/ADR-0003. The **Tech Lead / System Architect** owns deploy
verification; the doctor owns the choice made through the storefront.

## State and command boundaries

| Surface                            | Purpose                                                                             | State change                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /v1/public/specialty-choice`  | Resolve the anonymous `__Host-ds_specialty` cookie against the closed Minzdrav book | None                                                                                |
| `POST /v1/public/specialty-choice` | Remember a guest choice on this browser                                             | Replaces the `HttpOnly`, `Secure`, `SameSite=Lax`, host-only cookie                 |
| `GET /v1/me/specialty`             | Resolve the profile choice and adopt or discard a guest choice                      | May create one retained profile relation and clears the guest cookie                |
| `PUT /v1/me/specialty`             | Choose or change the authenticated doctor's primary specialty                       | Retires the prior relation and creates a new active relation when the value changes |

Both write commands require a fresh canonical `Idempotency-Key`. An exact retry
replays the stored response; reusing a key with another actor, route, method or
specialty is a conflict. The authenticated command serializes writes on the
doctor row, so concurrent retries must not create duplicate active relations or
false retired history.

The guest cookie is not trusted identity or authorization data. Every read
resolves it against the closed reference book. On authenticated navigation the
profile always wins: a guest choice is adopted only when the profile is empty,
otherwise it is discarded without overwrite or prompt. Before a rendered route
runs, the Doctor storefront proxy detects the authenticated-session plus guest
choice cookie pair, calls `GET /v1/me/specialty` with the original cookies, and
relays the API's clearing `Set-Cookie` onto the page response. Adoption therefore
still sees the guest value, while the browser receives its deletion before
hydration, sign-out, or another navigation can race it. A failed API call clears
nothing and leaves the guest value available for a later lossless retry.

## Post-deploy verification

Resolve the Doctor storefront and API URLs from the deployment record. Use
ordinary test identities and do not print cookies, session headers,
idempotency keys or specialty history in logs.

1. As a guest, choose a specialty and confirm the catalog collapses immediately.
   Reload: the same official book entry must render without a second write.
2. Retry the same guest command with the same key and payload. It must replay
   the same response and re-emit the same cookie; a different payload with that
   key must return the idempotency conflict.
3. Sign in with an empty profile after making a guest choice. The first
   authenticated navigation must show that choice, create exactly one active
   `primary` relation, and clear `__Host-ds_specialty` in the browser.
4. Repeat with a profile that already has another specialty. The profile value
   must remain unchanged and the guest cookie must still be cleared.
5. Sign out after either authenticated case. The discarded guest value must not
   reappear. Signing in as another empty profile on the same browser must not
   adopt the previous doctor's guest value.
6. Change the authenticated choice once, then retry the exact command. There
   must be one active `primary` relation; only a real value change may add one
   retired history row.

## Retained-row and failure signals

- `doctor_specialties` has no physical-delete path. A changed primary choice
  retires the previous row with its audit history and creates the new active row.
- A reference absent from the closed Minzdrav book returns
  `SPECIALTY_NOT_IN_BOOK` (422). The choice and cookie remain unchanged; retry
  only after selecting a served entry and use a fresh idempotency key.
- A missing or malformed `Idempotency-Key` is a request error. Do not bypass it
  with a handcrafted database write or reuse a key for a corrected payload.
- An idempotency conflict means the key is already bound to another request.
  Re-read current state, decide whether a new command is still intended, then
  issue it with a fresh key.
- If the authenticated page response succeeds but the guest cookie survives in
  the browser, verify the Doctor storefront proxy called `/v1/me/specialty` with
  both incoming cookies and relayed its clearing `Set-Cookie` on the page
  response. Do not ask an operator to edit an `HttpOnly` cookie manually.
- A uniqueness or serialization error during concurrent profile choice is a
  defect, not a recovery instruction. Keep the retained rows untouched, record
  the trace id and exact route, and investigate the parent-row lock plus
  idempotency outcome before retrying.

Do not recover by deleting `doctor_specialties`, editing its status columns,
copying a guest cookie between browsers, or changing the closed specialty book.
Those actions bypass the profile-wins rule, retained history and the audit
ledger.
