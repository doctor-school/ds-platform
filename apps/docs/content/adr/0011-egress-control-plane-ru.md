---
title: "ADR-0011 — Egress Control Plane [RU]"
description: "> Note: ADR-0010 пропущен в нумерации намеренно — оставлен как reserve для будущего ADR «RF edge & comms providers», если в Phase 1 потребуется..."
lang: ru
---

> **EN:** [`0011-egress-control-plane-en.md`](./0011-egress-control-plane-en.md) · **RU (this)**

# ADR-0011 — Egress Control Plane

**Дата:** 2026-05-18
**Статус:** Accepted
**Связан с:** Plane DSO-63 (cross-cutting finding #13), milestone DSO-24
**Design spec:** sections в `engineering-readiness §3` (telemetry classification — DSO-63 #12) + `ai-stack-design §6` (sanitizer pattern)
**Наследует:** ADR-0007 (AI zone), ADR-0008 (GitHub external dependency), ADR-0009 (PD lifecycle — erasure propagation)

> **Note:** ADR-0010 пропущен в нумерации намеренно — оставлен как reserve для будущего ADR «RF edge & comms providers», если в Phase 1 потребуется отдельный ADR-уровневый документ (текущая резолюция DSO-63 #8 — design-spec-level, см. engineering-readiness §5).

---

## 1. Context

Внешнее ревью архитектуры DS Platform (DSO-63) выявило, что egress PD/секретов из RF-зоны возможен не только через основной AI-канал (Anthropic / OpenAI), но через **множество разрозненных каналов**: GitHub issues / PR bodies, reviewer agent prompts, cost ledgers, dependency registries, screenshots в crash-reports, support tools, analytics events, prompt-eval corpora.

> «The same problem appears in many places, not only runtime AI: GitHub issues, PR bodies, reviewer agents, logs, traces, crash reports, cost ledgers, screenshots, support tickets, analytics events, and prompt-eval corpora. The architecture needs one shared egress policy that all ADRs inherit.» — Claude review, cross-cutting concern.

Текущая архитектура **верно** изолирует AI-zone от RF-zone (ADR-0007), но не покрывает «soft» egress-каналы. Без единой policy AI-агенты, работая над разными модулями, не имеют consistent правил «что можно отправить наружу».

Параллельно, ADR-0009 ввёл cross-zone erasure propagation (PD lifecycle → AI-zone subscriber удаляет embeddings). Это требует **формального контракта** на cross-zone messaging: какие события разрешены, что в них может находиться, кто аудитирует.

**Hard requirements:**

- 152-ФЗ: PD не покидает RF-территорию кроме исключений (ст. 12) — у нас исключений нет, поэтому **PD никогда не пересекает RF-границу**.
- УЗ-3 (предположение per DSO-63 #7): контроль трансграничных передач.
- ADR-0007: AI-zone outside-RF, с PII-filter; этот ADR расширяет: PII-filter применяется ко **всем** outbound каналам, не только runtime AI.
- [[feedback_rf_blocked_services]]: outbound dependencies от Cloudflare и других RF-blocked services запрещены.
- [[feedback_docs_as_ssot]]: approved channels list — в коде / CI-config, не только в Notion.

---

## 2. Decision

### 2.1 Принципы

1. **PD / секреты не покидают RF-зону**, кроме явно одобренных каналов из §2.2.
2. **Default deny:** новый external API / SaaS / outbound channel — отдельное решение (mini-ADR или ревизия этого ADR). Не «agent решает на ходу».
3. **Каждый одобренный канал имеет три гарантии:**

- **Sanitizer** (что именно сейчас можно отправить) — реализация в коде, не на доверии.
- **Audit** (per-call log: что отправлено, кому, статус санитации).
- **Opt-out / kill switch** (быстрое отключение канала).

4. **Cross-zone messaging** (RF ↔ AI) — формальный outbox/inbox контракт с явной schema каждого event-type.
5. **Cross-domain monitoring:** quarterly audit egress-каналов; red-team тесты на каждом канале минимум 1x/квартал.

### 2.2 Approved egress channels

Таблица одобренных каналов egress наружу RF-зоны или вне основного backend периметра. Каждый канал — отдельная enforcement-конфигурация.

|   # | Канал                                                 | Назначение                                                           | Что разрешено                                                                                                                       | Sanitizer                                                                                             | Audit                                                                                                                             | Owner                |
| --: | ----------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
|   1 | **Anthropic / OpenAI API** (RF→AI zone runtime)       | LLM completions для AI features (recommendations, content gen v2/v3) | Sanitized prompts only (PII filter из ADR-0007 §6). Никаких raw subject_id / PD-полей в prompt body.                                | `@ds/pii-filter` pre-call. Reject если patterns совпадают.                                            | Per-call log: model, tokens_in/out, sanitization_status, cost_estimate, request_id. Лог в `audit_ledger` (sub-class `ai_egress`). | AI lead              |
|   2 | **GitHub** (repo, issues, PRs, commits)               | Source code + spec docs + tracking. ADR-0008 sole hub.               | Code, docs, ADR/spec text. **Никаких real PD-fixtures, никаких production-data dumps, никаких prod secrets.**                       | git pre-commit hook `tools/pii-scanner-precommit` (regex + structured AST). Fail → блок коммита.      | Quarterly review git history (audit job). Per-PR — agent reviewer бот проверяет diff.                                             | Tech Lead / All devs |
|   3 | **GitHub Actions runs** (CI logs, artifacts)          | Build / test / deploy automation.                                    | Build outputs only. Runtime PD не должен попадать в logs (нет смысла CI читать prod DB; integration тесты — только synthetic data). | Log scrubber post-job (drop env-secrets, regex PII). Artifact retention 30d.                          | CI log access audit (admin-only after 30d).                                                                                       | DevOps               |
|   6 | **Dependency registries** (npm, pip, crates.io, EXPO) | Скачивание зависимостей при build.                                   | Outbound code + manifest only. **Never** publish что-либо из приватного code в публичные registry.                                  | `npm publish` блокирован на private packages; CODEOWNERS + 2-person approval для public releases.     | Release log (per publication).                                                                                                    | DevOps               |
|   7 | **RF Edge providers** (SMS, email — DSO-63 #8)        | Auth flows, magic-link, transactional notifications.                 | Subject phone/email + content (transactional text); **не AI-zone derived**. RF-located processors only.                             | Pre-call validation: provider в registry §8, subject consent active.                                  | Per-message audit row (recipient hash, channel, provider, status). 152-ФЗ DPA.                                                    | Backend / Marketing  |
|   8 | **Outbox events RF→AI zone** (cross-zone messaging)   | PD lifecycle propagation (erasure), content updates для embeddings.  | **Pseudonymous references** (sha256(subject_id) с pepper). Event payload sanitized per schema.                                      | Schema validation (Zod) на отправке; AI-zone subscriber отвергает payload, не соответствующий schema. | Both-sides log: outbox emit + inbox consume + ack. Audit per event.                                                               | AI lead / Backend    |
|   9 | **Ack events AI→RF zone**                             | Acknowledgement erasure propagation, embedding rebuild status.       | Metadata only: event_id, status, processed_at. **Никаких** AI-zone-internal данных.                                                 | Schema validation на обеих сторонах.                                                                  | Audit per ack.                                                                                                                    | AI lead / Backend    |

Forward-ref для канала #1 (AI provider egress): любой runtime LLM-flow с tool-use или внешним user-content обязан соответствовать **dual-LLM mandatory pattern** — Quarantined LLM ↔ Privileged LLM split, symbolic references. См. **ADR-0010** + design spec **`2026-05-18-ds-platform-dual-llm-pattern-design`**. `@ds/pii-filter` остаётся как первый слой защиты, dual-LLM — как второй (запрет на эскалацию prompt-injection в действия).

### 2.3 Denied channels (until separate decision)

| Канал                                                               | Почему deny                                                                                                        | Условие пересмотра                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **External telemetry SaaS** (Sentry SaaS, Datadog, etc.)            | Outside-RF, отправка stack-traces содержит PD. GlitchTip self-hosted покрывает потребность.                        | Если GlitchTip недостаточен — отдельный ADR.                                          |
| **External analytics SaaS** (Google Analytics, Mixpanel, Amplitude) | Outside-RF, события содержат user behavior data. Self-hosted Plausible / Umami / Matomo — допустимая альтернатива. | Self-hosted доступен; внешний — отдельный ADR.                                        |
| **External CDN / WAF** (Cloudflare и любые RF-blocked)              | [[feedback_rf_blocked_services]]                                                                                   | Никогда (постоянный deny).                                                            |
| **Public LLM playgrounds / chat-UIs** для debug                     | Невозможно гарантировать sanitization.                                                                             | Никогда; debugging через approved channel #1 only.                                    |
| **Screenshots в crash reports** (mobile / web)                      | Невозможно гарантировать отсутствие PD в скриншоте UI.                                                             | GlitchTip configured без attachment support; mobile crash reports без UI screenshots. |

### 2.4 Enforcement

**CI gates** (блокирующие при PR):

- `tools/pii-scanner-precommit` — regex + AST на staging code. Запускается локально (pre-commit) и в CI.
- `tools/audit-egress-channels` — проверяет, что любой outbound HTTP call в коде идёт на endpoint из allowlist (regex match на base URL). Новый external endpoint → CI fail → требует ADR-update.
- `drizzle-kit check` + `lint-retention` (см. ADR-0009 §10) — обеспечивает, что PD-поля корректно классифицированы для erasure-propagation.

**Runtime sanitizers** (loaded в startup):

- `@ds/pii-filter` (sanitizer для AI-zone calls).
- GlitchTip `beforeSend` hook.
- OTel processor (trace attribute allowlist).
- Loki promtail processors.

**Quarterly audit:**

- Review git history на нарушения approved channels list.
- Review egress logs (audit_ledger sub-class `ai_egress`) на anomalies.
- Re-run red-team тесты против каждого approved channel.

**Kill switch:**

- Per-channel feature flag в `.github/agents-config.json` (ADR-0007 §2.11) для канала #1 (AI-связанные). Для каналов #2, #6, #7, #8, #9 — environment-level disable через config.

### 2.5 Cross-zone messaging contract

См. **ADR-0009 §2.7 + design spec §8** для PD lifecycle. Общий принцип:

- **Schema-first:** каждый event-type имеет explicit JSON schema (Zod) с разрешёнными полями.
- **Pseudonymization:** subject identifiers — hash с pepper, не raw.
- **Idempotency:** event_id, дедупликация на consumer side.
- **At-least-once:** outbox pattern (Postgres → RF-zone publisher → AI-zone subscriber).
- **Ack required:** consumer emits ack-event, producer marks outbox row as confirmed.
- **Audit:** оба зоны логируют emit + consume + ack.

---

## 3. Alternatives considered

### 3.1 Per-ADR egress правила (distributed approach)

**Отвергнуто.** Размывание правил по ADR-0007 (AI), ADR-0008 (GitHub), ADR-0006 (docs/SSOT) приводит к inconsistent enforcement. AI-агент, добавляющий новый external API, не знает, какие правила проверять. Cross-cutting policy — единственный workable формат.

### 3.2 «Just don't send PD» (без формального enforcement)

**Отвергнуто.** AI-агенты при написании кода routinely добавляют `console.log(user)` или `Sentry.captureException(err, { extra: { user } })` — это норма везде, кроме систем под compliance. Без CI enforcement правило не работает.

### 3.3 Полная изоляция (air-gap) RF-zone

**Отвергнуто.** Полный air-gap делает невозможным использование AI-агентов для разработки (GitHub, AI providers — все outside-RF). Принимаем compromise: PD не покидает RF-зону, но dev-tooling может.

### 3.4 Service mesh + L7 egress proxy

**Отложено (deferred).** Istio / Linkerd / Cilium egress gateway — мощнее, чем application-level sanitizer, но требует kubernetes (отсутствует pre-pilot, см. tenancy design). Re-evaluate если переходим на k8s в Phase 1+.

---

## 4. Consequences

### Positive

- Один archetype-документ для AI-агентов / разработчиков / compliance: «что можно/нельзя отправить наружу».
- CI gates превращают policy в enforced reality, не «trust the dev».
- Cross-zone messaging contract — теперь architecturally defined, не ad-hoc.
- Quarterly audit + red-team — даёт regulatory-defensible answer на вопрос «как вы предотвращаете утечку».
- Engineering-readiness BLOCKER «dual-LLM PII filter» (см. DSO-63 mini-H) теперь имеет проектную опору.

### Negative / costs

- `@ds/pii-filter` + sanitizer тулинг — implementation cost, ≈ 1 неделя backend + 1 неделя CI tooling.
- Quarterly audit job — operational cost (4 часа квартал).
- Каждый new external endpoint требует ревизии этого ADR (overhead, но это by design).

### Downstream dependencies

- **ADR-0009 §2.7 (cross-zone erasure)** — конкретный event-type из §2.5 этого ADR.
- **ai-stack-design §6** — должен ссылаться на §2.2 channel #1.
- **engineering-readiness §3** — telemetry policy (#12) внедряет sanitizers из §2.4 этого ADR.
- **repo-strategy-design** — GitHub vendor risk note (DSO-63 #14) ссылается на §2.2 channel #2.

---

## 5. Deferred / Open Questions

- **OQ-EG-1:** PII-filter implementation: regex-based vs ML-based (entity recognition). Pre-pilot — regex (deterministic, simple, fast). Pilot+ — может потребоваться ML для сложных случаев (free-text input). **Резолюция:** regex pre-pilot, evaluate ML at pilot kick-off.
- **OQ-EG-2:** Cost ledger строит history содержащих aggregate token-counts. Возможна утечка через статистические атаки (выявить кто использует AI). **Резолюция:** для pre-pilot — accept risk, audience ledger'а — внутренний; для scale — отдельный noise-injection.
- **OQ-EG-3:** Cross-zone messaging — нужен ли отдельный security perimeter (VPN, mTLS, dedicated VPS)? **Резолюция:** mTLS pre-pilot (cheap, standard); dedicated VPN — pilot+ если объём сильно вырастет.

---

## 6. Cross-references

- **Plane:** DSO-63 finding #13 (parent), #12 (telemetry), #5/#6 (PD lifecycle).
- **ADR:** ADR-0007 (AI zone), ADR-0008 (GitHub), ADR-0009 (PD lifecycle, erasure propagation).
- **Specs:** `ai-stack-design §6` (sanitizer pattern), `engineering-readiness §3` (telemetry classification, §5 dual-LLM blocker).
- **Source:** `outputs/2026-05-18-ds-platform-external-validation-findings.md`.
- **Memory:** [[feedback_rf_blocked_services]], [[feedback_docs_as_ssot]].
