# @ds/legal-content

## 0.2.0

### Minor Changes

- [#4235](https://github.com/doctor-school/ds-platform/pull/4235) [`2afbe91`](https://github.com/doctor-school/ds-platform/commit/2afbe9163a349ed897b2ff7071de6801f8528ad3) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 033 queue core: the shared application queue — `POST /v1/me/applications/author` with consent, idempotency and bot protection; the daily expiry and erasure purge; the account-erasure step; the queue's PD columns masked in the audit ledger.

- [#4261](https://github.com/doctor-school/ds-platform/pull/4261) [`4cbb0a6`](https://github.com/doctor-school/ds-platform/commit/4cbb0a6fe354186f588a3a24830fa1da41e592b1) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - 033 EARS-1…5, 8, 9, 10: the Academy page «Заявка автора» at `/apply` — a guest gets the account gate «Войти / Регистрация» that returns to the open form after sign-in or registration; a signed-in expert sends topic, specialty, format, about and consent once per tap (a server failure keeps the input and retries with the same key), sees «Заявка отправлена», and on a later visit «Ваша предыдущая заявка в работе» from `GET /v1/me/applications?kind=author`.

## 0.1.0

### Minor Changes

- [#1988](https://github.com/doctor-school/ds-platform/pull/1988) [`bc18826`](https://github.com/doctor-school/ds-platform/commit/bc188260cc26a6781c4fe1ff9f3bb4f7ae73a727) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Publish the two legacy legal documents carried over from the Bubble site: the personal-data policy and the photo/video distribution consent.

### Patch Changes

- [#1993](https://github.com/doctor-school/ds-platform/pull/1993) [`a846acd`](https://github.com/doctor-school/ds-platform/commit/a846acd36863bcd6b6ad0c6aad5ba477e6f6c839) Thanks [@sidorovanthon](https://github.com/sidorovanthon)! - Resolve the default documents directory with `join(dirname(fileURLToPath(import.meta.url)), "..", "documents")` instead of `new URL("../documents/", import.meta.url)`. Bundlers treat the literal `new URL(..., import.meta.url)` form as a static asset reference and fail the consuming build with `Module not found: Can't resolve '../documents/'`, which made the package unusable from the Next.js server components it is written for. Runtime behaviour is unchanged.
