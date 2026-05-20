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
**Наследует:** ADR-0001 (Authentik/Zitadel), ADR-0002 (NestJS + BullMQ), ADR-0003 (Postgres17 + pgvector), ADR-0004 (Next.js 15 + ESLint guards), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs + Keystatic + SDD + GitHub Issues task split)

---

## 1. Context

DS Platform — greenfield TS/Postgres платформа, разрабатывается в Phase 0 преимущественно AI-агентами (Claude Code и Codex) при минимальной команде (Tech Lead + продукт-владелец Product Lead-нетехнарь, без второго инженера). Документация и task tracking уже зафиксированы в ADR-0006 (SDD-формат, GitHub Issues, glossary-SSOT, drift detection). Что ещё не зафиксировано:

- **Как агент проходит итерацию** — какой цикл (READ → PLAN → RED → GREEN → REFACTOR → checklist → PR → merge), какие методологии (SDD/TDD) hard rules vs soft.
- **Как любой агент (Claude Code, Codex, будущий Cursor) подхватывает контекст в начале свежей сессии**, без stale-state файлов.
- **AI-specific drift guards** поверх general'ных в ADR-0006 §7 — что ловит нарушение SDD-link, TDD-discipline, ADR-compliance.
- **Cross-vendor PR review** — независимая агентская ревью PR'ов другого vendor'а как обязательный gate перед human merge.
- **Prompt-caching и cost discipline** — без gateway инфраструктуры (которая преждевременна для Phase 0).
- **Autonomy ladder** — какие задачи агент может закрывать сам (с human-merge), какие нет, какие условия для повышения phase.
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

Все harness'ы проходят один и тот же 8-step iteration cycle (см. §2.4).

### 2.3 SDD + TDD как hard rules

- **SDD:** никакого production-кода без feature-spec'а в `apps/docs/content/specs/features/NNN-<slug>/` (3 файла: requirements/design/scenarios — формат из ADR-0006 §4). Если spec'а нет — агент сначала пишет через superpowers:brainstorming.
- **TDD:** никакого production-кода без failing test'а. One Vitest test per EARS-требование, naming `it('EARS-N.M: ...', ...)`. Playwright tests генерируются из `scenarios.feature` через `playwright-bdd`.
- **Узкие исключения** (typo / doc-only / dep-bumps / regenerated artifacts) документируются в PR description.

Enforcement: AGENTS.md hard rules + machine-checkable CI guards (§2.6).

### 2.4 Цикл итерации — делегирован skill'у `do-feature-iteration`

Каждая итерация реализации проходит оркестрованный цикл: READ relevant ADRs → verify base CI green → RED (failing test) → GREEN (минимум кода) → REFACTOR → iteration-end checklist (dispatch, verdict-gated) → surface decision-debt → PR open → Mode (a) review dispatch (verdict-gated) → respond-to-review до APPROVE + green CI → iteration summary → merge через `gh pr merge --auto --squash --delete-branch`. По ADR-0007 Amendment A1.4 (refined) и Amendment A2, положительный verdict Mode (a) или Mode (b) + green CI достаточен для merge.

Procedural source of truth — **`apps/docs/content/skills/do-feature-iteration/SKILL.md`** (по рефакторингу DSP-194, 2026-05-20). Прежний inline 8-step блок ("READ / PLAN / RED / GREEN / REFACTOR / CHECKLIST / PR OPEN / HUMAN-MERGE") **superseded** этим skill'ом: оркестрация skill'а несёт discipline-gate'ы (verdict checklist'а, verdict review, обязательная инвокация decision-debt), которые inline-narrative не мог обеспечить (находки G11: F-14, F-15, F-19, F-21).

### 2.5 Session bootstrap — `tools/agent-bootstrap.ts`

Детерминистический скрипт, который любой harness запускает в начале свежей сессии. Output — markdown ≤ 2 KB с live state snapshot: git state, open Issues assigned to @me, awaiting-review PRs, ready queue, active spec(s) metadata, recommended next step, context file paths.

Источники истины: `gh` CLI + `git` + spec frontmatter. Никакого state-файла, который мог бы стать stale.

Per-harness integration:

- **Claude Code:** SessionStart hook в `.claude/settings.json`, output идёт в `additionalContext`.
- **Codex:** AGENTS.md «Before any task» первый шаг — execute bootstrap.
- **Manual:** `pnpm bootstrap` alias.

Sketch и edge cases — design spec §4.

### 2.6 AI-specific CI drift guards (поверх ADR-0006 §7)

| Guard                           | Что ловит                                                                                                                                                  | Severity Phase 0              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **spec-link required**          | PR с label `feature:*` без `Closes #N` на Issue с matching milestone и spec folder. Non-feature PR (bug/chore) — skipped.                                  | BLOCK                         |
| **TDD signal**                  | implementation-only commit без test-файла                                                                                                                  | WARN v1                       |
| **cross-vendor review посещён** | merge без passing GH status check `agent-review` (workflow exit 0; reviewer-bot всегда постит либо review comment либо `[REVIEWER-UNAVAILABLE]` fallback). | BLOCK (status check required) |
| **EARS ↔ test linkage**         | EARS-требование без `it('EARS-N.M: ...')` теста (content-search across all `apps/**/*.test.ts`)                                                            | WARN v1 → BLOCK v2            |
| **Gherkin coverage**            | scenarios без Playwright step реализации                                                                                                                   | BLOCK (через test fail)       |
| **Spec status freshness**       | merged PR с label `feature:*`, но spec status='Draft'                                                                                                      | WARN v1                       |
| **Prior decisions cited**       | новый spec без ADR-link в "Prior decisions" если категория ≠ docs-only                                                                                     | WARN v1                       |

