---
title: "DS Platform — PD Lifecycle, Consent, Retention, Erasure design [RU]"
description: "1. Three erasure levels chosen per table: hard delete / tombstone / crypto-shred. Выбор фиксируется в retention matrix (§3) + CI lint. 2. Per-subject..."
lang: ru
---

> **EN:** [`0009-pd-lifecycle-and-consent-design-en.md`](./0009-pd-lifecycle-and-consent-design-en.md) · **RU (this)**

# DS Platform — PD Lifecycle, Consent, Retention, Erasure design

**Дата:** 2026-05-18
**Мастер:** репозиторий → `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-ru.md`
**Автор:** Tech Lead Сидоров
**Связан с:** Plane DSO-63 finding #5 + #6, milestone DSO-24
**Наследует:** ADR-0001 (identity / users / audit), ADR-0003 (Postgres + audit_ledger + pgvector), ADR-0007 (AI zone), ADR-0009 (PD lifecycle ADR — этот spec — его реализация)
**Входы:** `_validation-pack-2026-05-18/ds-platform-architecture-review.md` (Claude — High findings #5/#6), `outputs/2026-05-18-ds-platform-external-validation-findings.md`
**Выход:** Implementation contract для backend + admin + AI-zone subscriber для consent/erasure/retention. Закрывает `engineering-readiness §5` BLOCKER «data subject rights endpoints» + `data-layer-design §2.5 OQ-D3`.

---

## 0. TL;DR

1. **Three erasure levels** chosen per table: hard delete / tombstone / crypto-shred. Выбор фиксируется в retention matrix (§3) + CI lint.
2. **Per-subject crypto-shred** для audit_ledger + backups + AI-zone embeddings. Ключи в Vault на отдельной VM. Erasure SLA — 30 дней.
3. **Consent versioning** — `consent_versions` + append-only `consent_acceptances` + `consent_withdrawals`. Каждое изменение текста = новая версия; пользователь prompted при следующем логине.
4. **Data subject rights endpoints** под `/me/*` — обязательная часть pre-pilot. `data-export` async (signed link, ≤7d). `erasure-request` async (≤30d).
5. **Retention matrix** в `packages/db/schema/pd/retention.ts` как TS-объект → читается миграциями + CI + admin UI. Single source of truth.
6. **Cross-zone propagation:** erasure request → outbox event → AI-zone subscriber удаляет embeddings/corpus entries (см. ADR-0011 §3).
7. **Что НЕ в scope этого spec'а:** конкретный legal text для consent v1 (готовит юрист в составе DSO-X2), точное UX consent screens (frontend track), final SLA для data-export если объём окажется ≥X MB (измеряем в pilot).

---

## 1. Scope и non-goals

### В scope

- Схема таблиц `consent_*`, `data_export_requests`, `erasure_requests` + миграции.
- API endpoints под `/me/*` (NestJS controllers, Zod-схемы запросов/ответов).
- Retention matrix как code (TS) + CI validator (`drizzle-kit check` + custom lint).
- Erasure execution flow (sync vs async, audit, ack).
- Per-subject crypto-shred реализация: ключ-менеджмент (Vault или sealed master-key), encryption at-rest на критичных полях, key zeroization протокол.
- Cross-zone erasure propagation (outbox contract, см. ADR-0011 §3).
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
| `marketing_communications` | Все marketing channels off, marketing PD удаляется через 90d                                                               |
| `research_anonymized`      | Прекращение использования в новых R&D batch'ах; уже-обученные модели не переобучаются (анонимизация считается достаточной) |

---

## 3. Retention matrix

**Master location:** `packages/db/schema/pd/retention.ts` (TS объект, читается миграциями + CI + admin UI).

**Полный список таблиц с PD pre-pilot.** Каждая строка fixates: legal basis, retention, erasure level, audit exception, owner.

|   # | Table                                   | Fields with PD                          | Legal basis                                                    | Retention                           | Erasure level                                         | Audit exception                 | Owner           |
| --: | --------------------------------------- | --------------------------------------- | -------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------- | ------------------------------- | --------------- |
|   1 | `users`                                 | email, phone, name, dob, photo_url      | 152-ФЗ ст. 6 п. 1 / consent (`tos`, `medical_data_processing`) | active + 3y after deactivation      | hard delete + tombstone в FK-зависимых таблицах       | none                            | Legal/CTO       |
|   2 | `user_profiles_medical`                 | specialty, license_no, regalia          | 152-ФЗ ст. 10 (special category)                               | active + 3y                         | hard delete + tombstone                               | none                            | Legal/CTO       |
|   3 | `consent_versions`                      | body_markdown                           | — (системные данные)                                           | indefinite                          | not deleted                                           | n/a                             | Legal/CTO       |
|   4 | `consent_acceptances`                   | subject_id, ip, ua                      | 152-ФЗ доказательство                                          | 5y after withdrawal                 | tombstone (subject_id encrypted with key zeroization) | proof retained                  | Legal/CTO       |
|   5 | `consent_withdrawals`                   | subject_id, channel                     | 152-ФЗ доказательство                                          | 5y                                  | tombstone                                             | proof retained                  | Legal/CTO       |
|   6 | `audit_ledger`                          | subject_id, ip, ua, payload_hash        | 152-ФЗ + НК РФ + medical                                       | 5y                                  | crypto-shred at term                                  | retain hash-chain               | Legal/CTO       |
|   7 | `data_export_requests`                  | subject_id, signed_link_id              | operational                                                    | 90d after fulfillment               | hard delete + audit row                               | none                            | Backend/SRE     |
|   8 | `erasure_requests`                      | subject_id, status, legal_note          | operational + 152-ФЗ доказательство                            | 5y                                  | tombstone (subject_id encrypted)                      | proof retained                  | Legal/CTO       |
|   9 | `sessions` (если IdP shared)            | subject_id, ua                          | technical                                                      | 30d after expiry                    | hard delete                                           | none                            | IdP / Backend   |
|  10 | `payments` (если применимо в pre-pilot) | subject_id, amount, invoice_no          | НК РФ ст. 23                                                   | 5y after transaction                | no deletion                                           | full retention                  | Finance         |
|  11 | `webinar_attendance`                    | subject_id, event_id, presence_minutes  | NMO compliance                                                 | 3y                                  | tombstone                                             | retain attendance proof         | NMO/Legal       |
|  12 | `nmo_credit_issuance`                   | subject_id, event_id, credit_id         | NMO compliance + Минздрав reporting                            | 5y                                  | no deletion                                           | full retention                  | NMO/Legal       |
|  13 | `course_enrollments`                    | subject_id, course_id, completion_date  | medical_data_processing                                        | active + 3y after course completion | tombstone                                             | retain completion proof for NMO | NMO/Legal       |
|  14 | `quiz_attempts`                         | subject_id, course_id, answers, score   | derived from medical_data_processing                           | active + 3y                         | tombstone (answers crypto-shred)                      | retain pass/fail proof          | NMO/Legal       |
|  15 | `marketing_consent`                     | subject_id, channel, opt_in_at          | consent (`marketing_communications`)                           | until withdrawn + 90d               | hard delete                                           | retain proof of revocation      | Marketing/Legal |
|  16 | `marketing_events`                      | subject_id, event_type, sent_at         | consent                                                        | until withdrawn + 90d               | hard delete                                           | n/a                             | Marketing       |
|  17 | `embeddings` (AI-zone)                  | derived from content + subject behavior | derivative                                                     | recomputable                        | recompute or delete via outbox                        | n/a                             | AI lead         |
|  18 | `prompt_eval_corpus` (AI-zone)          | sanitized prompts + responses           | consent (`research_anonymized`) если PD remains                | per-corpus consent                  | delete via outbox                                     | n/a                             | AI lead         |
|  19 | `support_tickets` (если применимо)      | subject_id, raw_text                    | operational (legitimate interest)                              | 1y after resolution                 | hard delete + tombstone                               | none                            | Support/Legal   |

**Mutability:** Этот список — living. Любая новая таблица с PD требует строку в retention matrix **до** merge миграции (CI gate, см. §7).

---

## 4. Schemas (DDL outline)

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
    subject_id_encrypted: bytea("subject_id_encrypted").notNull(), // encrypted with per-subject key
    consent_version_id: uuid("consent_version_id")
      .notNull()
      .references(() => consentVersions.id),
    accepted_at: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ip_encrypted: bytea("ip_encrypted"),
    user_agent_encrypted: bytea("user_agent_encrypted"),
    channel: text("channel").notNull(), // 'web', 'mobile', 'admin-import', 'directual-migration'
    tombstone_at: timestamp("tombstone_at", { withTimezone: true }), // set on erasure
  },
  (t) => ({
    idxVersion: index().on(t.consent_version_id),
  }),
);
```

Append-only. `subject_id` ищется через `bytea` + per-subject key (см. §5).

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
  tombstone_at: timestamp("tombstone_at", { withTimezone: true }),
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
  status: text("status").notNull().default("pending"), // 'pending' | 'building' | 'ready' | 'fulfilled' | 'failed'
  failure_reason: text("failure_reason"),
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
  // 'pending' | 'review_required' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed'
  reviewed_by: uuid("reviewed_by"),
  reviewed_at: timestamp("reviewed_at", { withTimezone: true }),
  legal_note: text("legal_note"), // legal hold reason if rejected
  executed_at: timestamp("executed_at", { withTimezone: true }),
  key_zeroized_at: timestamp("key_zeroized_at", { withTimezone: true }),
  tombstone_at: timestamp("tombstone_at", { withTimezone: true }), // for self-tombstoning after 5y
});
```

