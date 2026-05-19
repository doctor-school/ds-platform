---
title: "DS Platform — PD Lifecycle, Consent, Retention, Erasure design [EN]"
description: "1. Three erasure levels chosen per table: hard delete / tombstone / crypto-shred. Decision is fixed in the retention matrix (§3) + CI lint. 2...."
lang: en
---

> **RU:** [`0009-pd-lifecycle-and-consent-design-ru.md`](./0009-pd-lifecycle-and-consent-design-ru.md) · **EN (this)**

# DS Platform — PD Lifecycle, Consent, Retention, Erasure design

**Date:** 2026-05-18
**Notion title:** [BBM · DS] 2026-05-18 — DS Platform: PD lifecycle design
**Notion page ID:** —
**Master:** repository → `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-ru.md`
**Author:** Tech Lead
**Related to:** Plane DSO-63 findings #5 + #6, milestone DSO-24
**Inherits:** ADR-0001 (identity / users / audit), ADR-0003 (Postgres + audit_ledger + pgvector), ADR-0007 (AI zone), ADR-0009 (PD lifecycle ADR — this spec is its implementation)
**Inputs:** `_validation-pack-2026-05-18/ds-platform-architecture-review.md` (Claude — High findings #5/#6), `outputs/2026-05-18-ds-platform-external-validation-findings.md`
**Output:** Implementation contract for backend + admin + AI-zone subscriber. Closes `engineering-readiness §5` BLOCKER "data subject rights endpoints" + `data-layer-design §2.5 OQ-D3`.

---

## 0. TL;DR

1. **Three erasure levels** chosen per table: hard delete / tombstone / crypto-shred. Decision is fixed in the retention matrix (§3) + CI lint.
2. **Per-subject crypto-shred** for audit_ledger + backups + AI-zone embeddings. Keys live in Vault on a dedicated VM. Erasure SLA — 30 days.
3. **Consent versioning** — `consent_versions` + append-only `consent_acceptances` + `consent_withdrawals`. Every text change = new version; user is prompted on next login.
4. **Data subject rights endpoints** under `/me/*` — mandatory pre-pilot. `data-export` async (signed link, ≤7d). `erasure-request` async (≤30d).
5. **Retention matrix** in `packages/db/schema/pd/retention.ts` as a TS object — read by migrations + CI + admin UI. Single source of truth.
6. **Cross-zone propagation:** erasure request → outbox event → AI-zone subscriber deletes embeddings/corpus entries (see ADR-0011 §3).
7. **Out of scope for this spec:** the actual legal text for consent v1 (drafted by lawyer under DSO-X2), exact UX of consent screens (frontend track), final data-export SLA if size turns out to be ≥X MB (measured in pilot).

---

## 1. Scope and non-goals

### In scope

- Schemas for `consent_*`, `data_export_requests`, `erasure_requests` + migrations.
- API endpoints under `/me/*` (NestJS controllers, Zod request/response schemas).
- Retention matrix as code (TS) + CI validator (`drizzle-kit check` + custom lint).
- Erasure execution flow (sync vs async, audit, ack).
- Per-subject crypto-shred: key management (Vault or sealed master-key), at-rest encryption on critical fields, key zeroization protocol.
- Cross-zone erasure propagation (outbox contract, see ADR-0011 §3).
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
| `marketing_communications` | All marketing channels off; marketing PD deleted after 90d                                                                |
| `research_anonymized`      | New R&D batches stop using the subject; already-trained models are not retrained (anonymization is considered sufficient) |

---

## 3. Retention matrix

**Master location:** `packages/db/schema/pd/retention.ts` (TS object, consumed by migrations + CI + admin UI).

**Full list of PD-bearing tables pre-pilot.** Each row fixes: legal basis, retention, erasure level, audit exception, owner.

|   # | Table                                | PD fields                               | Legal basis                                                     | Retention                           | Erasure level                                         | Audit exception                 | Owner           |
| --: | ------------------------------------ | --------------------------------------- | --------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------- | ------------------------------- | --------------- |
|   1 | `users`                              | email, phone, name, dob, photo_url      | 152-FZ art. 6 p. 1 / consent (`tos`, `medical_data_processing`) | active + 3y after deactivation      | hard delete + tombstone in FK-dependent tables        | none                            | Legal/CTO       |
|   2 | `user_profiles_medical`              | specialty, license_no, regalia          | 152-FZ art. 10 (special category)                               | active + 3y                         | hard delete + tombstone                               | none                            | Legal/CTO       |
|   3 | `consent_versions`                   | body_markdown                           | — (system data)                                                 | indefinite                          | not deleted                                           | n/a                             | Legal/CTO       |
|   4 | `consent_acceptances`                | subject_id, ip, ua                      | 152-FZ proof                                                    | 5y after withdrawal                 | tombstone (subject_id encrypted with key zeroization) | proof retained                  | Legal/CTO       |
|   5 | `consent_withdrawals`                | subject_id, channel                     | 152-FZ proof                                                    | 5y                                  | tombstone                                             | proof retained                  | Legal/CTO       |
|   6 | `audit_ledger`                       | subject_id, ip, ua, payload_hash        | 152-FZ + НК РФ + medical                                        | 5y                                  | crypto-shred at term                                  | retain hash-chain               | Legal/CTO       |
|   7 | `data_export_requests`               | subject_id, signed_link_id              | operational                                                     | 90d after fulfillment               | hard delete + audit row                               | none                            | Backend/SRE     |
|   8 | `erasure_requests`                   | subject_id, status, legal_note          | operational + 152-FZ proof                                      | 5y                                  | tombstone (subject_id encrypted)                      | proof retained                  | Legal/CTO       |
|   9 | `sessions` (if IdP shared)           | subject_id, ua                          | technical                                                       | 30d after expiry                    | hard delete                                           | none                            | IdP / Backend   |
|  10 | `payments` (if applicable pre-pilot) | subject_id, amount, invoice_no          | НК РФ art. 23                                                   | 5y after transaction                | no deletion                                           | full retention                  | Finance         |
|  11 | `webinar_attendance`                 | subject_id, event_id, presence_minutes  | NMO compliance                                                  | 3y                                  | tombstone                                             | retain attendance proof         | NMO/Legal       |
|  12 | `nmo_credit_issuance`                | subject_id, event_id, credit_id         | NMO compliance + Minzdrav reporting                             | 5y                                  | no deletion                                           | full retention                  | NMO/Legal       |
|  13 | `course_enrollments`                 | subject_id, course_id, completion_date  | medical_data_processing                                         | active + 3y after course completion | tombstone                                             | retain completion proof for NMO | NMO/Legal       |
|  14 | `quiz_attempts`                      | subject_id, course_id, answers, score   | derived from medical_data_processing                            | active + 3y                         | tombstone (answers crypto-shred)                      | retain pass/fail proof          | NMO/Legal       |
|  15 | `marketing_consent`                  | subject_id, channel, opt_in_at          | consent (`marketing_communications`)                            | until withdrawn + 90d               | hard delete                                           | retain proof of revocation      | Marketing/Legal |
|  16 | `marketing_events`                   | subject_id, event_type, sent_at         | consent                                                         | until withdrawn + 90d               | hard delete                                           | n/a                             | Marketing       |
|  17 | `embeddings` (AI zone)               | derived from content + subject behavior | derivative                                                      | recomputable                        | recompute or delete via outbox                        | n/a                             | AI lead         |
|  18 | `prompt_eval_corpus` (AI zone)       | sanitized prompts + responses           | consent (`research_anonymized`) where PD remains                | per-corpus consent                  | delete via outbox                                     | n/a                             | AI lead         |
|  19 | `support_tickets` (if applicable)    | subject_id, raw_text                    | operational (legitimate interest)                               | 1y after resolution                 | hard delete + tombstone                               | none                            | Support/Legal   |

**Mutability:** this list is living. Any new PD table requires a row in the retention matrix **before** the migration merges (CI gate, see §7).

---

## 4. Schemas (DDL outline)

Drizzle schemas (TS). Not full DDL — outline of key fields. Full migrations land in `packages/db/migrations/` post-bootstrap.

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

Append-only. `subject_id` is queried via `bytea` + per-subject key (see §5).

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
  subject_id: uuid("subject_id").notNull(), // not encrypted — operational, 90d retention
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
  legal_note: text("legal_note"), // legal hold reason on rejection
  executed_at: timestamp("executed_at", { withTimezone: true }),
  key_zeroized_at: timestamp("key_zeroized_at", { withTimezone: true }),
  tombstone_at: timestamp("tombstone_at", { withTimezone: true }), // self-tombstoning after 5y
});
```

---

## 5. Key management (per-subject keys)

### 5.1 Architecture

- **Master KEK** (Key Encryption Key) — stored in Vault on a dedicated VM (Hashicorp Vault or Vault-light).
- **Per-subject DEK** (Data Encryption Key) — generated when the subject is created; encrypted with KEK; stored in the `subject_keys` table in Postgres.
- **PD-field encryption** in `bytea` columns — symmetric (AES-256-GCM) with DEK.
- **Erasure** = destroy DEK in `subject_keys` (set NULL or DELETE row). Encrypted blobs become unreadable.

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

### 5.3 Why this pattern (vs alternatives)

- **Postgres pgcrypto under a master-key (simpler alternative):** every read requires master-key access. If master-key is in an env var → available to every process, including ML jobs. No isolation.
- **Vault + per-subject DEK (chosen):** Vault caches DEK briefly; after revocation, DEK becomes inaccessible. Erasure = revoke in Vault. Backup risk is bounded — backups hold only encrypted blobs, no key.
- **OQ-PD-1 (open):** dedicated Hashicorp Vault VM vs Postgres + sealed master-key at startup (Vault-light). Resolved by IdP spike (if the IdP host already runs Vault, reuse; otherwise — light pattern for pre-pilot, full Vault at scale).

### 5.4 Backup erasure via key zeroization

- A backup snapshot contains `subject_keys` + encrypted PD.
- When subject S's DEK is zeroized (erasure), new snapshots no longer contain that DEK.
- **Old snapshots taken before erasure** still contain the DEK. Compensating control: KEK rotated quarterly + retired KEKs are destroyed on rotation. Within ≤90d (offsite retention) old backups have an unreadable DEK → de facto erasure.
- **30d SLA compatible:** crypto-shred in live DB and primary backup — immediate (within hours of the request). Offsite — within rotation window. Acceptable per 152-FZ art. 14 (30d).

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

- Hard-delete: rows from tables with `erasure: 'hard_delete'`.
- Tombstone: NULL/replace PD fields in tables with `erasure: 'tombstone'`. Encrypt `subject_id` via DEK.
- Crypto-shred: zeroize DEK in `subject_keys`. All encrypted blobs become unreadable.
- Emit outbox event `erasure.subject_purged.v1` (see ADR-0011 §3).

5. **AI-zone subscriber** (cross-zone):

- Receives the outbox event.
- Deletes `embeddings` rows for the subject.
- Removes subject from `prompt_eval_corpus`.
- Acks completion → recorded in `erasure_requests.ai_zone_acked_at`.

6. **Backup erasure** (deferred — organic on rotation):

- Primary: within 30d (current rotation window).
- Offsite: within 90d.
- Both: cryptographically erased immediately via DEK zeroization.

7. **Completion**:

- Status → `'completed'`. `executed_at`, `key_zeroized_at`, `ai_zone_acked_at` filled.
- Audit log entry.
- Optional confirmation email (if subject still reachable).

---

## 8. Cross-zone erasure propagation

See **ADR-0011 §3 (Egress control plane)** for the full contract. Outline:

- **Outbox event schema** (`erasure.subject_purged.v1`):
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
- Deletes matching rows.
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

Access control: role `pd_officer` only (a new role, added in an ADR-0001 amendment when we get there).

---

## 10. CI gates / migration validation

**Custom lint** in `tools/lint-retention.ts`:

1. Every `bytea` / `text` column on a table under `packages/db/schema/` must be either classified in `retention.ts` or carry an explicit `@no-pd` annotation in the Drizzle schema.
2. A new table in a migration without an entry in `retention.ts` → CI fails.
3. Every PD field must have a valid erasure level from {hard_delete, tombstone, crypto_shred}.
4. `consent_*` tables must not have `UPDATE` / `DELETE` migrations — only `INSERT` + tombstoning via a separate column.

**Red-team tests** (`tests/red-team/pd-leakage.test.ts`):

- Register a test subject with a unique PD marker string.
- Trigger erasure.
- Assert: the marker does not appear in SELECTs + does not appear in audit_ledger raw output + does not appear in logs + does not appear in metrics endpoint + does not appear in the ai-zone-subscriber test fixture.

---

## 11. Deployment & operations

- **Phase 0 (before first user):** Vault-light pattern (sealed master-key in systemd-credential, KEK in env). DEK in Postgres.
- **Phase 1 (pre-pilot):** Vault-light → Vault-full if IdP-Vault interop is feasible (DSO-25 spike).
- **Quarterly:** KEK rotation. Old KEKs destroyed per rotation policy.
- **Backup procedure:** see ADR-0009 §2.5 + data-layer-design §2.4. Vault keys backed up separately (offline cold storage).

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
