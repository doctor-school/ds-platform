---
"@ds/api": minor
---

#1646 (audit D2 of #1639): `POST /v1/public/specialty-choice` — the storefront's
only unauthenticated write — now carries the platform's shared EARS-13 rate
limit. Every accepted call mints an `idempotency_keys` row keyed by a header the
CALLER chooses, and the TTL sweep soft-expires those rows rather than removing
them, so an unbounded anonymous caller was unbounded row growth rather than
merely wasted work.

`@ds/api` minor, not patch: a client of this route gains a response it could not
previously receive. Over the budget the route answers `429` as an RFC 7807
problem naming neither the threshold nor the breached dimension (EARS-13/16),
and a caller that handled only `200`/`422`/`428` now has a fourth case. Nothing
is removed or renamed, and the accepted path is byte-identical.

The decorator carries no per-endpoint value: the shared windows are the
platform's one abuse budget. With no `identifier` / `email` / `phone` in the
body there is no per-user window to key, leaving the per-IP ceiling (20 / 15
min) and the per-ASN ceiling (100 / h) — orders of magnitude above a doctor
choosing and re-choosing a specialty.
