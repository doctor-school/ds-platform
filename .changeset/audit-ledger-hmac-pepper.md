---
"@ds/api": patch
---

fix(api): #141 keyed HMAC-SHA256 + pepper for audit_ledger identifier_hash

The `audit_ledger` masked raw identifiers (email / phone) with a bare
`createHash("sha256")`. Because the identifier space is low-entropy and an
unkeyed digest is reproducible, the access-controlled ledger became an existence
oracle — a rainbow table over a phone range trivially confirms whether a given
identifier appears in a `auth.login.failure` / `auth.otp.sent` /
`auth.password.reset_requested` row (ADR-0001 §7, ADR-0003 §6).

`hashIdentifier` is now `HMAC-SHA256(pepper, identifier.toLowerCase())`, so the
masked value is not reproducible without the server-side secret. The pepper is a
new optional `AUDIT_IDENTIFIER_PEPPER` env key threaded explicitly into the pure
mapping (`toLedgerRow` takes the bound mask), resolved once in the
`DrizzleAuthAuditLog` constructor. The writer **fails closed**: construction
throws if no pepper is configured in a non-test runtime; under VITEST a fixed
deterministic test pepper keeps the DB-gated e2e suite runnable without
provisioning a secret. Per-event ledger behaviour is unchanged — `identifier_hash`
stays a hex string and no raw identifier ever reaches a row.
