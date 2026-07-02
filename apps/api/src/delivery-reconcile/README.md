# `delivery-reconcile` — flag → Zitadel active-provider reconcile

Reconciles the live `email-delivery-real` / `sms-delivery-real` Unleash flags
onto Zitadel's **active** notification provider (#185, [003 design][design] §3).
The api sends no OTP email/SMS itself — **Zitadel** does, using whichever provider
is currently active — so a delivery-mode flag cannot branch in our code; it must
repoint Zitadel via the admin API. This module reads each flag, finds the
pre-configured provider whose stable `description` matches the desired mode, and
`_activate`s it. It holds **no** SMTP/SMS secrets (those live in Zitadel's
provider config, set by `provision.sh`) — it only flips which provider is active.

## What's here

| Concern                                      | File                            |
| -------------------------------------------- | ------------------------------- |
| Module wiring + lifecycle hooks              | `delivery-reconcile.module.ts`  |
| Reconcile orchestration (flags → activate)   | `delivery-reconcile.service.ts` |
| Port + provider contracts + description SSOT | `delivery-reconcile.types.ts`   |
| Real Zitadel admin-API adapter               | `zitadel-delivery-admin.ts`     |

## Exported symbols

- **`DeliveryReconcileModule`** (`delivery-reconcile.module.ts`) — wires the
  reconcile. It is bound to a live service **only when** a real Zitadel admin
  client is configured (`IDP_ISSUER` + `IDP_SERVICE_TOKEN` — the same env
  `IdpModule` uses to pick the real adapter); otherwise the token resolves to
  `null` and no reconcile runs (no live Zitadel to repoint, so the boot-time env
  mode stands). `onApplicationBootstrap` runs the initial reconcile and subscribes
  to flag signals; `onModuleDestroy` unsubscribes. A boot failure is caught and
  logged — it must never abort boot.
- **`DELIVERY_RECONCILE`** (`delivery-reconcile.module.ts`) — the `Symbol` DI
  token for the optional service (absent without a live Zitadel admin).
- **`DeliveryReconcileService`** (`delivery-reconcile.service.ts`) — the reconcile
  itself. `start(warn?)` subscribes to `onChange` (operator UI toggle) and
  `onSynchronized` (the SDK's first poll — converges a steady-ON flag, #214)
  **first and unconditionally**, then runs a resilient initial reconcile with
  bounded linear backoff; it never throws. `reconcile(warn?)` reads both flags
  (env default as fallback) and, per channel, selects the provider matching the
  desired description and `_activate`s it unless already active. It is
  **idempotent** (skips an already-active provider), **safe** (a missing match is
  a no-op + warn — it never activates the wrong provider), and **reactive**.
  `stop()` unsubscribes.
- **`DeliveryEnvDefaults`** / **`ReconcileRetryConfig`** / **`WarnFn`**
  (`delivery-reconcile.service.ts`) — the boot/Unleash-unreachable delivery
  defaults, the injectable retry knobs (attempts, backoff, sleep — overridable in
  tests), and the diagnostic sink type.
- **`DeliveryAdmin`** + **`ZitadelProvider`** (`delivery-reconcile.types.ts`) —
  the minimal Zitadel admin port (list SMTP/SMS providers, activate one by id) and
  the normalised provider shape (`id`, `description`, `active`).
- **`SMTP_DESCRIPTION_INTERCEPT` / `SMTP_DESCRIPTION_REAL` /
  `SMS_DESCRIPTION_INTERCEPT` / `SMS_DESCRIPTION_REAL`**
  (`delivery-reconcile.types.ts`) — the stable `description` strings that are the
  contract between `provision.sh` and the reconcile: changing one side without the
  other breaks the match (the reconcile then warns rather than activating the
  wrong provider).
- **`ZitadelDeliveryAdmin`** + **`ZitadelDeliveryAdminConfig`** / **`AdminFetchLike`**
  (`zitadel-delivery-admin.ts`) — the real `DeliveryAdmin` adapter over the
  Zitadel admin API (`/admin/v1/smtp/_search`, `/admin/v1/sms/_search`,
  `…/{id}/_activate`), reusing the `baseUrl` + `serviceToken` + injectable
  `fetchImpl` pattern. `_activate` on an already-active provider is tolerated as a
  no-op (mirroring `provision.sh`); any other non-2xx throws.

[design]: ../../../docs/content/specs/features/003-user-authentication/003-design.md
