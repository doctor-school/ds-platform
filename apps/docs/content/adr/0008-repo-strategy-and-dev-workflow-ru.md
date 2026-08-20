---
title: "ADR-0008 — DS Platform Repository Strategy + Dev Workflow [RU]"
description: "DSO-25..30 + DSO-60 зафиксировали технологический стек DS Platform, методологию разработки и task-tracking split (Plane strategic / GitHub Issues..."
lang: ru
---

> **EN:** [`0008-repo-strategy-and-dev-workflow-en.md`](./0008-repo-strategy-and-dev-workflow-en.md) · **RU (this)**

# ADR-0008 — DS Platform Repository Strategy + Dev Workflow

**Дата:** 2026-05-19 (текущая редакция; полная история эволюции — в `git log`)
**Статус:** Accepted
**Связан с:** Plane DSO-31 (`fae57ab6-f09b-4a4d-9ede-9a4f1ca504c0`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0008-repo-strategy-and-dev-workflow-design-ru.md`
**Наследует:** ADR-0001 (Zitadel), ADR-0002 (NestJS+BullMQ), ADR-0003 (Postgres17+Drizzle), ADR-0004 (Next.js 15+Refine), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs+GitHub Issues), ADR-0007 (AI loop + интерактивные режимы ревью)

---

## 1. Context

DSO-25..30 + DSO-60 зафиксировали технологический стек DS Platform, методологию разработки и task-tracking split (Plane strategic / GitHub Issues code). Что осталось не зафиксировано — операционный слой между «решениями» и «первой строкой кода»:

- **Где** живёт код, под каким владельцем, в каких границах
- **Структура** monorepo до конкретных папок и manifest-файлов (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- **Release tooling** — как версионируются и публикуются apps/packages (changesets vs release-please vs conventional-only)
- **Pre-commit + branch protection policy** — concrete rules для main-ветки и local hooks
- **CI topology** — runner choice, pipeline shape, какие jobs blocking
- **CODEOWNERS bootstrap** — кто ответственен за что в Phase 0 (team-of-1+AI)
- **Версии Node/pnpm** — pin strategy, чтобы AI-агент и человек видели одно окружение

AI-stack design spec §11 уже перечислил шаги AI-loop tooling (bootstrap, lint guards, branch protection). Эти шаги остаются authoritative; ADR-0008 их обрамляет: создаёт repo skeleton, в котором §11 шаги выполнимы.

**Hard requirements:**

- Каждое решение AI-agent-friendly: новый агент в свежей сессии должен ориентироваться через bootstrap (ADR-0007 §2.5) + чтение AGENTS.md/CLAUDE.md/ADRs из workspace, без MCP-fetch proxy.
- Phase 0 minimum moving parts: ничего, что не блокирует первую feature-spec, не вводится.
- 152-ФЗ: код может жить на GitHub.com (нет ПДн в source). Trigger to revisit — политическое решение или блокировка GitHub.com из РФ (тогда mirror в Gitea/Forgejo на Timeweb; уже обсуждалось в ADR-0006 §Consequences).
- [[feedback_tech_stack_criteria_no_team_skill]]: выбор tooling не аргументируется «команда умеет / прототипы». Критерии — mainstream 2026, integration с уже-принятым стеком, low ops overhead для team-of-1+AI.

---

## 2. Decision

### 2.1 Repo identity и владелец

- **GitHub repository:** `doctor-school/ds-platform`, **public** (план организации: GitHub Free). Видимость — рычаг владельца с живым трейд-оффом, а не закрытый вопрос: public даёт бесплатно неметрируемые hosted-минуты Actions и доступный branch-protection API (§2.6 — именно это условие reactivation trigger'а) ценой читаемого исходника; **private** даёт лишь 2000 мин Actions/мес включённо (далее $0.008/мин за 2-ядерный `ubuntu`) и оставляет protection API за paywall'ом. Уход в private доступен в любой момент, когда читаемость исходника станет связывающим ограничением, но требует enabler'а по стоимости — CI-diet под бесплатную квоту (§2.8 batching) либо upgrade до GitHub Team. Видимость **не** влияет на владение: код `UNLICENSED` (проприетарный, все права защищены) при любой видимости; открытое состояние — _source-available_, не open-source (ADR-0013 §5).
- **GitHub organization:** `doctor-school` (GitHub Free plan: unlimited private repos + unlimited collaborators). Все repos DS Platform живут здесь — client-platform-level граница, симметричная Plane workspace `doctor-school`.
- **Visibility decision Phase 1+:** сейчас репо source-available; оставить так или закрыть обратно в private — отдельный ADR при достижении Pre-pilot или появлении community-сценария.

### 2.2 Monorepo build orchestrator + package manager

- **pnpm 10.x** (workspaces) — inherited ADR-0006 §2.
- **Turborepo** — inherited ADR-0006 §2; root `turbo.json` управляет build/lint/test pipeline + remote cache (cache server — решение отложено до момента «локальный кеш недостаточен», Phase 1+).
- **`packageManager` field** в root `package.json` (`pnpm@10.x`) — corepack auto-fetch, нет глобальной установки.
- **`engines`** требует `node ^22.22.2 || ^24.15.0 || >=26.0.0` + `pnpm >= 10`; `.npmrc` `engine-strict=true` блокирует install на mismatch.
- **Node version pin:** `.nvmrc` с `22` + `packageManager` — два source, оба автоматически honored разными tools (nvm/fnm/Volta/mise/corepack), no required client-side tool.

### 2.3 Top-level layout

Layout наследуется из ADR-0006 §10 unchanged + добавляет файлы из AI-stack design spec §11 + DSO-31 root-manifest файлы:

```
ds-platform/
├── AGENTS.md, CLAUDE.md, README.md
├── package.json, pnpm-workspace.yaml, pnpm-lock.yaml
├── turbo.json, tsconfig.base.json
├── .nvmrc, .editorconfig, .gitignore, .gitattributes, .npmrc
├── .changeset/                  # release tooling state
├── .github/
│   ├── workflows/{ci,release}.yml
│   ├── CODEOWNERS
│   ├── pull_request_template.md
│   ├── ISSUE_TEMPLATE/{feature,bug,chore}.md
│   └── dependabot.yml
├── apps/
│   ├── api/                     # NestJS (ADR-0002)
│   │   └── drizzle/             # drizzle-kit generated SQL diffs (ADR-0003 §4)
│   ├── promo/                   # SSG/ISR doctor.school (ADR-0004 §2)
│   ├── portal/                  # SSR app.doctor.school (ADR-0004 §2)
│   ├── admin/                   # Refine admin.doctor.school (ADR-0004 §2)
│   ├── cms/                     # Payload v3 cms.doctor.school — marketing-content (ADR-0004 §7)
│   ├── docs/                    # Fumadocs portal (ADR-0006 §2)
│   │   └── content/
│   │       ├── adr/             # ADR-0001..NNNN + парные design specs
│   │       ├── architecture/    # high-level arch docs (ADR-0006 §10)
│   │       ├── data/            # data model + ERD (ADR-0006 §10)
│   │       ├── operations/      # runbooks, monitoring (ADR-0006 §1, §10)
│   │       ├── product/
│   │       │   ├── vision.md
│   │       │   ├── prd/         # PRD chapters
│   │       │   ├── business-rules.md
│   │       │   ├── user-journeys.md
│   │       │   └── glossary/    # file-per-term master (ADR-0006 §6)
│   │       ├── specs/
│   │       │   ├── tech/        # tech-spec brainstorm outputs (ADR-0006 §4)
│   │       │   └── features/NNN-<slug>/   # SDD 3-file (ADR-0006 §4)
│   │       └── user-guides/     # Diátaxis (ADR-0006 §10)
│   ├── mobile/                  # Expo/RN (ADR-0005)
│   ├── academy-demo/            # dev-only Academy review surface (ADR-0013)
│   └── showcase/                # dev-only design-system showcase (ADR-0013)
├── packages/
│   ├── schemas/                 # Zod API SSOT (ADR-0002 §3-5, ADR-0006 §1)
│   ├── api-client/              # generated openapi-typescript SDK (ADR-0002, ADR-0006 §1)
│   ├── db/                      # Drizzle TS schemas master + loader (ADR-0006 §1, §10)
│   ├── glossary/                # ids.ts (generated) + loader.ts (ADR-0006 §6)
│   ├── hooks/                   # shared React hooks (ADR-0006 §10)
│   ├── design-system/           # tokens + UI primitives (ADR-0006 §10)
│   ├── observability/           # OTel wrappers, GenAI semconv (ADR-0006 §10, ADR-0007 §2.10)
│   ├── utils/                   # shared util fns (ADR-0006 §10)
│   ├── eslint-config/           # flat config + custom rules (ADR-0004 §13, ADR-0006 §6)
│   ├── tsconfig/                # shared TS configs
│   └── llm-utils/               # buildContext.ts и др. (ADR-0007 §2.5)
└── tools/
    ├── agent-bootstrap.ts       # ADR-0007 §2.5
    └── lint/
        ├── spec-link-lint.ts          # ADR-0007 §2.6
        ├── ears-test-lint.ts          # ADR-0007 §2.6
        ├── glossary-mdx-lint.ts       # ADR-0006 §6 (layer 2)
        ├── events-lint.ts             # ADR-0006 §7 (events drift)
        ├── module-readme-lint.ts      # ADR-0006 §7 (warn v1)
        └── generated-artifacts-check.ts  # ADR-0006 §7
```

**Источник правды для layout — ADR-0006 §10.** ADR-0008 ничего не переименовывает; добавляет только root-level manifest файлы и `.github/`-skeleton. Канонический master Drizzle-схем — `packages/db/schema/` (по ADR-0006 §1 SSOT-row); `packages/db/` позволяет read-only потребителям (`apps/admin`, `apps/cms`) импортировать ImageRecord schema без cross-app import. `apps/api/drizzle/` (миграции) — без изменений.

**No top-level `docs/`** — вся документация рендерится через Fumadocs из `apps/docs/content/`. Это сохраняет один SSOT для рендера и совпадает с ADR-0006 §1, §10 топологией.

**Backend — единый app, не service mesh** — backend = `apps/api/` (нет top-level `services/`). Конфиги локальной dev-среды (docker-compose dev-стенд) живут в `infra/dev-stand/` внутри этого репо — tightly coupled с application code (новый сервис → новый env var → compose update, один атомарный commit). Prod-deployment конфиги (Coolify manifests / Terraform) живут в отдельном repo `doctor-school/ds-platform-deploy`, создаётся в момент первого prod-deploy. `apps/` + `packages/` содержат pure application code.

**ADRs живут в `apps/docs/content/adr/`** (рендерятся Fumadocs'ом как раздел), парные design specs — рядом с тем же номером (`0008-repo-strategy-and-dev-workflow-ru.md` + `0008-repo-strategy-and-dev-workflow-design.md`). Это унифицирует pattern с ADR-0007's split на ADR + spec.

### 2.4 Release tooling

- **changesets** (`@changesets/cli` + `@changesets/changelog-github`).
- Поддерживает independent versioning per package (ADR-0006 multi-app), integrates с GitHub Actions через official `changesets/action`, conventional-commits-agnostic (changeset = explicit dev intent), opt-in: PR без changeset = warning, не блок (BLOCK конфигурируется per-app позже).
- **Conventional Commits** — light convention для changeset summary autogen (`fix:`, `feat:`, `chore:`), без enforcement в pre-commit. Если разработчик нарушит — changeset summary вручную фиксируется.
- **PR merge style:** squash-only. Чистая history; changesets умеет читать squashed commits.

### 2.5 Pre-commit hooks

- **simple-git-hooks + lint-staged** (pinned версии в root `package.json`).
- Hooks Phase 0:
- `pre-commit`: `lint-staged` (ESLint --fix + Prettier на staged files)
- `commit-msg`: (optional v2) commit-message lint для conventional-commits
- Установка через `pnpm install` postinstall script (simple-git-hooks self-registers).
- **Не Husky.** Author Husky deprecated его собственный пакет 2024-09 в пользу simple-git-hooks; продолжать с Husky = техдолг с момента создания.
- **Не lefthook.** Go binary как dependency — friction для AI-агентов в varied environments (особенно CI containers без Go runtime).

### 2.6 Branch strategy + protection

- **Trunk-based:** `main` — единственная long-lived ветка. Feature branches `feat/DSO-NN-<slug>` или `fix/<issue-N>-<slug>` короткие, мержатся squash'ем, удаляются после merge.
- **Repository settings** (отдельно от branch protection, применяются через `gh api /repos/{owner}/{repo}`):
  - `allow_squash_merge: true`
  - `allow_rebase_merge: false`
  - `allow_merge_commit: false`
  - `delete_branch_on_merge: true`

  Эти настройки **не** платные и применены сегодня. Сами по себе они enforce'ят squash-only независимо от состояния branch protection.

- **Branch protection на `main` — применена на сервере как repository ruleset.** Репо `doctor-school/ds-platform` — **public** (организация `doctor-school` остаётся на GitHub Free), поэтому бесплатно доступны и legacy protection endpoint, и Rulesets. Enforce'ящийся механизм — именно **repository ruleset** (`main protection`, `enforcement: active`, условие `~DEFAULT_BRANCH`), а не legacy branch protection: bypass actors есть только у rulesets, и ровно один узко заданный bypass — то, что сохраняет живым release train. Применённый payload закоммичен дословно в `branch-protection.json` в корне репо.

  | Применённое правило                                                                                                                                                                                                | Эффект                                                                                                                                             |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `pull_request` — `required_approving_review_count: 0`, `require_code_owner_review: false`, `require_last_push_approval: false`, `dismiss_stale_reviews_on_push: false`, `required_review_thread_resolution: false` | Pull request обязателен: ничто не попадает в `main` мимо него; при этом нативный approving review не требуется.                                    |
  | `required_status_checks` — `ci`, `strict_required_status_checks_policy: false`                                                                                                                                     | Единственный meta-job check из §2.8 должен быть зелёным. Non-strict: нет принудительного rebase всех открытых PR при каждом движении `main`.       |
  | `required_linear_history`                                                                                                                                                                                          | Squash-only история, подкрепляет repo-level настройки `allow_*`.                                                                                   |
  | `non_fast_forward` / `deletion`                                                                                                                                                                                    | Никакого force-push в `main`; `main` нельзя удалить.                                                                                               |
  | bypass actor: `RepositoryRole` id 5 (Admin), `bypass_mode: pull_request`                                                                                                                                           | Админ может обойти правила **только при merge пулл-реквеста** — никогда для прямого push'а, force-push'а или удаления: они заблокированы для всех. |

- **Почему два пункта контракта сознательно НЕ enforce'ятся на сервере.** Исходный target contract перечислял ещё «≥1 approving review», «dismiss stale reviews», «branches up-to-date» и «conversation resolution». Применённые дословно, они блокируют каждый merge, а не редкий крайний случай:
  - **Approving review.** Вердикты Mode (a) публикуются как comment-review (ADR-0007 §2.10), а единственный человек Phase 0 (§2.7) он же автор PR — нативный APPROVE структурно недоступен. `required_approving_review_count: 1` заблокировал бы **каждый** PR навсегда.
  - **Conversation resolution.** Нерешённый тред ревьювера или бота блокировал бы merge, а второго человека, который его закроет, нет.
  - **Branches up-to-date (`strict`).** При параллельных волнах каждый push в `main` инвалидировал бы все остальные открытые PR — катящийся deadlock. Привязка к head-SHA внутри gate `pr:land` и так роняет merge со stale-head.
  - **`include administrators`.** У rulesets нет тумблера «включить администраторов» по принципу всё-или-ничего; эквивалент здесь — узкий режим bypass `pull_request`. От правил push / force-push / deletion админы НЕ освобождены.

  Их intent живёт на процессной стороне — в детерминированном локальном gate, а не в конвенции: `pnpm pr:land <N>` отказывает в squash-merge, пока привязанные к head-SHA check-run'ы не терминально-зелёные И к тому же head не привязан вердикт `## Mode (a) Review` (исключения — только через громкий `--mode-a-exempt`).

- **Escape hatch для release train.** Bot-ветка Changesets `changeset-release/main` не несёт ни одного CI check-run, поэтому `ci` там неудовлетворим никогда. Её документированный merge — сырой `gh pr merge --squash --delete-branch --admin` под admin-токеном владельца — проходит через bypass actor в режиме `pull_request`. Это единственный документированный ручной override; гейтом на нём остаётся проверка состава файлов + зелёного main-CI из `repo-conventions.md` → _Version-Packages release PR_.

- **Reactivation trigger — сработал и закрыт.** Триггером было «API становится доступным»: организация апгрейдится на GitHub Team/Enterprise, **или** репо переводится в public (на public repos branch protection и rulesets бесплатны), или репо переезжает на forge, где эквивалентный feature бесплатен (тогда — отдельный ADR). Второе условие выполнилось, и описанная выше форма правила применена в рамках Issue #1403. Если репо вернётся в private на плане Free, ruleset перестанет enforce'иться и единственным механизмом снова станет process-level gate (`pr:land`).

### 2.7 CODEOWNERS

Phase 0 (team-of-1+AI):

```
# .github/CODEOWNERS
*    @sidorovanthon
```

Trigger на split: первый наём инженера. Тогда CODEOWNERS разрезается per `apps/<name>/` и `packages/<name>/`, владельцы привязываются к GitHub Teams (если будет ≥3 человека). До этого все PR ревьюит Tech Lead через интерактивные режимы ревью из ADR-0007 §2.10.

### 2.8 CI topology

- **Runner-топология.** Все CI-jobs выполняются на GitHub-hosted `ubuntu-latest`. Нагрузка BATCHED, а не разложена веером: 8 исполняемых jobs против прежних 47 (50 объявленных в двух workflow — 44 в `ci.yml` + 6 в `pr-body-guards.yml`, три из них — `if: false` заглушки в `ci.yml`) — `core` (install + lint + types + unit + build + api-build-smoke + docs-build + tokens-fresh + endpoint-authz), `api-e2e` (Postgres-сервис + `docker build/run`), `guards-block`, `guards-warn`, `playwright-axe`, `playwright-axe-portal`, meta-check `ci`, плюс batch `pr-body-guards` в собственном workflow (#651 — он также триггерится на правку тела PR). Один checkout + один `pnpm install` на batch вместо одного на guard: этот collapse и есть CI-diet, который §2.1 называет enabler'ом для private-квоты, и он не зависит от того, какой класс раннеров его исполняет. `actions/setup-node` несёт `cache: pnpm` — hosted-раннер холодный на каждом job, поэтому восстановление store из Actions-кеша выигрышно. CI-job, которому нужен доступ в RF-private network, не попадает ни в один runner-класс — production deploy выполняется вне CI (ADR-0012).
- **Self-hosted мощность: испытана и отклонена.** Общий эфемерный self-hosted пул (`bbm-ci`, владелец `sidorovanthon/bbm`) был подключён к этому репо в рамках #1224 и откачен в #1249. Причина — starvation очереди, а не compute: измеренный wall-clock `ci.yml` лёг в диапазон 20–814 мин на прогон против ожидаемых по контракту пула ~12–20 мин, потому что batch'и ждали свободного capacity-unit, и PR не мог дойти до терминального состояния CI внутри рабочей сессии. Стоимостная сторона, мотивировавшая испытание, и измерение, следующее за откатом, — в §3 Negative.
- **Pipeline `.github/workflows/ci.yml`** — full drift detection stack per ADR-0006 §7 + AI-specific guards per ADR-0007 §2.6 (семейство body-parsing guard'ов запускается из соседнего `.github/workflows/pr-body-guards.yml`, перезапуск при правке тела PR — #651). Jobs выполняются в параллельных GitHub Actions jobs где возможно; meta-job `ci` зависит от всех required и выставляет единый status check. Workflow также несёт `workflow_dispatch`: перепроверка пайплайна после смены раннеров или топологии — это `gh workflow run CI --ref <branch>`, а не одноразовый no-op PR; dispatch-прогон идёт по тому же не-PR пути, что и `push`-прогон, поэтому ни один guard не ведёт себя иначе.

Таблица ниже — реестр guard'ов: строка на GUARD с его источником и severity. Guard'ы не являются jobs: каждый исполняется шагом одного из batch'ей выше, и severity закодирована на уровне шага (BLOCK — обычный шаг в batch'е, который нужен meta-job'у `ci`; WARN — `continue-on-error` на шаге плюс финальный агрегат batch'а, который заново красит check-run).

| Job                     | Что делает                                                                      | Source        | Severity           |
| ----------------------- | ------------------------------------------------------------------------------- | ------------- | ------------------ |
| `setup`                 | `pnpm install --frozen-lockfile`, кеш `~/.pnpm-store`                           | —             | required           |
| `lint`                  | `pnpm lint` (ESLint flat + Prettier check)                                      | —             | required           |
| `types`                 | `pnpm typecheck` (Turborepo task)                                               | —             | required           |
| `unit`                  | `pnpm test` (Vitest per app/package)                                            | ADR-0007 §2.3 | required           |
| `build`                 | `pnpm build` (Turborepo cache)                                                  | —             | required           |
| `api-drift`             | Spectral lint + `openapi.snapshot.json` diff                                    | ADR-0006 §7   | BLOCK              |
| `db-drift`              | `tools/lint/db-drift-lint.ts` (regenerate ↔ committed migrations)               | ADR-0006 §7   | BLOCK              |
| `events-drift`          | `tools/lint/events-lint.ts` (@OutboxEmit ↔ events.md)                           | ADR-0006 §7   | BLOCK              |
| `generated-artifacts`   | `pnpm generate:all --check` (openapi-typescript SDK + glossary IDs + ERD)       | ADR-0006 §7   | BLOCK              |
| `markdown-links`        | `lychee` cross-doc link check                                                   | ADR-0006 §7   | BLOCK              |
| `module-readme`         | `tools/lint/module-readme-lint.ts`                                              | ADR-0006 §7   | WARN v1 → BLOCK v2 |
| `docs-build`            | `apps/docs` `next build` (Fumadocs compiles clean)                              | ADR-0006 §7   | BLOCK              |
| `glossary-mdx`          | `tools/lint/glossary-mdx-lint.ts` (`[[g:term-id]]` references)                  | ADR-0006 §6   | BLOCK              |
| `glossary-ids`          | ESLint `glossary-canonical-ids` rule (from `packages/eslint-config/`)           | ADR-0006 §6   | BLOCK              |
| `glossary-roundtrip`    | YAML ↔ Payload Glossary Collection sync drift                                   | ADR-0006 §6   | BLOCK              |
| `spec-link`             | `tools/lint/spec-link-lint.ts` (PR feature:\* requires Closes #N + spec folder) | ADR-0007 §2.6 | BLOCK              |
| `ears-tests`            | `tools/lint/ears-test-lint.ts` (EARS-N ↔ test linkage)                          | ADR-0007 §2.6 | WARN v1 → BLOCK v2 |
| `tdd-signal`            | implementation commit без test-file (heuristic)                                 | ADR-0007 §2.6 | WARN v1            |
| `spec-status-fresh`     | merged feature-PR с spec.status=Draft                                           | ADR-0007 §2.6 | WARN v1            |
| `prior-decisions-cited` | new spec без ADR-link если категория ≠ docs-only                                | ADR-0007 §2.6 | WARN v1            |

- **`release.yml`** — changesets action runs on push to `main`, opens "Version Packages" PR или publishes если PR уже merged.

### 2.9 Dependabot + supply chain

- `.github/dependabot.yml`:
- `npm` ecosystem, root + workspace packages, weekly schedule (понедельник 03:00 UTC)
- `github-actions` ecosystem, weekly
- Group minor + patch updates в один PR per package-type (reduces noise)
- Ревью через те же интерактивные режимы, что и feature-PR (ADR-0007 §2.10).
- SBOM генерация (Syft) — engineering-readiness spec §1 Pre-pilot, реализуется в follow-up; в Phase 0 CI её ещё нет (deferred trigger: first prod build).
- Container signing (cosign) — там же, deferred trigger.
- **Dependency freshness baseline (DSO-63 mini-G):** при repo bootstrap (step 19) — dependency freshness pass, pin exact versions в lockfile (`pnpm-lock.yaml`). **Recurring task в Plane:** quarterly dependency review (Dependabot + manual audit для major bumps + security advisories review). Это не реактивный fix-on-bump, а proactive cadence.

### 2.10 Repository bootstrap steps

Pre-DSO-31 admin (Tech Lead, ≤10 минут, ручной):

- **0.** Create GitHub org `doctor-school` (GitHub Free plan) + empty private repo `doctor-school/ds-platform`. URL: https://github.com/doctor-school/ds-platform.

Phase 0 implementation steps — extends AI-stack design spec §11. Шаги 1–14 из AI-stack design spec §11 unchanged. Additional шаги (DSO-32 children или новый work-item):

| Step | Action                                                                                                                                                                                                                                                                                                                                                    | Output                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 15   | Initialise root `package.json` + `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json` + `.changeset/config.json` + `.editorconfig` + `.gitignore` + `.gitattributes` + `.npmrc` + `.nvmrc`                                                                                                                                                         | repo bootstraps locally                       |
| 16   | Создать `.github/` minimal skeleton: `workflows/{ci,release}.yml`, `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{feature,bug,chore}.md`, `dependabot.yml`. CI references только tools которые уже существуют или skip'аются gracefully                                                                                                       | CI runs на первом push                        |
| 17   | Установить `simple-git-hooks` + `lint-staged` в root `package.json` + конфиг `simple-git-hooks` section                                                                                                                                                                                                                                                   | pre-commit работает                           |
| 19   | Initialise empty workspace stubs: `apps/{api,promo,portal,admin,cms,docs,mobile}/` + `packages/{schemas,api-client,db,glossary,hooks,design-system,observability,utils,eslint-config,tsconfig}/`, каждый с минимальным `package.json` (`name: @ds/<name>`, `version: 0.0.0`, `private: true`) + опциональным per-package `turbo.json` для script-stub map | workspace discoverable                        |
| 20   | Initialise `apps/docs/` как Fumadocs Next.js app (см. ADR-0006 §2) — ADR-контент + парные design-спеки лежат в `content/adr/`                                                                                                                                                                                                                             | doc portal builds                             |
| 21   | **[Manual, admin]** Apply repository settings (`allow_squash_merge=true`, `allow_rebase_merge=false`, `allow_merge_commit=false`, `delete_branch_on_merge=true`) через `gh api`. Применить ruleset на `main` из `branch-protection.json` в корне репо. См. design spec §4 для точных команд и §2.6 для формы правила                                      | squash-only enforced; ruleset живёт на `main` |
| 22   | Smoke test: создать первую feature-spec (`NNN-onboarding` или подобная) и пройти iteration cycle ADR-0007 §2.4 end-to-end                                                                                                                                                                                                                                 | proof of concept                              |

Dependency graph: 15 → 16 → 17 → 19 параллельно с 15. 20 depends on 19. 21 depends on 16. 22 depends на всё.

> Step 18 намеренно отсутствует — исторический gap, исходный шаг был свёрнут в step 16 (`.github/` skeleton). Перенумерация downstream шагов не делалась, чтобы сохранить cross-refs из соседних спек (OQ-R4, AI-stack §11).

Step 21 — admin-only. Step 22 — joint Tech Lead+AI.

**Estimate:** Steps 15–22 — Спринт 3 (после Pre-pilot kickoff, ~2026-06-09 start per Plane).

---

### 2.11 Accepted risks (DSO-63 mini-#14, 2026-05-18)

**GitHub vendor risk.** GitHub принят как single hub (repo + CI + issues + agent bootstrap source). Mirror / continuity infrastructure (self-hosted Gitea/GitLab + scheduled mirror) **не строится в pre-pilot** из YAGNI-соображений.

**Mitigation surface для accepted risk:**

- Локальные клоны git-history у всех разработчиков (full history доступна even при GitHub blackout).
- Plane как source of truth для задач (issues — secondary хранилище).
- `.github/` workflows + конфиги — в repo (re-setup на новой CI ≤1 day developer-time).

**Revisit triggers (когда строим mirror/continuity infra):**

- Команда вырастает до >10 человек (`Tech Lead + 9` — увеличивается blast radius при outage).
- Реальный GitHub outage >24h ИЛИ blocked access events.
- Legal / санкционное событие, угрожающее GitHub access из РФ.
- Любой из этих триггеров → mini-ADR с обоснованием mirror-инфры (Gitea/GitLab self-hosted на Timeweb, scheduled mirror, issue export).

**Cross-zone egress treatment:** GitHub — approved channel per ADR-0011 §2.2 (channels #2, #3) с обязательным PII scanner pre-commit + audit-egress-channels CI gate. Что в GitHub попадает регулируется не GitHub vendor risk, а egress control plane.

---

## 3. Consequences

### Positive

- **Один SSOT для платформенной документации** — ADR/specs/glossary/runbooks все в `apps/docs/content/`, рендерятся Fumadocs'ом единообразно. AI-агент в ds-platform читает их через relative path без cross-repo fetch.
- **Репозиторий одного назначения** — `ds-platform` содержит application code + platform docs и ничего больше. AI-агент, открыв репо, видит один связный scope, без strategy/бизнес-материала, через который нужно продираться.
- **Mainstream defaults Phase 0** — pnpm+Turborepo+changesets+simple-git-hooks — стек, который любой TypeScript-инженер 2026 читает без дополнительного обучения. AI-агент (Claude/Codex) тренирован на этих паттернах.
- **Минимум moving parts на старте** — нет Vault/feature-flags/cache-server в Phase 0. Каждый из них добавляется по explicit trigger, документированному либо здесь, либо в engineering-readiness spec; CI выполняется на GitHub-hosted раннерах (§2.8), поэтому никакая runner-инфраструктура из этого репо не оперируется.
- **Branch protection включается до первого merge** — нет окна Phase 0 без guards.

### Negative

- **`apps/docs/` как Next.js app — тяжелее, чем static markdown render**. Fumadocs build занимает ~30s, при каждом ADR-edit перерасчитывается. Trade-off уже принят в ADR-0006 (single toolchain). Mitigation: Turborepo cache.
- **Hosted fan-out быстрый, но метрируемый**. На GitHub-hosted раннерах jobs идут полностью параллельно (~4 мин wall до collapse) и потребляли ≈5000 оплачиваемых min/мес против квоты GitHub Free 2000 min/мес для private repo — это и есть стоимостная проблема, мотивировавшая попытку общего self-hosted пула. Пул был измерен на 20–814 мин на прогон (starvation очереди за эксклюзивными capacity-классами, не compute) и откачен в #1249, так что wall-time вернулся к hosted-профилю. Public-видимость (§2.1) снимает метрирование полностью — hosted-минуты на public repo не оплачиваются, — поэтому оплачиваемые минуты становятся ограничением только при возврате в private. От CI-diet остался batch-collapse (§2.8), чей эффект на оплачиваемые минуты не измерен; follow-up, актуальный при возврате в private, — снять фактическое потребление из org billing за 2–4 недели против базы ≈5000 min/мес и взвесить managed runner service либо амортизированную стоимость выделенной машины уже на реальных числах.
- **CODEOWNERS = одна строка с `@sidorovanthon`** — формально работает, но GitHub UI отображает «один owner на всё» как single point of failure. Mitigation: явно знаем, Phase 1 split документирован как trigger.

### Risks

- **GitHub.com блокировка из РФ** — gradual scenario (rate limits на Russian IPs, или полная блокировка). Mitigation: mirror `ds-platform` в self-hosted Gitea/Forgejo на Timeweb как read-only failover. Trigger: первое sustained недоступности GitHub.com из РФ > 24h. Trigger-ADR опишет sync mechanism.
- **changesets versioning conflict при independent releases multiple apps** — два PR одновременно меняют один package + апдейтят changeset → merge conflict в `.changeset/`. Mitigation: changesets handles это (changeset files имеют random hash names, не конфликтуют между PR); merge conflict только в `CHANGELOG.md` and `package.json`, что разрешается в обычном rebase.
- **Pre-commit hooks ломают `git commit` для AI-агента** если environment не подготовлен — Vitest crashed или ESLint config broken. Mitigation: hooks делают только lint-staged (быстро), не запускают тесты; `git commit --no-verify` остаётся valid escape hatch для AI-агента (документировано в AGENTS.md, но warning «использовал bypass»).

---

## 4. Alternatives considered (rejected или deferred)

| Alternative                                                  | Reason rejected/deferred                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS Platform code в shared strategy + code monorepo**       | Mixed strategy/code workspace = слабая граница для AI-агента: cognitive bleed между бизнес/PRD-материалом и implementation. Выделенный application-repo держит контекст агента сфокусированным. Rejected.                                                                             |
| **Polyrepo** (один repo на app: ds-portal, ds-api, ds-admin) | Дублирует tooling в каждом (ESLint, TS config, CI yaml), теряет Turborepo cross-package cache, atomic refactors через ≥2 apps требуют orchestration. Phase 0 размер не оправдывает overhead. Rejected.                                                                                |
| **Гибрид: backend polyrepo, frontend monorepo**              | Backend = один NestJS app (ADR-0002), нет нужды в polyrepo. Rejected.                                                                                                                                                                                                                 |
| **Self-host Git (Gitea/Forgejo) с самого старта**            | Premature ops overhead: VPS + admin + backup + DNS + SSO-обвязка поверх production-Zitadel (который обслуживает конечных пользователей платформы, а не dev tooling). GitHub.com покрывает Phase 0 use cases без ops cost. Trigger на mirror (см. Risks): первая блокировка. Deferred. |
| **Personal account как owner** (`sidorovanthon/ds-platform`) | Personal-account-as-team anti-pattern: transfer в org позже ломает PR/Issue cross-refs (хотя redirect работает), CODEOWNERS без teams = list of usernames. Rejected.                                                                                                                  |
| **changesets в favour release-please** (Google project)      | release-please tighter coupled to conventional-commits (no opt-out); требует `release-please-action` который медленнее эволюционирует. changesets — incumbent for pnpm-monorepos 2026. Deferred (можно мигрировать позже без потерь).                                                 |
| **changesets в favour semantic-release**                     | semantic-release одна version per repo, не fits multi-app independent versioning. Rejected.                                                                                                                                                                                           |
| **conventional-commits-only (no changesets)**                | Не поддерживает intentful version bumps (e.g., "this fix is also breaking on app-X но не на app-Y"); changeset = explicit dev statement. Rejected.                                                                                                                                    |
| **Husky для pre-commit**                                     | Deprecated его собственным author (typicode) 2024-09 в пользу simple-git-hooks. Использование = добавлять техдолг с момента создания. Rejected.                                                                                                                                       |
| **lefthook для pre-commit**                                  | Go binary как dependency: AI-агенты работают в varied CI containers (Vercel, GitHub Actions, locally) без Go runtime. Friction. Rejected.                                                                                                                                             |
| **GitLab CI вместо GitHub Actions**                          | Mismatch с уже-выбранным GitHub Issues (ADR-0006 §9): cross-repo refs, PR-issue auto-close, `gh` CLI tooling — всё построено на GitHub. Rejected.                                                                                                                                     |
| **Self-hosted Forgejo Actions / Drone / Woodpecker**         | Замена CI-_системы_ не совместима с уже построенной на GitHub петлёй (Issues, `gh`-tooling, PR auto-close). Вопросы мощности решаются на уровне _runner_'а, и он остаётся GitHub-hosted (§2.8). Rejected.                                                                             |
| **GitFlow** (develop + main + release branches)              | Tooling weight для team-of-1+AI; squash-merge на main + short-lived feature branches покрывает все use-cases. Rejected.                                                                                                                                                               |
| **Allow merge commits + rebase merge**                       | Mixed merge styles ломают changesets parsing и AI-agent reasoning о history. Rejected.                                                                                                                                                                                                |
| **Optional CODEOWNERS**                                      | Без CODEOWNERS = нет автоматического PR-reviewer assignment в GitHub UI. Стартуем с минимальным `* @sidorovanthon` чтобы файл существовал. Accepted (см. §2.7).                                                                                                                       |
| **GitHub Teams plan ($4/user/mo) с самого старта**           | $4/мес × 1 user = $4/мес, не cost-issue, но bringing-up без необходимости. Free plan покрывает private repo + CI 2000 min. Trigger на upgrade: исчерпан CI лимит или > 3 коллабораторов которым нужны Teams для CODEOWNERS. Deferred.                                                 |
| **Top-level `docs/` folder в ds-platform**                   | Дублирует с `apps/docs/content/` где Fumadocs serves документацию. Два места хранения = drift risk + AI-agent не знает где master. Rejected (см. §2.3).                                                                                                                               |

---

## 5. Open follow-ups (DSO-32+ и beyond)

| ID     | Q                                                                                                                                                                                                                    | Где решается                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| OQ-R1  | Точная версия pnpm pin (10.x — какая minor)                                                                                                                                                                          | На момент step 15 implementation; берётся latest stable на дату                                                                                                                |
| OQ-R2  | Turborepo remote cache server (self-host vs Vercel-managed)                                                                                                                                                          | Phase 1 trigger: локальный кеш недостаточен (>50% CI time на cold cache)                                                                                                       |
| OQ-R3  | `tools/lint/glossary-drift.ts` импл — какой парсер MDX (gray-matter? remark?)                                                                                                                                        | Step 8 (AI-stack design spec §11) implementation                                                                                                                               |
| OQ-R4  | Dependabot grouping rules — все minor+patch в один PR vs per-ecosystem                                                                                                                                               | Step 16 implementation, calibrate после первых 4 weeks                                                                                                                         |
| OQ-R5  | Squash commit title template (по умолчанию = PR title; custom?)                                                                                                                                                      | Phase 1 enhancement если AI-agent тяжело парсит history                                                                                                                        |
| OQ-R6  | Phase 1 CODEOWNERS split granularity (per-app vs per-folder вглубь)                                                                                                                                                  | На момент второго инженера hired                                                                                                                                               |
| OQ-R7  | Container signing (cosign) trigger                                                                                                                                                                                   | First prod-build (Phase 1)                                                                                                                                                     |
| OQ-R8  | SBOM (Syft) trigger                                                                                                                                                                                                  | Same as OQ-R7                                                                                                                                                                  |
| OQ-R9  | GitHub Team plan upgrade trigger thresholds (точные min/мес)                                                                                                                                                         | После 2 месяцев Phase 0 telemetry                                                                                                                                              |
| OQ-R10 | Mirror на Gitea/Forgejo failover plan                                                                                                                                                                                | Trigger: GitHub.com sustained downtime > 24h из РФ                                                                                                                             |
| OQ-R12 | Self-hosted GHA runner — конкретный setup                                                                                                                                                                            | **CLOSED** — никакого. Общий эфемерный пул BBM был испытан (#1224) и откачен (#1249); CI выполняется GitHub-hosted per §2.8, без выделенного runner-VPS и без runner-ADR здесь |
| OQ-R13 | `packages/db/` vs `apps/api/src/db/schema/` — формальное разрешение ADR-0003 §4 ↔ ADR-0006 §1 conflict                                                                                                               | **CLOSED** — ADR-0003 §4 теперь читает `packages/db/schema/` как канонический master, в согласии с ADR-0006 §1                                                                 |
| OQ-R14 | Reactivation discipline owner — trigger §2.6 сработал (репо public); кто отвечает за применение branch-protection контракта?                                                                                         | Owner: Tech Lead. Закрыт Issue #1403: на `main` живёт repository ruleset, bypass админа сужен до `pull_request`, поэтому bot-ветка Version-Packages остаётся mergeable.        |
| OQ-R15 | Периодический process-level аудит compliance с merge-gate intent — нужен ли регулярный (ежемесячный?) self-audit, подтверждающий, что merges Tech Lead'а реально удовлетворили §2.6 intent (CI green, diff прочитан) | Deferred — добавляет overhead без очевидной ценности в single-developer Phase 0; пересмотреть при найме второго инженера (OQ-R6 trigger)                                       |

---

## 6. Related ADRs / Делегировано

**Наследуется от:**

- ADR-0001 — Zitadel: SSO для GitHub.com не нужен в Phase 0 (Enterprise plan only); решение revisit при росте команды.
- ADR-0002 §6 — BullMQ async queue: живёт как часть `apps/api/`.
- ADR-0002 §3-5 — Zod schemas + openapi-typescript: `packages/schemas/` + `packages/api-client/` (последний — generated артефакт).
- ADR-0003 §4 (Drizzle ORM + drizzle-kit migrations) + §7 (pgvector): Drizzle schemas в `packages/db/schema/`; миграции в `apps/api/drizzle/`.
- ADR-0004 §2 — 4 frontend apps: promo, portal, admin, cms (Payload v3). Все в `apps/`.
- ADR-0004 §7 — Payload v3 content-only: `apps/cms/`, marketing-content в `cms.*` schema namespace shared Postgres.
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule: `packages/eslint-config/` экспортирует.
- ADR-0005 — RN/Expo mobile: `apps/mobile/` workspace, отдельный build с Expo EAS.
- ADR-0006 §1, §2, §3, §9 — doc topology, Fumadocs, task-tracker split: все воплощаются в layout §2.3.
- ADR-0007 §2.5, §2.6, §2.10 — bootstrap, lint drift guards, autonomy ladder (интерактивные режимы ревью); AI-stack design spec §11 — migration plan: воплощается в `tools/` + `.github/workflows/`.

**Делегировано в другие задачи:**

- **DSO-32 (Pre-pilot work-items) или отдельный repo-setup work-item:** execute steps 15–22 (§2.10). Параллелится между AI-агентом (15–17, 19–20) и Tech Lead (21, 22-сопровождение).
- **Будущий ADR-NNNN (Phase 1 CODEOWNERS):** split per app/package, GitHub Teams setup. Trigger: hire #2.
- **Ревизия стоимости раннеров (следует за #1249):** после 2–4 недель на GitHub-hosted раннерах снять фактическое потребление минут Actions из org billing и взвесить его против managed runner service и амортизированной стоимости выделенной машины; вердикт записать ревизией ADR-0008. Public-видимость (§2.1) уже сняла давление оплачиваемых минут — эта ревизия важна прежде всего на случай возврата репо в private. Испытание self-hosted пула (#1224) закрыто — откачено в #1249.
- **Будущий ADR-NNNN (Container signing + SBOM):** cosign + Syft pipeline integration. Trigger: first prod build (engineering-readiness §1 Pre-pilot full).
- **Будущий ADR-NNNN (Public source-available):** лицензионная / community-позиция уже открытого репо — остаётся ли `UNLICENSED` source-available или принимается настоящая лицензия и contribution-flow. Trigger: Pre-pilot done + community-сценарий.
- **Будущий ADR-NNNN (GitHub.com mirror на self-host Git):** failover. Trigger: §Risks GitHub блокировка.

**Влияет на (downstream):**

- **DSO-32+** — implementation steps 15–22.
- **Все feature-specs DS Platform** — живут в `apps/docs/content/specs/features/NNN-<slug>/` (фиксируется §2.3).
- **AGENTS.md + CLAUDE.md в `ds-platform`** — bootstraps из §2.10 step 11 (AI-stack design spec §11), включают reference на этот ADR-0008 в "Repository conventions" section.
- **Engineering-readiness spec** (`../specs/tech/2026-05-12-engineering-readiness-design-ru.md`) — runtime tooling decisions inherited; референсируется из README.md ds-platform.
