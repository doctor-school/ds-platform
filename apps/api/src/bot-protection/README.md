# `bot-protection` — pluggable bot-protection gate

Implements [003 design §10.1][design] (E4, #84): the platform's bot-protection
mechanism, bootstrapped behind an interface because 003 is its first consumer
(no separate package yet). The interface keeps the provider swappable
([ADR-0001][adr] open-q #7: Yandex SmartCaptcha default, alternatives →
DSO-26) without touching call sites.

## Pieces

| File                          | Role                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bot-protection.types.ts`     | The `BotProtection` interface (`verify(token, action, clientIp) → ok`) + result/action vocabulary.                 |
| `bot-protection.tokens.ts`    | `BOT_PROTECTION` DI token — call sites inject the **interface**, never a concrete adapter.                         |
| `smart-captcha.provider.ts`   | Yandex SmartCaptcha adapter (RF-accessible; hCaptcha/reCAPTCHA deprecated in RF). Fail-closed on any error.        |
| `bot-protection.decorator.ts` | `@BotProtected(action)` — opts a handler into verification.                                                        |
| `bot-protection.guard.ts`     | Global `APP_GUARD`; no-ops unless a handler is `@BotProtected`, then requires a valid provider token.              |
| `bot-protection.module.ts`    | Binds `BOT_PROTECTION` → SmartCaptcha from env; registers the guard. **The single place a provider swap happens.** |

## Guarding a route (filled by 003 F1/F5/F6 — EARS-17)

```ts
@Post("register")
@Public()
@BotProtected("register")
@Authz({ access: "public", check: "none", audit: "high-stakes", tests: ["EARS-17"] })
async register() {}
```

The guard pulls the widget token from the `x-smartcaptcha-token` header (or the
`captchaToken` body field), reads the client IP, and delegates to the bound
provider — including a **missing** token (passed as `""`), so the missing-token
decision lives in the provider, not the guard: a disabled provider still passes,
an enabled one rejects. The guard exposes only two stable, provider-independent
codes from `@ds/schemas`: `BOT_PROTECTION_REQUIRED` for a missing proof and
`BOT_PROTECTION_REJECTED` for a supplied proof the provider rejects. Provider
diagnostics stay server-side and never reach the client; the codes disclose no
account/credential outcome and let the portal trigger or repeat the check without
parsing exception text (EARS-16/17).

## Swapping the provider (DSO-26)

Implement `BotProtection` and rebind `BOT_PROTECTION` in `bot-protection.module.ts`.
No decorated endpoint and no guard code changes — that is the whole point of the
token indirection.

## Configuration

| Env var / flag              | Default                                         | Meaning                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bot-protection` (Unleash)  | —                                               | Master switch, read **live per request** (#185). Overrides the env default when Unleash is reachable; an operator toggles it in the Unleash UI with no restart.              |
| `BOT_PROTECTION_ENABLED`    | `false`                                         | Bootstrap default **and fail-closed fallback** for the flag above — used at boot and whenever Unleash is unreachable. `false` ⇒ `verify` short-circuits to `ok` (dev-stand). |
| `SMARTCAPTCHA_SERVER_KEY`   | —                                               | Yandex SmartCaptcha **server** key. Required when enabled.                                                                                                                   |
| `SMARTCAPTCHA_VALIDATE_URL` | `https://smartcaptcha.yandexcloud.net/validate` | Validation endpoint.                                                                                                                                                         |
| `BOT_PROTECTION_TEST_TOKEN` | — (empty = unset)                               | **Non-production only** (#2605), ≥32 chars. A request token equal to it passes without a Yandex call — see «Test token (non-production)» below.                              |

The master switch is read live on every `verify` from the Unleash `bot-protection`
flag (#185), so a toggle takes effect without a restart; `BOT_PROTECTION_ENABLED`
is the bootstrap default and the **fail-closed** fallback when Unleash is
unreachable (an outage never silently opens the gate). Disabled by default so the
dev-stand runs without a Yandex account; the guard and the portal widget stay
wired end to end, only the server-to-server validation is skipped. **Fail-closed
when enabled:** a missing server key, a non-2xx response, or a transport error all
resolve to `ok: false` — never an open gate (ADR-0001 §5.5 risk row: captcha
downtime ⇒ block + alert).

## Test token (non-production)

Yandex SmartCaptcha ships no vendor test keypair, and the invisible widget never
yields a token in headless Playwright, so a staging stand substitutes ONLY the
server-side validation: when bot protection is enabled and the request token
equals `BOT_PROTECTION_TEST_TOKEN` (constant-time compare), `verify` returns
`{ ok: true, reason: "test-token" }` without calling Yandex. The distinct `reason`
is on the verify result only — the guard does not write a passing verify to the
audit ledger, so a test-token pass is not recorded there. Every other token, and every
fail-closed path (missing token, missing server key, non-2xx, transport error),
is unchanged. The browser half is `packages/e2e/lib/captcha-stub.ts`, which
stubs the Yandex `captcha.js` and resolves the real widget with the token.

Production never carries it — two independent controls:

1. **Boot refusal.** `loadEnv` rejects a set token unless `SENTRY_ENVIRONMENT`
   positively names a non-production environment (`stage`, `development`,
   `test`). An unset `SENTRY_ENVIRONMENT` defaults to `production` and refuses.
2. **Deploy refusal.** `pnpm deploy:prod` probes `/etc/ds-platform/api.env` on
   api-prod before shipping and refuses when it assigns a non-empty
   `BOT_PROTECTION_TEST_TOKEN` (`tools/deploy/prod.mjs`).

On stage-1 the token lives in `/etc/ds-platform/stage.env`, generated on the box
(`openssl rand -hex 32`), never committed; `pnpm stage:slot up|sync` refuse an
incoherent one (`assertCaptchaCoherent`). The local dev stand runs with bot
protection OFF and needs no token.

## Frontend half

The official `@yandex/smart-captcha` React adapter lives behind the portal's
provider-neutral `apps/portal/components/bot-protection/` wrapper. It executes
provider-native invisible checks on demand, follows the resolved portal theme,
and creates a fresh single-use token for each protected action. There is no
permanent checkbox. Policy — register / initial OTP/reset request / every resend,
conditional password login after `BOT_PROTECTION_REQUIRED`, and no check on code
confirmation or reset completion — is EARS-17, owned by 003, not by this backend
mechanism.

[design]: ../../../docs/content/specs/features/003-user-authentication/003-design.md
[adr]: ../../../docs/content/adr/0001-identity-provider-shortlist-design-en.md
