# `mailer` — BFF transactional-email channel

The BFF's **own** transactional-email channel (003 EARS-23/29, [003 design][design]
§4, §13.3/§13.4, §14). Two mail classes ride it:

- **Product / security notices** that must never carry a secret — the
  account-exists notice (one sign-in action for a registration attempt on an
  already-registered address) and the admin MFA lockout notice (011 EARS-7).
- **One-time-code credential emails** (EARS-29, #910/#1045): the email-verify
  and password-reset codes are obtained from Zitadel via `returnCode` (Zitadel
  generates/stores/expires/verifies the code but **sends nothing**) and
  delivered as the branded, Russian, code-only, **fully link-free**
  §13.3/§13.4 artifacts (`code-emails.ts` is the copy SSOT). EARS-30 governs
  the transit: the code lives in memory for the in-flight send only — never
  logged, never persisted, and provider errors are scrubbed before surfacing.

All four BFF kinds reuse `email-layout.ts`, extracted from the existing
`code-emails.ts` inline-table layout without changing its colors, 480px width,
8px radius, spacing or typography (§13.5, #2171). Content data drives HTML and
plain text. Verification covers registration/resend and unverified-account
login with neutral ignore guidance; verification/reset direct code entry to
the already-open requesting tab. Both remain six uppercase/digit characters
with 3600-second Zitadel expiry, with no links or URLs. Account-exists contains
only the configured portal `/login` action; admin lockout preserves recovery
and reporting instructions without codes, counts or remaining lock time.
Intercept, real and fallback transports use the `Doctor.School` display name
and retain their own configured sender address.

Verified-account login email-OTP remains Zitadel-rendered/sent (eight digits,
300 seconds, native action still present). #2145 owns its migration and depends
on #2144; this independent BFF layout slice does not complete #2171 across all
login types. SMS also keeps its IdP template.
The module shares the `email-delivery-real` Unleash flag with the
[`delivery-reconcile`](../delivery-reconcile/README.md) module, so one flag flip
moves both this channel and Zitadel's between Mailpit-intercept and the
real relay with no restart.

## Explicit transport chain (003 EARS-31/32, design ?14.3, #2118)

Real mode requires `IDP_SMTP_REAL_PROVIDER=postbox` and the matching
`postbox.cloud.yandex.net:465` endpoint, or deliberate `mail.ru` with
`smtp.mail.ru:465`. Both use verified implicit TLS and the shared
`IDP_SMTP_REAL_USER`, `IDP_SMTP_REAL_PASSWORD`, and sender address.
Missing or mismatched real configuration fails internally on every send,
including after a flag flip; it never selects Mailpit or promotes a fallback.
Explicit intercept mode requires `MAILER_SMTP_HOST`; an absent host is an error.

`RESEND_ENABLED=false` is the default. Only `true` plus `RESEND_API_KEY`
enables the optional BFF fallback; enabling without a key is a configuration
error. A definite SMTP rejection can switch once. Timeout/connection loss
with uncertain acceptance never triggers an automatic duplicate. No retries.
Resend does not cover native Zitadel login OTP; its relay is reconciled separately.

SMTP limits are 5 seconds for connection/TLS, 5 seconds greeting, 10 seconds
socket inactivity, and 15 seconds absolute. Each send owns its socket through
Nodemailer's public `getSocket`; timeout destroys it, rejects late handoff,
and clears timers. HTTP uses an AbortController and a 10-second deadline,
including error-body consumption. Total transport execution is at most
25 seconds; enumeration-sensitive orchestration remains out of band.

Final SMTP/HTTP 2xx means **provider accepted**, not delivered or Inbox.
Structured logs and `bff_mailer_relay_events_total{event,provider,code}` distinguish
`primary_accepted`, `fallback_accepted`, `intercept_accepted`, `failover`,
`uncertain`, `configuration`, and `relay_failure`. Failures retain GlitchTip
reporting. Provider response text is discarded rather than partially redacted:
no address, subject, body, OTP or credential reaches these diagnostics.

Production activation, native OTP readback, rollback, quotas and controlled
received-artifact checks remain release-blocker #2116. Microsoft sender-auth
and Inbox evidence remain #1120; successful SMTP acceptance does not close it.

## Delivery-mode env defaults — and where SMS lives (not here)

The `email-delivery-real` / `sms-delivery-real` Unleash flags each fall back to
an env knob when Unleash is unreachable (`config/env.schema.ts`):
`EMAIL_DELIVERY_MODE` (`mailpit` | `real`, default `mailpit`) and
`SMS_DELIVERY_MODE` (`sink` | `real`, default `sink`) — the same knobs
`provision.sh` uses to pick the boot-time active Zitadel provider, so the env
default and the pre-reconcile provider state agree.

**SMS never rides this module.** SMS OTP is sent natively by Zitadel through
its ACTIVE HTTP SMS provider (repointed by
[`delivery-reconcile`](../delivery-reconcile/README.md)): intercept =
`sms-sink`; real = the **SMS-Aero** production sender (smsaero.ru **Gate API
v2** — `POST https://gate.smsaero.ru/v2/sms/send`, HTTP Basic auth
`email:api-key`), reached via the dev-stand `sms-aero-adapter` service that
holds the egress creds. Those creds (`SMSAERO_EMAIL` / `SMSAERO_API_KEY` /
`SMSAERO_SIGN`) live ONLY in the operator's stand env
(`infra/dev-stand/.env.example` documents the keys) — never in the repo. Real
SMS costs money: `real` is opt-in and fail-closed at provision time (#902).
Detail: `infra/dev-stand/README.md` → delivery flags.

## What's here

| Concern                                            | File                          |
| -------------------------------------------------- | ----------------------------- |
| Module wiring (mailer + throttle bindings)         | `mailer.module.ts`            |
| Port + shared send-time validation                 | `mailer.types.ts`             |
| §13.3/§13.4 code-only artifact templates           | `code-emails.ts`              |
| Shared existing HTML/plain-text layout and sender  | `email-layout.ts`             |
| Account-exists and admin-lockout content           | `notice-emails.ts`            |
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
  (`sendAccountExistsNotice(email)` and `sendAdminLockoutNotice(email)` carrying
  no secret; `sendVerificationCodeEmail(email, code)` /
  `sendPasswordResetCodeEmail(email, code)` carrying exactly one) and its
  `Symbol` DI token. `IdpModule` injects it into the IdP adapters for the EARS-29
  `returnCode` → mailer hand-off; `AdminSessionModule` injects it for the 011
  EARS-7 lockout notice. That notice carries **no code, no attempt count and no
  remaining time** — its recipient is by construction an account someone has just
  failed ten second-factor attempts against, so the mailbox may be the attacker's
  next target and the mail must not become their progress report.
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
  Invalid selected transport configuration fails closed, preserving the
  enumeration-safe caller response. `smtp-transport.ts` owns wire deadlines;
  `config/real-smtp.ts` is the shared BFF/native provider-validation contract.
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
