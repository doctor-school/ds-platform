---
"@ds/api": minor
"@ds/portal": minor
---

Relax password-recovery friction: auto-login after reset + forgiving auth rate-limit (#221, #222, 003 EARS-12/13).

Two product-owner-approved refinements to feature 003 found in live testing, both
shipped together.

**Auto-login after password reset (#221, EARS-12).** Completing a password reset
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

**Forgiving auth rate-limit (#222, EARS-13, ADR-0001 §7).** The per-user EARS-13
ceiling is raised **5 → 10 / 15 min** so a normal forgot-password → login recovery
flow is not throttled mid-journey (per-IP 20/15 min and per-ASN 100/h unchanged).
A **successful** login AND a **successful** reset-complete now **forgive** (clear)
the per-user window for that identifier (`RateLimitService.reset({ip, identifier})`,
keyed identically to the guard), so a recovering user is never stranded. Only the
per-user window is forgiven — per-IP / per-ASN are deliberately left intact. The
throttled response stays generic (no account-existence oracle).
