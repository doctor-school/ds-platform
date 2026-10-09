# @ds/e2e

## 0.1.1

### Patch Changes

- [#2639](https://github.com/doctor-school/ds-platform/pull/2639) [`7a13a8a`](https://github.com/doctor-school/ds-platform/commit/7a13a8a82f723ee0f84f5709a7d3dcd91499530e) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Golden seed: the named эфиры are Academy (`experts`) events of kind «Эфир», so the Academy listing and archive carry the cards the 004/014 stage scenarios open; `golden-event-live` stays the doctor storefront's `doctors` room and a new `golden-event-live-academy` is the Academy's, each with a named registrant. The 003 logout scenario expects the storefront home after sign-out.

- [#2606](https://github.com/doctor-school/ds-platform/pull/2606) [`ac3c945`](https://github.com/doctor-school/ds-platform/commit/ac3c9452087aa2a12c1fdd5f4932bb3ce3c454e8) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - A non-production stand can accept a secret bot-protection test token
  (`BOT_PROTECTION_TEST_TOKEN`) in place of the Yandex SmartCaptcha validation,
  with a distinct `test-token` result reason (not written to the audit ledger); the api refuses to boot with it unless
  `SENTRY_ENVIRONMENT` is `stage`, `development` or `test` ([#2605](https://github.com/doctor-school/ds-platform/issues/2605)). `@ds/e2e`
  exports `installCaptchaStub` (`@ds/e2e/captcha-stub`) to resolve the widget
  with that token in browser drives. Production behaviour is unchanged.
- Updated dependencies [[`8350915`](https://github.com/doctor-school/ds-platform/commit/835091584a7a9f2e44a3e5dbbc70bd27e7b17495), [`3f5fb3e`](https://github.com/doctor-school/ds-platform/commit/3f5fb3efc32cb9b49e61662a57e79157e52fc2eb), [`7a13a8a`](https://github.com/doctor-school/ds-platform/commit/7a13a8a82f723ee0f84f5709a7d3dcd91499530e), [`b7e535c`](https://github.com/doctor-school/ds-platform/commit/b7e535c34ce4bbd750c5167f750c3e88dd7b381d), [`ed94b36`](https://github.com/doctor-school/ds-platform/commit/ed94b36260d4ef98d16a9d8f0f1e1bdbd33c8449), [`dbc5624`](https://github.com/doctor-school/ds-platform/commit/dbc5624ef3cacf00d7fb60119f5045248fe22299), [`87e7143`](https://github.com/doctor-school/ds-platform/commit/87e7143dd89b7d6d9942f7008f92c64899dd8431), [`33d4899`](https://github.com/doctor-school/ds-platform/commit/33d4899eb80239139650707795fab82fc8be84e9), [`1853c46`](https://github.com/doctor-school/ds-platform/commit/1853c46b619aa78d69e4da96c6d5e1a7a02d517d), [`b7e535c`](https://github.com/doctor-school/ds-platform/commit/b7e535c34ce4bbd750c5167f750c3e88dd7b381d), [`c44edb2`](https://github.com/doctor-school/ds-platform/commit/c44edb23b6ad5ed5955651b8ccad09ce0b86d751), [`1d53550`](https://github.com/doctor-school/ds-platform/commit/1d535508dc5f0bcb0b82964b12ecc1f74d58b52a), [`bb4b540`](https://github.com/doctor-school/ds-platform/commit/bb4b540302e36d4edace761fe5e68e96932cdecd), [`390c917`](https://github.com/doctor-school/ds-platform/commit/390c9178288cc3737efbad87ba9ee1dbe5289d6b), [`640a608`](https://github.com/doctor-school/ds-platform/commit/640a60846ef16544d4bf4e61d4d22db6e6d53ba1), [`2886d85`](https://github.com/doctor-school/ds-platform/commit/2886d856bdb3e594c42940e936fd17aa762fde57)]:
  - @ds/db@4.0.0
