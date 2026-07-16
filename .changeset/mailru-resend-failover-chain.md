---
"@ds/api": minor
---

BFF mailer transport gains the mail.ru→Resend failover chain (003 EARS-31, design §14.3): one channel switch per send on a rate-limit/availability rejection (mail.ru 451, Resend 429, any 4xx/5xx/connection failure), never a same-channel retry, delivered only on a provider 2xx; both channels failing is fail-closed with both provider codes while the enumeration-safe API response stays unchanged (never a 500). Every failover and relay failure emits a structured log, a `bff_mailer_relay_events_total{event,provider,code}` Prometheus counter, and a GlitchTip event (EARS-32). New Resend adapter is configured via `RESEND_API_KEY` (failover-only per the recorded 152-ФЗ posture, design §14.6); the Mailpit sink path (#209) never fails over to a real provider.
