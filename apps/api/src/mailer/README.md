# `mailer` — BFF transactional-email channel

The BFF's **own** transactional-email channel (003 EARS-23/29, [003 design][design]
§4, §13.3/§13.4, §14). Two mail classes ride it:

- **Product / security notices** that must never carry a secret — the
  account-exists notice (a sign-in / password-reset prompt for a registration
  attempt on an already-registered address) is the first consumer, with
  lockout / welcome mails as future ones.
- **One-time-code credential emails** (EARS-29, #910/#1045): the email-verify
  and password-reset codes are obtained from Zitadel via `returnCode` (Zitadel
  generates/stores/expires/verifies the code but **sends nothing**) and
  delivered as the branded, Russian, code-only, **fully link-free**
  §13.3/§13.4 artifacts (`code-emails.ts` is the copy SSOT). EARS-30 governs
  the transit: the code lives in memory for the in-flight send only — never
  logged, never persisted, and provider errors are scrubbed before surfacing.

The still-Zitadel-sent types (login email-OTP, SMS) keep their IdP templates.
The module shares the `email-delivery-real` Unleash flag with the
[`delivery-reconcile`](../delivery-reconcile/README.md) module, so one flag flip
moves both this channel and Zitadel's between Mailpit-intercept and the
real relay with no restart.

## Failover chain (003 EARS-31/32, design §14.3, #1046)

On the real path the send rides a **mail.ru primary → Resend failover** chain:
a rate-limit/availability rejection on the active channel (mail.ru `451`,
Resend `429`, any 4xx/5xx/connection failure, or a resolved non-2xx SMTP
acceptance) triggers ONE switch to the other channel within the same send —
never a same-channel retry — and a send counts as delivered **only on a
provider 2xx**. Both channels failing = fail-closed: the send throws a
sanitized error (provider=code pairs only), and the enumeration-safe API
surface above stays unchanged (EARS-16 — callers swallow/log, never 500).
The Mailpit intercept path (flag OFF, #209) never fails over to a real
provider. Every failover and relay failure emits the EARS-32 triple —
structured log + `bff_mailer_relay_events_total{event,provider,code}`
Prometheus counter + GlitchTip event (`relay-observability.ts`) — so degraded
channel state is visible, never silent. Resend is failover-only by recorded
152-ФЗ decision (design §14.6); creds: `RESEND_API_KEY`
(`infra/deploy/api.env.example`).

## What's here

| Concern                                            | File                          |
| -------------------------------------------------- | ----------------------------- |
| Module wiring (mailer + throttle bindings)         | `mailer.module.ts`            |
| Port + shared send-time validation                 | `mailer.types.ts`             |
| §13.3/§13.4 code-only artifact templates           | `code-emails.ts`              |
| Production nodemailer adapter (chain + transports) | `smtp-mailer.ts`              |
| Per-provider relay-channel contract                | `relay-channel.ts`            |
| Resend failover channel (HTTPS adapter)            | `resend-transport.ts`         |
| Failover/relay-failure observability (EARS-32)     | `relay-observability.ts`      |
| In-memory test double                              | `mailer.fake.ts`              |
| Per-address anti-flood throttle                    | `register-notice-throttle.ts` |

## Exported symbols

- **`MailerModule`** (`mailer.module.ts`) — binds `MAILER` → `SmtpMailer` (with a
  live `email-delivery-real` read injected from the `@Global` `FEATURE_FLAGS`) and
  `REGISTER_NOTICE_THROTTLE` → the Redis-backed throttle when `REDIS_URL` is set,
  else the in-memory fake — the single place each backend is chosen (mirroring
  `SessionModule`). Both are `exports` so `AuthService` consumes them.
- **`Mailer`** + **`MAILER`** (`mailer.types.ts`) — the port
  (`sendAccountExistsNotice(email)` carrying no secret;
  `sendVerificationCodeEmail(email, code)` / `sendPasswordResetCodeEmail(email,
code)` carrying exactly one) and its `Symbol` DI token. `IdpModule` injects it
  into the IdP adapters for the EARS-29 `returnCode` → mailer hand-off.
- **`assertSendableEmail(email)`** / **`assertSendableCode(code)`**
  (`mailer.types.ts`) — the shared create-time validation every `Mailer`
  implementation runs, so the fake is **no more permissive** than the real
  adapter (a parity test proves both reject the same invalid input; the code
  guard's error never echoes the value).
- **`verificationCodeEmail(code)`** / **`passwordResetCodeEmail(code)`** +
  **`CODE_EMAIL_SUBJECT_TAILS`** (`code-emails.ts`) — the §13.3/§13.4 artifact
  composers (code-led subject, one unbroken enlarged token, expiry line, zero
  `<a>`/URLs) and the stable subject tails the e2e harnesses select by.
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
  every accepted send (`accountExistsNotices`, `verificationCodeEmails`,
  `passwordResetCodeEmails`; `failNextCodeSends(err)` models a transport
  outage) and runs the same `assertSendableEmail` / `assertSendableCode` guards
  so it is indistinguishable from the real adapter in both behaviour and error
  shape.
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
