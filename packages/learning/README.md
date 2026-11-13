# @ds/learning

The 024 learning path (spec `apps/docs/content/specs/features/024-learning-module-path/`): one Duolingo-style path through a course — school → course → module → lesson → step — whose completion, unlock, order, visibility and test behaviour are **data**, not code. Both storefronts and the mobile app read the same API (ADR-0013 A1: one shared core, thin app projections).

## Subpaths

| Subpath    | What it holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | I/O                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `.`        | the structure model (`model.ts`); the element-type catalog (`video`, `download`, `test` — which facts a type takes, whether it needs a provider source or a media file) and the condition-type catalog; setting keys, `LEARNING_PLATFORM_SEED` and `LEARNING_PRESET_SEEDS` (`rules/seed.ts`); the layer resolver (`rules/resolver.ts`, nearest layer wins: step › lesson › module › course › school › platform); rule and step-payload validation plus `publishRequirements` (`rules/validate.ts`); the evaluator cascade with the rule-sentence builder (`evaluator/`); RU copy (`copy/learning-copy-ru.ts`) | none                         |
| `./server` | framework-free services over `packages/db`: `LearningAdminService` (structure, publish gate, step source/media, rules, presets), `LearningDoctorService` (path/lesson/step reads, facts intake, attempts), the repository and the node-status projector                                                                                                                                                                                                                                                                                                                                                       | through `LearningServerDeps` |

`./client`, `./ui` and `./admin` are added by the doctor and admin UI slices of #4011; they do not exist yet.

## Seams (`LearningServerDeps`)

The host — `apps/api/src/learning/learning.module.ts` — wires: the Drizzle database; the audit-attributed transaction (`withRequestAuditContext`); the 025 `PointsEngine.record(tx, fact)` port, called inside the producer's transaction for the first `lesson.completed` (a re-completion is a 025 duplicate, a reversal records nothing); the 012 media signer for `download` files; the in-process event bus. The Nest module, controllers and problem filter live in `apps/api`, not here.

## Settings are data

No completion / unlock / order / visibility / test / progress value is a constant outside `LEARNING_PLATFORM_SEED`. Migration `0062_learning_path.sql` seeds the platform layer and the three presets with exactly those constants (an api e2e pins rows = constants). `test.exitRequired` is seeded on.

## Facts

`learning_facts` is append-only (a trigger refuses UPDATE / DELETE). A client event id is unique per person; the `learning:` prefix is the server's (`422 EVENT_ID_RESERVED`). The server sets `occurred_at` (the client time is kept as `data.clientOccurredAt`), and a reported video position is clamped by `progress.maxPlaybackRate` and `progress.slackSec`.

## Endpoints (`apps/api`)

- Public: `GET /v1/learning/courses/:courseSlug/path`, `GET /v1/learning/lessons/:lessonId`.
- Doctor: `GET /v1/me/learning/steps/:stepId`, `POST /v1/me/learning/facts`, `POST /v1/me/learning/tests/:testId/attempts`, `POST /v1/me/learning/attempts/:attemptId/submit`.
- Admin (`/v1/admin/learning`, 012 envelope — `Idempotency-Key` on writes, `If-Match` on versioned writes): schools, courses (publish / unpublish), modules, lessons (publish / unpublish, step order), steps (source for `video`, media for `download`), presets, rules per scope and apply-preset. Publishing a lesson that is not whole is `409 PUBLISH_REQUIREMENTS_NOT_MET` with field paths (`steps`, `steps.N.source`, `steps.N.media`, `exitTest`).

## Tests

`pnpm --filter @ds/learning test` (pure model). API e2e: `apps/api/test/learning/` (needs the dev stand).
