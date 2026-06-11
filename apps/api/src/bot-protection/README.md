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
an enabled one rejects. A rejected result is a **generic** `ForbiddenException`;
the specific reason lives only in the provider result for the audit ledger and
never reaches the client (timing-equalized generic failures, EARS-16).

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

The master switch is read live on every `verify` from the Unleash `bot-protection`
flag (#185), so a toggle takes effect without a restart; `BOT_PROTECTION_ENABLED`
is the bootstrap default and the **fail-closed** fallback when Unleash is
unreachable (an outage never silently opens the gate). Disabled by default so the
dev-stand runs without a Yandex account; the guard and the portal widget stay
wired end to end, only the server-to-server validation is skipped. **Fail-closed
when enabled:** a missing server key, a non-2xx response, or a transport error all
resolve to `ok: false` — never an open gate (ADR-0001 §5.5 risk row: captcha
downtime ⇒ block + alert).

## Frontend half

The SmartCaptcha widget that emits the token this guard verifies lives in the
portal: `apps/portal/components/bot-protection/`. Policy — which surfaces show
it, and when (post-failure for login) — is EARS-17, owned by 003 F1/F5/F6, not
by this mechanism.

[design]: ../../../docs/content/specs/features/003-user-authentication/003-design.md
[adr]: ../../../docs/content/adr/0001-identity-provider-shortlist-design-en.md
