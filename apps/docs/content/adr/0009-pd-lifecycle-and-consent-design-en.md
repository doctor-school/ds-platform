---
title: "DS Platform — PD Lifecycle, Consent, Retention, Erasure design [EN]"
description: "1. Every application-owned Postgres row is retained under ADR-0003; PD is erased by value erasure, tombstoning and crypto-shred. Policy is..."
lang: en
---

> **RU:** [`0009-pd-lifecycle-and-consent-design-ru.md`](./0009-pd-lifecycle-and-consent-design-ru.md) · **EN (this)**

# DS Platform — PD Lifecycle, Consent, Retention, Erasure design

**Date:** 2026-05-18
**Master:** repository → `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-ru.md`
**Author:** Tech Lead
**Related to:** Plane DSO-63 findings #5 + #6, milestone DSO-24
**Inherits:** ADR-0001 (identity / users / audit), ADR-0003 (Postgres + audit_ledger + pgvector), ADR-0007 (AI zone), ADR-0009 (PD lifecycle ADR — this spec is its implementation)
**Inputs:** `_validation-pack-2026-05-18/ds-platform-architecture-review.md` (Claude — High findings #5/#6), `outputs/2026-05-18-ds-platform-external-validation-findings.md`
**Output:** Implementation contract for backend + admin + AI-zone subscriber. Closes `engineering-readiness §5` BLOCKER "data subject rights endpoints" + `data-layer-design §2.5 OQ-D3`.

---

## 0. TL;DR

1. **Retained-row erasure:** physical deletion of every application-owned Postgres row is forbidden; every supported removal or expiry follows ADR-0003's `status` + `deleted_at` lifecycle, while immutable/append-only rows remain retained. PD is erased through value erasure / tombstone / crypto-shred.
2. **Purpose-separated crypto-shred:** a general per-subject DEK is destroyed on erasure; each `audit_ledger` row uses a separate retention DEK that survives only its legal term. Keys live in Vault, outside database backups. Erasure SLA — 30 days for non-exempt PD.
3. **Consent versioning** — `consent_versions` + append-only `consent_acceptances` + `consent_withdrawals`. Every text change = new version; user is prompted on next login.
4. **Data subject rights endpoints** under `/me/*` — mandatory pre-pilot. `data-export` async (signed link, ≤7d). `erasure-request` async (≤30d).
5. **Retention matrix** in `packages/db/schema/pd/retention.ts` as a TS object — read by migrations + CI + admin UI. Single source of truth.
6. **Cross-zone propagation:** erasure request → outbox event → AI-zone subscriber erases embedding/corpus payloads and retains their tombstones (see ADR-0011 §2.5).
7. **Out of scope for this spec:** the actual legal text for consent v1 (drafted by lawyer under DSO-X2), exact UX of consent screens (frontend track), final data-export SLA if size turns out to be ≥X MB (measured in pilot).

---

## 1. Scope and non-goals

### In scope

- Schemas for `consent_*`, `data_export_requests`, `erasure_requests` + migrations.
- API endpoints under `/me/*` (NestJS controllers, Zod request/response schemas).
- Retention matrix as code (TS) + CI validator (`drizzle-kit check` + custom lint).
- Erasure execution flow (sync vs async, audit, ack).
- Purpose-separated crypto-shred: general per-subject keys, per-audit-row retention keys, at-rest encryption on critical fields, and key-zeroization protocol.
- Cross-zone erasure propagation (outbox contract, see ADR-0011 §2.5).
- Admin UI layer (queue + actions).
- Backup erasure procedure (cron + Vault key zeroization).

### Not in scope

- Actual text of consent v1 (legal track, DSO-X2).
- UX design of consent screens (frontend track).
- RKN notification & Privacy Notice (legal track, DSO-X2 — this spec is an input).
- Legal hold workflow (deferred — not required pre-pilot).
- GDPR compatibility (DS Platform is RF-only; if EU expansion happens, separate ADR).

---

## 2. Consent model

### 2.1 Per-purpose consent

Consent is **per-purpose**, not all-in-one. Purposes for pre-pilot:

| Code                       | Description                                                               | Required for                       |
| -------------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| `tos`                      | Terms of service + privacy notice (152-FZ art. 9 minimum)                 | any platform use                   |
| `medical_data_processing`  | Processing of medical data (special-category PD, 152-FZ art. 10)          | registration as a doctor           |
| `nmo_credit_issuance`      | Issuing NMO credits and reporting to Minzdrav / RZN accreditation systems | participation in accredited events |
| `marketing_communications` | Promo email/SMS, partner events                                           | opt-in, not required               |
| `research_anonymized`      | Use of anonymized data in R&D / ML training                               | opt-in, not required               |

`tos` + `medical_data_processing` are mandatory at signup (block until accepted). Others are opt-in.

### 2.2 Consent versions

Each `purpose` has its own version stream:

```
purpose = "tos"
  v1 (effective 2026-06-01) — initial version
  v2 (effective 2026-09-15) — updated Privacy Notice + retention matrix
```

When a user accepts v2 they give explicit consent; **a v1 acceptance does not count** for actions requiring v2.

### 2.3 Withdrawal cascade

Withdrawal = revocation of an active consent. Cascading effects:

| Purpose withdrawn          | Effect                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `tos`                      | User deactivated (account suspended) + erasure offered (no auto-delete)                                                   |
| `medical_data_processing`  | Access to medical content revoked; profile retained pending erasure decision                                              |
| `nmo_credit_issuance`      | Future credit issuance blocked; past credits retained (3y legal retention)                                                |
| `marketing_communications` | All marketing channels off; marketing PD erased after 90d and lifecycle tombstones retained                               |
| `research_anonymized`      | New R&D batches stop using the subject; already-trained models are not retrained (anonymization is considered sufficient) |

---

## 3. Retention matrix

**Master location:** `packages/db/schema/pd/retention.ts` (TS object, consumed by migrations + CI + admin UI).

**Full list of PD-bearing tables pre-pilot.** Each row fixes: legal basis, retention, retained-row erasure mechanism, audit exception, owner. Every removable/expiring application-owned row also carries lifecycle `status` + `deleted_at` under ADR-0003 design §3.6; mechanisms may be combined.

|   # | Table                                | PD fields                               | Legal basis                                                     | Retention                           | Retained-row erasure mechanism              | Audit exception                 | Owner           |
| --: | ------------------------------------ | --------------------------------------- | --------------------------------------------------------------- | ----------------------------------- | ------------------------------------------- | ------------------------------- | --------------- |
|   1 | `users`                              | email, phone, name, dob, photo_url      | 152-FZ art. 6 p. 1 / consent (`tos`, `medical_data_processing`) | active + 3y after deactivation      | value erasure + tombstone                   | none                            | Legal/CTO       |
|   2 | `user_profiles_medical`              | specialty, license_no, regalia          | 152-FZ art. 10 (special category)                               | active + 3y                         | value erasure + tombstone                   | none                            | Legal/CTO       |
|   3 | `consent_versions`                   | body_markdown                           | — (system data)                                                 | indefinite                          | retained unchanged                          | n/a                             | Legal/CTO       |
|   4 | `consent_acceptances`                | subject_id, ip, ua                      | 152-FZ proof                                                    | 5y after withdrawal                 | immutable row; subject-link crypto-shred    | proof retained                  | Legal/CTO       |
|   5 | `consent_withdrawals`                | subject_id, channel                     | 152-FZ proof                                                    | 5y                                  | immutable row; subject-link crypto-shred    | proof retained                  | Legal/CTO       |
|   6 | `audit_ledger`                       | subject_id, ip, ua, payload_hash        | 152-FZ + НК РФ + medical                                        | 5y                                  | crypto-shred at term; retain hash-chain row | retain hash-chain               | Legal/CTO       |
|   7 | `data_export_requests`               | subject_id, signed_link_id              | operational                                                     | 90d after fulfillment               | value erasure + tombstone                   | none                            | Backend/SRE     |
|   8 | `erasure_requests`                   | subject_id, status, legal_note          | operational + 152-FZ proof                                      | 5y                                  | tombstone + subject-link crypto-shred       | proof retained                  | Legal/CTO       |
|   9 | `sessions` (if IdP shared)           | subject_id, ua                          | technical                                                       | 30d after expiry                    | IdP operational expiry; not a domain entity | none                            | IdP / Backend   |
|  10 | `payments` (if applicable pre-pilot) | subject_id, amount, invoice_no          | НК РФ art. 23                                                   | 5y after transaction                | retain; crypto-shred PD at term             | full retention                  | Finance         |
|  11 | `webinar_attendance`                 | subject_id, event_id, presence_minutes  | NMO compliance                                                  | 3y                                  | tombstone + subject-link crypto-shred       | retain attendance proof         | NMO/Legal       |
|  12 | `nmo_credit_issuance`                | subject_id, event_id, credit_id         | NMO compliance + Minzdrav reporting                             | 5y                                  | retain; crypto-shred PD at term             | full retention                  | NMO/Legal       |
|  13 | `course_enrollments`                 | subject_id, course_id, completion_date  | medical_data_processing                                         | active + 3y after course completion | tombstone + subject-link crypto-shred       | retain completion proof for NMO | NMO/Legal       |
|  14 | `quiz_attempts`                      | subject_id, course_id, answers, score   | derived from medical_data_processing                            | active + 3y                         | tombstone + answer/subject crypto-shred     | retain pass/fail proof          | NMO/Legal       |
|  15 | `marketing_consent`                  | subject_id, channel, opt_in_at          | consent (`marketing_communications`)                            | until withdrawn + 90d               | value erasure + tombstone                   | retain proof of revocation      | Marketing/Legal |
|  16 | `marketing_events`                   | subject_id, event_type, sent_at         | consent                                                         | until withdrawn + 90d               | value erasure + tombstone                   | n/a                             | Marketing       |
|  17 | `embeddings` (AI zone)               | derived from content + subject behavior | derivative                                                      | recomputable                        | erase vector/payload + tombstone via outbox | n/a                             | AI lead         |
|  18 | `prompt_eval_corpus` (AI zone)       | sanitized prompts + responses           | consent (`research_anonymized`) where PD remains                | per-corpus consent                  | erase payload + tombstone via outbox        | n/a                             | AI lead         |
|  19 | `support_tickets` (if applicable)    | subject_id, raw_text                    | operational (legitimate interest)                               | 1y after resolution                 | value erasure + tombstone                   | none                            | Support/Legal   |

**Mutability:** this list is living. Any new PD table requires a row in the retention matrix **before** the migration merges (CI gate, see §7).

---

## 4. Schemas (DDL outline)

Drizzle schemas (TS). Not full DDL — outline of key fields. Full migrations land in `packages/db/migrations/` post-bootstrap.

Every removable/expiring application-owned row additionally carries lifecycle `status` and nullable `deleted_at` as defined by ADR-0003 design §3.6. Immutable/append-only records explicitly do not support removal and are erased only through their payload/key contract. The snippets below show the fields relevant to this ADR; legacy `tombstone_at` on soft-deletable request records is standardized to `deleted_at`.

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

Immutable: no UPDATE, no DELETE. A newer version supersedes via `effective_from`.

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

Append-only. `subject_id` is queried via `bytea` + the general per-subject key (see §5).

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
  subject_id: uuid("subject_id").notNull(), // not encrypted — operational, 90d retention
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
  legal_note: text("legal_note"), // legal hold reason on rejection
  executed_at: timestamp("executed_at", { withTimezone: true }),
  general_key_zeroized_at: timestamp("general_key_zeroized_at", {
    withTimezone: true,
  }),
  deleted_at: timestamp("deleted_at", { withTimezone: true }), // self-tombstoning after 5y
});
```

---

## 5. Key management (purpose-separated keys)

### 5.1 Architecture

- **Key authority** — Vault on a dedicated VM (Hashicorp Vault or a Vault-light service with the same destroy semantics). Database backups contain opaque key references, never usable DEKs.
- **General per-subject DEK** — generated when the subject is created and used for profile, consent, contact, and derived subject PD. Postgres `subject_keys` stores only the Vault reference and retained lifecycle metadata.
- **Per-audit-row retention DEK** — generated for each `audit_ledger` row whose identifying fields carry a legal retention term. The row references one `audit_retention_keys` tombstone; that key cannot decrypt any non-audit data.
- **PD-field encryption** in `bytea` columns — symmetric AES-256-GCM with the purpose-scoped DEK.
- **Erasure** destroys the general DEK in Vault and marks its retained `subject_keys` row `zeroized`. A legally exempt audit key is intentionally unaffected.
- **Audit term expiry** destroys that row's retention DEK in Vault and marks the retained `audit_retention_keys` row `zeroized`; the audit ciphertext and hash-chain row remain unreadable but intact.

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

The table holds no DEK. Its row is retained after zeroization, so an old database snapshot cannot resurrect key material even if it still carries a stale Vault reference.

### 5.3 `audit_retention_keys` table

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

Each identifying `audit_ledger` row stores a restrictive FK `retention_key_id` to this table. The key record contains no subject identifier; the encrypted audit row is the only consumer. Neither row may be deleted.

### 5.4 Why this pattern (vs alternatives)

- **Postgres pgcrypto under a master-key (rejected):** database snapshots would carry wrapped DEKs, and one immediate subject erasure would conflict with the separate five-year audit exception.
- **One per-subject key for all purposes (rejected):** zeroizing it immediately destroys legally retained audit readability; retaining it leaves all other subject PD readable. Purpose separation is mandatory.
- **Vault + general subject DEK + per-row audit-retention DEK (chosen):** revocation is purpose-scoped, audit expiry is precise per row, and database backups hold ciphertext plus dead references rather than key material.
- **OQ-PD-1 (open):** dedicated Hashicorp Vault VM vs a sealed Vault-light service. Either implementation must keep keys outside the Postgres backup set and expose irreversible destroy + retained zeroization metadata.

### 5.5 Backup erasure via key zeroization

- A database snapshot contains ciphertext, `subject_keys` / `audit_retention_keys` metadata, and opaque Vault references — never a usable DEK.
- Destroying the general subject key makes non-exempt PD unreadable in the live database and every old database backup immediately. The stale reference cannot recover a destroyed Vault key.
- Audit-retention keys remain available only until each row's `retention_expires_at`; destroying one makes that row's identifying ciphertext unreadable in the live database and every backup while retaining the evidence row.
- Vault restore must replay the retained zeroization ledger before key service resumes; a destroyed key version is never importable from a cold snapshot. The quarterly restore drill verifies this fail-closed property.
- **30d SLA compatible:** non-exempt PD is crypto-shredded within hours of an approved request. A retention-matrix exception follows its recorded legal term rather than the general erasure clock.

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

Response: 200 (acceptance recorded). Side effect: insert into `consent_acceptances`.

### 6.3 `POST /me/consent/withdraw`

Request:

```json
{ "purpose": "marketing_communications" }
```

Response: 200. Side effects: insert into `consent_withdrawals`, trigger cascade (see §2.3).

### 6.4 `POST /me/data-export`

Request: empty body. Response 202:

```json
{ "request_id": "...", "status": "pending", "estimated_at": "2026-05-25T..." }
```

Async build → email with signed S3 link (TTL 48h).

### 6.5 `POST /me/erasure-request`

Request:

```json
{ "reason": "..." }
```

Response 202:

```json
{ "request_id": "...", "status": "pending", "expected_sla_days": 30 }
```

Async processing (see §7).

### 6.6 `GET /me/audit-log`

Paged. Per row:

```json
{
  "at": "2026-05-18T...",
  "actor": "self" | "admin" | "system",
  "action": "consent_accepted" | "profile_read" | "data_exported" | "erasure_requested",
  "details": "..."
}
```

> **Forward reference (audit classes):** an additional audit class `ai_dual_llm` (logging Quarantined call + Privileged call as a pair, with pseudonymized subject_id) is defined in **ADR-0010** + `2026-05-18-ds-platform-dual-llm-pattern-design`. The `ai_processing` class for consent type is defined in ADR-0009 §2.1 (AI consent class).

---

## 7. Erasure execution flow

> **Forward reference:** the BullMQ `erasure-execute` job contract (Zod payload schema, idempotency-key = `erasure_request_id`, retry/backoff/DLQ, classification = critical, queue `pd-lifecycle`, queue→worker mapping) is specified in **`2026-05-18-ds-platform-bullmq-queue-contract-design`**.

1. **Request submitted** (UI → API). Row inserted into `erasure_requests` with `status = 'pending'`.
2. **Automated triage** (cron job, 1x/hour):

- If subject has legal hold / active payments / regulatory hold → status `'review_required'`, routed to admin queue.
- Otherwise status `'approved'`, immediately enqueue execution job.

3. **Manual review** (admin app):

- Operator reviews the case in UI.
- Decides approve / reject / annotate. Reject requires `legal_note`.

4. **Execution job** (BullMQ, idempotent):

- Value erasure: NULL/replace PD fields in tables with `erasure: 'value_erasure'`; set lifecycle status and `deleted_at` without deleting the row.
- Tombstone: preserve the minimum non-PD fact in tables with `erasure: 'tombstone'`; erase or crypto-shred the subject link.
- Crypto-shred: destroy the general subject DEK in Vault and mark `subject_keys` zeroized. Non-exempt encrypted blobs become unreadable; active `audit_retention_keys` remain isolated until their own terms.
- Emit outbox event `erasure.subject_erased.v1` (see ADR-0011 §2.5).

5. **AI-zone subscriber** (cross-zone):

- Receives the outbox event.
- Erases vector/payload values and soft-deletes the subject's `embeddings` rows.
- Erases subject-bearing payloads and soft-deletes their `prompt_eval_corpus` rows.
- Acks completion → recorded in `erasure_requests.ai_zone_acked_at`.

6. **Backup erasure** (deferred — organic on rotation):

- Primary: within 30d (current rotation window).
- Offsite: within 90d.
- Both: non-exempt PD is cryptographically erased immediately by general-DEK zeroization; legally retained audit ciphertext remains readable only through its separate retention key until term.

7. **Completion**:

- Status → `'completed'`. `executed_at`, `general_key_zeroized_at`, `ai_zone_acked_at` filled; audit-retention key expiry remains independent.
- Audit log entry.
- Optional confirmation email (if subject still reachable).

---

## 8. Cross-zone erasure propagation

See **ADR-0011 §2.5 (Egress control plane)** for the full contract. Outline:

- **Outbox event schema** (`erasure.subject_erased.v1`):
  ```json
  {
    "event_id": "uuid",
    "subject_id_hash": "sha256(subject_id || pepper)", // pseudonymous reference, no raw PD
    "purposes": ["medical_data_processing", ...],
    "requested_at": "2026-05-18T...",
    "approved_at": "2026-05-19T..."
  }
  ```
- **AI-zone subscriber:**
- Idempotent (dedupes by `event_id`).
- Indexes embeddings by the same `subject_id_hash`.
- Erases matching vector/payload values and marks the rows soft-deleted.
- Emits an ack event to RF-zone (reverse outbox direction).
- **Sanitization:** event carries a pseudonymous hash, no raw PD. Allowed channel per ADR-0011 §2.
- **Audit:** every erasure event is logged in both zones.

---

## 9. Admin UI (queue)

`admin.doctor.school` — "PD requests" section:

- **Tab "Erasure requests":** list view with status filter (pending / review_required / approved / executing / completed / failed). Per row: subject email (decrypted on demand), `requested_at`, status, action buttons.
- **Detail view:** subject details (re-auth challenge before decrypting PD), full audit log, legal-hold flag, approve/reject buttons with `legal_note` input.
- **Tab "Data export requests":** monitoring; manual intervention only when `status = 'failed'`.
- **Tab "Consent versions":** view + create new version (requires legal review checkbox before publishing).

Access control: role `pd_officer` only (a new role; ADR-0001 §1 RBAC catalog is updated inline to include it when DSO-26 picks up consent / right-to-erasure work).

---

## 10. CI gates / migration validation

**Custom lint** in `tools/lint-retention.ts`:

1. Every `bytea` / `text` column on a table under `packages/db/schema/` must be either classified in `retention.ts` or carry an explicit `@no-pd` annotation in the Drizzle schema.
2. A new table in a migration without an entry in `retention.ts` → CI fails.
3. Every PD field must have a valid retained-row erasure mechanism from {value_erasure, tombstone, crypto_shred, retain}.
4. Every application-owned Postgres table must declare either lifecycle `status` + nullable `deleted_at` for removal/expiry or an immutable/append-only contract where removal is unsupported. Migrations, retention jobs and runtime repositories must not use `DELETE`, `TRUNCATE`, data-bearing `DROP TABLE` / `DROP PARTITION`, or `ON DELETE CASCADE`.
5. `consent_versions`, `consent_acceptances` and `consent_withdrawals` remain append-only: no `UPDATE`/`DELETE`; subject identity is erased by zeroizing the general key referenced by `subject_keys`. Any separately soft-deletable consent-domain table follows rule 4.
6. Every identifying `audit_ledger` row references one retained `audit_retention_keys` row; the general subject key is forbidden for audit ciphertext, and neither evidence nor key-tombstone rows may be physically deleted.

**Red-team tests** (`tests/red-team/pd-leakage.test.ts`):

- Register a test subject with a unique PD marker string.
- Trigger erasure.
- Assert: the marker disappears from general product SELECTs, logs, metrics, and the AI-zone fixture; raw `audit_ledger` output contains ciphertext only. The restricted compliance projection can decrypt an unexpired audit row, and a synthetic term-expiry zeroizes its separate retention key so the same row becomes unreadable without deleting it.

---

## 11. Deployment & operations

- **Phase 0 (before first user):** Vault-light service with sealed storage outside the Postgres backup set; Postgres stores opaque key references only.
- **Phase 1 (pre-pilot):** Vault-light → Vault-full if IdP-Vault interop is feasible (DSO-25 spike).
- **Quarterly:** KEK rotation. Active general/audit DEKs are rewrapped first; old KEK versions are destroyed only after the rewrap and zeroization-ledger verification succeed.
- **Backup procedure:** see ADR-0009 §2.5 + data-layer-design §2.4. Vault keys are backed up separately; restore replays retained zeroization tombstones before the key service accepts reads.

---

## 12. Open Questions

- **OQ-PD-1** (see ADR-0009 §5): Vault-full vs Vault-light. **Resolution:** depends on IdP spike. Pre-pilot — Vault-light (acceptable per УЗ-3 spec, key access network-restricted).
- **OQ-PD-2:** data-export SLA — async vs sync. **Resolution:** async by default; sync only if subject data ≤ 100 KB (estimated). Measure in pilot.
- **OQ-PD-3:** granular per-purpose consent vs all-in-one. **Resolution:** per-purpose (see §2.1). Decided.
- **OQ-PD-4** (new): consent capture flow for Directual cutover. Open — closes under DSO-X1.

---

## 13. Cross-references

- **ADR:** ADR-0009 (parent), ADR-0001 §134-141 (consent), ADR-0003 §6 (audit_ledger), ADR-0011 (egress).
- **Specs:** `data-layer-design §2.4` (backup), `engineering-readiness §5` (BLOCKER list).
- **Plane:** DSO-63 findings #5 + #6, DSO-X1 (Directual cutover), DSO-X2 (RKN + ФСТЭК-21).
- **Source:** `outputs/2026-05-18-ds-platform-external-validation-findings.md`.
- **Memory:** [[feedback_docs_as_ssot]], [[feedback_rf_blocked_services]].