---

## 5. Key management (per-subject keys)

### 5.1 Архитектура

- **Master KEK** (Key Encryption Key) — хранится в Vault на отдельной VM (Hashicorp Vault или Vault-light).
- **Per-subject DEK** (Data Encryption Key) — генерируется при создании subject; зашифрован KEK; хранится в `subject_keys` table в Postgres.
- **Шифрование PD-полей** в `bytea` columns — symmetric encryption (AES-256-GCM) с DEK.
- **Erasure** = destroy DEK in `subject_keys` (set to NULL or DELETE row). Encrypted blobs остаются нечитаемыми.

### 5.2 `subject_keys` table

```ts
export const subjectKeys = pgTable("subject_keys", {
  subject_id: uuid("subject_id").primaryKey(),
  dek_encrypted: bytea("dek_encrypted"), // DEK encrypted by KEK from Vault; NULL after erasure
  created_at: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  zeroized_at: timestamp("zeroized_at", { withTimezone: true }),
  zeroization_reason: text("zeroization_reason"), // 'erasure_request', 'admin_action', 'compliance'
});
```

### 5.3 Why этот pattern (а не alternative)

- **Postgres pgcrypto под master-key (simpler альтернатива):** требует доступа к master-key для каждой read-операции. Если master-key хранится в env-var → доступен всем процессам, включая ML-задачи. Без isolation.
- **Vault per-subject DEK (chosen):** Vault кэширует DEK на короткое окно, после revoke DEK становится недоступным. Erasure = revoke в Vault. Backup рисов нет — backup содержит только encrypted blobs, без ключа.
- **OQ-PD-1 (открытый):** Hashicorp Vault dedicated VM vs Postgres + sealed master-key в startup (Vault-light). Решается при IdP-spike (если IdP-хост уже несёт Vault, переиспользуем; иначе — light pattern для pre-pilot, full Vault при scale).

