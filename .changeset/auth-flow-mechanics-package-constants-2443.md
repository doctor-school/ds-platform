---
"@ds/auth-flow": major
"@ds/doctor": patch
"@ds/portal": patch
---

Auth-flow mechanics are package constants, not host data (#2443, owner
2026-09-29: «механика работы auth-flow к этим различиям не относится»).

`AuthFlowHostConfig` no longer accepts `channels`, and `AuthFlowRoutes` no
longer accepts `allowAuthenticated`. The package serves sign-in codes over
`AUTH_FLOW_CHANNELS` (`["email", "sms"]`) on every storefront, and the signed-in
guard derives its one exemption from the host's reset route
(`authenticatedAllowedRoutes(routes)`, 003 EARS-28). `identifierFieldSchema()`,
`loginIdentifierFormSchema()` and `otpIdentifierFormSchema(channel)` no longer
take a host config. Both host configs drop the keys; the values are unchanged,
so neither storefront changes behaviour.

The package also exports `AUTH_FLOW_PRODUCT_DIFFERENCE_FIELDS` — the fields that
may differ per storefront (`register.promoField`, `landing.specialtyAware`,
`consents`), each naming the clauses of its row in 021's new «Differences between
storefronts» table.
