---
title: "ADR-0007 — AI Stack для DS Platform: Phase 0 methodology + deferred runtime [RU]"
description: "DS Platform — greenfield TS/Postgres платформа, разрабатывается в Phase 0 преимущественно AI-агентами (Claude Code и Codex) при минимальной команде..."
lang: ru
---

> **EN:** [`0007-ai-stack-en.md`](./0007-ai-stack-en.md) · **RU (this)**

# ADR-0007 — AI Stack для DS Platform: Phase 0 methodology + deferred runtime

**Дата:** 2026-05-15
**Статус:** Accepted
**Связан с:** Plane DSO-30 (`fce557aa-4cfd-4466-b487-5ba165501a1f`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0007-ai-stack-design-ru.md`
**Наследует:** ADR-0001 (Zitadel), ADR-0002 (NestJS + BullMQ), ADR-0003 (Postgres17 + pgvector), ADR-0004 (Next.js 15 + ESLint guards), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs + Keystatic + SDD + GitHub Issues task split)

---

## 1. Context

DS Platform — greenfield TS/Postgres платформа, разрабатывается в Phase 0 преимущественно AI-агентами (Claude Code и Codex) при минимальной команде (Tech Lead + продукт-владелец Product Lead-нетехнарь, без второго инженера). Документация и task tracking уже зафиксированы в ADR-0006 (SDD-формат, GitHub Issues, glossary-SSOT, drift detection). Что ещё не зафиксировано:

- **Как агент проходит итерацию** — какой цикл (READ → PLAN → RED → GREEN → REFACTOR → checklist → PR → merge), какие методологии (SDD/TDD) hard rules vs soft.
- **Как любой агент (Claude Code, Codex, будущий Cursor) подхватывает контекст в начале свежей сессии**, без stale-state файлов.
- **AI-specific drift guards** поверх general'ных в ADR-0006 §7 — что ловит нарушение SDD-link, TDD-discipline, ADR-compliance.
- **Review-режимы** — какой путь ревью (subagent, параллельная Codex CLI сессия, чистый human) допустим и когда положительный verdict разрешает auto-merge.
- **Prompt-caching и cost discipline** — без gateway инфраструктуры (которая преждевременна для Phase 0).
- **Autonomy ladder** — какой review-путь обязателен по каждому PR, какие условия триггернут re-introducing automated reviewer-инфраструктуры.
- **Runtime AI инфраструктура** (LLM gateway, PII-filter, Zone-AI VM, OTel GenAI collector) — нужна для Content Pipeline v2/v3 и AI-рекомендаций v3 (PRD §24, §15), но не для Phase 0 dev-time работы. Должна быть спроектирована **сейчас** (с явными trigger-точками) и **реализована потом** (отдельный ADR на trigger).

Hard requirements:

- AI-friendliness: AI читает доку из репо напрямую, без MCP-fetch proxies (наследуется из ADR-0006).
- Self-host runtime stack (152-ФЗ; см. ADR-0006 §1).
- Mainstream coding-agent ecosystem (Claude Code + Codex покрывают ≥95% market share AI coding assistants 2026).
- [[feedback_docs_as_ssot]]: PR обновляет доку, доки не противоречат коду by construction.
- [[feedback_tech_stack_criteria_no_team_skill]]: intrinsic criteria, no bias arguments от прототипов/привычек.

---

## 2. Decision

### 2.1 Scope ADR-0007 — "Option 2: dev-time + minimum runtime foundation"

ADR фиксирует:

- **Phase 0 dev-time AI-loop methodology** (полная реализация в Phase 0).
- **Deferred runtime architecture** (только дизайн + trigger-условия; реализация — отдельный ADR на trigger).

Не фиксирует:

- Конкретных runtime LLM/TTS/video/image провайдеров — это product-decisions, делегируется на момент trigger'а.
- Vector DB engine choice сверх pgvector default из ADR-0003 — trigger на Qdrant отдельным ADR.

### 2.2 Coding agent harnesses Pre-pilot

- **Primary: Claude Code** (sync, terminal-attached в VSC). Текущий рабочий режим Tech Lead, сохраняется без изменений.
- **Opt-in async: Codex (cloud)** — активируется по решению Tech Lead запустить первую параллельную задачу. AGENTS.md уже совместим с Codex (универсальный constitution из ADR-0006).
- **Deferred: Cursor.** Trigger: наём второго инженера с inline-AI workflow preference.

Все harness'ы проходят один и тот же orchestrated iteration cycle (см. §2.4).

### 2.3 SDD + TDD как hard rules

- **SDD:** никакого production-кода без feature-spec'а в `apps/docs/content/specs/features/NNN-<slug>/` (3 файла: requirements/design/scenarios — формат из ADR-0006 §4). Если spec'а нет — агент сначала пишет через superpowers:brainstorming.
- **TDD:** никакого production-кода без failing test'а. One Vitest test per EARS-требование, naming `it('EARS-N: ...', ...)`. Playwright tests генерируются из `NNN-scenarios.feature` через `playwright-bdd`.
- **Узкие исключения** (typo / doc-only / dep-bumps / regenerated artifacts) документируются в PR description.

Enforcement: AGENTS.md hard rules + machine-checkable CI guards (§2.6).

### 2.4 Цикл итерации — делегирован skill'у `do-feature-iteration`

Каждая итерация реализации проходит оркестрованный цикл: READ relevant ADRs → verify base CI green → RED (failing test) → GREEN (минимум кода) → REFACTOR → iteration-end checklist (dispatch, verdict-gated) → surface decision-debt → PR open → Mode (a) review dispatch (verdict-gated) → respond-to-review до APPROVE + green CI → iteration summary → merge через `gh pr merge <N> --auto --squash --delete-branch`. Положительный verdict Mode (a) или Mode (b) + green CI достаточен для merge; Mode (c)-ревью остаются single human decision.

Procedural source of truth — **`apps/docs/content/skills/do-feature-iteration/SKILL.md`**. Orchestration skill несёт discipline-gate'ы (verdict checklist'а, verdict review, обязательная invocation decision-debt), которые inline narrative checklist обеспечить не может: агент, читающий narrative bullet list, молча пропустит, а агент, который не может пройти дальше без артефакта от subagent'а, пропустить не может. Конкретно:

- **`run-iteration-end-checklist`** работает в dispatch-mode; subagent возвращает строку `VERDICT: N of 12 — <PASS | BLOCKED on #X>`. Lead agent не может пройти дальше checklist gate, пока verdict — `BLOCKED`.
- **`request-mode-a-review`** работает в dispatch-mode; subagent-ревьювер возвращает строку `VERDICT: <APPROVE | REQUEST_CHANGES>`. Lead agent не может invocate'нуть `merge-when-green`, пока последний verdict — `REQUEST_CHANGES` или отсутствует.
- **`surface-decision-debt`** обязателен перед `write-iteration-summary`. Output может быть `[]`, но invocation сам по себе обязателен.

Цепочка `superpowers:*` заменена единственным разрешённым исключением — `superpowers:brainstorming` для spec-authoring — и каталогом discipline-skill'ов в `apps/docs/content/skills/` (процедуры абсорбированы: TDD живёт внутри `do-feature-iteration`, review dispatch — внутри `request-mode-a-review`).

### 2.5 Session bootstrap — `tools/agent-bootstrap.ts`

Детерминистический скрипт, который любой harness запускает в начале свежей сессии. Output — markdown ≤ 2 KB с live state snapshot: git state, open Issues assigned to @me, awaiting-review PRs, ready queue, active spec(s) metadata, recommended next step, context file paths.

Источники истины: `gh` CLI + `git` + spec frontmatter. Никакого state-файла, который мог бы стать stale.

Per-harness integration:

- **Claude Code:** SessionStart hook в `.claude/settings.json`, output идёт в `additionalContext`.
- **Codex:** AGENTS.md «Before any task» первый шаг — execute bootstrap.
- **Manual:** `pnpm bootstrap` alias.

Sketch и edge cases — design spec §4.

### 2.6 AI-specific CI drift guards (поверх ADR-0006 §7)

| Guard                     | Что ловит                                                                                                                                                                                                                           | Severity Phase 0        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **spec-link required**    | PR с label `feature:NNN-<slug>`, не связанный со своей спекой: нет `Closes #N`, у связанного Issue нет (product-тема) milestone, либо отсутствует spec-папка лейбла (`features/NNN-<slug>/`). Non-feature PR (bug/chore) — skipped. | BLOCK                   |
| **TDD signal**            | implementation-only commit без test-файла                                                                                                                                                                                           | WARN v1                 |
| **EARS ↔ test linkage**   | EARS-требование без `it('EARS-N: ...')` теста (content-search across all `apps/**/*.test.ts`)                                                                                                                                       | WARN v1 → BLOCK v2      |
| **Gherkin coverage**      | scenarios без Playwright step реализации                                                                                                                                                                                            | BLOCK (через test fail) |
| **Spec status freshness** | merged PR с label `feature:*`, но spec status='Draft'                                                                                                                                                                               | WARN v1                 |
| **Prior decisions cited** | новый spec без ADR-link в "Prior decisions" если категория ≠ docs-only                                                                                                                                                              | WARN v1                 |

Реализация в `tools/lint/spec-link-lint.ts`, `tools/lint/ears-test-lint.ts`. Эти guard'ы — CI-сигналы, видимые прямо человеку-ревьюверу в PR UI: WARN-guard'ы — non-blocking checks, BLOCK-guard'ы — блокируют merge. Их роль — «подсказать человеку-ревьюверу»; они вход для human review, а не для автоматического ревьювера.

> **Interim semantics note (per ADR-0008 §2.6 deferred branch protection):** пока ADR-0008 §2.6 branch protection отложен до апгрейда плана org'а или перевода репо в public, `BLOCK` читается операционально как **«CI job выходит red, и Tech Lead трактует это как merge-blocker по convention'у»** — тот же outcome на single-developer happy path, без server-side гарантии.

### 2.7 12-item iteration-end checklist (dispatch через `run-iteration-end-checklist`)

Перед `git push` агент диспатчит skill `run-iteration-end-checklist` fresh-context subagent'у (§2.4). Subagent verify'ет:

1. Tests green (unit + e2e)
2. Generated artifacts up-to-date (`pnpm generate:all && git diff --exit-code`)
3. TypeScript compiles
4. Lint clean
5. Module README updated если exports changed
6. Spec `status:` frontmatter обновлён
7. New glossary terms added if domain vocab grew
8. ADR создан если архитектурное решение
9. `apps/docs/content/architecture/` обновлён для cross-cutting изменений
10. `apps/docs/content/operations/` runbook обновлён для ops-relevant изменений
11. Linked Issue получил summary comment (file paths, decisions, что осталось)
12. Vertical-slice DoD (conditional, F-22) — когда итерация закрывает **последний** открытый handler спеки `surface: user-facing`, пользовательский путь проходится end-to-end (browser/E2E green) либо gap — tracked Issue; N/A для `surface: backend-only` или не-финального handler'а

Subagent возвращает `VERDICT: N of 12 — <PASS | BLOCKED on #X>`. Failure любого пункта → no push, либо fix, либо escalate.

### 2.8 Prompt-caching policy

Hard rule в AGENTS.md для всех runtime LLM-вызовов (будущие Content Pipeline и т.д.):

- `cache_control: ephemeral` на 3 stable tier-блоках (Anthropic limit = 4 breakpoints; используется 3 из 4): (1) AGENTS.md+CLAUDE.md concat, (2) active spec 3 файла concat, (3) ADRs sorted concat. Один breakpoint остаётся free для будущего расширения (modules README, persona configs и т.п.).
- **Tier 4 = volatile glossary entries**, intentionally uncached: glossary размещается **last** в payload, **без** `cache_control` — это сохраняет cache hit на tiers 1–3 при изменении glossary (новые термины добавляются по ходу разработки; если бы glossary имел свой breakpoint, каждое изменение инвалидировало бы весь prefix).
- НЕ кешировать также: user dialogue / current task instructions (по определению volatile).
- **Стабильный prefix order** обеспечивается общим `packages/llm-utils/buildContext.ts` helper'ом
- Цель: ≥60% cache hit rate на second+ calls в сессии

### 2.9 Cost observability — вручную, per-vendor консоли

Cost-tracking ведётся в собственной консоли vendor'а (Anthropic Console, OpenAI Platform) — Tech Lead проверяет вручную. Никакого headless CI puller'а, `outputs/llm-cost-ledger.csv`, weekly auto-PR, in-line rejection, OTel collector — всё это преждевременно для Phase 0, а многомесячный tuning loop, который они требуют, конкурирует с product-development в velocity-ограниченное pre-pilot окно. Полный runtime observability stack лэндится с trigger-ADR на runtime AI инфру (§2.11).

### 2.10 Autonomy ladder

**Phase 2 (Pre-pilot target):**

- Agents write PR for features/bugfixes/refactors.
- Три режима ревью доступны ревьюверу, выбираются по PR на усмотрение человека:
  - **Mode (a)** — main-session subagent dispatch через skill `request-mode-a-review` (verdict-gated, §2.4).
  - **Mode (b)** — параллельная Codex CLI сессия независимо ревьюит PR.
  - **Mode (c)** — чистый human review, без LLM-ассиста.
- Все три режима интерактивные, session-driven, и используют собственные LLM credentials человека в его терминале. Никаких API-ключей в GitHub repo secrets.
- Auto-merge после положительного Mode (a) или Mode (b) verdict + green CI разрешён через обязательную invocation `gh pr merge <N> --auto --squash --delete-branch`; Mode (c)-ревью остаются single human decision.
- Write-доступ в prod-DB запрещён.
- Direct push в main запрещён.
- Auto-chores (lint-fix, devDep bumps, doc-sync) идут тем же review-путём, что и feature-PR.

**Триггеры пересмотра Phase 3** (auto-merge low-risk PR за feature flag) — deferred без target date. Revisit требует **все три** условия:

(i) Продукт в руках пользователей (post-Pre-pilot).
(ii) >50 PR данных review-loop'а (вручную залогированные выходы interactive `/review` skill'а ИЛИ automated reviewer-bot пересмотрен и построен).
(iii) У Tech Lead'а есть пропускная способность на tuning loop.

