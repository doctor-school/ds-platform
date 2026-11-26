# @ds/applications

The shared application-queue unit (feature 033, ADR-0013 A1; registry row
«Application queue» in `specs/product/two-site-ia/capability-ownership.md`).
The Academy page «Подать заявку» (`academy.doctor.school/apply`) is built from
it; the doctor storefront imports nothing from it (033 EARS-2).

| Entry      | What it holds                                                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | `applicationsCopy` (RU copy from the Stage A canvas `design-source/academy-apply.dc.html`); `validateAuthorForm` / `fieldErrorsFromRefusal` (EARS-4, EARS-5); `startSubmission` / `submissionReducer` / `classifyFailure` — one idempotency key per form instance (EARS-8, EARS-9); `showRepeatBanner` (EARS-10) |
| `./client` | the same-origin `/v1/me/applications*` transport: `submitAuthorApplication` (idempotency key + bot-protection proof, EARS-7), `fetchOwnAuthorApplications` / `readOwnAuthorApplications` (EARS-10), `ApplicationsError`                                                                                          |

## Submission lifecycle

`editing → sending → sent | unavailable | editing`. A `submit` outside
`editing` / `unavailable` changes nothing, so a double tap sends one request.
Every failure keeps the key: a network or `5xx` failure retries with it (the
api answers the stored result on replay), and a refused body stored nothing.
A `422 IDEMPOTENCY_KEY_REUSED` re-reads the applicant's applications: an open
one settles as `sent`, a failed read is `unavailable` with the same key, and a
read that succeeds with none (`rekey`) mints a new key. Otherwise only
«Отправить ещё одну заявку» (`another` from `sent`) mints a new key.

## Tests

`pnpm --filter @ds/applications test` — Vitest, node environment, co-located
`*.test.ts`, `it('EARS-N: …')`. The endpoints themselves are covered by the
api e2e `apps/api/test/applications/application-queue-core.e2e-spec.ts`.
