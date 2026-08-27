---
"@ds/schemas": minor
"@ds/api": minor
---

017 EARS-5: the closed Минздрав specialty book gains its search read,
`GET /v1/public/specialties/search?q=…` — a public, cacheable, read-only route
over the WHOLE book, «Другое» included.

The matching rule lives in `@ds/schemas` as one shared, DB-free predicate
(`normalizeSpecialtyQuery` + `specialtyNameMatchesQuery`): NFC-normalized,
lowercased, ё folded to е in BOTH directions, whitespace collapsed, and matched
as a substring ANYWHERE in the official name — not a prefix. One rule serves the
api and the storefront, so the two can never disagree about what «кардио» finds.

The response is strict `{ query, entries, total }` where `total` is the size of
the MATCH set; `SpecialtyBook.total` remains the single source of the catalog's
«Показать весь список — N», so the two totals stay distinct by contract. A query
matching nothing returns an empty entry list, not an error; an over-long query is
rejected with 400 as RFC-7807 problem+json. The storefront's scoped exception
filter now passes a deliberate client-error refusal through with its own status
instead of collapsing it into an opaque 500, so a malformed query on a public
route is answered as the client error it is and no longer mints an ERROR-level
log line. Only `@Get` is declared — there is no write path.
