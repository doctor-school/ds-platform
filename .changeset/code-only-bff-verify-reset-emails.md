---
"@ds/api": minor
---

Email-verify and password-reset codes now ride Zitadel's `returnCode` and are delivered by the BFF mailer as branded, Russian, code-only, fully link-free emails (003 EARS-29): the code leads the subject, the body shows it as one unbroken enlarged token with an explicit 1-hour expiry line, and the mail carries zero links. Zitadel keeps full code authority (generate/store/expire/verify) but sends nothing for these types; the transiting code is scrubbed from every egress — logs, traces, error reports, provider echoes, audit ledger (EARS-30). The Zitadel-side `verifyemail`/`passwordreset` message-text overrides and the `urlTemplate`/`sendLink` send hops are retired.
