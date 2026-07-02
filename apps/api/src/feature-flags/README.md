# `feature-flags` — runtime feature-flag port (Unleash)

The api's runtime feature-flag reader (#185, [003 design][design] §1). It lets an
operator flip a dev-stand switch in the Unleash admin UI without editing
`.env.local` and restarting the service. Call sites depend on a **narrow port**
by the `FEATURE_FLAGS` token so the SDK is swappable and, crucially, fakeable in
the unit specs (the `@ds/api` suite runs without a live Unleash).

## What's here

| Concern                              | File                       |
| ------------------------------------ | -------------------------- |
| `@Global` module + SDK binding       | `feature-flags.module.ts`  |
| Live reader wrapping the Unleash SDK | `feature-flags.service.ts` |
| DI token                             | `feature-flags.tokens.ts`  |
| Port interface + flag-name constants | `feature-flags.types.ts`   |

## Exported symbols

- **`FeatureFlagsModule`** (`feature-flags.module.ts`) — `@Global` so the
  bot-protection provider, the delivery reconcile, and the mailer inject the port
  without re-importing. Its factory initialises the Unleash **server SDK**
  (`unleash-client`) **only when** `UNLEASH_URL` + `UNLEASH_API_TOKEN` are both
  set; otherwise it binds the service with a `null` client (the shared-CI /
  Unleash-less default). `initialize` is non-blocking and polls in the
  background, and a failed poll's `error` event is swallowed so an unreachable
  Unleash degrades quietly to the env fallback.
- **`FeatureFlagsService`** (`feature-flags.service.ts`) — the live reader,
  implementing `FeatureFlags` + `OnModuleDestroy`. Reads are **fail-soft**:
  `isEnabled` returns the caller's `defaultValue` when the client is absent, the
  flag is unknown, the SDK has not synced yet, or the SDK throws. `onModuleDestroy`
  calls `client.destroy()` to stop the background poll/metrics timers on shutdown.
- **`UnleashLike`** (`feature-flags.service.ts`) — the narrow slice of the SDK
  the service consumes (`isEnabled`, the `changed`/`synchronized` events,
  `destroy`), declared locally so the unit spec injects a hand-rolled fake.
- **`FEATURE_FLAGS`** (`feature-flags.tokens.ts`) — the `Symbol` DI token; call
  sites inject the interface by this token, never the concrete service.
- **`FeatureFlags`** (`feature-flags.types.ts`) — the port: `isEnabled(flag,
defaultValue)` (live per-request read), `onChange(listener)` (fired on a
  subsequent toggle — the `changed` poll), and `onSynchronized(listener)` (fired
  once after the SDK's first successful poll, so the delivery reconcile can
  converge a steady-ON flag at boot, #214). The signal hooks return an
  unsubscribe handle and are no-ops in env-only fallback mode.
- **`FlagName`** + **`FLAG_BOT_PROTECTION`** / **`FLAG_EMAIL_DELIVERY_REAL`** /
  **`FLAG_SMS_DELIVERY_REAL`** (`feature-flags.types.ts`) — the three dev-stand
  runtime flags this migration owns, as a union type plus canonical constants so
  call sites are not stringly-typed.

## Precedence + fallback (design §4)

When Unleash is reachable its value wins; when it is unreachable or the flag is
absent, the caller-supplied `defaultValue` (sourced from env) is returned — so an
outage never silently changes behaviour. For the security flag (`bot-protection`)
the caller passes a **fail-closed** default: an Unleash outage must not open the
gate.

[design]: ../../../docs/content/specs/features/003-user-authentication/003-design.md
