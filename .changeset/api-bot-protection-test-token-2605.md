---
"@ds/api": patch
"@ds/e2e": patch
---

A non-production stand can accept a secret bot-protection test token
(`BOT_PROTECTION_TEST_TOKEN`) in place of the Yandex SmartCaptcha validation,
audited as `test-token`; the api refuses to boot with it unless
`SENTRY_ENVIRONMENT` is `stage`, `development` or `test` (#2605). `@ds/e2e`
exports `installCaptchaStub` (`@ds/e2e/captcha-stub`) to resolve the widget
with that token in browser drives. Production behaviour is unchanged.
