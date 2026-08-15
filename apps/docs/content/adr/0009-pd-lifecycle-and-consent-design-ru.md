---
title: "DS Platform — PD Lifecycle, Consent, Retention, Erasure design [RU]"
description: "1. Domain rows сохраняются по soft-delete lifecycle ADR-0003; PD стираются через value erasure, tombstone и crypto-shred. Policy фиксируется..."
lang: ru
---

> **EN:** [`0009-pd-lifecycle-and-consent-design-en.md`](./0009-pd-lifecycle-and-consent-design-en.md) · **RU (this)**

# DS Platform — PD Lifecycle, Consent, Retention, Erasure design

**Дата:** 2026-05-18
**Мастер:** репозиторий → `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-ru.md`
**Автор:** Tech Lead
**Связан с:** Plane DSO-63 finding #5 + #6, milestone DSO-24
**Наследует:** ADR-0001 (identity / users / audit), ADR-0003 (Postgres + audit_ledger + pgvector), ADR-0007 (AI zone), ADR-0009 (PD lifecycle ADR — этот spec — его реализация)
**Входы:** `_validation-pack-2026-05-18/ds-platform-architecture-review.md` (Claude — High findings #5/#6), `outputs/2026-05-18-ds-platform-external-validation-findings.md`
**Выход:** Implementation contract для backend + admin + AI-zone subscriber для consent/erasure/retention. Закрывает `engineering-readiness §5` BLOCKER «data subject rights endpoints» + `data-layer-design §2.5 OQ-D3`.

---

## 0. TL;DR

1. **Retained-row erasure:** физическое удаление каждой application-owned строки Postgres запрещено; каждое поддерживаемое удаление или истечение следует lifecycle ADR-0003 с `status` + `deleted_at`, а immutable/append-only строки сохраняются. PD стираются через value erasure / tombstone / crypto-shred.
2. **Purpose-separated crypto-shred:** общий per-subject DEK уничтожается при erasure; каждая строка `audit_ledger` использует отдельный retention DEK, живущий только законный срок. Ключи находятся в Vault вне database backups. Erasure SLA для неисключённых PD — 30 дней.
3. **Consent versioning** — `consent_versions` + append-only `consent_acceptances` + `consent_withdrawals`. Каждое изменение текста = новая версия; пользователь prompted при следующем логине.
4. **Data subject rights endpoints** под `/me/*` — обязательная часть pre-pilot. `data-export` async (signed link, ≤7d). `erasure-request` async (≤30d).
5. **Retention matrix** в `packages/db/schema/pd/retention.ts` как TS-объект → читается миграциями + CI + admin UI. Single source of truth.
6. **Cross-zone propagation:** erasure request → outbox event → AI-zone subscriber стирает embedding/corpus payload и сохраняет tombstones (см. ADR-0011 §2.5).
7. **Что НЕ в scope этого spec'а:** конкретный legal text для consent v1 (готовит юрист в составе DSO-X2), точное UX consent screens (frontend track), final SLA для data-export если объём окажется ≥X MB (измеряем в pilot).

---

## 1. Scope и non-goals

### В scope

- Схема таблиц `consent_*`, `data_export_requests`, `erasure_requests` + миграции.
- API endpoints под `/me/*` (NestJS controllers, Zod-схемы запросов/ответов).
- Retention matrix как code (TS) + CI validator (`drizzle-kit check` + custom lint).
- Erasure execution flow (sync vs async, audit, ack).
- Purpose-separated crypto-shred: общие per-subject ключи, отдельные per-audit-row retention keys, encryption at-rest критичных полей и key-zeroization protocol.
- Cross-zone erasure propagation (outbox contract, см. ADR-0011 §2.5).
- Admin UI слой (queue + actions).
- Backup erasure procedure (cron + Vault key zeroization).

### Не в scope

- Конкретный текст consent v1 (legal track, DSO-X2).
- UX-дизайн consent screens (frontend track).
- РКН-уведомление и Privacy Notice (legal track, DSO-X2 — спек служит входом).
- Legal hold workflow (отложен — нет требования pre-pilot).
- GDPR-совместимость (DS Platform — RF-only; если выйдет на EU, отдельный ADR).

---

## 2. Consent model

### 2.1 Per-purpose consent

Consent — **per-purpose**, не all-in-one. Purposes для pre-pilot:

| Code                       | Description                                                            | Required для                  |
| -------------------------- | ---------------------------------------------------------------------- | ----------------------------- |
| `tos`                      | Terms of service + privacy notice (152-ФЗ ст. 9 минимум)               | любое использование платформы |
| `medical_data_processing`  | Обработка медицинских данных (special category PD, 152-ФЗ ст. 10)      | регистрация как врача         |
| `nmo_credit_issuance`      | Выдача NMO баллов и передача в Минздрав / РЗН аккредитационные системы | участие в accredited событиях |
| `marketing_communications` | Promo email/SMS, события партнёров                                     | opt-in, не required           |
| `research_anonymized`      | Использование анонимизированных данных в R&D, ML training              | opt-in, не required           |

`tos` + `medical_data_processing` — обязательны при регистрации (block-signup до acceptance). Остальные — opt-in.

### 2.2 Consent versions

Каждый `purpose` имеет свою версионную ленту:

```
purpose = "tos"
  v1 (effective 2026-06-01) — initial version
  v2 (effective 2026-09-15) — обновлены пункты Privacy Notice + retention matrix
```

При acceptance v2 пользователь даёт явное согласие; **previous v1 acceptance не считается** для action'ов, требующих v2.

### 2.3 Withdrawal cascade

Withdrawal — отзыв активного согласия. Cascading effects:

| Purpose withdrawn          | Effect                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `tos`                      | User deactivated (account suspended) + erasure offered (no auto-delete)                                                    |
| `medical_data_processing`  | Access to medical content revoked; profile retained pending erasure decision                                               |
| `nmo_credit_issuance`      | Future credit issuance blocked; past credits retained (legal retention 3y)                                                 |
| `marketing_communications` | Все marketing channels off, marketing PD стираются через 90d, lifecycle-tombstones сохраняются                             |
| `research_anonymized`      | Прекращение использования в новых R&D batch'ах; уже-обученные модели не переобучаются (анонимизация считается достаточной) |

---

## 3. Retention matrix

**Master location:** `packages/db/schema/pd/retention.ts` (TS объект, читается миграциями + CI + admin UI).

**Полный список таблиц с PD pre-pilot.** Каждая строка fixates: legal basis, retention, retained-row erasure mechanism, audit exception, owner. Soft-deletable доменные строки также имеют lifecycle `status` + `deleted_at` по ADR-0003 design §3.6; механизмы можно комбинировать.

|   # | Table                                   | Fields with PD                          | Legal basis                                                    | Retention                           | Retained-row erasure mechanism              | Audit exception                 | Owner           |
| --: | --------------------------------------- | --------------------------------------- | -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- | ------------------------------- | --------------- |
|   1 | `users`                                 | email, phone, name, dob, photo_url      | 152-ФЗ ст. 6 п. 1 / consent (`tos`, `medical_data_processing`) | active + 3y after deactivation      | value erasure + tombstone                   | none                            | Legal/CTO       |
|   2 | `user_profiles_medical`                 | specialty, license_no, regalia          | 152-ФЗ ст. 10 (special category)                               | active + 3y                         | value erasure + tombstone                   | none                            | Legal/CTO       |
|   3 | `consent_versions`                      | body_markdown                           | — (системные данные)                                           | indefinite                          | retained unchanged                          | n/a                             | Legal/CTO       |
|   4 | `consent_acceptances`                   | subject_id, ip, ua                      | 152-ФЗ доказательство                                          | 5y after withdrawal                 | immutable row; subject-link crypto-shred    | proof retained                  | Legal/CTO       |
|   5 | `consent_withdrawals`                   | subject_id, channel                     | 152-ФЗ доказательство                                          | 5y                                  | immutable row; subject-link crypto-shred    | proof retained                  | Legal/CTO       |
|   6 | `audit_ledger`                          | subject_id, ip, ua, payload_hash        | 152-ФЗ + НК РФ + medical                                       | 5y                                  | crypto-shred at term; retain hash-chain row | retain hash-chain               | Legal/CTO       |
|   7 | `data_export_requests`                  | subject_id, signed_link_id              | operational                                                    | 90d after fulfillment               | value erasure + tombstone                   | none                            | Backend/SRE     |
|   8 | `erasure_requests`                      | subject_id, status, legal_note          | operational + 152-ФЗ доказательство                            | 5y                                  | tombstone + subject-link crypto-shred       | proof retained                  | Legal/CTO       |
|   9 | `sessions` (если IdP shared)            | subject_id, ua                          | technical                                                      | 30d after expiry                    | IdP operational expiry; не domain entity    | none                            | IdP / Backend   |
|  10 | `payments` (если применимо в pre-pilot) | subject_id, amount, invoice_no          | НК РФ ст. 23                                                   | 5y after transaction                | retain; crypto-shred PD at term             | full retention                  | Finance         |
|  11 | `webinar_attendance`                    | subject_id, event_id, presence_minutes  | NMO compliance                                                 | 3y                                  | tombstone + subject-link crypto-shred       | retain attendance proof         | NMO/Legal       |
|  12 | `nmo_credit_issuance`                   | subject_id, event_id, credit_id         | NMO compliance + Минздрав reporting                            | 5y                                  | retain; crypto-shred PD at term             | full retention                  | NMO/Legal       |
|  13 | `course_enrollments`                    | subject_id, course_id, completion_date  | medical_data_processing                                        | active + 3y after course completion | tombstone + subject-link crypto-shred       | retain completion proof for NMO | NMO/Legal       |
|  14 | `quiz_attempts`                         | subject_id, course_id, answers, score   | derived from medical_data_processing                           | active + 3y                         | tombstone + answer/subject crypto-shred     | retain pass/fail proof          | NMO/Legal       |
|  15 | `marketing_consent`                     | subject_id, channel, opt_in_at          | consent (`marketing_communications`)                           | until withdrawn + 90d               | value erasure + tombstone                   | retain proof of revocation      | Marketing/Legal |
|  16 | `marketing_events`                      | subject_id, event_type, sent_at         | consent                                                        | until withdrawn + 90d               | value erasure + tombstone                   | n/a                             | Marketing       |
|  17 | `embeddings` (AI-zone)                  | derived from content + subject behavior | derivative                                                     | recomputable                        | erase vector/payload + tombstone via outbox | n/a                             | AI lead         |
|  18 | `prompt_eval_corpus` (AI-zone)          | sanitized prompts + responses           | consent (`research_anonymized`) если PD remains                | per-corpus consent                  | erase payload + tombstone via outbox        | n/a                             | AI lead         |
|  19 | `support_tickets` (если применимо)      | subject_id, raw_text                    | operational (legitimate interest)                              | 1y after resolution                 | value erasure + tombstone                   | none                            | Support/Legal   |

**Mutability:** Этот список — living. Любая новая таблица с PD требует строку в retention matrix **до** merge миграции (CI gate, см. §7).

---

## 4. Schemas (DDL outline)

Каждая soft-deletable доменная сущность и строка связи дополнительно имеет доменный lifecycle `status` и nullable `deleted_at` по ADR-0003 design §3.6. Immutable/append-only записи явно не поддерживают удаление и стираются только через свой payload/key-контракт. Snippets ниже показывают поля, относящиеся к этому ADR; legacy `tombstone_at` на soft-deletable request records стандартизирован как `deleted_at`.

Drizzle-схемы (TS). Не полный DDL — выжимка с ключевыми полями. Полные миграции — в `packages/db/migrations/` после bootstrap.

### 4.1 `consent_versions`

```ts
export const consentVersions = pgTable(
  "consent_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    purpose: text("purpose").notNull(), // 'tos' | 'medical_data_processing' | ...
    version_tag: text("version_tag").notNull(), // 'v1', 'v2'
    locale: text("locale").notNull(), // 'ru', 'en'
    body_markdown: text("body_markdown").notNull(),
    effective_from: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    sha256: text("sha256").notNull(), // hash of body for integrity
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uniqPurposeVer: unique().on(t.purpose, t.version_tag, t.locale),
  }),
);
```

Immutable: no UPDATE, no DELETE. Newer version supersedes via `effective_from`.

### 4.2 `consent_acceptances`

```ts
export const consentAcceptances = pgTable(
  "consent_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subject_id_encrypted: bytea("subject_id_encrypted").notNull(), // encrypted with general per-subject key
    consent_version_id: uuid("consent_version_id")
      .notNull()
      .references(() => consentVersions.id),
    accepted_at: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ip_encrypted: bytea("ip_encrypted"),
    user_agent_encrypted: bytea("user_agent_encrypted"),
    channel: text("channel").notNull(), // 'web', 'mobile', 'admin-import', 'directual-migration'
  },
  (t) => ({
    idxVersion: index().on(t.consent_version_id),
  }),
);
```

Append-only. `subject_id` ищется через `bytea` + общий per-subject key (см. §5).

### 4.3 `consent_withdrawals`

```ts
export const consentWithdrawals = pgTable("consent_withdrawals", {
  id: uuid("id").defaultRandom().primaryKey(),
  subject_id_encrypted: bytea("subject_id_encrypted").notNull(),
  consent_version_id: uuid("consent_version_id")
    .notNull()
    .references(() => consentVersions.id),
  purpose: text("purpose").notNull(), // denormalized for fast filtering
  withdrawn_at: timestamp("withdrawn_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  channel: text("channel").notNull(),
});
```

### 4.4 `data_export_requests`

```ts
export const dataExportRequests = pgTable("data_export_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  subject_id: uuid("subject_id").notNull(), // not encrypted — operational, retention 90d
  requested_at: timestamp("requested_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  fulfilled_at: timestamp("fulfilled_at", { withTimezone: true }),
  signed_link_id: text("signed_link_id"), // pointer to S3 object with signed URL
  status: text("status").notNull().default("pending"), // 'pending' | 'building' | 'ready' | 'fulfilled' | 'failed' | 'erased'
  failure_reason: text("failure_reason"),
  deleted_at: timestamp("deleted_at", { withTimezone: true }),
});
```

### 4.5 `erasure_requests`

```ts
export const erasureRequests = pgTable("erasure_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  subject_id_encrypted: bytea("subject_id_encrypted").notNull(),
  requested_at: timestamp("requested_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  status: text("status").notNull().default("pending"),
  // 'pending' | 'review_required' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'erased'
  reviewed_by: uuid("reviewed_by"),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  legal_note: text("legal_note"), // legal hold reason if rejected
  executed_at: timestamp("executed_at", { withTimezone: true }),
  general_key_zeroized_at: timestamp("general_key_zeroized_at", {
    withTimezone: true,
  }),
  deleted_at: timestamp("deleted_at", { withTimezone: true }), // for self-tombstoning after 5y
});
```

---

## 5. Key management (purpose-separated keys)

### 5.1 Архитектура

- **Key authority** — Vault на отдельной VM (Hashicorp Vault или Vault-light service с той же destroy-семантикой). Database backups содержат только opaque key references, но не пригодные DEK.
- **Общий per-subject DEK** — создаётся вместе с субъектом и защищает profile, consent, contact и derived subject PD. Postgres-таблица `subject_keys` хранит только Vault reference и сохраняемые lifecycle-метаданные.
- **Per-audit-row retention DEK** — создаётся для каждой строки `audit_ledger`, чьи identifying fields имеют законный срок хранения. Строка ссылается на один tombstone `audit_retention_keys`; этот ключ не может расшифровать никакие non-audit данные.
- **Шифрование PD-полей** в `bytea` columns — symmetric AES-256-GCM с purpose-scoped DEK.
- **Erasure** уничтожает общий DEK в Vault и помечает сохраняемую строку `subject_keys` как `zeroized`. Audit-ключ с законным исключением намеренно не затрагивается.
- **Окончание audit-срока** уничтожает retention DEK строки в Vault и помечает сохраняемую строку `audit_retention_keys` как `zeroized`; audit-ciphertext и hash-chain строка остаются нечитаемыми, но целыми.

### 5.2 `subject_keys` table

```ts
export const subjectKeys = pgTable("subject_keys", {
  subject_id: uuid("subject_id").primaryKey(),
  vault_key_ref: text("vault_key_ref"), // opaque Vault handle; NULL after zeroization
  status: text("status").notNull().default("active"), // 'active' | 'zeroized'
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  zeroized_at: timestamp("zeroized_at", { withTimezone: true }),
  zeroization_reason: text("zeroization_reason"), // 'erasure_request', 'admin_action', 'compliance'
});
```

Таблица не содержит DEK. Её строка сохраняется после zeroization, поэтому старый database snapshot не может воскресить key material, даже если в нём остался устаревший Vault reference.

### 5.3 Таблица `audit_retention_keys`

```ts
export const auditRetentionKeys = pgTable("audit_retention_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  vault_key_ref: text("vault_key_ref"), // opaque Vault handle; NULL after term zeroization
  status: text("status").notNull().default("active"), // 'active' | 'zeroized'
  retention_expires_at: timestamp("retention_expires_at", {
    withTimezone: true,
  }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  zeroized_at: timestamp("zeroized_at", { withTimezone: true }),
  zeroization_reason: text("zeroization_reason"), // 'retention_term' | 'legal_release'
});
```

Каждая identifying строка `audit_ledger` хранит restrictive FK `retention_key_id` на эту таблицу. Key-record не содержит subject identifier; зашифрованная audit-row — его единственный потребитель. Ни одна из строк не удаляется.

### 5.4 Why этот pattern (а не alternative)

- **Postgres pgcrypto под master-key (отвергнуто):** database snapshots содержали бы wrapped DEKs, а немедленное subject erasure конфликтовало бы с отдельным пятилетним audit-исключением.
- **Один per-subject key для всех purpose (отвергнуто):** его немедленная zeroization уничтожает читаемость законно хранимого audit; его сохранение оставляет читаемыми все остальные subject PD. Purpose separation обязательна.
- **Vault + общий subject DEK + per-row audit-retention DEK (выбрано):** revoke ограничен purpose, audit expiry точен для каждой строки, database backups содержат ciphertext и мёртвые references, а не key material.
- **OQ-PD-1 (открытый):** отдельная Hashicorp Vault VM или sealed Vault-light service. Любая реализация хранит ключи вне Postgres backup set и предоставляет irreversible destroy + сохраняемые zeroization metadata.

### 5.5 Backup erasure через key zeroization

- Database snapshot содержит ciphertext, metadata `subject_keys` / `audit_retention_keys` и opaque Vault references — но не пригодный DEK.
- Уничтожение общего subject key сразу делает неисключённые PD нечитаемыми в live database и любом старом database backup. Устаревший reference не восстанавливает уничтоженный Vault key.
- Audit-retention keys доступны только до `retention_expires_at` каждой строки; уничтожение ключа делает identifying ciphertext этой строки нечитаемым в live database и любом backup, сохраняя evidence-row.
- Vault restore до запуска key service обязан переиграть сохраняемый zeroization ledger; уничтоженная key version никогда не импортируется из cold snapshot. Quarterly restore drill проверяет это fail-closed свойство.
- **SLA 30d compatible:** неисключённые PD crypto-shred'ятся в течение часов после одобренного запроса. Исключение retention matrix следует записанному законному сроку, а не общему erasure-clock.

---

## 6. API endpoints

### 6.1 `GET /me/consent`

Response:

```json
{
  "active_consents": [
    {
      "purpose": "tos",
      "version_tag": "v2",
      "accepted_at": "2026-09-20T12:00:00Z"
    },
    {
      "purpose": "medical_data_processing",
      "version_tag": "v1",
      "accepted_at": "2026-06-15T10:30:00Z"
    },
    {
      "purpose": "marketing_communications",
      "version_tag": "v1",
      "withdrawn_at": "2026-08-01T09:00:00Z"
    }
  ],
  "pending_acceptance": [
    {
      "purpose": "tos",
      "version_tag": "v3",
      "effective_from": "2026-11-01T00:00:00Z",
      "body_markdown": "..."
    }
  ]
}
```

### 6.2 `POST /me/consent/accept`

Request:

```json
{ "purpose": "tos", "version_tag": "v3", "channel": "web" }
```

Response: 200 (acceptance recorded). Side-effect: insert into `consent_acceptances`.

### 6.3 `POST /me/consent/withdraw`

Request:

```json
{ "purpose": "marketing_communications" }
```

Response: 200. Side-effects: insert into `consent_withdrawals`, trigger cascade (см. §2.3).

### 6.4 `POST /me/data-export`

Request: empty body. Response 202 (accepted):

```json
{ "request_id": "...", "status": "pending", "estimated_at": "2026-05-25T..." }
```

Async build → email со signed link к S3 (TTL 48h).

### 6.5 `POST /me/erasure-request`

Request:

```json
{ "reason": "..." }
```

Response 202:

```json
{ "request_id": "...", "status": "pending", "expected_sla_days": 30 }
```

Async processing (см. §7).

### 6.6 `GET /me/audit-log`

Paged. Response per row:

```json
{
  "at": "2026-05-18T...",
  "actor": "self" | "admin" | "system",
  "action": "consent_accepted" | "profile_read" | "data_exported" | "erasure_requested",
  "details": "..."
}
```

> **Forward-ref (audit-классы):** дополнительный audit-класс `ai_dual_llm` (логирование Quarantined-call + Privileged-call в pair'е, с pseudonymized subject_id) — см. **ADR-0010** + `2026-05-18-ds-platform-dual-llm-pattern-design`. Класс `ai_processing` для consent type — см. ADR-0009 §2.1 (AI consent class).

---

## 7. Erasure execution flow

> **Forward-ref:** контракт BullMQ-задачи `erasure-execute` (payload Zod-схема, idempotency-key = `erasure_request_id`, retry/backoff/DLQ, classification = critical, queue `pd-lifecycle`, queue→worker привязка) — см. **`2026-05-18-ds-platform-bullmq-queue-contract-design`**.

1. **Request submitted** (UI → API). Row inserted into `erasure_requests` with `status = 'pending'`.
2. **Automated triage** (cron job, 1x/hour):

- If subject has legal hold / active payments / regulatory hold → status `'review_required'`, route to admin queue.
- Else status `'approved'`, immediately enqueue execution job.

3. **Manual review** (admin app):

- Operator reviews case in UI.
- Decides approve / reject / annotate. Reject requires legal_note.

4. **Execution job** (BullMQ, idempotent):

- Value erasure: NULL/replace PD fields in tables with `erasure: 'value_erasure'`; установить lifecycle status и `deleted_at`, не удаляя строку.
- Tombstone: сохранить минимальный неперсональный факт в таблицах с `erasure: 'tombstone'`; стереть или crypto-shred'ить subject-link.
- Crypto-shred: уничтожить общий subject DEK в Vault и пометить `subject_keys` как zeroized. Неисключённые encrypted blobs становятся нечитаемыми; активные `audit_retention_keys` остаются изолированы до своих сроков.
- Emit outbox event `erasure.subject_erased.v1` (см. ADR-0011 §2.5).

5. **AI-zone subscriber** (cross-zone):

- Receives outbox event.
- Стирает vector/payload values и soft-delete'ит строки `embeddings` субъекта.
- Стирает subject-bearing payloads и soft-delete'ит их строки `prompt_eval_corpus`.
- Acks completion → recorded in `erasure_requests.ai_zone_acked_at`.

6. **Backup erasure** (deferred — happens organically on rotation):

- Primary: within 30d (current rotation window).
- Offsite: within 90d.
- Both: неисключённые PD crypto-shred'ятся сразу через zeroization общего DEK; законно сохраняемый audit-ciphertext читается только через отдельный retention key до срока.

7. **Completion**:

- Status → `'completed'`. Заполняются `executed_at`, `general_key_zeroized_at`, `ai_zone_acked_at`; срок audit-retention key остаётся независимым.
- Audit log entry.
- Optional: send confirmation email (if subject still reachable).

---

## 8. Cross-zone erasure propagation

См. **ADR-0011 §2.5 (Egress control plane)** для полного контракта. Краткий вид:

- **Outbox event schema** (`erasure.subject_erased.v1`):
  ```json
  {
    "event_id": "uuid",
    "subject_id_hash": "sha256(subject_id || pepper)", // pseudonymous reference, не raw PD
    "purposes": ["medical_data_processing", ...],
    "requested_at": "2026-05-18T...",
    "approved_at": "2026-05-19T..."
  }
  ```
- **AI-zone subscriber:**
- Idempotent (deduplicates by event_id).
- Indexes embeddings by same `subject_id_hash`.
- Стирает matching vector/payload values и помечает строки soft-deleted.
- Emits ack event to RF-zone (separate outbox direction).
- **Sanitization:** event содержит pseudonymous hash, не raw PD. Allowed channel per ADR-0011 §2.
- **Audit:** каждый erasure event logged in both zones.

---

## 9. Admin UI (queue)

`admin.doctor.school` — секция «PD requests»:

- **Tab «Erasure requests»:** list view with status filter (pending / review_required / approved / executing / completed / failed). Per row: subject email (decrypted on-demand), requested_at, status, action buttons.
- **Detail view:** subject details (with re-auth challenge before decrypting PD), full audit log, legal hold flag, approve/reject buttons with legal_note input.
- **Tab «Data export requests»:** monitoring; ручное вмешательство только при `status = 'failed'`.
- **Tab «Consent versions»:** view + create new version (requires legal review checkbox before publishing).

Access control: только роль `pd_officer` (новая; ADR-0001 §1 RBAC catalog обновляется inline, когда DSO-26 возьмёт работу по consent / right-to-erasure).

---

## 10. CI gates / migration validation

**Custom lint** в `tools/lint-retention.ts`:

1. Каждая колонка `bytea` / `text` в таблице, расположенной в `packages/db/schema/`, должна быть либо классифицирована в `retention.ts`, либо иметь explicit `@no-pd` annotation в Drizzle schema.
2. Каждая new table в migration без entry в `retention.ts` → CI fail.
3. Каждое поле с PD должно иметь корректный retained-row erasure mechanism из {value_erasure, tombstone, crypto_shred, retain}.
4. Каждая application-owned таблица Postgres должна объявлять либо lifecycle `status` + nullable `deleted_at` для удаления/истечения, либо immutable/append-only контракт без поддержки удаления. Migrations, retention jobs и runtime repositories не должны использовать `DELETE`, `TRUNCATE`, data-bearing `DROP TABLE` / `DROP PARTITION` или `ON DELETE CASCADE`.
5. `consent_versions`, `consent_acceptances` и `consent_withdrawals` остаются append-only: без `UPDATE`/`DELETE`; subject identity стирается через zeroization общего ключа, на который ссылается `subject_keys`. Любая отдельно soft-deletable таблица consent-домена следует правилу 4.
6. Каждая identifying строка `audit_ledger` ссылается на одну сохраняемую строку `audit_retention_keys`; общий subject key запрещён для audit-ciphertext, а evidence и key-tombstone строки нельзя физически удалять.

**Red-team тесты** (`tests/red-team/pd-leakage.test.ts`):

- Регистрация test subject с unique-PD строкой.
- Trigger erasure.
- Проверка: marker исчезает из общих продуктовых SELECT'ов, логов, metrics и AI-zone fixture; raw output `audit_ledger` содержит только ciphertext. Ограниченная compliance-проекция расшифровывает audit-row до срока, а синтетическое истечение срока zeroize'ит отдельный retention key, после чего та же строка нечитаема без её удаления.

---

## 11. Деплой и операции

- **Phase 0 (до first user):** Vault-light service с sealed storage вне Postgres backup set; Postgres хранит только opaque key references.
- **Phase 1 (pre-pilot):** Vault-light → Vault-full при наличии IdP-Vault interop (DSO-25 spike).
- **Quarterly:** KEK rotation. Сначала активные general/audit DEK rewrap'ятся; старые версии KEK уничтожаются только после успешной проверки rewrap и zeroization ledger.
- **Backup procedure:** см. ADR-0009 §2.5 + data-layer-design §2.4. Vault keys backup'ятся отдельно; restore переигрывает сохраняемые zeroization tombstones до того, как key service начнёт обслуживать reads.

---

## 12. Open Questions

- **OQ-PD-1** (см. ADR-0009 §5): Vault-full vs Vault-light pattern. **Резолюция:** зависит от IdP-spike. Pre-pilot — Vault-light (acceptable risk per УЗ-3 spec, key access ограничен по network).
- **OQ-PD-2:** SLA data-export — async vs sync. **Резолюция:** async by default; sync только если subject данные ≤ 100 KB (estimated). Измеряем в pilot.
- **OQ-PD-3:** Granular consent per-purpose vs all-in-one. **Резолюция:** per-purpose (см. §2.1). Decided.
- **OQ-PD-4** (новый): consent capture flow для Directual cutover. Открыт — закроет DSO-X1.

---

## 13. Cross-references

- **ADR:** ADR-0009 (parent), ADR-0001 §134-141 (consent), ADR-0003 §6 (audit_ledger), ADR-0011 (egress).
- **Specs:** `data-layer-design §2.4` (backup), `engineering-readiness §5` (BLOCKER list).
- **Plane:** DSO-63 finding #5 + #6, DSO-X1 (Directual cutover), DSO-X2 (РКН + ФСТЭК-21).
- **Source:** `outputs/2026-05-18-ds-platform-external-validation-findings.md`.
- **Memory:** [[feedback_docs_as_ssot]], [[feedback_rf_blocked_services]].
