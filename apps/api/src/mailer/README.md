# `mailer` — BFF transactional-email channel

The BFF's **own** transactional-email channel (003 EARS-23/29, [003 design][design]
§4, §13.3/§13.4, §14). Two mail classes ride it:

- **Product / security notices** that must never carry a secret — the admin
  MFA lockout notice (011 EARS-7) and the congress letters.
- **One-time-code credential emails** (EARS-23/29/34, #910/#1045): the
  email-verify, login, re-registration and password-reset codes are obtained from Zitadel via `returnCode` (Zitadel
  generates/stores/expires/verifies the code but **sends nothing**) and
  delivered as the branded, Russian, code-only, **fully link-free**
  §13.3/§13.4 artifacts (`code-emails.ts` is the copy SSOT). EARS-30 governs
  the transit: the code lives in memory for the in-flight send only — never
  logged, never persisted, and provider errors are scrubbed before surfacing.

All five BFF kinds reuse `email-layout.ts`, extracted from the existing
`code-emails.ts` inline-table layout without changing its colors, 480px width,
8px radius, spacing or typography (§13.5, #2171). Content data drives HTML and
plain text. Verification covers registration/resend and unverified-account
login with neutral ignore guidance; verification/reset direct code entry to
the already-open requesting tab. Both carry six digits (#2636)
with 3600-second Zitadel expiry, with no links or URLs. The re-registration
code mail (EARS-23, a registration attempt on an already-registered address)
says the address is already registered, states the code's lifetime and whether
the password is kept, and carries no link; admin lockout preserves recovery
and reporting instructions without codes, counts or remaining lock time.
Intercept, real and fallback transports use the `Doctor.School` display name
and retain their own configured sender address.

Verified-account login email-OTP uses the same layout and existing SmtpMailer
route. Zitadel returns its six-digit, 300-second code through `returnCode`
and sends no duplicate; the mail contains no action or URL. Session verification
and token exchange remain IdP-owned. SMS keeps its IdP template. Broader provider
acceptance in #2144/#2145 remains separate from this template migration.
The module shares the `email-delivery-real` Unleash flag with the
[`delivery-reconcile`](../delivery-reconcile/README.md) module, so one flag flip
moves both this channel and Zitadel's between Mailpit-intercept and the
real relay with no restart.

## Transport chain — Postbox → mail.ru → Resend (003 EARS-31/32/45/46, design §14.3, #2144)

Real mode requires `IDP_SMTP_REAL_PROVIDER=postbox` and the matching
`postbox.cloud.yandex.net:465` endpoint, or the pre-activation `mail.ru` with
`smtp.mail.ru:465`. Both use verified implicit TLS and the shared
`IDP_SMTP_REAL_USER`, `IDP_SMTP_REAL_PASSWORD`, and sender address.
Explicit intercept mode requires `MAILER_SMTP_HOST` and sends to Mailpit only.

Two reserves follow the primary, each joining only through its own switch:
the mail.ru reserve (`MAILER_FALLBACK_SMTP_ENABLED=true` plus its own complete
`MAILER_FALLBACK_SMTP_PROVIDER|HOST|PORT|USER|PASSWORD|SENDER_ADDRESS`, provider
`mail.ru`, never the primary's values) and Resend (`RESEND_ENABLED=true` plus
`RESEND_API_KEY`). Credentials alone are inert. An enabled reserve with
incomplete credentials, a mail.ru reserve while the primary is mail.ru, or (when
real mode is selected) a missing/unknown primary throws
`Mailer: invalid transport configuration` at module construction, aborting
startup, and again on every real-mode send; no Mailpit or other provider is
used instead (`assertMailerConfiguration`, `config/real-smtp.ts`).

Every channel receives the same composed object (same code, identical UTF-8
content); Resend gets only `from/to/subject/text/html` — tracking is a Resend
domain setting that must stay off (runbook). Each attempt ends in one EARS-45
class (`smtp-outcome.ts`, `resend-transport.ts`):

- `accepted` — final 2xx to the end-of-data sequence / Resend 2xx: stop.
- `recipient-permanent` — only an enhanced `5.1.x` (not `5.1.7`/`5.1.8`) reply
  to `RCPT TO`, or a Resend `validation_error` on the `to` field: stop.
- `provider-failure` — any server reply that is not the above (MAIL FROM, AUTH
  535, 4xx, bare 5xx, `5.7.x`, the end-of-data reply), connection refusal,
  DNS/certificate-handshake failure, any failure without a reply proven
  before end-of-data;
  Resend pre-send network failure, non-recipient 4xx, 429: next channel.
- `ambiguous` — timeout/connection loss after end-of-data, or whenever the
  phase cannot be proven; Resend 5xx or a failure after the request may have
  left: stop, no resend.

**Phase.** The owned socket (`smtp-transport.ts`) observes every byte
Nodemailer writes: after the `DATA` command, the stream tail reveals the
`CRLF.CRLF` end-of-data sequence (dot stuffing keeps it out of the body). Only
that transport can claim "before end-of-data". A measured phase always decides
a failure without a reply: before end-of-data it is `provider-failure`, after
it `ambiguous` whatever the errno (a TLS alert after `CRLF.CRLF` included). Any
other error source is classified with an unknown phase, so a non-reply failure
is `ambiguous` unless it is pre-session by nature (refused, DNS, a
certificate-handshake code such as `CERT_*` / `UNABLE_TO_VERIFY_*`, EAUTH,
EENVELOPE); a generic `ERR_SSL_*` with an unknown phase is `ambiguous`.

SMTP limits are 5 seconds for connection/TLS, 5 seconds greeting, 10 seconds
socket inactivity, and 15 seconds absolute; Resend has a 10-second deadline
including body consumption. Each attempt's effective deadline is the lesser of
its channel deadline and the remaining **40-second** chain budget; on budget
expiry the attempt is cancelled (socket destroyed / fetch aborted, timers
cleared), classified by phase, and the chain ends as `stopped-budget`.
Enumeration-sensitive orchestration remains out of band.

Final SMTP/HTTP 2xx means **provider accepted**, not delivered or Inbox.
`relay-observability.ts` emits a structured `mailer_attempt` line per attempt
(actual provider + class + bounded code) and one `mailer_chain` line per send
with the terminal outcome (`accepted-by-<provider>`,
`stopped-recipient-permanent`, `stopped-ambiguous`, `stopped-budget`,
`exhausted`) and the skipped-channel count, mirrored on
`bff_mailer_relay_events_total{event,provider,outcome,code,skipped}`.
GlitchTip receives every failed chain and configuration error (error) and
degraded acceptance (warning). Provider response text is discarded rather than
partially redacted: no address, subject, body, OTP or credential reaches these
diagnostics.

**Readiness (EARS-46).** `MailerReadinessMonitor` (`mailer-readiness.ts`,
token `MAILER_READINESS`) probes at startup and on every flag change, without
sending: an authenticated SMTP handshake (Nodemailer `verify` over the owned
socket) for Postbox and mail.ru, a `GET /domains` key check for Resend
(`restricted_api_key` 401 = `verified`). States: `disabled`, `absent`,
`configured-unverified`, `probe-failed`, `verified`; only verified reserves are
operational reserve. It logs `mailer_channel_readiness` and sets the
`mailer_channel_readiness{provider,state}` gauge;
[`delivery-reconcile`](../delivery-reconcile/README.md) consumes and reports it.

Production activation, native OTP readback, rollback, quotas and controlled
received-artifact checks remain release-blocker #2116
([runbook](../../../../infra/deploy/smtp-activation.md)). Microsoft sender-auth
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
| Admin-lockout content                              | `notice-emails.ts`            |
| Production nodemailer adapter (chain + transports) | `smtp-mailer.ts`              |
| Per-provider relay-channel contract                | `relay-channel.ts`            |
| Resend channel (HTTPS adapter, key probe)          | `resend-transport.ts`         |
| EARS-45 SMTP outcome classes                       | `smtp-outcome.ts`             |
| Owned-socket SMTP transport (deadlines, phase)     | `smtp-transport.ts`           |
| EARS-46 channel readiness monitor                  | `mailer-readiness.ts`         |
| Attempt/chain observability (EARS-32)              | `relay-observability.ts`      |
| In-memory test double                              | `mailer.fake.ts`              |
| Per-address anti-flood throttle                    | `register-notice-throttle.ts` |

## Exported symbols

- **`MailerModule`** (`mailer.module.ts`) — binds `MAILER` → `SmtpMailer` (with a
  live `email-delivery-real` read injected from the `@Global` `FEATURE_FLAGS`) and
  `REGISTER_NOTICE_THROTTLE` → the Redis-backed throttle when `REDIS_URL` is set,
  else the in-memory fake — the single place each backend is chosen (mirroring
  `SessionModule`). Both are `exports` so `AuthService` consumes them.
- **`Mailer`** + **`MAILER`** (`mailer.types.ts`) — the port
  (`sendAdminLockoutNotice(email)` carrying no secret;
  `sendVerificationCodeEmail(email, code)` /
  `sendPasswordResetCodeEmail(email, code)` /
  `sendLoginCodeEmail(email, code, lifetime)` /
  `sendReRegistrationCodeEmail(email, code, { lifetime, passwordKept })`
  carrying exactly one) and its
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
  every accepted send (`verificationCodeEmails`, `loginCodeEmails`,
  `reRegistrationCodeEmails`, `passwordResetCodeEmails`; `failNextCodeSends(err)` models a transport
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
