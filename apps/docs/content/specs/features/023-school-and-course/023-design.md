---
title: "023 — The school and the course (Design)"
description: "Design for feature 023 over the 024 `packages/learning` model: the school and course descriptive columns, the module reward setting, the review, mentoring-request and school-interest tables, the school read and screen, the course header, the module-done cascade to 025 and 038, the review lifecycle, the admin structure editor, the API and the delivery slices."
slug: 023-school-and-course-design
status: Draft
lang: en
---

> Requirements: [`023-requirements-en.md`](./023-requirements-en.md) · Scenarios: [`023-scenarios.feature`](./023-scenarios.feature) · PRD: [`023-product.md`](./023-product.md) · Model: [`024-design.md`](../024-learning-module-path/024-design.md)

# 023 — Design

## 1. Package and host boundary (ADR-0013 §A1)

023 adds no package: everything lands in `packages/learning` (`@ds/learning`, 024 design §1) next to the 024 model.

| Subpath    | 023 adds                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`        | The `module.reward` setting key and its platform seed (EARS-2); the school-status and course-state derivations over the 024 evaluator (EARS-3); RU copy of the school screen.                                                                                                                                                                                                                                         |
| `./server` | The school read, the review, mentoring and school-interest services, the school-opened notice sender (EARS-7), the module/course-done listener that requests 038 documents (EARS-14), the admin school / course / module editor endpoints.                                                                                                                                                                            |
| `./client` | `/v1/learning/schools/*`, `/v1/me/learning/reviews`, `/v1/me/learning/mentoring-requests`, `/v1/me/learning/schools/{schoolId}/interest`.                                                                                                                                                                                                                                                                             |
| `./ui`     | `SchoolScreen` per `design-source/doctor-school.dc.html` (course cards as the 018 content card `FeedCard` (`packages/design-system/src/blocks/feed-card.tsx`; the canvas's `unit-content-card`), the events section as a mount of `@ds/events-storefront/feed` with a cap of 4 and the school's club-event filter (EARS-15)), `CourseHeader` over 024 `CoursePath`; the single-module mode of `CoursePath` (EARS-12). |
| `./admin`  | `SchoolEditor`, `CourseStructureEditor`, `ReviewModeration` — `@ds/design-system` primitives and the 012 list/form compositions; module reward and club in completion edit through 024 `RulesEditor` fields.                                                                                                                                                                                                          |

`apps/doctor` adds `app/schools/[schoolSlug]/page.tsx` and host-config fields; the course route is 024's. `apps/admin` adds route files under `app/learning/schools/`. `apps/portal` adds nothing (EARS-24).

## 2. Data model

```mermaid
erDiagram
  learning_schools ||--o{ learning_courses : "024, school_id NOT NULL"
  learning_courses ||--o{ learning_modules : "024"
  learning_modules }o--o| events : "club_event_id (020)"
  learning_courses }o--o| organisations : "partner_organisation_id (032)"
  learning_courses ||--o{ learning_reviews : ""
  learning_schools ||--o{ learning_mentoring_requests : ""
  learning_schools ||--o{ learning_school_interests : ""
  learning_document_requests }o--|| learning_courses : "course or module"
```

- **Columns over 024 rows** (`doctor`): `learning_schools` + `description`, `facts jsonb` (≤4 `{label, text}`), `soon_note NULL`, `community_url NULL`, `mentoring_offer NULL`, `internship_offer NULL`; `learning_courses` + `description`, `academic_hours`, `document_kind: certificate | certificate-nmo`, `document_prerequisites`, `partner_organisation_id NULL`, `position`; `learning_modules` + `club_event_id NULL`. The 024 rows, keys and `school_id` NOT NULL are unchanged.
- **Reviews** (`doctor`; `state` `admin-only` until published): `learning_reviews (id, person_id, course_id, stars 1..5, text, state: pending | published | rejected, submitted_at, moderated_by NULL, moderated_at NULL, version; U (person_id, course_id))`. A resubmission updates the row back to `pending` (reviews are not facts; 010 audits staff moderation).
- **Mentoring requests** (`doctor`): `learning_mentoring_requests (id, person_id, school_id, requested_at, state: open | closed; U (person_id, school_id) WHERE state = open)`.
- **School interests** (`doctor`): `learning_school_interests (person_id, school_id, state: active | withdrawn, registered_at, withdrawn_at NULL, notified_at NULL; PK (person_id, school_id))` — a register is an upsert to `active` (idempotent), a withdraw sets `withdrawn`; it never touches `person_specialties` or any 017 / 018 row (017's `PUT /v1/me/specialty` replaces the single primary specialty and is not used). The staff count is `count(*) WHERE state = active`.
- **Document requests** (`doctor`): `learning_document_requests (request_id U, person_id, item_kind: module | course, item_id, requested_at)` — the outbox to 038, `request_id = learning:<kind>-document:<personId>:<itemId>`.
- **Erasure**: reviews, requests, school interests and document requests follow the platform's personal-data erasure procedure with the 024 facts.

## 3. Settings (over 024 design §3)

| Key                                                           | Platform seed | Levels         | Read by                                     |
| ------------------------------------------------------------- | ------------- | -------------- | ------------------------------------------- |
| `module.reward`                                               | `points`      | course, module | the module-done listener (EARS-14)          |
| `school.mentoringEligibility` (`course-done` \| `any-doctor`) | `course-done` | school         | the mentoring section and request (EARS-16) |

`course.clubInCompletion` (seed `false`) is a 024 key (024 EARS-6, EARS-8); 023's editor writes it. Both go through 024 `SetRuleLayer`, so on a published course they need `learning_rules_editor` and the change dialog (024 EARS-30, EARS-31).

## 4. School read and screen (EARS-3…EARS-13)

```mermaid
sequenceDiagram
  participant B as apps/doctor /schools/{slug}
  participant S as SchoolReadService
  participant V as Evaluator (024)
  participant D as 037 verification
  B->>S: GET /v1/learning/schools/{slug}
  S->>S: published school + published courses (position order)
  alt signed-in doctor
    S->>V: course status per course (024 EARS-11)
    S->>D: documents verification status
  end
  S-->>B: school, status open|soon, counts, cards[state], verification
  B->>B: SchoolScreen: header · о школе · band? · courses (≤6 cards | «Вы учитесь» + rows) · events · document · mentoring · reviews · community
```

- **Course state** on a card: `done` = 024 `CourseCompleted` status; `started` = any done or current step that is not the first; else `not-started`. No percent is stored or sent.
- **Over six courses**: the read returns all published cards (bounded by the school); search and «Показать ещё 10» are client-side over that list, built from `@ds/design-system` primitives — no URL edit (unlike `EventList`'s show-more, which pages a server read).
- **Course header** (`CourseHeader`) reads the course read of 024 extended with the EARS-1 columns and the rules summary from the 024 sentence builder for the course scope; the preset's name is stripped by design — the builder takes resolved values, not the `preset` field of the resolver.
- **Events section** (EARS-15): the school read returns the club event ids of its published modules; `SchoolScreen` mounts `@ds/events-storefront/feed` with `limit: 4` and those ids as an additive filter of the 019 feed query — the precedent is 018's `SpecialtyEventsBlock`. Cards, «Все события», empty, error and «Повторить» are the block's own; 023 adds no events copy.
- **Single module** (EARS-12): `CoursePath` receives `modules.length === 1` and renders lesson segments without section headers; the outline lists lessons.

## 5. Module and course done → 025 and 038 (EARS-14)

```mermaid
sequenceDiagram
  participant P as StatusProjector (024)
  participant R as Resolver (024)
  participant E as PointsEngine (025)
  participant L as DocumentRequestListener
  participant O as 038 issuance
  P->>R: resolve module.reward(module)
  alt reward includes points
    P->>E: record(tx, module.completed {mode})
  end
  P-->>L: ModuleCompleted (after commit)
  opt reward includes document
    L->>L: insert learning_document_requests (request_id U)
    L->>O: request module document
  end
  P-->>L: CourseCompleted (after commit)
  L->>L: insert request (course) ; L->>O: request course certificate
```

The reward check sits inside 024's projector transaction (024 EARS-12), so 025 hears `module.completed` only under points; the 038 request is an outbox row, so a replay is a duplicate on `request_id`. 038 owns the issuance of the course certificate and the module document as well as the НМО registry (functional map §B 038; ADR-0016 §7); until 038's contract exists, this slice is `blocked_by` #1798 — no stand-in issuance.

## 6. School interest and the school-opened notice (EARS-7)

```mermaid
sequenceDiagram
  participant B as SchoolScreen
  participant I as SchoolInterestService
  participant A as Admin publish course
  participant N as SchoolOpenedNoticeSender
  participant M as Mailer (product notice)
  B->>I: PUT /v1/me/learning/schools/{id}/interest
  I->>I: upsert (person, school) state = active
  I-->>B: 200 «Вы в списке»
  A->>A: PublishCourse — first published course of the school
  A-->>N: CoursePublished { firstOfSchool } (after commit)
  loop active interests with notified_at NULL
    N->>M: send school-opened notice (notice-emails.ts)
    N->>N: set notified_at
  end
```

The letter belongs to the product-notice class of the `Mailer` port (no code, no credential); `notified_at` makes a replay or a second course publication send nothing. A guest's capture rides the 021 registration return target (the school screen with the capture intent) and is completed by the same `PUT` on return. The letter's copy and look are the owner's Stage A pick in slice 3.

## 7. Review lifecycle (EARS-18…EARS-20)

```mermaid
stateDiagram-v2
  [*] --> pending: graduate submits
  pending --> published: staff publish (010 audit)
  pending --> rejected: staff reject (010 audit)
  published --> pending: author resubmits
  rejected --> pending: author resubmits
```

Only `published` rows reach a doctor read; the author line is the profile's specialty and city, never the name.

## 8. API

| Method and path                                                                                                                                                                                           | Who                         | Clause         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------- |
| `GET /v1/learning/schools/{schoolSlug}`                                                                                                                                                                   | anyone (states per session) | EARS-3         |
| `GET /v1/learning/schools/{schoolSlug}/reviews?cursor=`                                                                                                                                                   | anyone                      | EARS-20        |
| `PUT /v1/me/learning/courses/{courseId}/review`                                                                                                                                                           | doctor, graduate            | EARS-18        |
| `POST /v1/me/learning/schools/{schoolId}/mentoring-requests`                                                                                                                                              | doctor, graduate            | EARS-16        |
| `PUT /v1/me/learning/schools/{schoolId}/interest` · `DELETE …/interest` (withdraw)                                                                                                                        | doctor                      | EARS-7         |
| `GET /v1/learning/courses/{courseSlug}` (024 course read + EARS-1 columns, rules summary)                                                                                                                 | anyone                      | EARS-11, 13    |
| `PATCH /v1/admin/learning/schools/{id}` · `…/publish` · `…/unpublish` (create is 024's)                                                                                                                   | staff (047 content editing) | EARS-26, 28    |
| `PATCH /v1/admin/learning/courses/{id}` · `…/publish` · `PUT /v1/admin/learning/schools/{id}/course-order` · `PUT /v1/admin/learning/courses/{id}/module-order` · `PATCH /v1/admin/learning/modules/{id}` | staff                       | EARS-27, 28    |
| `GET /v1/admin/learning/reviews?state=pending` · `POST …/{id}/publish` · `POST …/{id}/reject`                                                                                                             | staff                       | EARS-19        |
| `GET /v1/admin/learning/schools/{id}/mentoring-requests` · the interest count on `GET /v1/admin/learning/schools/{id}`                                                                                    | staff                       | EARS-7, 16, 26 |

Problems are RFC 7807: `REVIEW_NOT_GRADUATE` (403), `MENTORING_NOT_ELIGIBLE` (403), `PUBLISH_REQUIREMENTS_NOT_MET` (409), `PRECONDITION_FAILED` (412). Rule settings (`module.reward`, `school.mentoringEligibility`, `course.clubInCompletion`, `course.moduleSize`) use 024's `/v1/admin/learning/rules/*`.

## 9. UI mapping

- **School screen** — `design-source/doctor-school.dc.html` (Stage A «Го» 2026-11-12): poster header, loading, «О школе» with the verification band, courses (volumes 3 / 22 / 62: cards; «Вы учитесь» + rows + search + «Показать ещё 10»), «Школа готовится», the guest gate, events, document block (default / certificate available / waiting for verification), mentoring, reviews (ok / empty / error), community.
- **Course header** — over the 024 `CoursePath` of `design-source/doctor-course.dc.html` v16.
- **School-opened letter** (EARS-7) — no canvas yet: its copy and look go to the owner's Stage A in slice 3 (AGENTS.md §6, emails).
- **Admin** — no canvas, no Stage A (lead decision, Issue #1793 comment 6822255430): `build-ui-from-design-system` inventory → whitelist → report recorded in the slice PR.

## 10. Delivery slices

1. **School screen and course cards** (thinnest end-to-end): a school seeded through the 024 admin API with the EARS-1 columns, the school read, `SchoolScreen` with header, facts and course cards into the 024 path, the guest gate, the course header with the rules summary, the single-module path.
2. **Structure editor** — `SchoolEditor`, `CourseStructureEditor`, module club and reward, the admin envelope.
3. **«Скоро» and interest** — the soon state, the school-interest record and «Вы в списке», the staff count, the guest capture through 021 and the school-opened notice.
4. **Documents and the module reward** — the verification band (037), the document block and the 038 requests, the conditional 025 module fact.
5. **Graduate reviews** — form, moderation, section.
6. **Beyond lessons** — club events through the events feed block, mentoring requests with `school.mentoringEligibility`, community.
7. **Browser journeys and the phone** — CI journeys, 390 px, axe.

## 11. Dependencies

- **024** — every row, the resolver, the evaluator, the projector, the path block and the admin envelope (slice 1: 024 «First course path»; slice 2: 024 «Rules editor and live changes»).
- **018** — the content card `FeedCard` (`packages/design-system/src/blocks/feed-card.tsx`) and the «урок дня» link (slice 1). **017** — the shell (slice 1); 023 never writes the doctor's specialty. **021** — the registration return (slice 3). **Mailer** — the product-notice class of `apps/api/src/mailer/notice-emails.ts` (slice 3).
- **037** — the verification status and upload entry; **038** (#1798) — issuance of the course certificate and the module document (slice 4).
- **020** — the club events (slices 2, 6); **019** / `packages/events-storefront` — the events feed block and its feed read with the club filter (slice 6). **032** — partner organisations (slice 1). **047** — the content-editing grant; **010** — change audit; **012** — admin compositions, idempotency and `If-Match`.