До тех пор Phase 2 baseline (human-driven review через modes a/b/c + lint guards + auto-merge после положительного verdict'а) — это операционный режим.

### 2.11 Deferred runtime architecture (design only, реализация по trigger)

Эти компоненты **спроектированы сейчас** (см. design spec §9), **реализуются по trigger'ам** отдельными ADR'ами:

| Component                                    | Trigger                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| **LiteLLM Proxy + Zone-AI VM** (Hetzner EU)  | First runtime AI feature deploy (Content Pipeline v2 LLM draft)                       |
| **PII filter** (regex v1, NER v2)            | Same trigger                                                                          |
| **OTel GenAI collector** (gen_ai.\* semconv) | Same trigger; в Phase 0 — minimal stderr token logging                                |
| **Vector DB Qdrant** (вместо pgvector)       | mobile v3 AI-рекомендации p95 query >100ms или vector workload мешает OLTP            |
| **Self-hosted GHA runner на Timeweb**        | DSO-31 setup (general CI), не AI-specific                                             |
| **Sandbox / experimentation environment**    | Команда ≥3 инженеров с параллельными agent-PR или регулярная нужда отлаживать gateway |
| **Codex cloud async activation**             | Tech Lead решает запустить первую async-задачу (opt-in self-serve)                    |

Архитектура runtime gateway:

- **Two LiteLLM Proxy instances** (MIT, OpenAI-compatible, virtual keys + budgets + prompt-cache passthrough): instance A в Hetzner EU для Anthropic+OpenAI (foreign endpoints требуют EU egress); instance B в Zone RF (Timeweb) для YandexGPT (RF-only API, не должен делать hop в EU). Обе делят один Postgres state (replication для unified budgets/keys).
- **mTLS RF → Zone AI** для outbound к instance A; instance B полностью внутри Zone RF.
- **PII Filter применяется unconditionally** к обоим маршрутам — даже YandexGPT внутри РФ (152-ФЗ требует обезличивания при отправке любому третьему лицу).
- **LiteLLM admin UI** не имеет native OIDC — потребуется nginx forward-auth proxy с Zitadel (ADR-0001 tenant). Не-trivial setup, документируется в trigger-ADR.

**Self-host honest framing (parallel to ADR-0006 §3 Keystatic/GitHub caveat):** Hetzner EU = non-RF compute. 152-ФЗ не нарушается потому что ПДн обезличиваются PII-Filter'ом **до** пересечения границы Zone RF → Zone AI; через границу идут только sanitized prompts. Это "self-host" в смысле «инфраструктура контролируется нами», но **не "data sovereignty"** в строгом смысле (compute в EU). Trigger to revisit fallback: блокировка Hetzner из РФ или regulatory требование compute-в-РФ для AI — fallback к Timeweb self-hosted с международным egress proxy.

**Pre-v2 prerequisite — dual-LLM pattern для user-content:** перед запуском Content Pipeline v2 — формальная оценка, входит ли user-controlled content (briefs от соавторов, file uploads) в pipeline. Если да — OWASP dual-LLM pattern (privileged + quarantined LLM) реализуется в trigger-ADR, не deferred дальше.

Подробнее — design spec §9.

---

## 3. Consequences

### Positive

- **Текущий workflow Tech Lead (sync Claude Code в VSC) не меняется** — Phase 0 опирается на этот режим как primary. SessionStart hook добавляется прозрачно через `.claude/settings.json`.
- **Любой агент orienting за <2 KB context** — bootstrap скрипт даёт детерминистический snapshot, фрагментация state между сессиями минимизирована.
- **SDD/TDD enforce'ятся machine-checkable** — не только rhetorical в AGENTS.md, но реальные CI gates ловят skip-discipline.
- **Интерактивные режимы ревью используют собственные LLM credentials человека** — никаких API-ключей в repo secrets, никакого headless CI-вызова paid LLM API в Phase 0, никакого многомесячного reviewer-bot tuning loop'а в velocity-ограниченное pre-pilot окно.
- **Phase 0 не требует runtime инфры** — Hetzner/LiteLLM/PII/OTel deferred с явными triggers, нет premature optimization.
- **Prompt-caching экономит ~60-80% input tokens** на second+ calls в интерактивных сессиях.
- **Codex активируется opt-in** — не блокирует Phase 0 start; когда Tech Lead ready параллелить — instant pickup без re-arch.
- **Vendor lock minimized** — AGENTS.md универсален, Bootstrap vendor-agnostic, любой harness (Cursor, GitHub Copilot Workspace, Devin) подключается тем же интерфейсом.

### Negative

- **AGENTS.md растёт** — AI-loop секция сидит поверх ADR-0006 baseline. Long files = больше prompt input на чтение (но кешируется).
- **Cross-vendor blind-spot reduction не автоматическое.** Без headless reviewer-bot'а свойство «два LLM lineage'а с разными blind spots видят каждый PR» требует, чтобы человек намеренно вызывал Mode (b) Codex CLI на Claude-авторских PR (и наоборот). Default Mode (a) использует тот же LLM-lineage, что и автор.
- **TDD signal lint — heuristic с false positives** — implementation file без test-file в diff может быть legit (e.g., refactor existing code, test уже существует). WARN-only v1, BLOCK переключается после калибровки.
- **Bootstrap зависит от GitHub auth** в рабочей среде — если `gh` не аутентифицирован, fallback к git-only output (graceful, но степень полезности падает).
- **Cost visibility ручная.** Tech Lead напрямую смотрит Anthropic Console + OpenAI Platform; никакого repo-side ledger'а; drift возможен, если неделями не заходить в консоль.

### Risks

- **Product Lead или новый разработчик пишет код, минуя SDD-цикл** — социальный risk. Mitigation: spec-link CI guard BLOCK уровня, никакого merge без spec.
- **Ревьювер пропускает dispatch Mode (a)/(b) и мержит на одном green CI** — bypass-risk для discipline-gate'а. Mitigation: skill `merge-when-green` не может пройти дальше без verdict-артефакта от `request-mode-a-review` (см. §2.4); G11 retrospective показал, что этот gate необходим.
- **Phase 3 activation premature** — если auto-merge low-risk PR'ов вернётся слишком рано, post-merge incident может оказаться дорогим. Mitigation: revisit criteria из §2.10 (post-Pre-pilot + 50+ PR review-данных + пропускная способность Tech Lead'а) — gate.
- **`tools/agent-bootstrap.ts` зависит от `gh` CLI и `simple-git`** в runtime — если в CI runner отсутствуют, bootstrap fails. Mitigation: CI install gh; для local dev — gh уже стандарт.