### 5.4 Backup erasure через key zeroization

- Backup snapshot содержит `subject_keys` table + encrypted PD.
- Если DEK для subject S зануляется (erasure), новые backup snapshots не содержат DEK.
- **Старые backup snapshots до erasure** — содержат DEK. Compensating control: KEK rotated quarterly + старые KEK уничтожаются по retention rotation. Через ≤90d (offsite retention) старые backups имеют unreadable DEK → de facto erasure.
- **SLA 30d compatible:** crypto-shred в live DB и primary backup — immediate (within hours of request). Offsite backup — within rotation window. Acceptable per 152-ФЗ ст. 14 (30d).

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

- Hard-delete: rows from tables with `erasure: 'hard_delete'`.
- Tombstone: NULL/replace PD fields in tables with `erasure: 'tombstone'`. Encrypt subject_id via DEK.
- Crypto-shred: zeroize DEK in `subject_keys`. All encrypted blobs become unreadable.
- Emit outbox event `erasure.subject_purged.v1` (см. ADR-0011 §3).

5. **AI-zone subscriber** (cross-zone):

- Receives outbox event.
- Deletes `embeddings` rows for subject.
- Removes subject from `prompt_eval_corpus`.
- Acks completion → recorded in `erasure_requests.ai_zone_acked_at`.

6. **Backup erasure** (deferred — happens organically on rotation):

- Primary: within 30d (current rotation window).
- Offsite: within 90d.
- Both: cryptographically erased immediately via DEK zeroization.

7. **Completion**:

- Status → `'completed'`. `executed_at`, `key_zeroized_at`, `ai_zone_acked_at` filled.
- Audit log entry.
- Optional: send confirmation email (if subject still reachable).

---

## 8. Cross-zone erasure propagation

См. **ADR-0011 §3 (Egress control plane)** для полного контракта. Краткий вид:

- **Outbox event schema** (`erasure.subject_purged.v1`):
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
- Deletes matching rows.
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

Access control: только роль `pd_officer` (новая, см. ADR-0001 amendment когда подвезём).

---

## 10. CI gates / migration validation

**Custom lint** в `tools/lint-retention.ts`:

1. Каждая колонка `bytea` / `text` в таблице, расположенной в `packages/db/schema/`, должна быть либо классифицирована в `retention.ts`, либо иметь explicit `@no-pd` annotation в Drizzle schema.
2. Каждая new table в migration без entry в `retention.ts` → CI fail.
3. Каждое поле с PD должно иметь корректный erasure level из {hard_delete, tombstone, crypto_shred}.
4. `consent_*` таблицы не должны иметь `UPDATE` / `DELETE` migrations — только `INSERT` + tombstoning через separate column.

**Red-team тесты** (`tests/red-team/pd-leakage.test.ts`):

- Регистрация test subject с unique-PD строкой.
- Trigger erasure.
- Проверка: PD строка не появляется в SELECT'ах + не появляется в audit_ledger raw output + не появляется в логах + не появляется в metrics endpoint + не появляется в ai-zone-subscriber-test fixture.

---

## 11. Деплой и операции

- **Phase 0 (до first user):** Vault-light pattern (sealed master-key в systemd-credential, KEK хранится в env). DEK в Postgres.
- **Phase 1 (pre-pilot):** Vault-light → Vault-full при наличии IdP-Vault interop (DSO-25 spike).
- **Quarterly:** KEK rotation. Старые KEK уничтожаются по rotation policy.
- **Backup procedure:** см. ADR-0009 §2.5 + data-layer-design §2.4. Vault keys backup отдельно (offline cold storage).

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
