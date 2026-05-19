---
title: "ADR-0006 — Documentation Framework + SSOT-стратегия для DS Platform [RU]"
description: "DS Platform — greenfield TS/Postgres/Next.js платформа, разрабатывается AI-агентами с малой командой (1-2 dev + продукт-владелец Product..."
lang: ru
---

> **EN:** [`0006-documentation-and-ssot-en.md`](./0006-documentation-and-ssot-en.md) · **RU (this)**

# ADR-0006 — Documentation Framework + SSOT-стратегия для DS Platform

**Дата:** 2026-05-14
**Статус:** Accepted
**Связан с:** Plane DSO-60 (`55222f0b-ba97-4b2f-ac91-194fed38ea18`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0006-documentation-and-ssot-design-ru.md`
**Наследует:** ADR-0001 (IdP shortlist Authentik/Zitadel — TBD per §8 spike; Cerbos RBAC живёт в ADR-0003 §5), ADR-0002 (NestJS+Zod+REST+openapi-typescript), ADR-0003 (Postgres17+Drizzle+drizzle-kit), ADR-0004 (Next.js 15 + 4 apps + Refine + Payload v3), ADR-0005 (RN+Expo+WatermelonDB+GlitchTip)
**Reference:** `docs/documentation-pattern/documentation-framework-final.md` (общая best-practices spec; не authoritative — отдельные решения здесь расходятся с reference doc по обоснованию)

---

## Context

DS Platform — greenfield TS/Postgres/Next.js платформа, разрабатывается AI-агентами с малой командой (1-2 dev + продукт-владелец Product Lead-нетехнарь). Документация — основной механизм передачи контекста между сессиями AI и между членами команды. Без disciplined doc-as-SSOT каждый рестарт AI-сессии теряет архитектурное намерение.

ADR-0001..0005 зафиксировали технологии, но не зафиксировали:

- Где живёт документация, кто её редактирует, как она рендерится.
- Кто Master для каждого типа правды (Zod / Drizzle / glossary / prose).
- Как detected расхождения между документом и кодом (drift).
- Какой формат feature-specs использовать (EARS + Event Modeling + Gherkin или free-form).
- Где у Product Lead (нетехнарь, не пишет markdown в IDE) UI для PRD/Vision.

Hard requirements:

- Self-host (152-ФЗ; никаких Cloudflare/Vercel/Notion).
- AI-friendliness: AI читает доку при старте сессии напрямую из репо, без MCP-fetch проксей.
- Modern Notion-vibe UX для Product Lead (block-based, не классический wiki).
- Two-way editing markdown: Product Lead в UI ↔ Tech Lead/AI в IDE — один источник.
- Mainstream-стек, большой LLM-корпус (продолжение принципа [[feedback_tech_stack_criteria_no_team_skill]]).

Принцип [[feedback_docs_as_ssot]] (STRICT): doc-first cycle, AI-сессия начинается с чтения релевантной доки, каждый PR обновляет доку, доки не противоречат коду by construction где возможно (через codegen).

**Inheritance caveat (для transparency).** ADR-0006 architecturally наследует единый TS-стек от ADR-0002/0004 (TypeScript на бэке и фронте → один язык в Keystatic config, Fumadocs, generator scripts, ESLint custom rules, drift-detection tools). ADR-0002 §1 содержит argumentation с упоминанием существующих прототипов («3 прототипа на Next.js») — это нарушает [[feedback_tech_stack_criteria_no_team_skill]], которое позже сформулировалось. ADR-0004 уже зафиксировал этот caveat. ADR-0006 не invalidates ADR-0002/0004 в этом смысле (intrinsic-критерии — LLM-датасет, mainstream-стек, RF-self-host — выполняются independently), но при revision ADR-0002 без аргумента «3 прототипа» Node.js должен пройти по чистым критериям, иначе документационный стек требует пересмотра.

---

## Decision

### 1. SSOT-топология — «SSOT-per-kind»

Принцип 7 reference doc применён буквально: каждый тип правды имеет ровно один дом. Полная таблица:

| Тип правды                                   | Master                                                                                 | Mechanism propagation                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API контракт                                 | Zod schemas в `packages/schemas/`                                                      | nestjs-zod → OpenAPI 3.1 → openapi-typescript → `@ds/api-client` SDK (ADR-0002 §3-5)                      |
| DB схема                                     | Drizzle TS schemas в `packages/db/schema/`                                             | drizzle-kit generate → SQL migrations + introspect → ERD .svg (ADR-0003 §4)                               |
| Доменные ID (immutable)                      | `apps/docs/content/product/glossary/*.md` (Keystatic-managed)                          | `pnpm generate:glossary` → `packages/glossary/ids.ts` TS const → ESLint enforce import                    |
| Доменные labels (mutable RU/EN)              | тот же glossary                                                                        | i18n bundles + sync в Payload Glossary Collection                                                         |
| Бизнес-контент (legal/team/marketing)        | Payload v3 collections                                                                 | Build-time fetch / runtime API (ADR-0004 §7)                                                              |
| Архитектурные решения                        | `docs/adr/NNNN-*.md` immutable Git                                                     | Rendered в Fumadocs portal                                                                                |
| Tech specs (architectural brainstorm output) | `docs/content/specs/tech/YYYY-MM-DD-*.md`                                              | DSO-25..29 pattern, Keystatic-editable                                                                    |
| Feature specs (SDD)                          | `docs/content/specs/features/NNN-name/` (req+design+scenarios — 3 файла, без tasks.md) | EARS → unit tests; Gherkin → Playwright E2E; per-EARS GitHub Issues с label `feature:NNN-name`            |
| Implementation tasks (code-level)            | **GitHub Issues** в DS Platform repo (один Issue per EARS handler / bug / refactor)    | PR-linked, auto-close on merge; AI читает `gh issue view`; cross-link `tracker:` field в spec frontmatter |
| Strategic/PM tasks (non-code)                | **Plane** workspace `doctor-school` (DSP/DSC/DSM/DSO projects)                         | Strategic-уровень, cross-team (продукт+юр+HR+маркетинг), Product Lead-native; cross-link через URL labels |
| Module README                                | `apps/*/src/modules/*/README.md`                                                       | Rendered Fumadocs + lint проверяет exports ↔ README                                                       |
| Prose narrative (Vision, OKRs, PRD)          | `apps/docs/content/product/*.md`                                                       | Keystatic UI для Product Lead + Fumadocs render                                                           |
| Operations (runbooks, monitoring)            | `apps/docs/content/operations/`                                                        | Fumadocs render                                                                                           |
| AI constitution                              | `AGENTS.md` (root) + `CLAUDE.md` (Claude-Code overrides)                               | Читается AI первым при старте сессии                                                                      |

«Копировать значение между Master'ами запрещено» — это лучший indicator потенциального drift'а. Если значение появляется в двух местах, второе должно быть автогенерированным артефактом, а не ручной копией.

### 2. Doc Portal: **Fumadocs (Next.js + MDX)**

Слой рендера для технической документации. Полный набор требований Fumadocs закрывает:

- Native Next.js 15 — живёт как `apps/docs/` в monorepo, делит `pnpm` workspace, ESLint flat config, Tailwind tokens, Turborepo cache со всеми другими apps.
- MDX + полная свобода React-компонентов внутри (Scalar/Redoc embed, Mermaid, custom glossary tooltips).
- Tailwind + shadcn-style components — визуальная консистентность с `apps/portal`/`apps/admin`.
- Doc-специфика: автогенерируемый sidebar, search (Orama/Algolia integration), versioning, OpenAPI rendering plugin.
- MIT лицензия.

**Альтернативы и почему не выбраны:**

- **Starlight (Astro):** doc-специализация выше, Pagefind search built-in, но Astro — дополнительный toolchain помимо Next.js. Weighted score близко (181 vs 157 при equal weights), пользовательский override в пользу stack-consistency.
- **Docusaurus v3:** maximum maturity и plugin-ecosystem, но React+webpack отдельно от Next.js монорепо — disconnect с остальной инфраструктурой.
- **Nextra v3:** Next.js-native, но general-purpose MDX-фреймворк с doc-темой; doc-специфика слабее Fumadocs.
- ~~MkDocs Material~~: Python toolchain в TS-shop, dropped (явный override пользователя «нет диназаврам нулевых»).

**Risk acknowledged:** Fumadocs молодой (~1.5 года, активный релиз-цикл, breaking changes возможны). Mitigation: контент = stock MDX, портируется в Docusaurus/Starlight за день без потери данных.

**Diagrams в Fumadocs:** Mermaid через `remark-mdx-mermaid` remark plugin (external dependency, не «встроенный Fumadocs plugin»), подключается в Fumadocs `source.config.ts`. Производительность приемлема (lazy-load на client-side).

### 3. Markdown Editor (Notion-like UX для не-разработчиков): **Keystatic**

UI-слой над теми же `.md` / `.mdx` / `.yaml` файлами в Git. Двусторонняя работа:

- Product Lead в Keystatic UI редактирует prose-страницы (PRD, vision, business-rules, glossary). На save Keystatic коммитит файл в Git через GitHub App.
- Tech Lead/AI редактирует те же файлы напрямую в IDE — Keystatic подтянет на следующее открытие.

**Почему Keystatic:**

- MIT, schema-as-code в TypeScript (collections, fields, blocks типизированы).
- Block editor inspired by Notion 2024 — не классический wiki, modern UX.
- Контент = чистый Markdown / MDX / YAML / JSON — AI читает напрямую без proprietary deserialization.
- Native Next.js App Router plugin (`makeRouteHandler` + `<KeystaticApp />`) — поднимается как `apps/docs-cms/` рядом с `apps/docs/`.
- TypeScript schema enforces: типизированные fields, валидация на save в UI, relationship references (нельзя сослаться на несуществующий glossary term).

**Self-host honest framing.** Keystatic `storage.kind: 'github'` использует GitHub.com API для commits — это означает зависимость от GitHub.com (Microsoft US-инфраструктура) для doc-repo. Доки prose/specs/ADR/glossary **не содержат ПДн** → 152-ФЗ не нарушается. ПДн платформы живут в RF-Postgres (ADR-0003) и Timeweb Object Storage (ADR-0002). Doc-repo на GitHub.com — приемлемый trade-off, не «полностью self-host». Если требуется full air-gap (например при потере доступа к GitHub.com) — fallback к Keystatic `kind: 'local'` + self-hosted Gitea/GitLab. Trigger: блокировка GitHub.com из RF, или политический решение перенести source code в RF.

**Content format (Markdoc vs MDX impedance).** Keystatic `fields.document` сериализует в Markdoc-flavored markdown. Fumadocs ожидает MDX. Для prose collections (PRD chapters, Vision, business-rules) используется `fields.document` — DSO-31 верифицирует на pilot странице, что Markdoc-output читается Fumadocs (через `fumadocs-mdx` либо отдельный markdoc→mdx transform). Для glossary `definition` — короткая проза, формат не критичен (рендерится отдельным custom Fumadocs-компонентом).

**Альтернативы и почему не выбраны:**

- **TinaCMS:** maturity выше (5+ лет), есть live-preview Next.js страниц, но GraphQL-layer добавляет complexity, Tina Cloud bias в out-of-box setup. Weighted score practically tied (147 vs 149). Trigger to revisit: Keystatic v1.0 release + первый breaking change в Keystatic, который ломает наш CI.
- **Wiki.js:** classical wiki UX, не Notion-like blocks. AGPL. Bidirectional Git sync — мощно, но interval-based (не instant). Score 122.
- ~~Outline/AFFiNE/AppFlowy/HedgeDoc~~: хранят в своей БД, не в Git. AI-friendliness падает (нужен MCP-fetch + cron snapshot для AI), drift-risk высок. Отброшены.

**Risk acknowledged:** Keystatic v0.x, breaking changes возможны. Mitigation: контент = просто `.md` файлы в Git, editor swappable на TinaCMS/Pages-CMS без потери данных.

### 4. Spec формат: **Hybrid B (tech-spec brainstorm + feature-spec SDD)**

Два соседствующих template, каждый со своей дисциплиной:

**Tech specs** — `docs/content/specs/tech/YYYY-MM-DD-<topic>-design.md`.

- Продолжает DSO-25..29 pattern: brainstorming skill → design spec → ADR.
- Use cases: tech-stack выбор, infra-decisions, integration patterns, migration plans.
- Free-form structure, но с обязательными секциями: Context, Decision, Consequences, Alternatives, Open Questions.

**Feature specs** — `docs/content/specs/features/NNN-<feature-name>/`.

- SDD-структура (3 файла, без `tasks.md` — задачи живут в GitHub Issues, не в Git, см. §9 ниже):
- `requirements.md` — frontmatter с `tracker:` (URL GitHub milestone) + Outcomes / Scope / Constraints / Prior decisions / **Event Model (Commands/Events/Read models/Policies)** / **EARS requirements** (one per handler) / Invariants / Verification.
- `design.md` — Mermaid sequence-диаграммы каскадов, state-диаграммы lifecycle, ER-фрагменты.
- `scenarios.feature` — Gherkin, happy path + 2-3 failure branches.
- Если у фичи есть длинная транзакция с компенсациями — добавляется секция «Saga» в `requirements.md` (reference doc §5.6) с явным compensate-mapping per step и failure policy.
- Decomposition на атомарные задачи (один EARS-handler ≈ один Issue) делается **в GitHub Issues** (см. §9), не в Git-файле. Git хранит intent (EARS-N), GitHub Issues хранит execution state (assignee, status, PR-link, comments).

Outputs Spec-Driven Development:

- EARS-handlers → unit tests (Vitest), один EARS ≈ один test.
- Gherkin scenarios → Playwright E2E (через `playwright-bdd` transpilation).
- Event Model → NestJS modules (Commands = controllers, Events = outbox emits, Policies = handlers).
- Invariants → property-based тесты (defer v2+).

### 5. AI Constitution: AGENTS.md + CLAUDE.md split

`AGENTS.md` в корне DS-Platform repo — **universal constitution** для всех AI-агентов (Claude/Cursor/Cody/GPT-Codex). Содержит: stack list, doc-структуру repo, обязательные «Before any task» / «During implementation» / «After implementation» чеклисты, PR требования, forbidden actions (silent arch changes, hardcoded glossary IDs, etc.). Иммутабельный по существу — обновляется только при добавлении нового слоя архитектуры. Structure follows reference doc §4.1.

`CLAUDE.md` — Claude-Code-specific overlay. Содержит: ссылку на AGENTS.md как baseline, MCP server config, Claude-Code skill preferences (pp-plane CLI первым), tool-allowlist, hook patterns, slash-command shortcuts. Может меняться часто.

`.cursor/rules/` — добавляется когда/если Cursor войдёт в команду.

### 6. Glossary mechanism: glossary.yaml + 4-layer validation + roundtrip check

Подробно расписано в design spec §6 с code-sketches. Резюме:

- Master = `apps/docs/content/product/glossary/*.md` (Keystatic file-per-term collection, frontmatter YAML + markdown body для definition).
- Generated artifact = `packages/glossary/ids.ts` (TS const enum) + sync в Payload Glossary Collection.
- 4 client-facing validation layers + 1 CI roundtrip-check:

1.  **Keystatic UI** — typed fields, relationship references, save-blocking validators.
2.  **MDX glossary-lint** — кастомный AST-парсер сканирует `[[term-id]]` directives и bold-токены в `apps/docs/content/**/*.{md,mdx}`; unknown term без `<!-- new-term -->` маркера → fail.
3.  **ESLint `@ds/glossary-canonical-ids`** — TS-литералы, совпадающие с GlossaryId, должны импортироваться из `@ds/glossary/ids`, не быть инлайн-string'ом.
4.  **Payload Lexical glossary-ref check** — каждый `<GlossaryRef id="...">` в Payload Lexical AST экспорта существует в glossary.

- **Roundtrip CI check** — glossary.yaml ↔ generated TS ids ↔ Payload Glossary table consistent (запускается post-sync).

### 7. Drift Detection Stack

Полный список v1 (все block merge кроме помеченных warn-only):

| Check                                                                    | Tool                                                    | Что проверяет                                                                                          |
| ------------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| TS compile                                                               | `tsc --noEmit`                                          | Базовая типобезопасность                                                                               |
| ESLint                                                                   | `eslint` flat config                                    | Custom rules incl. `glossary-canonical-ids`, `no-class-validator`, `no-vercel-only-api` (ADR-0004 §13) |
| Prettier                                                                 | `prettier --check`                                      | Code style                                                                                             |
| Unit tests                                                               | Vitest                                                  | Per-handler coverage                                                                                   |
| E2E                                                                      | Playwright + `playwright-bdd`                           | Gherkin scenarios pass                                                                                 |
| **API drift**                                                            | Spectral + `openapi.snapshot.json` diff                 | NestJS-генерированный OpenAPI vs committed snapshot                                                    |
| **DB schema drift**                                                      | `drizzle-kit check`                                     | TS schema ↔ migrations consistent                                                                      |
| **Events drift**                                                         | Custom AST (`tools/lint/events-lint.ts`)                | `@OutboxEmit` calls ↔ spec's `events.md`                                                               |
| **Glossary lint (3 CI checks; layer 1 = Keystatic UI runtime, не в CI)** | custom MDX-lint + ESLint custom rule + Payload AST scan | См. §6 выше                                                                                            |
| **Generated artifacts**                                                  | `pnpm generate:all --check`                             | openapi-typescript SDK + glossary IDs + ERD up-to-date                                                 |
| **Markdown links**                                                       | `lychee`                                                | No broken links cross-docs                                                                             |
| **Module README**                                                        | `tools/lint/module-readme-lint.ts`                      | Every `src/modules/*/` имеет README; export symbols mentioned (warn-only v1, block в v2)               |
| **Docs build**                                                           | `apps/docs` next build                                  | Fumadocs билдится без ошибок                                                                           |

**Не v1 (отложено):**

- AsyncAPI — нет внешнего event bus (outbox/Centrifugo internal не требуют AsyncAPI v1).
- Pact contract testing — после first external integration (ADR-0002 OQ8).
- Property-based тесты invariants — после первой product-сложной фичи.
- Coverage thresholds — после 3 месяцев продакшна.

### 8. Diagrams: Mermaid only в v1

Sequence / state / ER / C4Context — все Mermaid в MDX. Rendering — Fumadocs встроенный Mermaid plugin. C4-modeling через Mermaid v10+ `C4Context` шейп.

**Trigger to revisit:** 10+ компонентов в architecture diagram, или 3+ stakeholders регулярно читают arch docs — переход на Structurizr DSL (text-based C4, multiple views) или d2.

### 9. Task-tracker split: Plane (strategic) + GitHub Issues (code-level)

Чтобы избежать false-SSOT в Git (`tasks.md`), state работы живёт в task-tracker'ах. **Два tracker'а — две разные зоны ответственности**, cross-link через URL.

| Что трекаем                                                                            | Где                                               | Почему                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack ADRs, infra milestones, product/PM decisions, hiring, fundraising                | Plane workspace `doctor-school` (DSP/DSC/DSM/DSO) | Strategic-уровень, cross-team, Product Lead работает в Plane native, CLAUDE.md pp-plane-first rule                                               |
| Implementation tasks для DS Platform code (EARS handlers, bugs, refactors, deps, perf) | **GitHub Issues** в DS Platform repo              | PR-native (auto-close, mention, sub-issues, GitHub Projects v2), AI работает с `gh` CLI в репо, milestone-cleanly разбивается по feature-spec'ам |
| Cross-cutting initiatives (release planning, infrastructure milestone)                 | Plane parent + GitHub Milestone children          | Strategic owner = Plane, implementation детали = GitHub                                                                                          |

**Convention GitHub Issues для feature-implementation:**

- **One Milestone per feature** (например `001-doctor-onboarding`), description содержит link на `apps/docs/content/specs/features/001-doctor-onboarding/requirements.md`.
- **One Issue per EARS-handler** — title `[001] EARS-3: When OIDC callback received, the system shall ...`, body содержит link на specific EARS-ID в requirements.md.
- **Labels** — `feature:NNN-name`, `kind:ears-handler` / `kind:bug` / `kind:refactor` / `kind:dep-upgrade`.
- **GitHub Project v2** — «DS Platform Implementation» board с swimlanes by feature.

**Cross-linking:**

- Plane Issue → GitHub: URL в description или comment.
- GitHub Issue → Plane: URL в body, optional label `plane:DSO-N`.
- Feature spec → GitHub Milestone: frontmatter поле `tracker: <github-milestone-url>` в `requirements.md`.

**AI-агент workflow:**

- Старт сессии в DS Platform repo: `gh issue view N` → реад linked feature spec → реализация → PR auto-close on merge.
- AI agent НЕ открывает Plane для code-level work — это бы создало friction. Plane open'ится только для strategic context (например, читать DSO-ADR при референсе).

**Almost-SSOT для Plane CLI rule:** в BBM repo (`CLAUDE.md`) правило «pp-plane CLI первый» относится к BBM-уровню (DSP/DSC/DSM/DSO). В DS Platform repo `AGENTS.md` / `CLAUDE.md` фиксируют альтернативное правило: «`gh` CLI первый для code-level Issues; pp-plane — для cross-tracker references (Plane DSO-XXX из ADR/spec)».

### 10. Repository topology в monorepo

```
ds-platform/
├── AGENTS.md
├── CLAUDE.md
├── apps/
│   ├── docs/                      # Fumadocs portal (Next.js)
│   │   └── content/
│   │       ├── adr/
│   │       ├── architecture/
│   │       ├── data/
│   │       ├── operations/
│   │       ├── product/
│   │       │   ├── vision.md
│   │       │   ├── prd/           # PRD chapters per Keystatic collection
│   │       │   ├── business-rules.md
│   │       │   ├── user-journeys.md
│   │       │   └── glossary/      # file-per-term
│   │       ├── specs/
│   │       │   ├── tech/          # brainstorm-style
│   │       │   └── features/      # SDD-style (NNN-name/)
│   │       └── user-guides/       # Diátaxis
│   ├── docs-cms/                  # Keystatic editor (Next.js)
│   │   └── keystatic.config.ts
│   ├── portal/                    # student app (ADR-0004)
│   ├── admin/                     # Refine (ADR-0004)
│   ├── promo/                     # marketing (ADR-0004)
│   ├── cms/                       # Payload v3 (ADR-0004)
│   └── mobile/                    # Expo RN (ADR-0005)
├── packages/
│   ├── schemas/                   # Zod (API SSOT)
│   ├── api-client/                # generated SDK
│   ├── db/                        # Drizzle schema (DB SSOT)
│   ├── glossary/
│   │   ├── ids.ts                 # GENERATED — never edit
│   │   └── loader.ts              # YAML reader для скриптов
│   ├── hooks/, design-system/, observability/, utils/, eslint-config/
│   └── ...
└── tools/lint/
    ├── events-lint.ts
    ├── glossary-mdx-lint.ts
    ├── module-readme-lint.ts
    └── generated-artifacts-check.ts
```

---

## Consequences

### Positive

- **Один Git Master для всей prose+tech** — нет drift между Notion/Outline и кодом, AI читает напрямую.
- **Keystatic over Git** даёт Product Lead Notion-like UX без отдельного prose-store: правка в UI = commit в Git = виден AI следующей сессией.
- **Fumadocs as Next.js app** — единый toolchain (Turborepo cache, shared ESLint/Tailwind/TS config) для docs+portal+admin+promo+cms.
- **SSOT-per-kind таблица** — формальная карта, кто-кому Master, codegen где возможно, autoенно отлавливает drift.
- **EARS+Event Model в feature-specs** даёт AI structured prompt для генерации NestJS handlers + Vitest tests + Playwright E2E — один источник, три артефакта.
- **AGENTS.md split** позволяет добавить Cursor/Codex без переписывания CLAUDE.md.
- **Drift detection из 12 checks** ловит расхождения PR-time; разработка не уезжает от спецификации.
- **Self-host runtime stack** (Keystatic admin, Fumadocs portal, lint-tools) — все compute в RF-периметре. Документация в Git на GitHub.com — приемлемый trade-off (нет ПДн в doc-repo), 152-ФЗ не нарушается. Trigger to revisit: блокировка GitHub.com или политическое решение перенести source code в RF (Gitea/GitLab self-host).
- **Контент-portability**: контент = stock `.md`/`.mdx`/`.yaml` — editor и portal swappable без потери данных.

### Negative

- **Keystatic v0.x maturity risk** — breaking changes возможны раз в 3-6 месяцев. Mitigation: контент-portable; pin minor version; CI smoke-test после Keystatic upgrade.
- **Fumadocs young (~1.5 года)** — plugin-ecosystem меньше Docusaurus, OpenAPI integration требует ручной embed Scalar/Redoc React-компонента. Mitigation: контент-portable.
- **Product Lead учится работе в Keystatic** — block editor проще IDE, но всё равно новая среда; первый месяц + туториал.
- **Glossary 4-layer validation** требует написать ~3 custom lint-скрипта в `tools/lint/` (~300 строк TS). Не trivial, но прямой pattern.
- **Custom ESLint rule `glossary-canonical-ids`** — еще одно maintain. Mitigation: standalone package, тестируется отдельно.
- **EARS + Event Modeling + Gherkin дисциплина** требует обучения; первая feature-spec пишется медленнее. Mitigation: payoff на codegen tests со второго feature.
- **Sync glossary.yaml → Payload Glossary Collection** — ещё один script в CI, идемпотентность нужна.
- **Mermaid единственный — рендер ограничен** для сложных C4. Trigger to revisit зафиксирован.

### Risks

- **Keystatic + Fumadocs combined youth** — оба молоды; теоретически возможна ситуация, когда оба ломаются одновременно major upgrade Next.js. Mitigation: pin major Next.js, проходим upgrade через canary branch.
- **Product Lead продолжает писать в Notion несмотря на Keystatic** — социальный risk. Mitigation: в Master Copy Policy DS Platform-секции явно сказать «BBM Notion больше не Master для DS Platform docs»; деактивировать соответствующие Notion-страницы (или сделать read-only mirror через CI).
- **AI-агент пишет в `apps/docs/content/` напрямую, ломая Keystatic schema** — например добавляет `.md` файл без обязательного frontmatter. Mitigation: CI schema-validation для Keystatic collections — fail если файл не соответствует schema.

---

## Alternatives considered (rejected или deferred)

| Alternative                                             |  Score  | Reason                                                                                                                   |
| ------------------------------------------------------- | :-----: | ------------------------------------------------------------------------------------------------------------------------ |
| Notion-as-Master для prose (BBM pattern extension)      |   n/a   | 152-ФЗ vendor compliance; AI должен fetch через MCP — slower context build; markdown ↔ Notion-blocks lossy serialization |
| Outline self-hosted                                     |   n/a   | Storage = Postgres (не Git) → AI читает snapshot, drift risk; bidirectional sync с Git non-trivial                       |
| TinaCMS                                                 |   147   | Близко к Keystatic (149) — GraphQL-layer добавляет complexity; revisit trigger зафиксирован                              |
| Wiki.js                                                 |   122   | Classical wiki UX, не Notion-blocks; AGPL acceptable но restrictive; sync-interval-based                                 |
| Pages CMS / Sveltia CMS                                 | 102-110 | Очень молоды, schema-power слабее, GitHub OAuth bias                                                                     |
| Outline / AFFiNE / AppFlowy / HedgeDoc                  |   n/a   | Хранят в своей БД, не Git → drift risk + AI fetch overhead                                                               |
| Docusaurus v3 (portal)                                  |   157   | Webpack-build отдельно от Next.js monorepo; ecosystem зрелее но stack-disconnect                                         |
| Starlight (Astro) portal                                | 161/181 | Tied/wins on weighted; explicit override пользователя в пользу Next.js-fit (Fumadocs)                                    |
| Nextra v3                                               |   173   | Native Next.js, но doc-specialization слабее чем Fumadocs                                                                |
| ~~MkDocs Material~~                                     |   n/a   | Dropped пользовательский override («не динозавры нулевых»)                                                               |
| Structurizr DSL для C4                                  |   n/a   | Overhead vs Mermaid в Phase 0; trigger для revisit зафиксирован                                                          |
| Full SDD (EARS+Event+Gherkin) для всех specs incl. tech |   n/a   | Retrofitting DSO-25..29 в EARS impractical; hybrid (option B) chosen                                                     |
| Spec-Kit (GitHub) CLI                                   |   n/a   | Адресует тот же use-case; добавляет внешний CLI-tool; наш hybrid pattern доказан на DSO-25..29                           |
| AsyncAPI v1                                             |   n/a   | Нет внешнего event bus; trigger v2+                                                                                      |
| Atlas migrations                                        |   n/a   | Drizzle-kit покрывает (ADR-0003 §4) — нет смысла второй migration tool                                                   |
| DBML + dbdocs.io                                        |   n/a   | Drizzle introspect → ERD рендер покрывает (ADR-0003 §4)                                                                  |
| AGENTS.md only (no CLAUDE.md)                           |   n/a   | Теряем Claude-specific MCP / skills / hooks config                                                                       |
| CLAUDE.md only (BBM pattern)                            |   n/a   | Не масштабируется на multi-agent (Cursor, Codex)                                                                         |

---

## Open questions (deferred)

| ID       | Q                                                                                                                    | Где решается                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-Doc1  | Versioning документации в Fumadocs (per-release docs vs unversioned)                                                 | Первый breaking change в публичном API после v1                                                                                                                                                                                                                      |
| OQ-Doc2  | AsyncAPI добавить                                                                                                    | Когда появится первый продуктовый event bus наружу                                                                                                                                                                                                                   |
| OQ-Doc3  | AI-powered search (Mintlify / Orama Cloud)                                                                           | Если organic Fumadocs search окажется недостаточным после 6 месяцев                                                                                                                                                                                                  |
| OQ-Doc4  | Дополнительные glossary fields beyond v1 (synonyms with weight, related-terms graph, deprecation flag)               | По мере роста терминологии — DSO-31+                                                                                                                                                                                                                                 |
| OQ-Doc5  | Keystatic → TinaCMS migration trigger                                                                                | При первом breaking Keystatic v0.x → v1.0                                                                                                                                                                                                                            |
| OQ-Doc6  | Pact contract testing                                                                                                | Первая external integration после v1                                                                                                                                                                                                                                 |
| OQ-Doc7  | Property-based тесты invariants                                                                                      | Первая product-сложная фича с math-инвариантами (ledger reconciliation, etc.)                                                                                                                                                                                        |
| OQ-Doc8  | AI-powered hosted doc search (Mintlify / similar)                                                                    | Только при явной боли — self-host Fumadocs Orama search недостаточен после 6 месяцев И ops-overhead self-host alternative значителен. Hosted doc-search не содержит ПДн (только public docs metadata), 152-ФЗ trade-off приемлем. Default — оставаться на self-host. |
| OQ-Doc9  | Structurizr DSL для C4                                                                                               | 10+ компонентов в arch diagram или 3+ stakeholders                                                                                                                                                                                                                   |
| OQ-Doc10 | i18n EN документации портала                                                                                         | Если найм English-speaking разработчиков начнётся                                                                                                                                                                                                                    |
| OQ-Doc11 | §-reference linter — CI guard, парсит `ADR-NNNN §X` / `spec §X` и валидирует существование секции в target документе | Phase 1 enhancement; trigger — повторное обнаружение wrong-section citations при code review (issue зафиксирован DSO-61, 11 wrong refs найдено в DSO-24 batch)                                                                                                       |

---

## Связанные ADR / Делегировано

**Наследуется от:**

- ADR-0001 — единый OIDC tenant (Authentik **или Zitadel** — финальный выбор pending ADR-0001 §8 spike) для Keystatic admin login, тот же tenant что Refine admin (`apps/admin`)
- ADR-0002 — Zod schemas + nestjs-zod + openapi-typescript → SDK
- ADR-0003 — Drizzle schemas + drizzle-kit
- ADR-0004 — Payload v3 Glossary Collection, Next.js 15 + Tailwind + shadcn для всех apps
- ADR-0005 — Module README pattern переиспользуется в `apps/mobile/src/modules/`

**Делегировано в другие задачи:**

- **DSO-31 (Repo strategy / Engineering readiness):** monorepo tooling финализация (Turborepo); CI workflow.yml; Fumadocs setup; Keystatic setup; AGENTS.md/CLAUDE.md draft; первый glossary YAML scaffold; lint-tools пакет; sync-glossary-to-payload script; deployment домен `docs.dsplatform.bbm.academy` + `docs-cms.dsplatform.bbm.academy`.
- **Phase 0.5 после DSO-31:** первый feature-spec в SDD-формате как acceptance proof.
- **DSO-32 (Юр):** статусы Notion-страниц DS Platform после миграции — read-only mirror или deprecation.

**Влияет на (downstream blockers):**

- **DSO-31** — структура `apps/docs/`, `apps/docs-cms/`, `packages/glossary/`, `tools/lint/`.
- **Payload Phase 0 implementation** — Payload Glossary Collection requires canonical glossary as SSOT.
- **Feature-specs DS Platform code** — spec-format зафиксирован, можно начинать `docs/content/specs/features/001-*/` для первой product-фичи.