---

## 4. Alternatives considered (rejected или deferred)

| Alternative                                                                                        | Reason rejected/deferred                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LiteLLM Proxy в Phase 0** (Zone-AI VM сразу)                                                     | Premature: dev-time агенты звонят свои APIs напрямую (Anthropic, OpenAI) через свои клиенты. Gateway полезен только для runtime AI features (Content Pipeline). Деплой Hetzner VM сейчас = ops overhead без value. Deferred §2.11.                                                                              |
| **Northflank / Daytona managed sandbox**                                                           | Vendor-lock + RF-доступность под вопросом (US/EU providers) + payment friction. Self-host k8s namespace на Timeweb (когда понадобится) — proven RF path. Deferred §2.11.                                                                                                                                        |
| **Только Claude Code (no Codex)**                                                                  | Vendor lock-in без диверсификации; Mode (b) parallel-Codex review-путь теряет смысл. С Codex как opt-in async — best of both.                                                                                                                                                                                   |
| **Multi-agent с самого старта (Claude + Cursor + Codex + Devin)**                                  | Overhead: 3+ configs, 3+ cost streams, 3+ sandbox specifics. Не оправдано для team-of-1+AI. Cursor deferred с явным trigger.                                                                                                                                                                                    |
| **Phase 1 read-only autonomy**                                                                     | Слишком консервативно: Tech Lead уже работает в Phase 2 mode (agents write PR), downgrade был бы регрессией.                                                                                                                                                                                                    |
| **Headless CI-driven reviewer-bot в Phase 0**                                                      | Требует repo-secret credentials + месяцы precision/recall tuning'а, которые конкурируют с product-development в pre-pilot velocity-ограниченное окно. Интерактивные режимы (a/b/c) под собственными LLM credentials человека покрывают то же review-свойство с нулевой CI-сложностью. Revisit triggers — §2.10. |
| **Plan markdown в `docs/superpowers/plans/` для каждой задачи (классический superpowers pattern)** | Дублирование с GitHub Issues (ADR-0006 §9). Plan markdown оправдан только для multi-step внутри одной Issue. Default flow: Issue body + sub-issues = task tracking.                                                                                                                                             |
| **AGENTS.md only, no CLAUDE.md**                                                                   | Теряем Claude-specific MCP/skills/SessionStart hook config. Split inherited from ADR-0006.                                                                                                                                                                                                                      |
| **OWASP dual-LLM pattern (privileged LLM separated from quarantined)** для Phase 0                 | Overkill: Phase 0 dev-time агенты не обрабатывают untrusted user content в runtime. Trigger: runtime AI feature, обрабатывающий user-supplied content (Content Pipeline, support-tickets) — реализуется в момент trigger'а §2.11 через ADR-0010.                                                                |
| **OTel GenAI semconv collector в Phase 0**                                                         | Преждевременно без runtime AI traffic. Minimal stderr token logging достаточно. Deferred §2.11.                                                                                                                                                                                                                 |
| **Hard cost cap с in-line rejection (Portkey-style)** в Phase 0                                    | Требует gateway (LiteLLM) — preface §2.11 trigger. Phase 0 cost discipline = ручные проверки per-vendor консолей.                                                                                                                                                                                               |
| **GitHub Copilot Workspace вместо Codex**                                                          | Codex покрывает тот же use-case (cloud async PR-opening agent), но с большим maturity 2025-2026 и open ecosystem. Copilot Workspace = ещё один vendor lock в GitHub. Не блокируется — можно добавить параллельно если будет ценность.                                                                           |
| **Полное Spec-Driven Development per Kiro/BMAD framework**                                         | Тяжелее ADR-0006 hybrid SDD pattern; не оправдан overhead для team-of-1+AI. Hybrid (3-file spec + GitHub Issues) — proven на DSO-25..29 cycle.                                                                                                                                                                  |

