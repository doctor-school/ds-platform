---
"@ds/design-system": minor
"@ds/portal": patch
---

feat(266): `OtpFocusScreen` gains a `resendNonce` prop that restarts the resend
cooldown without a remount. The block previously re-seeded its countdown only
when `cooldownSeconds` changed, so a resend re-issuing the same duration could
not restart it — the portal login worked around this by remounting the verify
form via `key={resendNonce}`. Consumers now bump `resendNonce` instead; the
portal login drops the remount hack and clears the stale code explicitly on the
same signal.
