---
"@ds/auth-flow": major
"@ds/doctor": patch
"@ds/portal": patch
"@ds/storefront-shell": minor
---

Auth-flow mechanics are package constants, not host data (#2443, owner
2026-09-29: «механика работы auth-flow к этим различиям не относится»).

`AuthFlowHostConfig` no longer accepts `channels` or `returnTo`, and
`AuthFlowRoutes` no longer accepts `allowAuthenticated`. The package serves sign-in codes over
`AUTH_FLOW_CHANNELS` (`["email", "sms"]`) on every storefront, and the signed-in
guard derives its one exemption from the host's reset route
(`authenticatedAllowedRoutes(routes)`, 003 EARS-28). `identifierFieldSchema()`,
`loginIdentifierFormSchema()` and `otpIdentifierFormSchema(channel)` no longer
take a host config. Both host configs drop the keys; those values are unchanged.

Return-target parking (014 EARS-6) is one package mechanism on both
storefronts: `RETURN_TARGET_PARKING` (`ds_return_to`, 900 s, host-only), written
by `parkReturnTarget(request, response?)` and read by the client store with no
host argument. The Academy middleware and the doctor proxy both park on
`/login`, `/register` and `/verify`. Behaviour change on the doctor storefront:
an auth hop that lost the `returnTo` query param now lands on the parked target
there too, as it already did on the Academy; the query param still wins when
present.

The package also exports `AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS` — the fields that
may differ per storefront (`register.promoField`, `landing.specialtyAware`,
`consents`), each naming the clauses of its row in 021's new «Differences between
storefronts» table.

`@ds/storefront-shell` exports `SHELL_PRODUCT_DIFFERENCE_FIELDS` — the header
`search`, cited in 017's new «Differences between storefronts» table.
