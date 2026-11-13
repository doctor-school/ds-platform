---
title: "033 — Author application: the «Подать заявку» page and the shared application queue (Design, slice 1)"
description: "Where the application queue lives, what exists today and what slice 1 replaces, the applications / application_notes model with closed request kinds that 034 extends, the author and partnership intakes with idempotency, consent and bot protection, the notification sequence that never loses an application, the admin lifecycle, the retention row and the erasure tombstone, the one-off import of the interim partnership files, the endpoints, the capability owner, the canvas and approved-non-canvas UI composition, the dependencies, the delivery slices and the lead decisions."
slug: 033-author-application
lang: en
---

# 033 — Author application: the «Подать заявку» page and the shared application queue (Design, slice 1)

Requirements: [`033-requirements-en.md`](./033-requirements-en.md) · PRD: [`033-product.md`](./033-product.md) · Domain: ADR-0016 §1 (one account), §7 (consent per purpose), §8 (storefront ownership) · PD lifecycle: ADR-0009 §2.3, §2.6 and its design §3 · Sibling: [`034-product.md`](../034-investment-marketplace/034-product.md) (adds the investor kind) · Access: [`047-design.md`](../047-staff-access/047-design.md).

## Current behaviour → replacement delta

| Today                                                                                                                                                                                                                                                                                                                                                                         | Slice 1                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The Academy home «Экспертам → Подать заявку» entries have no page behind them.                                                                                                                                                                                                                                                                                                | `apps/portal` route `/apply` (EARS-1…EARS-10, EARS-21); the home entries point at it (EARS-2).                                                                            |
| The interim home partnership form (`apps/portal/app/academy-partnership-action.ts`, `lib/academy-partnership-{schema,store}.ts`) writes one private JSON file per request to the portal volume `academy_partnership_submissions` (`/var/lib/ds-platform/academy-submissions`, ops doc `operations/academy-partnership-submissions.md`). Nobody is notified; there is no list. | The form posts to the queue's partnership intake (EARS-18); the stored files are imported once (EARS-19); the store module, the volume mount and the ops doc are removed. |
| No request queue exists in `apps/api` or `apps/admin`.                                                                                                                                                                                                                                                                                                                        | New `apps/api/src/applications/` module, `packages/schemas/src/applications/`, `packages/db/src/schema/applications.ts`, admin «Заявки».                                  |

## Placement

- `packages/db/src/schema/applications.ts` — `applications`, `application_notes`; forward migration in `apps/api/drizzle/`.
- `packages/schemas/src/applications/` — `ApplicationKind` enum, per-kind payload schemas (`AuthorApplicationPayload`, `PartnershipRequestPayload`), intake bodies, the applicant read item, admin list / detail / status / note contracts, the problem codes.
- `apps/api/src/applications/` — `applications.me.controller.ts` (author intake + applicant read), `applications.public.controller.ts` (partnership intake; 034 adds its investor intake here), `applications.admin.controller.ts`, `applications.service.ts`, `applications.repository.ts`, `application-notices.ts` (after-commit sends), `applications-retention.purge.ts` (daily, precedent `apps/api/src/sign-in-host/sign-in-host-record.purge.ts`), `import-partnership-records.ts` (the one-off command), README.
- Email bodies in `apps/api/src/mailer/notice-emails.ts` (`applicationTeamNoticeMessage`, `authorApplicationReceiptMessage`) in `email-layout.ts`.
- `apps/portal/app/apply/page.tsx` (route file) mounting the page from the application package (below); `apps/portal/app/academy-partnership-action.ts` re-pointed at the API.
- `apps/admin/app/applications/` — list and detail.

### Capability owner (ADR-0013 §A1)

