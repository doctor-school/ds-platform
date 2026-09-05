---
"@ds/design-system": minor
"@ds/portal": patch
---

#1666 slice B — `PasswordRecoveryCard` and `EmailConfirmCard` join the blocks
tier, so password recovery and post-registration email confirmation each have
ONE canonical implementation both storefronts project (AGENTS.md §6 cross-front
capability reuse, ADR-0013 A1). Both compositions were lifted verbatim out of the
portal `/reset` and `/verify` pages — same elements, order, classes, test ids,
aria and state presentation — with the app glue replaced by props: copy, the
validation resolvers, BFF transport, the enumeration-safe outcome mapping, the
bot-protection element and routing all stay host-supplied. The portal pages are
now thin host projections; no rendered output changes.
