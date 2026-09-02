---
"@ds/api": patch
---

fix(1655): resolve the real client IP behind the reverse-proxy chain

The Fastify adapter is now constructed with `trustProxy` set to the trusted proxy
addresses (new `TRUSTED_PROXIES` env, defaulting to loopback + link-local + the
private ranges). Every source-address control — the EARS-13 rate-limit windows,
the login-challenge gate, the session/admin-session fingerprint and the
bot-protection guard — reads `request.ip`, which previously resolved to the Caddy
container for every visitor. The trusted set is a predicate over proxy addresses
rather than a hop count, so the 1-hop (Caddy → api) and 2-hop (Caddy → doctor
rewrite → api) chains both resolve the caller, and an `x-forwarded-for` presented
by an untrusted peer is ignored.

**Deploy impact — a one-time forced sign-out.** The session fingerprint folds the
client `IP/24`; it is bound once when the session is established and never
rebound, and prod sessions live in Redis with a 30 d TTL, so they survive the api
restart. Existing sessions were fingerprinted against the proxy container's /24;
after this deploy the term re-derives from the real client's /24, so **every
signed-in user and every admin operator is signed out exactly once and signs in
again**. No data is affected. Deploy in a quiet window. Ongoing, the binding also
evicts a session when the client's own /24 changes (cellular roaming, CGNAT
reassignment) — the ADR-0001 §6 intent, which the constant term had made a no-op.
Owner ack (2026-09-02):
https://github.com/doctor-school/ds-platform/pull/1736#issuecomment-5505979858