The queue is one capability with one owner: **`apps/api/src/applications/` + `packages/schemas/src/applications/`** (the backend core) and **`packages/applications`** (`@ds/applications`: RU copy, the browser transport for `/v1/me/applications*`, the form, gate, states and banner UI, the route component taking a host config). The Academy is its only storefront consumer; 034 consumes the backend core by adding a kind and its own page. The row «Application queue (033 + 034)» is added to [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md) in this PR; the shared project card of «Пока не готовы?» stays the 030 row's (EARS-21 consumes it, never re-implements it).

## Data model

```mermaid
erDiagram
  users ||--o{ applications : "applicant_user_id (author kind)"
  consent_records ||--o| applications : "consent_record_id"
  specialties_minzdrav ||--o{ applications : "specialty_code (author payload)"
  applications ||--o{ application_notes : "application_id"
  applications {
    uuid id PK
    text kind "author | partnership (034 adds investor)"
    text status "new | in_review | closed"
    text outcome "accepted | declined | null"
    uuid applicant_user_id "nullable FK users"
    jsonb payload "per-kind schema"
    jsonb contact "no-account kinds: name, company, contact"
    text subject_line "topic or company/name, list + team email"
    uuid consent_record_id "nullable FK consent_records"
    text consent_purpose
    text consent_version_tag
    uuid idempotency_key "unique"
    uuid legacy_record_id "unique, import only"
    timestamptz submitted_at
    text team_notice "pending | sent | failed | skipped"
    text receipt_notice "pending | sent | failed | not_applicable"
    timestamptz status_changed_at
    uuid status_changed_by "admin user id"
    timestamptz closed_at
    timestamptz pd_erased_at
    int version
  }
  application_notes {
    uuid id PK
    uuid application_id FK
    uuid author_admin_id
    text body "1-2000; blanked on erasure"
    timestamptz created_at
  }
```

Checks: `kind = 'author'` ⇒ `applicant_user_id` and `consent_record_id` not null until erasure; `status = 'closed'` ⇔ `outcome` not null ⇔ `closed_at` not null; the author payload holds exactly one of `specialtyCode` (FK-by-value to `specialties_minzdrav.code`, precedent `packages/db/src/schema/registrations.ts:72`) or `specialtyOther`, or neither (specialty optional). Indexes: `(submitted_at desc, id)`, `(kind, status, submitted_at desc)`, `(applicant_user_id) where status <> 'closed'`.

### Request kinds (the 034 seam)

`ApplicationKind` is a closed `z.enum` in `packages/schemas`; each kind owns `{ payloadSchema, subjectLine(payload), intake: "me" | "public", consentPurpose, receipt: boolean }` in one `APPLICATION_KINDS` table in `apps/api/src/applications/`. 034 adds `investor` by extending the enum and the table, adding its public intake (`@BotProtected`) beside the partnership one, and a migration widening the `kind` check — the list, detail, status, notes, notifications, retention and erasure work unchanged. The admin kind filter and labels come from the same table.

### Retention (ADR-0009 §2.6 row)

| Table               | PD fields                                                        | Legal basis                                                                                     | Retention                              | Retained-row erasure mechanism                                                                 | Audit exception |
| ------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------- |
| `applications`      | applicant_user_id, payload (about, topic), contact, subject_line | 152-FZ art. 6 p. 1 — consent `author-application-personal-data` / `academy_partnership_contact` | while not closed; 1y after `closed_at` | value erasure + tombstone (EARS-20): payload, contact and subject_line replaced, user unlinked | none            |
| `application_notes` | body (may name the applicant)                                    | operational (legitimate interest) under the application's purpose                               | follows its application                | body blanked with the application's erasure                                                    | none            |

The consent row itself follows `consent_records` (ADR-0009 matrix rows 4–5: proof retained). The queue-core Issue adds both rows to the master matrix (ADR-0009 design §3) in the same PR as the migration, as that matrix requires.

## Intake and notification sequence (EARS-7, EARS-11, EARS-12)

