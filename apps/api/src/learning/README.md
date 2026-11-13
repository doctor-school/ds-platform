# `learning` — 024 learning path host

Spec: `apps/docs/content/specs/features/024-learning-module-path/` (design §1–§7, §9–§11). The model and services live in `@ds/learning` (`packages/learning/README.md`); this module is the Nest host that wires them to the API. Tables: `packages/db/src/schema/learning.ts` + migration `apps/api/drizzle/0062_learning_path.sql`. Contracts: `packages/schemas/src/learning/`.

## Files

- `learning.module.ts` — `LearningModule`: builds `LearningServerDeps` (Drizzle database, the audit-attributed transaction via `withRequestAuditContext`, the 025 `PointsEngine.record(tx, fact)` port, the 012 media signer, the in-process event bus) and provides `LearningAdminService` / `LearningDoctorService`; registers the `learning_steps.media_ref` media slot.
- `learning.public.controller.ts` — public reads: `GET /v1/learning/courses/:courseSlug/path`, `GET /v1/learning/lessons/:lessonId`.
- `learning.me.controller.ts` — the doctor's routes (`doctor_guest` | `platform_admin`): `GET /v1/me/learning/steps/:stepId`, `POST /v1/me/learning/facts`, `POST /v1/me/learning/tests/:testId/attempts` (201), `POST /v1/me/learning/attempts/:attemptId/submit`.
- `learning.admin.controller.ts` — `/v1/admin/learning/*` (`platform_admin`), the 012 command envelope (`Idempotency-Key` on every write, `If-Match` on versioned writes, replay returns the stored response): schools, courses (publish / unpublish), modules, lessons (publish / unpublish, step order), steps (`PUT …/source` for `video` — the 006 provider + embed ref; `PUT …/media` multipart for `download`), presets, rules per scope and apply-preset.
- `learning.errors.ts` — the learning problem filter: `LearningServerError` codes → RFC 7807 bodies (`PUBLISH_REQUIREMENTS_NOT_MET` 409, `EVENT_ID_RESERVED` 422, `LEARNING_ATTEMPT_UNAVAILABLE` 409 with `nextAt`, …).
- `learning.person.ts` — resolves the signed-in doctor's `users.id` from the session.

## Tests

API e2e under `apps/api/test/learning/` (`learning-doctor`, `learning-admin`, `learning-audit`), built on `harness.ts` — every course is built through the admin API.
