# `mailer` — BFF transactional-email channel

The BFF's **own** transactional-email channel (003 EARS-23, [003 design][design]
§4) — deliberately separate from Zitadel's identity-credential emails (the
verification / OTP / reset codes that carry a secret). This module owns
**product / security notices** that must never carry a secret; the account-exists
notice (a sign-in / password-reset prompt for a registration attempt on an
already-registered address) is the first consumer, with lockout / welcome mails
as future ones. It shares the `email-delivery-real` Unleash flag with the
[`delivery-reconcile`](../delivery-reconcile/README.md) module, so one flag flip
moves both this notice and Zitadel's channel between Mailpit-intercept and the
real relay with no restart.

## What's here

| Concern                                        | File                          |
| ---------------------------------------------- | ----------------------------- |
| Module wiring (mailer + throttle bindings)     | `mailer.module.ts`            |
| Port + shared send-time validation             | `mailer.types.ts`             |
| Production nodemailer adapter (dual-transport) | `smtp-mailer.ts`              |
| In-memory test double                          | `mailer.fake.ts`              |
| Per-address anti-flood throttle                | `register-notice-throttle.ts` |

## Exported symbols

- **`MailerModule`** (`mailer.module.ts`) — binds `MAILER` → `SmtpMailer` (with a
  live `email-delivery-real` read injected from the `@Global` `FEATURE_FLAGS`) and
  `REGISTER_NOTICE_THROTTLE` → the Redis-backed throttle when `REDIS_URL` is set,
  else the in-memory fake — the single place each backend is chosen (mirroring
  `SessionModule`). Both are `exports` so `AuthService` consumes them.
- **`Mailer`** + **`MAILER`** (`mailer.types.ts`) — the port
  (`sendAccountExistsNotice(email)`, carrying no code/token/PD) and its `Symbol`
  DI token.
- **`assertSendableEmail(email)`** (`mailer.types.ts`) — the shared create-time
  validation every `Mailer` implementation runs, so the fake is **no more
  permissive** than the real adapter (a parity test proves both reject the same
  invalid input).
- **`SmtpMailer`** + **`SmtpMailerConfig`** / **`SmtpTransportConfig`** /
  **`SmtpTransport`** / **`TransportFactory`** / **`SmtpTransportFactoryOptions`** /
  **`WarnFn`** (`smtp-mailer.ts`) — the production adapter over `nodemailer`. It
  carries **both** an intercept transport (`MAILER_SMTP_*`, Mailpit) and a real
  transport (`IDP_SMTP_REAL_*`) and selects per send from the live flag read.
  Fail-soft: flag OFF (or Unleash-unreachable) ⇒ intercept; flag ON but the real
  relay unconfigured ⇒ warn + intercept (never throw, never silently drop); the
  selected transport's host unset ⇒ a logged no-op (infra-gated, so the dev-stand /
  CI still boots and the EARS-23 path stays exercised).
- **`FakeMailer`** (`mailer.fake.ts`) — the in-memory unit-test double; records
  every accepted send (`accountExistsNotices`) and runs the same
  `assertSendableEmail` guard so it is indistinguishable from the real adapter in
  both behaviour and error shape.
- **`RegisterNoticeThrottle`** + **`REGISTER_NOTICE_THROTTLE`** /
  **`REGISTER_NOTICE_TTL_SECONDS`** / **`noticeThrottleKey`** /
  **`RedisRegisterNoticeThrottle`** / **`InMemoryRegisterNoticeThrottle`** /
  **`ThrottleRedisLike`** (`register-notice-throttle.ts`) — the per-address
  anti-flood throttle so the registration form can't be weaponised to flood a
  victim's inbox. `tryAcquire(email)` is `true` only the first time within the
  ~15-min window (atomic `SET key 1 NX EX`); the marker is an ephemeral,
  self-expiring Redis key, never a persistent per-email record. The key is
  `register-notice:<HMAC-SHA256(pepper, lower(email))>`, reusing the #141 audit
  pepper so it is non-reversible (no existence oracle over the email space).

[design]: ../../../docs/content/specs/features/003-user-authentication/003-design.md