```mermaid
sequenceDiagram
  participant P as apps/portal /apply
  participant A as apps/api applications
  participant DB as Postgres
  participant M as mailer chain (Postbox → mail.ru → Resend)
  P->>A: POST /v1/me/applications/author (Idempotency-Key, x-smartcaptcha-token)
  A->>A: session → 401; BotProtectionGuard → 403 codes; Zod → 400
  A->>DB: BEGIN; idempotency lookup; insert consent_records + applications (team/receipt = pending); COMMIT
  A-->>P: 201 { id, submittedAt }
  A--)M: team notice to APPLICATIONS_TEAM_NOTIFY_TO
  M--)A: ok | error
  A->>DB: team_notice = sent | failed
  A--)M: «Заявка получена» to the account email
  A->>DB: receipt_notice = sent | failed
```

The sends run after the response, on the request's process (no outbox, no scheduler — the congress precedent of `apps/api/src/congress/README.md`): the row is the record of truth, a crash between commit and send leaves `pending`, which the admin list shows like `failed` («Команда не уведомлена»). An idempotent replay returns the stored `{ id, submittedAt }` and sends nothing. The team list is the env `APPLICATIONS_TEAM_NOTIFY_TO` (comma-separated addresses, validated at boot; empty ⇒ `team_notice = skipped` and a boot warning in non-production, boot failure in production).

## Lifecycle (EARS-15, EARS-20)

```mermaid
stateDiagram-v2
  [*] --> new: intake / import
  new --> in_review: «Взять в работу»
  new --> closed: «Закрыть» + outcome
  in_review --> closed: «Закрыть» + outcome
  closed --> [*]
  note right of closed: closed + 1y → purge erases PD (tombstone)
```

