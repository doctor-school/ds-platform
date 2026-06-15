---
"@ds/api": minor
---

Flag-gate the BFF account-exists notice transport on `email-delivery-real` (#209, 003 EARS-23).

The EARS-23 account-exists notice (#207/#208) selected its SMTP transport purely
from `MAILER_SMTP_*` env, blind to the `email-delivery-real` Unleash flag — so
flipping the flag moved Zitadel's identity-credential channel to the real relay
while the BFF notice stayed on Mailpit (an inconsistent, per-channel toggle).

`SmtpMailer` now carries a **dual transport** — the **Mailpit intercept**
(`MAILER_SMTP_*`, the dev/test default) and the **real relay** (reusing the
`IDP_SMTP_REAL_*` creds) — and selects per send from the `email-delivery-real`
flag read **live** (env default `EMAIL_DELIVERY_MODE === "real"` as the
Unleash-unreachable fallback), mirroring `DeliveryReconcileService`. One operator
flag flip now moves **both** channels between Mailpit-intercept and the real relay
with no restart. Fail-soft: flag ON but `IDP_SMTP_REAL_*` unconfigured ⇒ warn and
use the intercept (never throws, never silently drops); the selected transport's
host unset ⇒ the existing logged no-op holds. FakeMailer ↔ SmtpMailer create-time
parity and the #207 invariants (fire-and-forget, per-address throttle, no
account/consent/`auth.register` write, EARS-16-identical response) are unchanged.

`env.schema.ts` gains the optional `IDP_SMTP_REAL_HOST` (carries `host:port`),
`IDP_SMTP_REAL_PORT`, `IDP_SMTP_REAL_USER`, `IDP_SMTP_REAL_PASSWORD`, and
`IDP_SMTP_REAL_SENDER_ADDRESS` (`secure` derived from port 465).