---

## 5. Open questions (deferred)

| ID      | Q                                                                                                                                                                                            | Где решается                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| OQ-AI3  | TDD signal lint false-positive rate в реальности                                                                                                                                             | Phase 1 после 10 PR в Vitest scope                                                                |
| OQ-AI6  | Codex GitHub App config specifics                                                                                                                                                            | На момент Tech Lead activate'а Codex                                                              |
| OQ-AI7  | Глубокий dual-LLM pattern для untrusted-content AI features                                                                                                                                  | На момент trigger'а §2.11; зависит от первой runtime AI feature (Content Pipeline). См. ADR-0010. |
| OQ-AI9  | OTel GenAI collector deployment topology — single или HA                                                                                                                                     | На момент trigger'а §2.11                                                                         |
| OQ-AI10 | PII-filter NER (spaCy Russian) trigger threshold                                                                                                                                             | После measurement на synthetic corpus в момент trigger'а §2.11                                    |
| OQ-AI11 | Output-direction PII filter (LLM-hallucinated PII) — v3 expansion                                                                                                                            | Trigger: первая AI-generated content публикуется внешнему получателю без human review pre-publish |
| OQ-AI12 | LiteLLM admin UI OIDC integration (через nginx forward-auth) — детальный design                                                                                                              | На момент trigger'а §2.11                                                                         |
| OQ-AI14 | Конкретная метрика «tuning ROI proven», которая оправдала бы re-introducing automated reviewer-bot'а (например, catch-rate на размеченной выборке прошлых PR vs N часов/неделя human review) | Post-Pre-pilot, когда сработают revisit criteria из §2.10                                         |

