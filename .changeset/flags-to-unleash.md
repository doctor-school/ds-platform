---
"@ds/api": minor
---

feat(api): #185 migrate runtime feature flags to Unleash + delivery reconcile

The api now reads three dev-stand runtime flags from Unleash (server SDK,
`unleash-client`) so an operator toggles them in the Unleash admin UI with no
`.env.local` edit + restart:

- `bot-protection` — read **live per request** by the captcha guard/provider. The
  `SmartCaptchaProvider` master switch became an `isEnabled()` callback wired to
  the live flag; `BOT_PROTECTION_ENABLED` is now the bootstrap default and the
  **fail-closed** fallback (an Unleash outage never silently opens the gate).
- `email-delivery-real` / `sms-delivery-real` — drive a **reconcile**: the api
  does not send OTP email/SMS (Zitadel does, via its active provider), so a flag
  change cannot branch in code — it repoints Zitadel. A new `DeliveryReconcileService`
  reacts to the SDK `changed` event (and reconciles on boot), finds the Zitadel
  provider whose stable `description` matches the desired mode among the
  pre-configured pair (`provision.sh` now ensures BOTH Mailpit + real SMTP and
  both sms-sink + SMS-Aero providers), and calls the admin `…/_activate`. It holds
  no SMTP/SMS secrets (only flips which provider is active), is idempotent
  (already-active ⇒ no-op), and safe (a not-provisioned target ⇒ leave the active
  provider, log a clear note, never activate the wrong one).

A new `FeatureFlagsService` wraps the SDK behind a `FEATURE_FLAGS` port: reads are
fail-soft (env default when Unleash is unreachable / the flag is unknown), with a
clean SDK shutdown on `OnModuleDestroy` (shutdown hooks enabled in `main.ts`). New
env: `UNLEASH_URL`, `UNLEASH_API_TOKEN`, `EMAIL_DELIVERY_REAL`, `SMS_DELIVERY_REAL`.
The SDK + reconcile bind only when their env is present (the shared-CI / fake-IdP
default runs env-only), so the api test topology is unchanged.