Реализация в `tools/lint/spec-link-lint.ts`, `tools/lint/ears-test-lint.ts`. Branch protection rule требует passing status check `agent-review` (не approving review от bot account) — это обеспечивает что reviewer-agent run _произошёл_, при этом human approval остаётся отдельным branch protection requirement.

> **Interim semantics note (2026-05-19, per ADR-0008 Amendment A3):** строки `BLOCK` выше предполагают server-side required status check на `main`. Пока ADR-0008 §2.6 в target-state (branch protection отложен до апгрейда плана org'а или перевода репо в public), `BLOCK` читается операционально как **«CI job выходит red, и Tech Lead трактует это как merge-blocker по convention'у»** — тот же outcome на single-developer happy path, без server-side гарантии. Строка `cross-vendor review visited` независимо SUPERSEDED через ADR-0007 Amendment A1.

### 2.7 9-item iteration-end checklist (AGENTS.md hard rule)

Перед `git push` агент verify'ет:

1. Tests green (unit + e2e)
2. Generated artifacts up-to-date (`pnpm generate:all && git diff --exit-code`)
3. TypeScript compiles
4. Lint clean
5. Module README updated если exports changed
6. Spec `status:` frontmatter обновлён
7. New glossary terms added if domain vocab grew
8. ADR создан если архитектурное решение
9. Linked Issue получил summary comment (file paths, decisions, что осталось)

Failure любого пункта → no push, либо fix, либо escalate.

### 2.8 Cross-vendor reviewer-agent

GH Action `agent-review.yml` на PR open/synchronize:

- Определяет противоположного vendor'а (если PR от Claude → reviewer = GPT-5-equivalent, и наоборот)
- Загружает контекст через `packages/llm-utils/buildContext.ts` (стабильный prefix для prompt-cache)
- Two-pass review: (a) general code review, (b) ADR/SDD compliance
- Posts review comments через `gh pr review --comment` (НЕ approval — human-gate сохраняется)
- Markers `[BLOCKING] / [NIT] / [SUGGESTION]` для приоритизации

Branch protection rule требует reviewer-bot review (или explicit `[OK-TO-MERGE]` маркер) перед мержем. Approval остаётся за человеком.

Cost estimate: ~$0.15/day при 5 PRs/day с 70% prompt-cache hit rate.

### 2.9 Prompt-caching policy

Hard rule в AGENTS.md для всех runtime LLM-вызовов (reviewer-bot, будущие Content Pipeline и т.д.):

- `cache_control: ephemeral` на 3 stable tier-блоках (Anthropic limit = 4 breakpoints; используется 3 из 4): (1) AGENTS.md+CLAUDE.md concat, (2) active spec 3 файла concat, (3) ADRs sorted concat. Один breakpoint остаётся free для будущего расширения (modules README, persona configs и т.п.).
- **Tier 4 = volatile glossary entries**, intentionally uncached: glossary размещается **last** в payload, **без** `cache_control` — это сохраняет cache hit на tiers 1–3 при изменении glossary (новые термины добавляются по ходу разработки; если бы glossary имел свой breakpoint, каждое изменение инвалидировало бы весь prefix).
- НЕ кешировать также: user dialogue / current task instructions (по определению volatile).
- **Стабильный prefix order** обеспечивается общим `packages/llm-utils/buildContext.ts` helper'ом
- Цель: ≥60% cache hit rate на second+ calls в сессии

### 2.10 Cost observability — Phase 0 без gateway

`tools/cost-ledger-sync.ts` запускается еженедельно через GH Actions cron:

1. Pull usage из Anthropic Admin API + OpenAI Admin API
2. Append rows в `outputs/llm-cost-ledger.csv` (date, vendor, project, tokens, cost_usd)
3. Open GitHub Issue с label `cost-alert` если weekly cost > soft cap (default $50)
4. **Auto-PR** с обновлённым CSV (не direct push в main — соответствует §2.11 запрету на direct push). Tech Lead мержит PR при следующей session.
5. При пустых rows из обоих pullers — explicit `process.exit(2)` чтобы GH Actions step показывал red и Tech Lead видел downtime (а не silent no-op неделями).

Без LiteLLM, без in-line rejection, без OTel collector — это для Phase 0 преждевременно. Soft cap alert через Issue + human discretion достаточно. Полный observability stack — §3.

### 2.11 Autonomy ladder

**Phase 2 (Pre-pilot target):**

- Agents write PR for features/bugfixes/refactors
- Human-merge gate обязателен (branch protection)
- Cross-vendor reviewer-bot обязателен (branch protection)
- Auto-merge запрещён
- Write-доступ в prod-DB запрещён
- Direct push в main запрещён
- Auto-chores (lint-fix, devDep bumps, doc-sync) разрешены через bot-PR с label `chore:auto` — всё равно через cross-vendor review + human merge

**Triggers на Phase 3** (auto-merge low-risk PR за feature flag):

- ≥50 успешных agent-PR без post-merge incident
- Reviewer-bot precision ≥70%, recall ≥50% — measured by formal protocol (см. spec §8.2: TP/FP/FN definitions, Tech Lead как evaluator, CSV tracking, sample 20+ PR с findings)
- Документированные low-risk criteria в отдельном ADR
- Kill switch tested

**Kill switch:** `.github/agents-config.json` `{ "agents_enabled": false, "cross_vendor_review_required": true }` — Action `agent-review.yml` skip'ает себя; меняется обычным PR + human merge (нельзя самоликвидироваться). Поле `auto_merge_enabled` отсутствует в Phase 2 (auto-merge disabled by design); добавится в Phase 3 ADR.

### 2.12 Deferred runtime architecture (design only, реализация по trigger)

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
- **LiteLLM admin UI** не имеет native OIDC — потребуется nginx forward-auth proxy с Authentik/Zitadel (ADR-0001 tenant). Не-trivial setup, документируется в trigger-ADR.

**Self-host honest framing (parallel to ADR-0006 §3 Keystatic/GitHub caveat):** Hetzner EU = non-RF compute. 152-ФЗ не нарушается потому что ПДн обезличиваются PII-Filter'ом **до** пересечения границы Zone RF → Zone AI; через границу идут только sanitized prompts. Это "self-host" в смысле «инфраструктура контролируется нами», но **не "data sovereignty"** в строгом смысле (compute в EU). Trigger to revisit fallback: блокировка Hetzner из РФ или regulatory требование compute-в-РФ для AI — fallback к Timeweb self-hosted с международным egress proxy.

**Pre-v2 prerequisite — dual-LLM pattern для user-content:** перед запуском Content Pipeline v2 — формальная оценка, входит ли user-controlled content (briefs от соавторов, file uploads) в pipeline. Если да — OWASP dual-LLM pattern (privileged + quarantined LLM) реализуется в trigger-ADR, не deferred дальше.

Подробнее — design spec §9.

---

## 3. Consequences

### Positive

- **Текущий workflow Tech Lead (sync Claude Code в VSC) не меняется** — Phase 0 опирается на этот режим как primary. SessionStart hook добавляется прозрачно через `.claude/settings.json`.
- **Любой агент orienting за <2 KB context** — bootstrap скрипт даёт детерминистический snapshot, фрагментация state между сессиями минимизирована.
- **SDD/TDD enforce'ятся machine-checkable** — не только rhetorical в AGENTS.md, но реальные CI gates ловят skip-discipline.
- **Cross-vendor review снижает correlated code-level errors** — два разных LLM lineage'а имеют разные blind spots для bugs/security/edge-cases. **Caveat:** ADR/SDD compliance pass даёт обоим моделям одинаковый ADR-текст, поэтому correlated misinterpretation ADR-формулировок не устраняется — human merge gate остаётся primary защитой для архитектурных решений (см. spec §6.6).
- **Phase 0 не требует runtime инфры** — Hetzner/LiteLLM/PII/OTel deferred с явными triggers, нет premature optimization.
- **Prompt-caching экономит ~60-80% input tokens** на second+ calls; cost discipline soft cap + weekly review достаточен для Pre-pilot масштаба.
- **Codex активируется opt-in** — не блокирует Phase 0 start; когда Tech Lead ready параллелить — instant pickup без re-arch.
- **Vendor lock minimized** — AGENTS.md универсален, Bootstrap vendor-agnostic, любой harness (Cursor, GitHub Copilot Workspace, Devin) подключается тем же интерфейсом.

### Negative

- **AGENTS.md растёт** — DSO-30 добавляет AI-loop секцию ~80 строк поверх ADR-0006 baseline. Long files = больше prompt input на чтение (но кешируется).
- **`buildContext.ts` helper — еще один maintain** — обязательная точка входа для всех runtime LLM clients (reviewer-bot, future Content Pipeline). Изменение order = cache invalidation.
- **Reviewer-bot vendor detection — explicit label** `author:claude` / `author:codex` ставит сам автор-агент при PR open (часть AGENTS.md PR template). Default при отсутствии label = OpenAI как reviewer (Claude — primary harness в Phase 0, поэтому fallback на не-Claude). Изначально планировалась heuristic на commit-message grep, но эта heuristic в default-case всегда выбирала Anthropic — нарушала cross-vendor property для большинства PR. Explicit label решает.
- **Branch protection rule на reviewer-bot** означает что если bot API down — merge заблокирован. Mitigation: kill switch + `[OK-TO-MERGE]` маркер для emergency bypass.
- **TDD signal lint — heuristic с false positives** — implementation file без test-file в diff может быть legit (e.g., refactor existing code, test уже существует). WARN-only v1, BLOCK переключается после калибровки.
- **Bootstrap зависит от GitHub auth** в рабочей среде — если `gh` не аутентифицирован, fallback к git-only output (graceful, но степень полезности падает).
- **Cost-ledger требует Admin API keys** — отдельные от main API keys, нужно настроить в Anthropic Console и OpenAI org settings.

### Risks

- **Anthropic / OpenAI usage API shape меняется** — Admin endpoints менее стабильны чем chat completions. Mitigation: cost-ledger-sync.ts инкапсулирует pull-логику, при breaking change — точечный fix не затрагивает остальную инфру.
- **OpenAI API доступность из Hetzner EU** — реверс-санкционных изменений (block on EU IPs от OpenAI или block Hetzner.com из РФ) лишает cross-vendor reviewer одного из двух vendors. Mitigation: kill switch выключает required status check, временно human-only review; параллельная конфигурация reviewer в Mistral / Gemini (через LiteLLM routing, requires trigger-ADR runtime infra deployed) как fallback. Для Phase 0 явный fallback не требуется (cross-vendor review — desirable но не блокирует базовую разработку при единичных downtime).
- **Reviewer-bot generates noise** — если precision слишком низкая, Tech Lead перестаёт читать review-комментарии. Mitigation: метрика precision/recall на sample 20+ PR в Phase 1; если <50% — пересмотр prompts или vendor switch.
- **Product Lead или новый разработчик пишет код, минуя SDD-цикл** — социальный risk. Mitigation: spec-link CI guard BLOCK уровня, никакого merge без spec.
- **Phase 3 activation premature** — если auto-merge включён слишком рано, post-merge incident может оказаться дорогим. Mitigation: criteria из §2.11 (50+ PR, 70%+ precision, documented low-risk classes) — gate.
- **Prompt-cache invalidation** при добавлении нового ADR / spec — cache TTL Anthropic 5 минут, OpenAI prefix должен быть byte-identical. `buildContext.ts` sorting ADRs by number обеспечивает determinism; новый ADR meets new cache start (приемлемо).
- **`tools/agent-bootstrap.ts` зависит от `gh` CLI и `simple-git`** в runtime — если в CI runner отсутствуют, bootstrap fails. Mitigation: CI install gh; для local dev — gh уже стандарт.

---

## 4. Alternatives considered (rejected или deferred)

| Alternative                                                                                        | Reason rejected/deferred                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LiteLLM Proxy в Phase 0** (Zone-AI VM сразу)                                                     | Premature: dev-time агенты звонят свои APIs напрямую (Anthropic, OpenAI) через свои клиенты. Gateway полезен только для runtime AI features (Content Pipeline). Деплой Hetzner VM сейчас = ops overhead без value. Deferred §2.12.    |
| **Northflank / Daytona managed sandbox**                                                           | Vendor-lock + RF-доступность под вопросом (US/EU providers) + payment friction. Self-host k8s namespace на Timeweb (когда понадобится) — proven RF path. Deferred §2.12.                                                              |
| **Только Claude Code (no Codex)**                                                                  | Vendor lock-in без диверсификации; cross-vendor review pattern теряет смысл. С Codex как opt-in async — best of both.                                                                                                                 |
| **Multi-agent с самого старта (Claude + Cursor + Codex + Devin)**                                  | Overhead: 3+ configs, 3+ cost streams, 3+ sandbox specifics. Не оправдано для team-of-1+AI. Cursor deferred с явным trigger.                                                                                                          |
| **Phase 1 read-only autonomy**                                                                     | Слишком консервативно: Tech Lead уже работает в Phase 2 mode (agents write PR), downgrade был бы регрессией.                                                                                                                          |
| **Phase 3 auto-merge сразу**                                                                       | Premature: нет baseline для измерения reviewer precision; risk-reward не оправдано для Pre-pilot. Trigger criteria зафиксированы.                                                                                                     |
| **Plan markdown в `docs/superpowers/plans/` для каждой задачи (классический superpowers pattern)** | Дублирование с GitHub Issues (ADR-0006 §9). Plan markdown оправдан только для multi-step внутри одной Issue. Default flow: Issue body + sub-issues = task tracking.                                                                   |
| **AGENTS.md only, no CLAUDE.md**                                                                   | Теряем Claude-specific MCP/skills/SessionStart hook config. Split inherited from ADR-0006.                                                                                                                                            |
| **Self-written reviewer agent без LLM (rule-based linter only)**                                   | Не ловит logical bugs, edge cases, security context-aware issues. LLM-reviewer catches класс errors, который linter не может (по design).                                                                                             |
| **OWASP dual-LLM pattern (privileged LLM separated from quarantined)** для Phase 0                 | Overkill: Phase 0 dev-time агенты не обрабатывают untrusted user content в runtime. Trigger: runtime AI feature, обрабатывающий user-supplied content (Content Pipeline, support-tickets) — реализуется в момент 9.1 trigger.         |
| **OTel GenAI semconv collector в Phase 0**                                                         | Преждевременно без runtime AI traffic. Minimal stderr token logging достаточно. Deferred §2.12.                                                                                                                                       |
| **Hard cost cap с in-line rejection (Portkey-style)** в Phase 0                                    | Требует gateway (LiteLLM) — preface §9.1 trigger. Phase 0 soft cap + Issue alert разумен.                                                                                                                                             |
| **GitHub Copilot Workspace вместо Codex**                                                          | Codex покрывает тот же use-case (cloud async PR-opening agent), но с большим maturity 2025-2026 и open ecosystem. Copilot Workspace = ещё один vendor lock в GitHub. Не блокируется — можно добавить параллельно если будет ценность. |
| **Полное Spec-Driven Development per Kiro/BMAD framework**                                         | Тяжелее ADR-0006 hybrid SDD pattern; не оправдан overhead для team-of-1+AI. Hybrid (3-file spec + GitHub Issues) — proven на DSO-25..29 cycle.                                                                                        |

---

## 5. Open questions (deferred)

| ID      | Q                                                                                                | Где решается                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| OQ-AI1  | Реальный shape Anthropic Admin API usage endpoint                                                | На момент impl cost-ledger-sync.ts (DSO-31+ step 11)                                              |
| OQ-AI2  | Reviewer-bot precision baseline на sample 20+ PR                                                 | Phase 1 после 20 PR closed                                                                        |
| OQ-AI3  | TDD signal lint false-positive rate в реальности                                                 | Phase 1 после 10 PR в Vitest scope                                                                |
| OQ-AI4  | Phase 3 low-risk criteria — конкретный allowlist                                                 | Отдельный ADR при достижении 50+ PR threshold                                                     |
| OQ-AI5  | Vendor detection — explicit label vs commit-message grep                                         | v2 enhancement; explicit label при PR creation                                                    |
| OQ-AI6  | Codex GitHub App config specifics                                                                | На момент Tech Lead activate'а Codex                                                              |
| OQ-AI7  | Глубокий dual-LLM pattern для untrusted-content AI features                                      | На момент 9.1 trigger; зависит от первой runtime AI feature (Content Pipeline)                    |
| OQ-AI8  | Glossary auto-population из reviewer-bot                                                         | Phase 1 enhancement если manual coverage недостаточен                                             |
| OQ-AI9  | OTel GenAI collector deployment topology — single или HA                                         | На момент 9.1 trigger                                                                             |
| OQ-AI10 | PII-filter NER (spaCy Russian) trigger threshold                                                 | После measurement на synthetic corpus в момент 9.1 trigger                                        |
| OQ-AI11 | Output-direction PII filter (LLM-hallucinated PII) — v3 expansion                                | Trigger: первая AI-generated content публикуется внешнему получателю без human review pre-publish |
| OQ-AI12 | LiteLLM admin UI OIDC integration (через nginx forward-auth) — детальный design                  | В trigger-ADR 9.1                                                                                 |
| OQ-AI13 | Fallback reviewer vendor (Mistral / Gemini) при OpenAI EU unavailable — pre-config через LiteLLM | Trigger: первый sustained downtime OpenAI или Hetzner EU                                          |

---

## 6. Related ADRs / Делегировано

**Наследуется от:**

- ADR-0001 — Authentik/Zitadel: future runtime LLM gateway admin (§2.12) защищён тем же OIDC tenant
- ADR-0002 §6 — BullMQ как async queue для AI jobs (§2.12 trigger)
- ADR-0003 §7 — pgvector default vector DB; trigger на Qdrant — отдельный ADR
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule reviewer-bot включает в SDD-compliance pass
- ADR-0005 — mobile AI-рекомендации v3 будут идти через runtime LLM gateway
- ADR-0006 §7 — drift detection расширяется 7 AI-specific guards
- ADR-0006 §4 — 3-file feature-spec format наследуется (formerly mis-cited as §8 = Diagrams; fixed DSO-61)
- ADR-0006 §9 — GitHub Issues task tracker + milestone convention наследуется
- ADR-0006 §5 / spec §9 — AGENTS.md / CLAUDE.md split наследуется + расширяется AI-loop секцией (см. spec §10.1, §10.2 этого ADR — §10.2 явно отмечен как additive over baseline)

**См. также (forward-refs):**

- **ADR-0010** — dual-LLM mandatory pattern для любого runtime AI flow с tool-use или внешним user content (Quarantined LLM ↔ Privileged LLM split, symbolic references).
- **`2026-05-18-ds-platform-dual-llm-pattern-design`** — design-spec реализации dual-LLM: контракты, threat model, integration с egress proxy и audit-классами.

**Делегировано в другие задачи:**

- **DSO-31 (Repo strategy / Engineering readiness):** реализация `tools/agent-bootstrap.ts`, `packages/llm-utils/`, `tools/reviewer-agent/`, `.github/workflows/{agent-review,cost-ledger}.yml`, AGENTS.md / CLAUDE.md обновления, branch protection rules, `.github/agents-config.json` kill switch. Полный migration plan — design spec §11.
- **Будущий ADR-NNNN (runtime AI infra):** LiteLLM Proxy + Zone-AI VM (Hetzner EU) + PII-filter + OTel GenAI collector. Trigger: first runtime AI feature deploy (Content Pipeline v2 LLM-draft).
- **Будущий ADR-NNNN (Phase 3 autonomy):** auto-merge low-risk PR за feature flag. Trigger: 50+ PR + reviewer-bot 70%+ precision + low-risk criteria документированы.
- **Будущий ADR-NNNN (Qdrant migration):** vector DB scaling beyond pgvector. Trigger: mobile v3 AI-рекомендации p95 >100ms.

**Влияет на (downstream):**

- **DSO-31** — структура `tools/`, `packages/llm-utils/`, `.github/workflows/`, AGENTS.md / CLAUDE.md baseline.
- **Все feature-specs DS Platform** — должны проходить через 8-step cycle и 9-item checklist.
- **Content Pipeline v2 implementation** — будет первым triggering event для runtime LLM gateway ADR.

---

## 7. Amendments

### Amendment A1 — Drop automated reviewer-bot + cost-ledger automation (2026-05-19)

**Контекст:** ADR-0007 §2.8 (cross-vendor reviewer-bot), §2.10 (cost-ledger weekly cron + auto-PR) и Phase 2/3 autonomy ladder в §2.11 строились вокруг допущения headless CI-driven LLM-вызовов — GitHub Actions дёргает Anthropic/OpenAI API с credentials в repo secrets. Перед стартом инженерного Phase A всплыли две практические причины пересмотреть:

1. **Цена tuning loop'а.** У Tech Lead'а есть прошлый опыт многомесячных tuning-циклов на CI-driven LLM-автоматизации (precision/recall калибровка, prompt drift на изменении контекста, изменение shape vendor API). Этот цикл конкурирует с product-development в наиболее velocity-ограниченное окно (pre-pilot).
2. **Product velocity — приоритетное ограничение** до запуска pre-pilot. Автоматизация, требующая месяцев tuning'а чтобы быть полезной, — плохая инвестиция до того как есть продукт для наблюдения.

Прагматичная альтернатива есть: оставить людей + интерактивные сессии в review loop'е. LLM-ассист на ревью сохраняется, но переезжает из CI в собственный терминал человека — под его credentials, по его расписанию.

**Решение (амендмент):**

**A1.1 — Automated reviewer-bot dropped.** `tools/reviewer-agent/`, `.github/workflows/agent-review.yml` и флаг `cross_vendor_review_required` в `.github/agents-config.json` **не реализуются в Phase 0**. ADR-0007 §2.8 («Cross-vendor reviewer-agent») помечен **SUPERSEDED** данным амендментом.

**A1.2 — Automated cost-ledger dropped.** `tools/cost-ledger-sync.ts`, `.github/workflows/cost-ledger.yml` и weekly auto-PR pattern **не реализуются в Phase 0**. ADR-0007 §2.10 («Cost observability — Phase 0 without gateway») помечен **SUPERSEDED**. Cost-tracking теперь происходит в собственной консоли vendor'а (Anthropic Console, OpenAI Platform) — Tech Lead проверяет вручную. Вне scope репо.

**A1.3 — Replacement model: interactive-only LLM-assisted review.** Три режима ревью доступны человеку-ревьюверу, выбираются по PR на усмотрение человека:

- **Mode (a) — main-session subagent dispatch.** Основная Claude Code сессия человека (primary terminal) дёргает subagent'а со skill'ом `/review` против текущей ветки/PR перед открытием на merge.
- **Mode (b) — parallel Codex CLI session.** Человек запускает параллельную Codex CLI сессию в другом терминале и просит Codex ревьюить PR.
- **Mode (c) — pure human review.** Без LLM-ассиста.

Все три режима **интерактивные**, session-driven, и используют **собственные LLM credentials человека** в его терминале. Никаких API-ключей в GitHub repo secrets. Никакого headless CI-вызова LLM API в Phase 0.

**A1.4 — 8-step iteration cycle (ADR-0007 §2.4) обновлён.** Step 7 (PR open) без изменений. Step 8 был «HUMAN-MERGE — Tech Lead reads diff + reviewer-bot comments; merge → Issue closes»; теперь:

> **8. REVIEW + MERGE** — Author-agent (или человек) запускает ревью в mode (a), (b) или (c). После положительного verdict'а Mode (a) или Mode (b) + green CI author-agent мержит через `gh pr merge <N> --auto --squash --delete-branch` — **human-merge не требуется**. Mode (c)-ревью остаются единственным human decision. Codification artifact-gate'а — Amendment A2 ниже (закрывает G11 finding F-10).

**Уточнение (2026-05-20, DSP-194):** исходная формулировка A1.4 выше подразумевала, что каждый merge — «single human decision». Это всегда было несовместимо с тем, что `--auto --squash --delete-branch` — обязательная invocation (`--auto` уходит без человека в момент merge). Уточнённая формулировка выше кодифицирует то, что уже было операционным паттерном: положительный verdict subagent / Codex review + green CI достаточен; человек остаётся в loop'е для Mode (c)-ревью и для любого PR, где автор решает escalate.

**A1.5 — Lint guards в ADR-0007 §2.6 retained.** Пять guard'ов (`spec-link`, `ears-test`, `tdd-signal`, `spec-status-fresh`, `prior-decisions`) остаются в CI-пайплайне с исходными severity (BLOCK или WARN per §2.6 таблица). Их цель **сдвигается**: изначально они задумывались как вход для compliance-pass'а reviewer-bot'а, теперь служат **CI-сигналами, видимыми прямо человеку-ревьюверу** в PR UI. WARN guards — non-blocking checks; BLOCK guards — блокируют merge. Их роль становится «подсказать человеку», а не «накормить бота».

**A1.6 — `.github/agents-config.json` оставлен как есть.** Поле `agents_enabled: true` становится vestigial (никакой automated agent не читает его в Phase 0 review-loop'е). Удаление или перепрофилирование как kill switch для tooling'а interactive `/review` skill — deferred до отдельного амендмента, когда такой tooling будет формализован.

**A1.7 — Phase 2 autonomy / Phase 3 auto-merge deferred indefinitely.** Milestones из ADR-0007 §2.11 (auto-merge low-risk PR за feature flag, baseline 50+ PR, reviewer-bot precision/recall калибровка) **deferred без target date**. Revisit trigger: post-Pre-pilot, **все три**:
(i) продукт в руках пользователей,
(ii) >50 PR данных review-loop'а (вручную залогированных выходов interactive `/review` skill'а ИЛИ нового automated reviewer-bot'а, если будет пересмотрен и построен),
(iii) у Tech Lead'а есть пропускная способность на tuning loop.

До тех пор Phase 2 baseline = human-merge gate + lint guards + interactive review (mode a/b/c). Phase 3 = не на roadmap.

**Consequences:**

- **Branch protection упрощён** — required status checks list теряет `agent-review`. См. ADR-0008 Amendment A2 для правки §2.6.
- **Plane sub-issues cancelled** — DSP-172 (reviewer-agent scaffolding), DSP-173 (workflow YAML), DSP-177 (cost-ledger script), DSP-184 (cost-ledger workflow) — группы G4 + G6 в Phase A orchestration plan. Отмена — отдельная Plane-работа под DSP-160.
- **AI-stack design spec amendments** — §6, §7 (cost observability подсекция), §10 (CLAUDE.md overlay review tooling section) — prepended с SUPERSEDED callout'ами; §11 migration plan Steps 5/6/10 помечены cancelled. См. spec Amendment SD1.
- **`.github/agents-config.json` зашипанный в G3 (commit `7c72d6a` в `doctor-school/ds-platform`)** остаётся в дереве, но его enforcement-семантика vestigial пока interactive-review tooling не примет kill switch.
- **Cost visibility ручная.** Tech Lead напрямую смотрит Anthropic Console + OpenAI Platform; никакого repo-side ledger'а.
- **Cross-vendor blind-spot reduction потерян.** Положительный пункт ADR-0007 §3 «Cross-vendor review reduces correlated code-level errors» больше не действует. Mitigation: человек-ревьювер может выбрать mode (b) Codex CLI ревью для Claude-авторского PR (и наоборот) — то же свойство, но manual cadence.

**Why now (timing):** G4 (reviewer-bot) был следующей группой в Phase A orchestration plan. Постройка заняла бы ~2–3 сессии плюс ongoing tuning loop. Drop'аем сейчас — экономим недели мета-работы в velocity-ограниченное pre-pilot окно. Работа над lint guards в G5 не задета — эти CI-чеки остаются полезными вне зависимости от того, кто/что их читает.

**Open follow-up:**

- **OQ-A1** — Trigger пересмотра для re-introducing automated review: конкретная метрика для «tuning ROI proven» (например, catch-rate на размеченной выборке прошлых PR, превышающий N часов/неделя времени человеческого ревью).
- **OQ-A2** — `.github/agents-config.json`: убрать совсем или оставить как kill switch для interactive-tooling'а? Defer до формализации interactive `/review` skill'а, который, возможно, захочет kill switch.

**Affects (downstream):**

- **ADR-0008** §2.6 — см. Amendment A2 в ADR-0008.
- **AI-stack design spec** (`0007-ai-stack-design-ru.md`) — §6 (reviewer-bot architecture), §7 (cost observability subsection), §10 (CLAUDE.md overlay review tooling), §11 Migration plan Steps 5/6/10 — все SUPERSEDED per spec Amendment SD1.
- **Plane workspace `doctor-school`** — 4 sub-issues cancelled (DSP-172, DSP-173, DSP-177, DSP-184); 2 sub-issues description-updated (DSP-180 Step 13, DSP-189 Step 21).

### Amendment A2 — Discipline-gate'ы (artifact-required) + auto-merge после положительного review (2026-05-20, follow-up к DSP-194)

**Контекст:** G11 smoke (DSP-181, проход по feature'у `001-api-bootstrap-health`) дошёл до green CI и merged PR, но retrospective в `bbm/outputs/g11-smoke-findings.md` зафиксировал, что green был достигнут **только потому, что человек-наблюдатель вмешался в трёх критических точках**. Три находки доминируют стоимость:

- **F-14** — Step 8 (review dispatch) был забыт. Author-agent объявил цикл завершённым после `gh pr create`, считая «human-merge» единственным финальным действием. Только прямой вопрос человека («ты запустил ревью?») запустил Mode (a). Ревью тогда поймало два BLOCKER-findings, которые иначе бы ушли в `main`.
- **F-15** — 9-item iteration-end checklist (тогда в AGENTS.md §3 Step 6, до рефакторинга DSP-194) никогда не исполнялся как дискретный шаг. Из девяти пунктов применялись два-три; остальные были пропущены или молча отложены. Checklist как narrative bullet list был, по словам retrospective, «фактически декоративным».
- **F-10** — исходная формулировка A1.4 подразумевала human-merge после каждого review. Операционный паттерн был другим: `gh pr merge --auto --squash --delete-branch` не нуждается в человеке в момент merge, и положительного Mode (a)-verdict'а + green CI уже было достаточно на velocity-constrained pre-pilot пути.

Структурная причина F-14 и F-15 — AGENTS.md §3 нёс narrative, пошаговую процедуру вместо набора dispatchable, verifiable, artifact-producing действий. Агент, читающий narrative checklist, пропустит молча; агент, который не может пройти дальше без артефакта, возвращённого subagent'ом, пропустить не может.

**Решение (amendment):**

**A2.1 — Iteration-end checklist становится artifact-gated и dispatch-mode.** 11-item checklist (расширен с прежних 9 пунктов на `apps/docs/content/architecture/` и `apps/docs/content/operations/` по F-3) реализован как procedural skill **`run-iteration-end-checklist`** в `apps/docs/content/skills/run-iteration-end-checklist/SKILL.md`. Skill работает в **dispatch-mode**: lead agent передаёт тело skill'а fresh-context subagent'у; subagent возвращает структурированную строку verdict'а `VERDICT: N of 11 — <PASS | BLOCKED on #X>`. Lead agent не может пройти дальше checklist gate, пока verdict — `BLOCKED`. Это primary enforcement для F-15.

**A2.2 — Mode (a) review становится artifact-gated и dispatch-mode.** Mode (a) review (по Amendment A1.3) реализован как procedural skill **`request-mode-a-review`** в `apps/docs/content/skills/request-mode-a-review/SKILL.md`. Skill работает в dispatch-mode; subagent-ревьювер возвращает структурированную строку verdict'а `VERDICT: <APPROVE | REQUEST_CHANGES>`. Lead agent не может invocate'нуть `merge-when-green`, пока последний verdict — `REQUEST_CHANGES` или отсутствует. Это primary enforcement для F-14.

**A2.3 — Auto-merge после положительного review.** Per уточнение к A1.4 выше (закрывает F-10): после положительного Mode (a) или Mode (b) verdict + green CI author-agent мержит через единственную обязательную invocation `gh pr merge <N> --auto --squash --delete-branch`. Human-merge для Mode (a) / Mode (b) путей **не** требуется. Mode (c)-ревью остаются single human decision. Это кодификация операционного паттерна, уже действующего с Amendment A1; это не новый шаг autonomy в сторону Phase 3 (auto-merge low-risk PR за feature flag остаётся deferred per A1.7).

**A2.4 — Surfacing decision-debt — обязательная invocation.** Procedural skill **`surface-decision-debt`** в `apps/docs/content/skills/surface-decision-debt/SKILL.md` обязателен перед `write-iteration-summary`. Output skill'а может быть `[]`, но invocation сам по себе обязателен; молчаливый skip — это F-19 / F-21 паттерн, зафиксированный в retrospective.

**Последствия:**

- AGENTS.md §3 (прежде inline 8-step cycle) переписан как Work Protocol entry-triplet (identify task kind → cite entry point → load skill). Procedural detail переезжает в каталог skill'ов `apps/docs/content/skills/`.
- Discipline-gate'ы, добавленные A2, документированы как «Cannot proceed without» секции на каждом orchestration skill'е (`do-feature-iteration`, `do-hotfix-pr`, `do-adr-amendment`). Эти секции — контракт, который агент читает при загрузке skill'а.
- Цепочка `superpowers:*` (прежде перечисленная в `CLAUDE.md` Skill priorities) заменена единственным исключением: `superpowers:brainstorming` для spec-authoring. Все остальные `superpowers:*` skill'ы явно запрещены для project work; их процедуры абсорбированы каталогом проектных skill'ов (например, TDD живёт внутри `do-feature-iteration`; review dispatch — внутри `request-mode-a-review`). Закрывает находки G11 F-16 и F-18.
- A1.4 уточнён, как указано выше; несовместимость между «single human decision» и `--auto --squash` разрешена в пользу операционного паттерна.

**Почему сейчас (timing):**

DSP-181 retrospective — это worked example того, что human-in-loop ловит то, что просочилось; без artifact-gate'ов следующая итерация повторит F-14 и F-15. Стоимость лэндинга A2 сейчас — один PR (DSP-194); стоимость отложить — один human-prompt на итерацию по всем будущим PR.

**Открытый follow-up:**

- **OQ-A3** — `agents-skills-consistency-check.ts` (WARN-уровень lint того, что каталог skill'ов в AGENTS.md и директория `apps/docs/content/skills/` согласованы) — deferred до разрешения F-12 (Issue #10 hotfix); spec помечает его как optional и WARN-only, поэтому добавлять его поверх сломанного BLOCK guard'а — это compound the gap.

**Affects (downstream):**

- **AGENTS.md** — переписан DSP-194 commit 1.
- **CLAUDE.md** — секция Skill priorities переписана DSP-194 commit 1.
- **`apps/docs/content/skills/`** — 14 новых SKILL.md (4 orchestration + 10 procedural) добавлены DSP-194 commit 2.
- **DSP-190** — следующий smoke-прогон — acceptance test для A2; это первая итерация под новой instruction system.
