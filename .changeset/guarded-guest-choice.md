---
"@ds/api": minor
---

#1646 (audit D2 of #1639): `POST /v1/public/specialty-choice` — the storefront's
only unauthenticated write — now carries the EARS-13 rate limiter. Every
accepted call mints an `idempotency_keys` row keyed by a header the CALLER
chooses, and the TTL sweep soft-expires those rows rather than removing them, so
an unbounded anonymous caller was unbounded row growth rather than merely wasted
work.

`@ds/api` minor, not patch: a client of this route gains a response it could not
previously receive. Over the budget the route answers `429` as an RFC 7807
problem naming neither the threshold nor the breached dimension (EARS-13/16),
and a caller that handled only `200`/`422`/`428` now has a fourth case. Nothing
is removed or renamed, and the accepted path is byte-identical.

`@RateLimited` gains an optional scope tag, and this route passes one
(`storefront:specialty-choice`). The tag partitions the limiter's
source-address windows, so this endpoint owns its bucket and can never exhaust
the ceiling `/v1/auth/register`, login and `password/reset` consume from the
same address. Every existing auth call site keeps the argument-less form, whose
keying is unchanged — the shared auth budget behaves exactly as before.

The budget on this route is 20 requests / 15 minutes **per source address as the
api resolves it**. No other dimension engages: the body carries no `identifier`
/ `email` / `phone`, so there is no per-user window, and the per-ASN ceiling is
inert because no infrastructure layer sets `x-asn` in this deployment. And the
api does not currently resolve the caller — `trustProxy` is unconfigured and
nothing reads `x-forwarded-for` (#1655), while guest calls arrive through the
doctor app's server-side `/v1/:path*` rewrite — so until #1655 lands the
effective production behaviour is a single shared bucket for this route: a
global bound on anonymous `idempotency_keys` growth, not a per-caller control.