Erasure is orthogonal to status: it can run in any status, sets `pd_erased_at`, and the row keeps kind, status, outcome and times. The subject's request reaches the team by any channel; the administrator runs «Стереть персональные данные заявителя» on each of that subject's applications (the detail lists the subject's other applications for an author account). Account erasure of the `users` row (ADR-0009) cascades to the same tombstone for the subject's author applications.

## Import of the interim records (EARS-19)

`pnpm --filter @ds/api applications:import-partnership <dir>` reads each `<id>.json` (`AcademyPartnershipRecord` of `academy-partnership-store.ts`), validates it against `PartnershipRequestPayload`, inserts `kind = partnership`, `legacy_record_id = id`, `submitted_at` from the record, consent purpose / version tag from the record, `team_notice = skipped`, `receipt_notice = not_applicable`, on conflict of `legacy_record_id` do nothing; prints `imported / already present / invalid` and the invalid names. Run order on prod: deploy with the re-pointed form → run the import against the volume mounted read-only into a one-off api container → compare counts with the file count → remove the volume from Compose. Removing the volume is an irreversible data action and waits for the owner's explicit «go» (AGENTS.md §6), tracked in the partnership Issue as a deferred prod action.

## Endpoints

| Method + path                                          | Caller                                            | Contract                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `POST /v1/me/applications/author`                      | signed-in account, `@BotProtected("application")` | `Idempotency-Key`; body `AuthorApplicationIntake` → `201 { id, submittedAt }` (EARS-6, EARS-7) |
| `GET /v1/me/applications?kind=author`                  | signed-in account                                 | `{ items: [{ id, submittedAt, topic, state: "received" }] }` — own, not closed (EARS-10)       |
| `POST /v1/public/applications/partnership`             | anyone, `@BotProtected("partnership")`            | `Idempotency-Key`; body `PartnershipRequestIntake` → `201 { id }` (EARS-18)                    |
| `GET /v1/admin/applications?kind&status&cursor`        | `platform_admin` + 2FA                            | `AdminDataList` page (EARS-13)                                                                 |
| `GET /v1/admin/applications/{id}`                      | `platform_admin` + 2FA                            | detail + notes + `ETag` version (EARS-14)                                                      |
| `POST /v1/admin/applications/{id}/status`              | `platform_admin` + 2FA, CSRF                      | `Idempotency-Key`, `If-Match`; `{ status, outcome? }` (EARS-15)                                |
| `POST /v1/admin/applications/{id}/notes`               | `platform_admin` + 2FA, CSRF                      | `Idempotency-Key`; `{ body }` (EARS-16)                                                        |
| `POST /v1/admin/applications/{id}/erase-personal-data` | `platform_admin` + 2FA, CSRF                      | `Idempotency-Key`; `409 ALREADY_ERASED` on a second call (EARS-20)                             |

Admin endpoints use `AdminAuthorityGuard` (`apps/api/src/auth/admin-session/admin-authority.guard.ts`) and the 012 EARS-16/17 envelope; every mutation writes a 010 change-audit row. The doctor storefront imports none of these contracts (EARS-2).

## UI composition

### Academy (canvas, Stage A pending)

Canvas `design-source/academy-apply.dc.html`, switch «Объём» = «срез 1», and the «Экспертам» entries of `design-source/academy-home.dc.html`.

| State           | Canvas branch                              | Notes                                                                                                         |
| --------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `page`          | hero, «Что будет дальше», «Условия автора» | slice-1 path: administrator, then programme, production, medical expertise, publication; no producer sentence |
| `gate`          | guest                                      | account gate in place of the form (EARS-3)                                                                    |
| `form`          | «заполнено» / empty                        | «Отправите как», fields, required tags, consent row (EARS-4, EARS-6)                                          |
| `form-errors`   | attempted                                  | inline errors, consent error (EARS-5)                                                                         |
| `network-error` | «сбой сети»                                | banner + «Попробовать ещё раз» (EARS-8)                                                                       |
| `sent`          | `scr = sent`                               | «Заявка отправлена», «Пока ждёте — посмотрите», «Отправить ещё одну заявку» (EARS-9, EARS-21)                 |
| `repeat`        | `repV = on`                                | «Ваша предыдущая заявка в работе…» (EARS-10)                                                                  |
| `not-ready`     | «Пока не готовы?»                          | projects link + first catalog card; no expert card in slice 1 (EARS-21)                                       |

The specialty select lists the whole `specialties_minzdrav` book (the canvas shows a sample of five) with search, from `@ds/design-system` `Combobox`; «Другое» stays the last option.

### Admin (approved-non-canvas)

| State                | Composition                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `applications-list`  | «Заявки»: `AdminDataList` — «Вид», «Получена», «Заявитель», «Тема / компания», «Статус»; filters «Вид» (Все / Авторы / Партнёрство / …) and «Статус» (Новые / На рассмотрении / Закрытые); marks «Команда не уведомлена», «Персональные данные стёрты» |
| `application-detail` | sent fields with labels; applicant card (account name, email, phone, or the given contact); consent purpose / version / time; notice outcomes; «Взять в работу», «Закрыть» (dialog with «Принята» / «Отклонена»); notes list + «Добавить заметку»      |
| `application-erase`  | «Стереть персональные данные заявителя» → confirm dialog naming what is erased and what stays                                                                                                                                                          |
| `stale`              | `412` → reload notice, nothing changed                                                                                                                                                                                                                 |

## Dependencies

- **030 #3505** (public catalog read) — merged; EARS-21 reads it.
- **030 #3506** (shared project card, `/projects`) — the «Project links of the page» package (#4033) is `blocked_by` #3506: the card and its target page must exist before the page links to them.
- **030 #3506 / #3507 edges on #1802** — 030 blocked its catalog and project-page packages on this parent so no link points at a missing `/apply`. Kept on the parent they would deadlock with the project-links package (which waits for #3506 and must close before #1802 does); they are rewired to the «Подать заявку» page Issue #4031, the precise prerequisite.
- **034 #1824** — `blocked_by` the queue-core Issue #4028 (034 slice 1 adds its kind to the queue).
- **003 / 021** sign-in and registration with a return target, **bot protection** (`apps/api/src/bot-protection/`), the **mailer** chain, **047** admin access, **010** audit, **`specialties_minzdrav`** — on `main`, no edge.

## Delivery slices

1. **Queue core** (EARS-6, 7, 20) — schema, migration, kinds table, author intake, consent, idempotency, bot protection, erasure handler and purge, the ADR-0009 matrix rows. Head.
2. **Notifications** (EARS-11, 12) — after core.
3. **Admin queue** (EARS-13…17) — after core.
4. **«Подать заявку» page** (EARS-1…5, 8, 9, 10, 22) — after core; creates `packages/applications`.
5. **Interim partnership form into the queue** (EARS-18, 19) — after core.
6. **Project links of the page** (EARS-21) — after the page and 030 #3506.
7. **Browser journeys** (V-9, V-10, V-11, V-13) — integration, after 2, 3, 4.

## Lead decisions

The PRD's _agent-proposed — UNCONFIRMED_ items, specified as the PRD writes them, plus the design choices made here:

1. **Sign-in before the form** (US-2): the guest sees the account gate, never a fillable form; the draft across sign-in is the later slice (EARS-3).
2. **Repeat applications** (US-7): an expert with an open application sees «Ваша предыдущая заявка в работе. Новую можно отправить, если это другой проект.» and can send another; no limit in slice 1 (EARS-10).
3. **Double submission** (Flows): one idempotency key per form instance, the button disabled in flight, retry reuses the key; the server returns the stored result on replay (EARS-7, EARS-8).
4. **Statuses** (US-11): `new → in_review → closed` with `new → closed` allowed, outcome `accepted` / `declined` required at close, closed final in slice 1 (EARS-15).
5. **Notes** (US-11): append-only, internal, never on an applicant read or email (EARS-16).
6. **Attribution** (product AC): status changes store the actor and time on the row and in the 010 audit (EARS-15, EARS-17).
7. **Consent** (US-8, lead-asserted 152-ФЗ constraint): separate purpose `author-application-personal-data`, recorded in `consent_records` in the intake transaction (046 precedent) (EARS-6).
8. **Team-notification channel** (US-12): email through the platform's existing mailer chain to a configured team list — a channel the platform already runs, no new external egress (ADR-0011 not engaged); the email carries no personal data beyond the subject line and links to the admin (EARS-11).
9. **Notification failures**: one attempt after commit through the chain's provider failover, outcome recorded and marked in the list; no outbox or scheduler (congress precedent) (EARS-11, EARS-12).
10. **Bot protection on both intakes**: the signed-in author intake is `@BotProtected` too, so «every public intake» holds without a per-kind exception (EARS-7, EARS-18).
11. **Applicant read**: open author applications only, each «received»; a closed one disappears from the banner, because the slice shows no outcome to the applicant (EARS-10).
12. **Field bounds and optionality** follow the canvas: «Тема» and «Формат» required, «Специальность» and «О себе» optional; formats «курс-сериал», «отдельный урок», «подкаст», «выступление» (EARS-4).
13. **Specialty** = the whole Минздрав book with search plus «Другое» with its text (EARS-4, EARS-7).
14. **Route** `academy.doctor.school/apply` (EARS-1, EARS-2).
15. **Interim form kept on the home and re-pointed** at the queue (kind `partnership`); its look does not change; the stored files are imported once and the volume removed after the owner's go (EARS-18, EARS-19).
16. **Retention**: applications kept while open and one year after closing, then erased to a tombstone by a daily purge; erasure on request by an administrator action (EARS-20).
17. **Applicant contact is read live** from the account, not copied, so account edits and account erasure reach the queue (EARS-14, EARS-20).
18. **Project links ship as their own package** after 030 #3506 so neither feature ships a link to a missing page; the 030 edges are rewired from #1802 to the page Issue (Dependencies).