---

## 6. Related ADRs / Делегировано

**Наследуется от:**

- ADR-0001 — Zitadel: future runtime LLM gateway admin (§2.11) защищён тем же OIDC tenant
- ADR-0002 §6 — BullMQ как async queue для AI jobs (§2.11 trigger)
- ADR-0003 §7 — pgvector default vector DB; trigger на Qdrant — отдельный ADR
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule выставляется как CI guard для человека-ревьювера (§2.6)
- ADR-0005 — mobile AI-рекомендации v3 будут идти через runtime LLM gateway
- ADR-0006 §7 — drift detection расширяется AI-specific guards из §2.6
- ADR-0006 §4 — 3-file feature-spec format наследуется
- ADR-0006 §9 — GitHub Issues task tracker + milestone convention наследуется
- ADR-0006 §5 / spec §9 — AGENTS.md / CLAUDE.md split наследуется + расширяется AI-loop секцией

**См. также (forward-refs):**

- **ADR-0010** — dual-LLM mandatory pattern для любого runtime AI flow с tool-use или внешним user content (Quarantined LLM ↔ Privileged LLM split, symbolic references).
- **`2026-05-18-ds-platform-dual-llm-pattern-design`** — design-spec реализации dual-LLM: контракты, threat model, integration с egress proxy и audit-классами.

