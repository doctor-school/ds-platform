---
title: "ADR-0009 — PD Lifecycle, Consent, Retention, Erasure [EN]"
description: "ADR-0001 §134-141, engineering-readiness §5, data-layer-design §2.5 (OQ-D3) reference consent management, right-to-erasure, retention — without a..."
lang: en
---

> **RU:** [`0009-pd-lifecycle-and-consent-ru.md`](./0009-pd-lifecycle-and-consent-ru.md) · **EN (this)**

# ADR-0009 — PD Lifecycle, Consent, Retention, Erasure

**Date:** 2026-05-18
**Status:** Accepted
**Related to:** Plane DSO-63 (external architecture validation, finding #5+#6), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-en.md`
**Inherits:** ADR-0001 (identity / users table / audit), ADR-0003 (Postgres + audit_ledger + pgvector), ADR-0007 (AI zone egress)
**Affects:** ADR-0011 (Egress control plane, separate ADR for cross-zone flows)

---

## 1. Context

ADR-0001 §134-141, `engineering-readiness §5`, `data-layer-design §2.5 (OQ-D3)` reference consent management, right-to-erasure, retention — **without a single architectural contract**. The external validation pack (DSO-63) flagged this as a top compliance risk:

> "Consent management and right-to-erasure are treated partly as deferred gaps, while the readiness spec correctly says data subject rights are pre-pilot legal blockers." — Claude review, High severity.

> "Store everything until first observation is risky for personal data and audit-heavy medical platform. Data minimization and retention are legal/product decisions, not only observability decisions." — Claude review, High.

PD lifecycle for DS Platform is **first-class architecture, not implementation detail**, for three reasons:

1. **Technical conflict between append-only audit ledger and right to erasure.** 152-FZ requires the ability to delete PD on request. The append-only ledger (ADR-0003 §6) is built on a hash-chain — arbitrary delete breaks integrity. A **tombstoning + crypto-shredding** pattern must be chosen architecturally, not ad hoc.

2. **Technical conflict between backup retention and right to erasure.** Standard pgbackrest retention (30d primary + 90d offsite, ADR-0003 §8 + DSO-63 #9) outlives an erasure request by days to weeks. We need either a short backup cycle, or **per-subject crypto-shred** (preferred — "delete from backup" via key destruction).

3. **Cross-zone egress component.** The AI zone holds embeddings + prompt-eval corpora derived from PD. Erasure must propagate there. This requires a contract between RF-zone backend and AI-zone (see ADR-0011).

**Hard requirements:**

- 152-FZ art. 14: data subject can request cessation of processing + destruction of PD. Response SLA — up to 30 days.
- 152-FZ art. 9: consent must be specific, informed, conscious. **Consent versioning is mandatory** — a user who agreed to v1 has not agreed to v2.
- Special category PD (medical) — heightened regime (152-FZ art. 10).
- УЗ-3 (assumption per DSO-63 #7) — requires logging + access control + at-rest encryption.
- [[feedback_docs_as_ssot]]: retention matrix must live **in code**, not only Notion — single source of truth, CI-validated.

---

## 2. Decision

### 2.1 Consent versioning

- **Every consent text version** has an immutable record `consent_versions(id, version_tag, locale, body_markdown, effective_from, sha256)`.
- **Every user consent act** — `consent_acceptances(subject_id, consent_version_id, accepted_at, ip, user_agent, channel)` (append-only, no UPDATE/DELETE).
- **When consent text changes** (new locale, new revision) — new version is created; users whose last accepted version is stale are prompted at next login.
- **Withdrawal** — separate append-only table `consent_withdrawals(subject_id, consent_version_id, withdrawn_at, channel)`. The acceptance record is not deleted (proof that consent existed at a point in time), but the withdrawal applies to active state.
- **AI consent class** (separate consent for PD processing by LLM models, including the dual-LLM flow) — see ADR-0010 «Consent & audit»: classification of AI actions requires a dedicated consent version and audit class; consent tables stay the same with an added `consent_kind = 'ai_processing'`.

### 2.2 Data subject rights endpoints

The API (NestJS, ADR-0002) exposes under `/me`:

| Endpoint                    | Description                                                                         | SLA         |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------- |
| `GET /me/consent`           | Active consents, versions, history.                                                 | sync        |
| `POST /me/consent/withdraw` | Withdraw consent + cascading effects.                                               | sync        |
| `GET /me/data-export`       | Machine-readable dump of all PD (JSON). Async — delivered via signed link by email. | ≤ 7 days    |
| `POST /me/erasure-request`  | Erasure request. Status tracking, audit log, manual legal review when required.     | ≤ 30 days   |
| `GET /me/audit-log`         | User's own data-access log (art. 14).                                               | sync, paged |

These endpoints are mandatory pre-pilot (engineering-readiness §5 BLOCKER).

### 2.3 Erasure semantics

**Three erasure levels**, selected per table:

| Level            | Behavior                                                                                                        | Applies to                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Hard delete**  | `DELETE FROM …`, tuple disappears.                                                                              | mutable PD without legal hold (profile, contact data, marketing consent)         |
| **Tombstone**    | PD fields nulled / replaced with `'<erased>'`; row remains for referential integrity; tombstone flag for audit. | append-only action logs where the action matters but subject identity is removed |
| **Crypto-shred** | Field-level encryption per subject; destroying the key = effective erasure.                                     | audit_ledger, backup snapshots, AI-zone embeddings, archived blobs               |

**Per-table policy** is fixed in the retention matrix (design spec §3) + enforced via migrations + CI lint.

Forward reference: the erasure execution contract (BullMQ `erasure-execute` job, idempotency, cross-zone propagation) is defined in `2026-05-18-ds-platform-bullmq-queue-contract-design` (queue `pd-lifecycle`).

### 2.4 Audit log + tombstoning compatibility

`audit_ledger` (ADR-0003 §6) is append-only, hash-chained. Erasure works without breaking the chain:

- **Subject-identifying fields** in audit rows (subject_id, ip, ua) are encrypted with a **per-subject key** stored in Vault.
- **Erasure request** → key zeroization in Vault. Hash-chain remains valid; row remains; subject-identifying data becomes unreadable.
- **Audit exception clause** (152-FZ — mandatory retention for some events) — handled via retention matrix: `audit_ledger` retention 5y (НК РФ + medical compliance), crypto-shred at term.

### 2.5 Backup erasure policy

- **Primary backups (Timeweb):** 30d retention; erasure via per-subject crypto-shred.
- **Offsite backups (Beget S3):** 90d retention; per-subject crypto-shred.
- **Quarterly archives:** 1y retention; per-subject crypto-shred.
- **Keys stored in Vault on a separate VM** (DSO-63 #9 backup topology).
- **Erasure SLA** — 30 days (152-FZ art. 14). Key shred → data becomes unreadable immediately; physical tuple removal — on backup rotation.
- **Legal hold** (litigation, regulator) — override; key retained until hold released; tuple marked `legal_hold = true`.

### 2.6 Retention matrix

Full matrix per entity/table — in design spec §3. Summary:

| Entity                                   | Legal basis                  | Retention                      | Erasure                                  | Audit exception            |
| ---------------------------------------- | ---------------------------- | ------------------------------ | ---------------------------------------- | -------------------------- |
| `users`                                  | 152-FZ art. 6 p. 1 / consent | active + 3y after deactivation | hard delete + tombstone where referenced | none                       |
| `consent_acceptances`                    | 152-FZ proof                 | 5y after withdrawal            | tombstone (subject_id encrypted)         | proof retained             |
| `consent_withdrawals`                    | 152-FZ proof                 | 5y                             | tombstone                                | proof retained             |
| `audit_ledger`                           | 152-FZ + НК РФ + medical     | 5y                             | crypto-shred at term                     | retain hash-chain          |
| `payments`                               | НК РФ art. 23                | 5y                             | no deletion (audit exception)            | full retention             |
| `webinar_attendance`                     | NMO compliance               | 3y                             | tombstone                                | retain attendance proof    |
| `marketing_consent` / `marketing_events` | consent                      | until withdrawn + 90d          | hard delete                              | retain proof of revocation |
| `embeddings` (AI zone, derived)          | derivative                   | recomputable                   | recompute or delete                      | n/a                        |
| `prompt_eval_corpus` (AI zone)           | consent                      | per-corpus consent             | delete                                   | n/a                        |

### 2.7 Cross-zone erasure propagation

See ADR-0011 §3 (Egress control plane). Erasure request in RF-zone backend → outbox event → AI-zone subscriber → embedding / corpus entry removal. Audit per event.

### 2.8 Operator workflow

- Erasure requests are processed automatically by default (subject click in UI → API → execution).
- **Manual legal review** is required for: legal hold flag, active processes (litigation, audit), bulk requests covering multiple subjects (potential abuse).
- The **admin app (`admin.doctor.school`)** has an erasure-request queue with block / override / annotate actions.
- Every admin decision is audited.

### 2.9 Schema location

All PD-lifecycle tables (`consent_*`, `data_export_requests`, `erasure_requests`) live in `packages/db/schema/pd/`. Per DSO-63 #10/I, schemas live in `packages/db/`, not `apps/api`; ADR-0003 §4 (ORM + Migrations) is updated inline to reflect this layout.

---

## 3. Alternatives considered

### 3.1 Distributed consent management (no dedicated ADR)

**Rejected.** Spreading consent / erasure logic across ADR-0001, engineering-readiness, data-layer-design makes cross-table coherence impossible (backend writes, audit shreds the key, AI zone deletes embeddings — all three must respect one contract). A single ADR + design spec is the only workable form.

### 3.2 Soft delete without crypto-shred

**Rejected.** Soft delete (`deleted_at IS NOT NULL`) does not cover backups — data lives on in pgbackrest snapshots for months. 152-FZ requires actual cessation of processing, not a flag.

### 3.3 Full physical removal from audit_ledger

**Rejected.** Breaks the hash-chain → we lose the ability to prove an event to a regulator. Per-subject crypto-shred is the correct compromise: chain stays valid, subject-identifying fragments are unreadable.

### 3.4 Third-party / DPaaS (data privacy as a service)

**Rejected.** Russian DPaaS offerings are either outside-RF (violates 152-FZ) or in beta (no mature 2026 option). Self-hosted is the only viable path.

---

## 4. Consequences

### Positive

- One archetype document for AI agents / engineers / lawyers. No more "where's consent handled?" — every other doc forward-refs ADR-0009.
- Per-subject crypto-shred — satisfies 152-FZ backup requirement without forcing short backup retention.
- Retention matrix as code (CI-validated) — no drift from reality.
- Engineering-readiness §5 BLOCKER closed — pre-pilot launch is not blocked by missing consent infrastructure.

### Negative / costs

- Additional tables (`consent_*`, `data_export_requests`, `erasure_requests`) + cron jobs + admin UI — ≈ 2 weeks backend + 1 week admin frontend.
- Vault for per-subject keys — extra infra (separate VM). Alternative — keys in Postgres under master-key, simpler but weaker isolation; decided in design spec §5.
- Every new PD table must pass retention-matrix CI check — small migration overhead.

### Downstream dependencies

- **DSO-X1 (Directual cutover, DSO-63 #4)** — first-login flow must capture consent v1 (a requirement on ADR-0001 §9; the first-login flow defined there must implement consent v1 capture per DSO-63 #4).
- **DSO-X2 (РКН + ФСТЭК-21, DSO-63 #7)** — Privacy Notice references consent versions + retention matrix.
- **ADR-0011 (Egress control plane)** — propagates erasure to AI zone.

---

## 5. Deferred / Open Questions

- **OQ-PD-1:** Vault deployment topology — dedicated Hashicorp Vault VM vs Postgres + sealed master-key. Decided in design spec §5; trigger — IdP-spike outcome (if the IdP manages its secrets via Vault, reuse; otherwise stand up a dedicated instance).
- **OQ-PD-2:** Exact data-export SLA (sync vs async) — depends on PD volume per subject. Pre-pilot — async by default (signed link via email). Pilot — measure, optimize if feasible.
- **OQ-PD-3:** Granular consent — per-purpose (educational content vs marketing vs research) vs all-in-one. Decided in design spec §2 (skew towards per-purpose; does not block ADR).

---

## 6. Cross-references

- **Plane:** DSO-63 findings #5 + #6.
- **Design spec:** `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-en.md` (retention matrix, schemas, endpoints).
- **Forward refs from this ADR:** ADR-0001 §134-141 (consent), `engineering-readiness §5` (BLOCKER list), `data-layer-design §2.5` (OQ-D3 closed by §3 retention matrix), ADR-0011 (egress propagation).
- **Memory:** [[feedback_docs_as_ssot]], [[feedback_rf_blocked_services]].
