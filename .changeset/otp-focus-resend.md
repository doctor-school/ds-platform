---
"@ds/portal": minor
"@ds/design-system": minor
---

OTP focus-resend on `/verify` and `/reset` code steps (#227, #267, EARS-24/25).

- **`/verify`** — the existence-agnostic dual-affordance verify screen (enter the email code AND the co-equal «Войти» / «Сбросить пароль», EARS-24) now offers **resend-with-cooldown** wired to the real `POST /v1/auth/verify/resend` endpoint (EARS-25, #319). A successful resend re-issues the code, restarts the 30s cooldown, and clears the stale typed code; the layout keeps both co-equal paths (it is NOT collapsed into the single-focus `OtpFocusScreen`). The resend control is hidden on a bare deep-link with no `?email=` destination to target. Auto-submit and the EARS-16 generic outcome are preserved.
- **`/reset`** — the complete step (code + new password submitted together) gains a **resend-with-cooldown** wired to the existing `requestPasswordReset(identifier)` (no new backend) plus a **«Начать заново»** action that returns to the request step to change the identifier. The code+password-together shape is kept (no auto-submit, intentional).
- **`@ds/portal`** — new `authClient.resendVerification` BFF helper and a `useResendCooldown` hook factoring the shared resend orchestration (nonce bump + clear-stale-code + error routing) across `/login`, `/verify`, `/reset`.
- **`@ds/design-system`** — new exported `useResendCountdown` hook factoring the live resend-cooldown timer; `OtpFocusScreen` now composes it, and the `/reset` inline resend (which can't adopt the whole block) reuses the identical timer instead of duplicating the interval logic.
