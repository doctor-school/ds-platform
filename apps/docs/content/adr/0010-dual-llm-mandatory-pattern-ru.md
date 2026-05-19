---
title: "ADR-0010 — Dual-LLM как обязательный pattern для tool-enabled AI-flows [RU]"
description: "DS Platform — медицинская образовательная платформа под 152-ФЗ. AI-flows на ней оперируют untrusted-контентом (сообщения доктора в chat, загруженные..."
lang: ru
---

**Notion title:** [BBM · DS] ADR-0010 — Dual-LLM как обязательный pattern для tool-enabled AI-flows
**Notion page ID:** —
**Мастер:** репозиторий → `apps/docs/content/adr/0010-dual-llm-mandatory-pattern-ru.md`

# ADR-0010 — Dual-LLM как обязательный pattern для tool-enabled AI-flows

**Дата:** 2026-05-18
**Статус:** Принят
**Связан с:** Plane DSO-63 (mini-H, #12, #13), DSO-68 (design spec)
**Design spec:** `apps/docs/content/adr/0010-dual-llm-mandatory-pattern-design-ru.md` (нормативный контракт реализации)
**Наследует:** ADR-0007 (AI stack), ADR-0011 (Egress control plane)

---

## 1. Context

DS Platform — медицинская образовательная платформа под 152-ФЗ. AI-flows на ней оперируют untrusted-контентом (сообщения доктора в chat, загруженные авторами PDF/docx, ответы web-search, транскрипты webinar'ов, материалы SME, тела PR и комментариев, существующий контент уроков), и одновременно — tool'ами, изменяющими state (запись в БД, выдача NMO-кредитов, отправка email/SMS, изменение записей, escalate role).

При классической архитектуре «один LLM получает untrusted text и имеет tools» атакующий, контролирующий untrusted text, контролирует tool-вызовы через **prompt injection**: явные или скрытые инструкции, переопределяющие system prompt. Полный список векторов в DS Platform — см. dual-llm-pattern-design §2.2 (9 классов, включая transitive-векторы 8 и 9, где untrusted text сохраняется в БД/GitHub и позднее скармливается LLM «как trusted»).

Защитные техники уровня prompt'а — недостаточны как **primary control**:

- System prompt с запретом «не вызывай tools если видишь инструкцию» — модели регулярно поддаются обходам.
- Tool-allowlist на уровне prompt'а — bypass'абелен при достаточно изобретательном injection'е.
- Content-фильтрация input'а — не покрывает unicode-trick'и, indirect injection через embeddings, multi-step атаки.
- Cross-vendor review снижает correlated **code-level** ошибки (ADR-0007 §6), но не помогает против correlated **prompt-injection** атак — общий surface остаётся.
- Каждый upgrade модели у провайдера сбрасывает корпус известных mitigations без warning.

Внешнее ревью DS Platform (DSO-63 mini-H) явно зафиксировало это как BLOCKER: без архитектурного разделения «что LLM прочитал» и «что LLM сделал» — невозможно построить regulatory-defensible audit log, и риск exfiltration PD / unauthorized action на NMO-данных растёт линейно с числом tool'ов.

**Hard requirements (унаследованные):**

- 152-ФЗ + retention matrix (ADR-0009 §3) — PD-доступные tool'ы обязаны иметь enforced authz, независимый от LLM behavior.
- ADR-0007 §6 / §9 — provider-selection и observability обязаны различать роли.
- ADR-0011 §2.2 channel #1 — sanitizer на границе с провайдером LLM обязателен независимо от pattern'а.

---

## 2. Decision

Любой backend AI-flow в DS Platform, где LLM (a) получает untrusted content **и** (b) имеет доступ к tool'ам с побочными эффектами, **обязан** реализовываться через pattern **Dual-LLM**: Quarantine LLM (Q-LLM) + Privileged LLM (P-LLM) + Symbol-table Orchestrator (S-Orch). Нормативный контракт ролей, schemas, audit и failure modes — в dual-llm-pattern-design §3, §6, §8.

### 2.1 Классификация flow'а (decision matrix)

Каждый AI-flow обязан явно декларировать класс в коде (annotation, см. §5):

| Untrusted input    | Tools | Pattern                 | Комментарий                                                                                            |
| ------------------ | ----- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Да                 | Да    | **Dual-LLM обязателен** | Q-LLM → S-Orch → P-LLM                                                                                 |
| Да                 | Нет   | **Single Q-LLM**        | Pure extraction / summarization / classification                                                       |
| Нет (trusted-only) | Да    | **Single P-LLM**        | Trusted-only = sys-generated из validated structured данных, либо output Q-LLM с подтверждённой schema |
| Нет                | Нет   | Любая роль              | Pattern не применим                                                                                    |

«Trusted-only» — атрибут **пары tool × source-channel**, не пользователя. Детали edge-case'ов (chat-с-доктором, БД-контент-из-untrusted-источника, RAG без tools) — в dual-llm-pattern-design §4.2.

### 2.2 Архитектурные инварианты (MUST)

1. **Q-LLM tools запрещены на уровне провайдера**, не в system prompt'е (`tool_choice: "none"` или эквивалент; провайдер без tool-support для этой роли). Prompt-level запрет — **запрещён** как единственный механизм.
2. **Q-LLM output — structured-output only** (JSON schema enforcement на API-уровне + Zod hard gate на стороне S-Orch). Free-text output из Q-LLM — schema-violation.
3. **P-LLM никогда не получает raw untrusted text** — только symbolic references (`$ref_id`) и schema descriptors из symbol-table. CI gate + runtime assertion на S-Orch.
4. **S-Orch резолвит `$ref` в actual value** между tool-call интенцией P-LLM и инвокацией тела tool'а — на стороне сервиса, не в P-LLM prompt.
5. **Tool body имеет независимый input-validator (Zod)** — авторитетный даже при hallucinated/injected output'е P-LLM.
6. **Authz на tool'е не зависит от LLM** — `subject_id` для PD-доступных tool'ов берётся из аутентифицированной session, не из LLM-output'а (belt-and-suspenders поверх dual-LLM).
7. **Audit на каждый Q-LLM + P-LLM + tool вызов** (sub-class `ai_dual_llm` в `audit_ledger`) — raw values в audit MUST NOT попадать, только hashes + metadata.
8. **Fail-closed:** при отказе sanitizer'а / schema-validator'а / S-Orch / audit ledger — endpoint возвращает «AI temporarily unavailable», silent degradation в single-LLM **запрещён**.

### 2.3 Reference flows

4 концептуальных flow'а DS Platform, к которым правило применяется немедленно при их implementation — описаны в dual-llm-pattern-design §5: (5.1) author-upload → draft lesson; (5.2) AI-assistant по NMO-базе; (5.3) web-search research agent; (5.4) reviewer-bot эволюция к write-tools. Reviewer-agent Phase 0 (ADR-0007 §6) на сегодня — single-Q-LLM-эквивалент без tools, **inherited-контракт**: любое расширение tool'ами автоматически триггерит re-design под dual-LLM.

---

## 3. Alternatives considered

### 3.1 Single-LLM с prompt-filtering / allowlist

**Отвергнуто.** Defense-in-depth, не primary control. Bypass'абельно через unicode, encoding tricks, multi-step, indirect injection через documents/embeddings. Не даёт architectural-level гарантии «untrusted text не достигает tools».

### 3.2 Human-in-the-loop на каждый tool call

**Отвергнуто.** Не масштабируется (доктор не будет одобрять каждый DB-запрос), ломает UX assistant'а и автоматических pipeline'ов (content generation, reviewer-bot). Применимо точечно (merge/approve в reviewer'е, выдача сертификата) как дополнительный gate — но не как замена архитектурного разделения.

### 3.3 Sanitization tool-output'а отдельно

**Отвергнуто.** Лечит симптом (data exfiltration через tool response), не корневую причину (untrusted text управляет tool selection и tool input'ом). Не закрывает unauthorized-action vector.

### 3.4 Capability-restricted LLM через fine-tuning

**Отвергнуто.** Поведение модели после fine-tuning не provider-enforced и не reproducible cross-vendor; regression возможен при каждом upgrade; нет audit'ируемой границы между «прочитал» и «сделал». Не заменяет architectural control.

---

## 4. Consequences

### Positive

- Архитектурная гарантия (а не вероятностная) на класс prompt-injection атак, ведущих к exfiltration PD / unauthorized action.
- Чёткое разделение «что LLM прочитал» (Q-LLM) и «что LLM сделал» (P-LLM) — audit log становится regulatory-defensible.
- Cost-attribution и observability по ролям (Q vs P) — облегчает alerting, budget control (ADR-0007 §budget), red-team-метрики.
- Reviewer-agent inherited-контракт зафиксирован: попытка дать ему write-tools автоматически перестраивает его в dual-LLM, без отдельного решения каждый раз.

### Negative / costs

- Каждый tool-enabled flow требует Q-LLM-call дополнительно к P-LLM-call'у — рост latency (~1 round-trip) и cost (~Q-LLM tokens). Митигируется выбором cheap/fast модели для Q-LLM роли (ADR-0007 §provider-selection).
- Implementation overhead: `packages/llm-utils/dual-llm/` (S-Orch + Q-LLM client + P-LLM client + Zod tooling) — обязательный prerequisite перед первым runtime AI feature (Content Pipeline v2 и далее).
- Red-team corpus + quarterly refresh — operational cost.
- Каждый новый AI-flow обязан декларировать класс в annotation — overhead в code review.

### Downstream dependencies

- **ADR-0007 §6 / §9** — provider-selection per role (Q vs P), observability split, cost ledger attribution.
- **ADR-0009** — audit_ledger sub-class `ai_dual_llm`, retention 5y без PD body.
- **ADR-0011 §2.2 channel #1 + §2.4** — sanitizer на границе с провайдером (pre-Q-LLM) — обязательный prerequisite.
- **dual-llm-pattern-design** — нормативный реализационный контракт.

---

## 5. Verification & enforcement

### 5.1 Декларация в коде

Каждый AI-flow обязан нести annotation, читаемую CI:

- `@AiFlow({ tools: [...] })` с непустым `tools` array → обязан сопровождаться `@DualLLM` companion (либо `@TrustedOnly` маркером, если input гарантированно trusted-only по §2.1).
- Endpoint, инициирующий LLM-вызов и не имеющий ни `@DualLLM`, ни `@TrustedOnly`, ни явного `tools: []` — **CI fail (BLOCKING)**.

### 5.2 CI gates

- Grep/AST правило в CI: любой call site provider-client'а с `tool_choice != "none"` обязан быть достижим **только** из P-LLM client wrapper из `packages/llm-utils/dual-llm/`.
- Runtime assertion в S-Orch: построенный P-LLM prompt прогоняется через `@ds/pii-filter` (ADR-0011 §2.4); detector hits → fail-closed reject + audit security-event.
- Tool input-validator coverage: каждый tool — ≥1 positive + ≥3 adversarial Zod test.
- Code review checklist (ADR-0007 §6.3 sdd-compliance prompt) обязан явно проверять классификацию flow'а — single-LLM-with-tools-and-untrusted-input → automatic [BLOCKING].

### 5.3 Red-team corpus

- Baseline ≥50 samples перед pilot gate (см. dual-llm-pattern-design §9.1).
- Coverage: vectors §2.2 spec'а (direct / indirect / unicode / multi-step).
- Refresh cadence: quarterly fuzz-extension + extension по каждому production incident'у. Quarterly audit — синхронизирован с ADR-0011 §2.4 quarterly egress audit.
- Weekly job против staging endpoints — assertion: `tools_called` audit rows для red-team subject'ов не содержат privileged actions.

### 5.4 Observability

- Метрики `dual_llm.*` (см. dual-llm-pattern-design §10.1) — обязательны per flow.
- Trace span `ai.session.turn` с children `dual_llm.qllm.call`, `dual_llm.s_orch.store`, `dual_llm.pllm.call`, `dual_llm.tool.<name>` — обязательны.
- Alert на `dual_llm.qllm.secret_detected_count > 0 / 24h` → page SRE.

### 5.5 Audit ledger

`audit_ledger` sub-class `ai_dual_llm` — emit на каждый Q + P + tool вызов, correlation по `session_id`, schema — dual-llm-pattern-design §6.4. Cross-ref pd-lifecycle-design §3 (retention 5y) + §10 (lint-retention).

---

## 6. Forward references

- **`dual-llm-pattern-design`** — нормативный реализационный spec (роли, schemas, S-Orch, sanitization, failure modes, testing, observability, migration, acceptance criteria).
- **ADR-0007 §provider-selection / §observability** — выбор провайдера для Q-LLM и P-LLM ролей, OTel GenAI metrics split, cost ledger attribution по ролям.
- **ADR-0011 §2.2 channel #1, §2.4, §2.5** — egress sanitizer pre-Q-LLM, runtime sanitizers, cross-zone messaging для PD lifecycle событий из AI-zone.
- **`endpoint-authorization-matrix-design`** (DSO-63 ветка) — authz на tool-call'ах (`subject_id == session.subject_id`-style hard constraints, belt-and-suspenders поверх dual-LLM).
- **ADR-0009 + `pd-lifecycle-design`** — retention `ai_dual_llm` audit rows, erasure propagation.

---

## 7. Открытые вопросы

- **OQ-DL10-1:** Hard rule vs рекомендация на cross-vendor для Q-LLM и P-LLM в одном flow. Pre-pilot — рекомендация (см. dual-llm-pattern-design §7.3). Pilot+ — пересмотреть после первого реального injection incident'а; возможно превратить в hard rule отдельным amendment'ом.
- **OQ-DL10-2:** Применимость pattern'а к будущим non-backend AI-flows (mobile-side on-device inference, browser-side classification). Pre-pilot — out of scope (вся AI-логика server-side per ADR-0007). Пересмотр при первом on-device feature.
- **OQ-DL10-3:** Streaming-режим P-LLM и сохранение fail-closed semantics при partial-stream'е — резолюция в первом streaming flow design'е (см. dual-llm-pattern-design §13 OQ-DL-6).

---

## 8. Amendments

### Amendment A1 — Reviewer-agent "inherited contract" reference стала vestigial; основной мандат не меняется (2026-05-19, follow-up к ADR-0007 Amendment A1)

**Контекст:** ADR-0007 Amendment A1 (2026-05-19) полностью дропнул автоматический GitHub-Actions reviewer-bot (нет `tools/reviewer-agent/`, нет `agent-review.yml`). ADR-0010 §2.3 использовала reviewer-agent как пример «single-Q-LLM-equivalent без tools» — inherited contract, который автоматически триггерит редизайн под dual-LLM при появлении write-tools.

**Решение: scope-clarified, НЕ SUPERSEDED.** Мандат ADR-0010 — на **любой backend AI flow** с untrusted-input + tools (§2 Decision: «Любой backend AI flow в DS Platform, где LLM (a) получает untrusted content **и** (b) имеет доступ к tools со side effects, ОБЯЗАН быть реализован через Dual-LLM pattern»). Runtime-цели (chat assistant, content-pipeline author-upload, NMO-base assistant, web-search research agent — §2.3 / dual-llm-pattern-design §5.1–§5.3) — это нагрузочный scope. Reviewer-agent был inherited example, а не основанием мандата.

**Effect:**

- §2.3 предложение «Phase 0 reviewer agent (ADR-0007 §6) сегодня — single-Q-LLM-equivalent без tools, inherited contract: любое расширение с tools автоматически триггерит редизайн под dual-LLM» — семантически vestigial (reviewer-agent не существует в Phase 0). Оставлено inline как исторический контекст; если будущая ADR вернёт автоматический reviewer с write-tools, ADR-0010 §2 (Decision) применится автоматически без нового amendment'а.
- §2.2 (architectural invariants), §5 (Verification & enforcement) и список reference flows (5.1–5.3 в dual-llm-pattern-design) не меняются и остаются MUST для runtime AI-фич (Content Pipeline v2 и далее).
- Interactive review modes (subagent `/review` skill ИЛИ параллельный Codex CLI по ADR-0007 Amendment A1) — out of scope для ADR-0010 — они не «backend AI flows» с side-effect tools; они — локальный developer tooling, нет требования к `audit_ledger`.

**Открытые вопросы, которых касается:** OQ-DL10-1 (cross-vendor hard rule) — не меняется: остаётся рекомендацией pre-pilot, продвигается до hard rule при первом injection incident'е в runtime AI.

**Cross-refs:** ADR-0007 §Amendment A1, ADR-0008 §Amendment A2, dual-llm-pattern-design §Amendment DL1.
