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
