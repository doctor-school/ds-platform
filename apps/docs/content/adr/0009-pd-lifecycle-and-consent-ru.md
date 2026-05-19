---
title: "ADR-0009 — PD Lifecycle, Consent, Retention, Erasure [RU]"
description: "ADR-0001 §134-141, engineering-readiness §5, data-layer-design §2.5 (OQ-D3) упоминают consent management, right-to-erasure, retention — но без..."
lang: ru
---

> **EN:** [`0009-pd-lifecycle-and-consent-en.md`](./0009-pd-lifecycle-and-consent-en.md) · **RU (this)**

# ADR-0009 — PD Lifecycle, Consent, Retention, Erasure

**Дата:** 2026-05-18
**Статус:** Accepted
**Связан с:** Plane DSO-63 (внешняя валидация архитектуры, finding #5+#6), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-ru.md`
**Наследует:** ADR-0001 (identity / users-table / audit), ADR-0003 (Postgres + audit_ledger + pgvector), ADR-0007 (AI zone egress)
**Влияет на:** ADR-0011 (Egress control plane, отдельный ADR для cross-zone flows)

---

## 1. Context

ADR-0001 §134-141, `engineering-readiness §5`, `data-layer-design §2.5 (OQ-D3)` упоминают consent management, right-to-erasure, retention — но **без единого архитектурного контракта**. Внешний валидационный пакет (DSO-63) выявил это как один из главных compliance-рисков:

> «Consent management and right-to-erasure are treated partly as deferred gaps, while the readiness spec correctly says data subject rights are pre-pilot legal blockers.» — Claude review, High severity.

> «Store everything until first observation is risky for personal data and audit-heavy medical platform. Data minimization and retention are legal/product decisions, not only observability decisions.» — Claude review, High.

PD lifecycle для DS Platform — **first-class архитектурное решение, не implementation detail**, по трём причинам:

1. **Технический конфликт между append-only audit ledger и правом на удаление.** 152-ФЗ требует уметь удалить PD по запросу. Append-only ledger (ADR-0003 §6) построен на hash-chain → произвольное удаление ломает целостность. Нужен паттерн **tombstoning + crypto-shredding**, выбранный архитектурно, не на ходу.

2. **Технический конфликт между backup retention и правом на удаление.** Стандартный pgbackrest retention (30d primary + 90d offsite, ADR-0003 §8 + #9 после DSO-63) переживает erasure request на дни-недели. Нужен либо короткий backup-цикл, либо **crypto-shredding ключа per subject** (предпочтительно — позволяет «удалить из бэкапа» через уничтожение ключа).

3. **Cross-zone egress компонент.** AI-zone хранит embeddings + prompt-eval corpora, основанные на PD. Erasure request должен распространяться туда. Это требует контракта между RF-zone backend и AI-zone (см. ADR-0011).

**Hard requirements:**

- 152-ФЗ ст. 14: субъект ПДн имеет право требовать прекращения обработки + уничтожения PD. Сроки реакции — до 30 дней.
- 152-ФЗ ст. 9: согласие должно быть конкретным, информированным, сознательным. **Версионирование согласия обязательно** — пользователь, давший согласие на v1, не считается давшим согласие на v2.
- Спец. категория ПДн (медицинские) — повышенный режим (152-ФЗ ст. 10).
- УЗ-3 (предположение по DSO-63 #7) — требует журналирование + контроль доступа + шифрование at rest.
- [[feedback_docs_as_ssot]]: retention matrix должна быть **в коде**, не только в Notion — single source of truth, валидируется через CI.

---

## 2. Decision

### 2.1 Consent versioning

- **Каждая версия consent text'а** имеет immutable record `consent_versions(id, version_tag, locale, body_markdown, effective_from, sha256)`.
- **Каждый акт согласия пользователя** — `consent_acceptances(subject_id, consent_version_id, accepted_at, ip, user_agent, channel)` (append-only, без UPDATE/DELETE).
- **При изменении текста согласия** (новая локаль, новая редакция) — создаётся новая версия; пользователи, чья последняя акцептованная версия отстаёт, получают prompt при следующем логине.
- **Withdrawal** (отзыв согласия) — отдельная append-only таблица `consent_withdrawals(subject_id, consent_version_id, withdrawn_at, channel)`. Запись о согласии не удаляется (доказательство, что в момент времени согласие было), но отзыв применяется к active state.
- **AI consent class** (отдельный consent на обработку PD моделями LLM, включая dual-LLM flow) — см. ADR-0010 §«Consent & audit»: классификация AI-actions требует отдельной consent-версии и audit-класса; consent-таблицы остаются те же, добавляется `consent_kind = 'ai_processing'`.

### 2.2 Data subject rights endpoints

API (NestJS, ADR-0002) выставляет под `/me`:

| Endpoint                    | Описание                                                                                         | SLA         |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| `GET /me/consent`           | Активные согласия, их версии, история.                                                           | sync        |
| `POST /me/consent/withdraw` | Отзыв согласия + cascading effects (deactivation, etc).                                          | sync        |
| `GET /me/data-export`       | Машинно-читаемый дамп всех PD пользователя (JSON). Async — выдаётся via signed link через email. | ≤ 7 дней    |
| `POST /me/erasure-request`  | Запрос на удаление. Status tracking, audit log, ручной review legal-офицером при необходимости.  | ≤ 30 дней   |
| `GET /me/audit-log`         | Лог доступа к собственным данным (ст. 14).                                                       | sync, paged |

Endpoint'ы — обязательная часть pre-pilot (engineering-readiness §5 BLOCKER).

### 2.3 Erasure semantics

**Три уровня erasure**, выбираемые архитектурой per table:

| Уровень          | Поведение                                                                                                         | Применимо к                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Hard delete**  | `DELETE FROM ...`, tuple исчезает.                                                                                | mutable PD без legal hold (профиль, контактные данные, marketing consent)          |
| **Tombstone**    | Замена PD-полей на `NULL` или `'<erased>'`; запись остаётся со ссылочной целостностью; tombstone-flag для аудита. | append-only логи действий, где факт действия важен, но identity субъекта удаляется |
| **Crypto-shred** | Field-level encryption per subject; уничтожение ключа = эффективная erasure.                                      | audit_ledger, backup snapshots, AI-zone embeddings, archived blobs                 |

**Per-table policy** фиксируется в retention matrix (см. design spec §3) + enforced через migrations + CI lint.

Forward-ref: контракт исполнения erasure (BullMQ-задача `erasure-execute`, idempotency, cross-zone propagation) — см. `2026-05-18-ds-platform-bullmq-queue-contract-design` (queue `pd-lifecycle`).

### 2.4 Audit log + tombstoning compatibility

`audit_ledger` (ADR-0003 §6) — append-only, hash-chained. Erasure обрабатывается без разрыва цепочки:

- **Subject-identifying поля** в audit-row (subject_id, ip, ua) шифруются **отдельным ключом per subject**, хранящимся в Vault.
- **Erasure request** → уничтожение ключа в Vault (key-zeroization). Hash-chain остаётся валидным; tuple остаётся; subject-identifying данные становятся нечитаемыми.
- **Audit exception clause** (152-ФЗ — обязательность хранения некоторых событий) — реализуется через retention matrix: `audit_ledger` retention 5y (НК РФ + medical compliance), crypto-shred at term.

### 2.5 Backup erasure policy

- **Primary backups (Timeweb)**: 30d retention; erasure через crypto-shred per-subject ключа.
- **Offsite backups (Beget S3)**: 90d retention; crypto-shred per-subject ключа.
- **Quarterly archives**: 1y retention; crypto-shred per-subject ключа.
- **Ключи хранятся в Vault на отдельной VM** (см. DSO-63 #9 backup topology).
- **Erasure SLA** — 30 дней (152-ФЗ ст. 14). Crypto-shred ключа → данные становятся нечитаемыми сразу; физическое удаление tuple — по backup-retention rotation.
- **Legal hold** (litigation, регулятор) — override; ключ сохраняется до снятия hold; tuple помечается `legal_hold = true`.

### 2.6 Retention matrix

Полная матрица per entity/table — в design spec §3. Краткий вид:

| Entity                                   | Legal basis                 | Retention                      | Erasure                                  | Audit exception            |
| ---------------------------------------- | --------------------------- | ------------------------------ | ---------------------------------------- | -------------------------- |
| `users`                                  | 152-ФЗ ст. 6 п. 1 / consent | active + 3y after deactivation | hard delete + tombstone where referenced | none                       |
| `consent_acceptances`                    | 152-ФЗ доказательство       | 5y after withdrawal            | tombstone (subject_id encrypted)         | proof retained             |
| `consent_withdrawals`                    | 152-ФЗ доказательство       | 5y                             | tombstone                                | proof retained             |
| `audit_ledger`                           | 152-ФЗ + НК РФ + medical    | 5y                             | crypto-shred at term                     | retain hash-chain          |
| `payments`                               | НК РФ ст. 23                | 5y                             | no deletion (audit exception)            | full retention             |
| `webinar_attendance`                     | НМО compliance              | 3y                             | tombstone                                | retain attendance proof    |
| `marketing_consent` / `marketing_events` | consent                     | until withdrawn + 90d          | hard delete                              | retain proof of revocation |
| `embeddings` (AI-zone, derived)          | derivative                  | recomputable                   | recompute or delete                      | n/a                        |
| `prompt_eval_corpus` (AI-zone)           | consent                     | per-corpus consent             | delete                                   | n/a                        |

### 2.7 Cross-zone erasure propagation

См. ADR-0011 §3 (Egress control plane). Erasure request в RF-zone backend → событие в outbox → AI-zone subscriber → удаление эмбеддингов + corpus entries. Audit per event.

### 2.8 Operator workflow

- Erasure requests **по умолчанию** processed автоматически (subject клик в UI → API → execution).
- **Manual review legal-офицером** требуется в случаях: legal hold flag, активные процессы (litigation, аудит), запрос охватывает несколько subject'ов одновременно (potential abuse).
- **Admin app (`admin.doctor.school`)** имеет очередь erasure-requests с возможностью block / override / annotate.
- Audit log каждого решения admin.

### 2.9 Schema location

Все PD-lifecycle таблицы (`consent_*`, `data_export_requests`, `erasure_requests`) живут в `packages/db/schema/pd/` (ADR-0003 amendment по DSO-63 #10/I — schemas в `packages/db/`, не в `apps/api`).

---

## 3. Alternatives considered

### 3.1 Distributed consent management (без отдельного ADR)

**Отвергнуто.** Размазывание consent / erasure logic по ADR-0001, engineering-readiness, data-layer-design делает невозможным cross-table coherence (backend пишет, audit shred'ит ключ, AI-zone удаляет embeddings — все три должны соблюдать один контракт). Single ADR + design spec — обязательное условие.

### 3.2 Soft delete без crypto-shred

**Отвергнуто.** Soft-delete (`deleted_at IS NOT NULL`) не покрывает backups — данные продолжают существовать в pgbackrest snapshots месяцами. 152-ФЗ требует фактического прекращения обработки, не флага.

### 3.3 Полное физическое удаление из audit_ledger

**Отвергнуто.** Уничтожает hash-chain → теряем способность доказать факт события для регулятора. Crypto-shred per subject — корректный компромисс: hash-chain остаётся валидным, subject-identifying фрагменты не читаемы.

### 3.4 Третья сторона / DPaaS (data privacy as a service)

**Отвергнуто.** Все RF DPaaS либо outside-RF (нарушает 152-ФЗ), либо в стадии beta (нет mature option в 2026). Self-hosted решение в новой системе — единственный вариант.

---

## 4. Consequences

### Positive

- Один archetype-документ для AI-агентов / разработчиков / юристов. Никаких «а где про consent?» — везде forward-reference на ADR-0009.
- Crypto-shred per subject — отвечает 152-ФЗ требованию по бэкапам без перехода на короткий backup retention.
- Retention matrix как code (CI-validated) — отсутствует drift с реальностью.
- Engineering-readiness §5 BLOCKER closed — pre-pilot launch не блокируется отсутствием консент-инфраструктуры.

### Negative / costs

- Дополнительные таблицы (`consent_*`, `data_export_requests`, `erasure_requests`) + cron-jobs + admin UI — ≈ 2 недели backend + 1 неделя admin frontend.
- Vault для key-per-subject — дополнительная инфра (отдельная VM). Альтернатива — хранение ключей в Postgres под master-key, проще, но weaker isolation; решение в design spec §5.
- Каждый new table с PD должен пройти retention-matrix CI check — небольшой overhead на migrations.

### Дальнейшие зависимости

- **DSO-X1 (Directual cutover, DSO-63 #4)** — first-login flow должен capture consent v1 (см. ADR-0001 §9 amendment по DSO-63 #4).
- **DSO-X2 (РКН + ФСТЭК-21, DSO-63 #7)** — Privacy Notice ссылается на consent versions + retention matrix.
- **ADR-0011 (Egress control plane)** — пропагирует erasure в AI-zone.

---

## 5. Deferred / Open Questions

- **OQ-PD-1:** Vault deployment topology — отдельная VM с Hashicorp Vault vs Postgres + sealed master-key. Решается в design spec §5; trigger — IdP-spike результат (если IdP управляет своими секретами через Vault, переиспользуем; если нет — отдельный экземпляр).
- **OQ-PD-2:** Точный SLA на data-export (sync vs async) — зависит от объёма PD per subject. Pre-pilot — async by default (signed link via email). Pilot — измерить, оптимизировать если возможно.
- **OQ-PD-3:** Granular consent — per-purpose (educational content vs marketing vs research) — vs всё-в-одном. Решается в design spec §2 (skew towards per-purpose, не блокирует ADR).

---

## 6. Cross-references

- **Plane:** DSO-63 finding #5 + #6.
- **Design spec:** `apps/docs/content/adr/0009-pd-lifecycle-and-consent-design-ru.md` (retention matrix, schemas, endpoints).
- **Forward-refs из этого ADR:** ADR-0001 §134-141 (consent), `engineering-readiness §5` (BLOCKER list), `data-layer-design §2.5` (OQ-D3 closed by §3 retention matrix), ADR-0011 (egress propagation).
- **Memory:** [[feedback_docs_as_ssot]], [[feedback_rf_blocked_services]].