**Делегировано в другие задачи:**

- **DSO-31 (Repo strategy / Engineering readiness):** реализация `tools/agent-bootstrap.ts`, lint-guard'ов под `tools/lint/`, обновлений AGENTS.md / CLAUDE.md, branch protection rules. Полный migration plan — design spec §11.
- **Будущий ADR-NNNN (runtime AI infra):** LiteLLM Proxy + Zone-AI VM (Hetzner EU) + PII-filter + OTel GenAI collector. Trigger: first runtime AI feature deploy (Content Pipeline v2 LLM-draft).
- **Будущий ADR-NNNN (Phase 3 autonomy):** auto-merge low-risk PR за feature flag. Trigger per §2.10: post-Pre-pilot + 50+ PR review-loop данных + пропускная способность Tech Lead'а.
- **Будущий ADR-NNNN (Qdrant migration):** vector DB scaling beyond pgvector. Trigger: mobile v3 AI-рекомендации p95 >100ms.

**Влияет на (downstream):**

- **DSO-31** — структура `tools/`, `.github/workflows/` (только lint guards), AGENTS.md / CLAUDE.md baseline.
- **Все feature-specs DS Platform** — должны проходить через оркестрованный iteration cycle (§2.4) с verdict-gated checklist и review.
- **Content Pipeline v2 implementation** — будет первым triggering event для runtime LLM gateway ADR.
