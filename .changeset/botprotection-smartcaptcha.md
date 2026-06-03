---
"@ds/api": minor
"@ds/portal": minor
---

feat(api,portal): #84 bootstrap BotProtection abstraction + Yandex SmartCaptcha adapter

003 is the platform's first consumer of bot protection, so it bootstraps the
mechanism behind an interface rather than a separate package (design §10.1,
ADR-0001 open-q #7). Backend (`@ds/api`): a `BotProtection` provider interface
(`verify(token, action, clientIp) → ok`) bound to the `BOT_PROTECTION` DI token,
a Yandex SmartCaptcha adapter (RF-accessible; fail-closed on any error), a
`@BotProtected(action)` decorator, and a global `BotProtectionGuard` that no-ops
unless a handler opts in — so swapping the provider (DSO-26) never touches a call
site. Disabled by default (`BOT_PROTECTION_ENABLED=false`) so the dev-stand runs
without a Yandex account.

Frontend (`@ds/portal`): a provider-neutral `BotProtectionField` wrapping a
self-contained Yandex SmartCaptcha widget that emits the token the guard
verifies, wired onto the sign-in scaffold. EARS-17 policy (which surfaces, when)
is owned by 003 F1/F5/F6; this ships the mechanism only. Closes #84.
