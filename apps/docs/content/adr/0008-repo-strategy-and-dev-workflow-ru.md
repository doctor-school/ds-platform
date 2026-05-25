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
**Наследует:** ADR-0001 (Zitadel), ADR-0002 (NestJS+BullMQ), ADR-0003 (Postgres17+Drizzle), ADR-0004 (Next.js 15+Refine), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs+Keystatic+GitHub Issues), ADR-0007 (AI loop + интерактивные режимы ревью)

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

- **GitHub repository:** `doctor-school/ds-platform`, private до Pre-pilot launch.
- **GitHub organization:** `doctor-school` (GitHub Free plan: unlimited private repos + unlimited collaborators). Все repos DS Platform живут здесь — client-platform-level граница, симметричная Plane workspace `doctor-school`.
- **Visibility decision Phase 1+:** оставить private vs source-available — отдельный ADR при достижении Pre-pilot или появлении community-сценария.

### 2.2 Monorepo build orchestrator + package manager

- **pnpm 10.x** (workspaces) — inherited ADR-0006 §2.
- **Turborepo** — inherited ADR-0006 §2; root `turbo.json` управляет build/lint/test pipeline + remote cache (cache server — решение отложено до момента «локальный кеш недостаточен», Phase 1+).
- **`packageManager` field** в root `package.json` (`pnpm@10.x`) — corepack auto-fetch, нет глобальной установки.
- **`engines`** требует `node >= 22 < 23` (LTS Iron) + `pnpm >= 10`; `.npmrc` `engine-strict=true` блокирует install на mismatch.
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
│   │       │   ├── prd/         # PRD chapters (Keystatic collection)
│   │       │   ├── business-rules.md
│   │       │   ├── user-journeys.md
│   │       │   └── glossary/    # file-per-term master (ADR-0006 §6)
│   │       ├── specs/
│   │       │   ├── tech/        # tech-spec brainstorm outputs (ADR-0006 §4)
│   │       │   └── features/NNN-<slug>/   # SDD 3-file (ADR-0006 §4)
│   │       └── user-guides/     # Diátaxis (ADR-0006 §10)
│   ├── docs-cms/                # Keystatic editor (ADR-0006 §3, ОТДЕЛЬНЫЙ Next.js app)
│   │   └── keystatic.config.ts
│   └── mobile/                  # Expo/RN (ADR-0005)
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

- **Branch protection rule на `main` — target state, deferred enforcement.** GitHub Free + private repo блокирует branch-protection API с HTTP 403 (`"Upgrade to GitHub Pro or make this repository public to enable this feature"`). То же ограничение касается GitHub Rulesets. Организация `doctor-school` — на Free plan; репо — private; в Phase 0 платный upgrade не планируется. Поэтому правила ниже — **target contract**, на сервере сейчас не enforce'ятся:
  1.  Require pull request before merging
  2.  Require ≥1 approving review (`required_approving_review_count: 1`)
  3.  Dismiss stale reviews on new commits
  4.  Require status check `ci` — passing (один контекст — meta-job из §2.8)
  5.  Require branches up-to-date before merging
  6.  Require linear history (squash-only когда разрешён только squash)
  7.  Include administrators (Tech Lead не может байпасить себя)
  8.  No force pushes
  9.  No deletions
  10. Require conversation resolution before merge

  Payload для применения на trigger закоммичен в `branch-protection.json` в корне репо (как документация; ни одна автоматизация его сейчас не потребляет).

- **Interim (Phase 0) merge gate — process-level, не server-side.** Та же intent, другой механизм:

  | Target rule                             | Phase 0 process-level substitute                                                                                                                                                      |
  | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 1. PR обязателен перед merge в `main`   | Convention: Tech Lead никогда не `git push origin main` напрямую; все изменения идут через PR. AGENTS.md hard rule + compliance AI-агента.                                            |
  | 2. ≥1 approving review                  | Convention: Tech Lead читает diff перед кликом merge (single-developer flow; «self-review = read-the-diff»). При наличии второго human-ревьювера — запрашивается через PR sidebar.    |
  | 3. Dismiss stale reviews on new commits | Вручную: Tech Lead перечитывает diff после любого push'а, следующего за ранее прочитанным состоянием.                                                                                 |
  | 4. Required status check `ci` — passing | `gh pr merge --auto --squash` — стандартная merge-команда. GitHub держит merge до прохождения всех checks; эквивалент required-status-check семантики на single-developer happy path. |
  | 5. Branches up-to-date before merging   | `gh pr merge --auto --squash` rebases-or-fails в зависимости от repo setting; ручной `git pull --rebase origin main` перед push — convention.                                         |
  | 6. Linear history (squash-only)         | Enforce'ится на уровне repo settings выше — уже применено, не платно.                                                                                                                 |
  | 7. `include administrators`             | В interim неприменимо — server-side rule нет, обходить нечего. Convention: Tech Lead не пушит в `main` напрямую даже когда технически может.                                          |
  | 8. No force pushes / 9. No deletions    | Только convention. Hard rule Tech Lead'а: никогда `git push --force` в `main`; никогда `git push --delete origin main`. После reactivation становится server-side.                    |
  | 10. Required conversation resolution    | Только convention — GitHub всё равно подсвечивает unresolved threads в merge button UI; Tech Lead читает перед merge.                                                                 |

- **Reactivation trigger.** Target rule list из 10 пунктов применяется verbatim через `gh api PUT …/branches/main/protection` (или эквивалентный ruleset) при первом наступлении **любого** из условий:
  - Организация `doctor-school` апгрейдится на GitHub Team или Enterprise (даёт branch protection на private repos).
  - Репо `doctor-school/ds-platform` переводится в public (даёт branch protection на public repos на Free plan).
  - Репо переезжает на другой forge (Forgejo / GitLab self-hosted и т.п.), где эквивалентный feature бесплатен — отдельный ADR в этом случае.

### 2.7 CODEOWNERS

Phase 0 (team-of-1+AI):

```
# .github/CODEOWNERS
*    @sidorovanthon
```

Trigger на split: первый наём инженера. Тогда CODEOWNERS разрезается per `apps/<name>/` и `packages/<name>/`, владельцы привязываются к GitHub Teams (если будет ≥3 человека). До этого все PR ревьюит Tech Lead через интерактивные режимы ревью из ADR-0007 §2.10.

### 2.8 CI topology

- **GitHub-hosted `ubuntu-latest` runner only** в Phase 0. Free 2000 min/мес для private repo (Team plan +5000) покрывает ~30 min/день при 1–2 PR/день.
- **Pipeline `.github/workflows/ci.yml`** — full drift detection stack per ADR-0006 §7 + AI-specific guards per ADR-0007 §2.6. Jobs выполняются в параллельных GitHub Actions jobs где возможно; meta-job `ci` зависит от всех required и выставляет единый status check.

| Job                     | Что делает                                                                      | Source        | Severity           |
| ----------------------- | ------------------------------------------------------------------------------- | ------------- | ------------------ |
| `setup`                 | `pnpm install --frozen-lockfile`, кеш `~/.pnpm-store`                           | —             | required           |
| `lint`                  | `pnpm lint` (ESLint flat + Prettier check)                                      | —             | required           |
| `types`                 | `pnpm typecheck` (Turborepo task)                                               | —             | required           |
| `unit`                  | `pnpm test` (Vitest per app/package)                                            | ADR-0007 §2.3 | required           |
| `build`                 | `pnpm build` (Turborepo cache)                                                  | —             | required           |
| `api-drift`             | Spectral lint + `openapi.snapshot.json` diff                                    | ADR-0006 §7   | BLOCK              |
| `db-drift`              | `pnpm exec drizzle-kit check`                                                   | ADR-0006 §7   | BLOCK              |
| `events-drift`          | `tools/lint/events-lint.ts` (@OutboxEmit ↔ events.md)                           | ADR-0006 §7   | BLOCK              |
| `generated-artifacts`   | `pnpm generate:all --check` (openapi-typescript SDK + glossary IDs + ERD)       | ADR-0006 §7   | BLOCK              |
| `markdown-links`        | `lychee` cross-doc link check                                                   | ADR-0006 §7   | BLOCK              |
| `module-readme`         | `tools/lint/module-readme-lint.ts`                                              | ADR-0006 §7   | WARN v1 → BLOCK v2 |
| `docs-build`            | `apps/docs` `next build` (Fumadocs compiles clean)                              | ADR-0006 §7   | BLOCK              |
| `glossary-mdx`          | `tools/lint/glossary-mdx-lint.ts` (`[[term-id]]` references)                    | ADR-0006 §6   | BLOCK              |
| `glossary-ids`          | ESLint `glossary-canonical-ids` rule (from `packages/eslint-config/`)           | ADR-0006 §6   | BLOCK              |
| `glossary-roundtrip`    | YAML ↔ Payload Glossary Collection sync drift                                   | ADR-0006 §6   | BLOCK              |
| `spec-link`             | `tools/lint/spec-link-lint.ts` (PR feature:\* requires Closes #N + spec folder) | ADR-0007 §2.6 | BLOCK              |
| `ears-tests`            | `tools/lint/ears-test-lint.ts` (EARS-N.M ↔ test linkage)                        | ADR-0007 §2.6 | WARN v1 → BLOCK v2 |
| `tdd-signal`            | implementation commit без test-file (heuristic)                                 | ADR-0007 §2.6 | WARN v1            |
| `spec-status-fresh`     | merged feature-PR с spec.status=Draft                                           | ADR-0007 §2.6 | WARN v1            |
| `prior-decisions-cited` | new spec без ADR-link если категория ≠ docs-only                                | ADR-0007 §2.6 | WARN v1            |

- **`release.yml`** — changesets action runs on push to `main`, opens "Version Packages" PR или publishes если PR уже merged.
- **Trigger на self-hosted runner (Timeweb):** (a) исчерпан 2000-min cloud limit два месяца подряд, (b) появилась нужда CI-job'у иметь доступ в RF-private network (deploy to staging). До любого из триггеров — cloud-only.

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

| Step | Action                                                                                                                                                                                                                                                                                                                                                             | Output                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 15   | Initialise root `package.json` + `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json` + `.changeset/config.json` + `.editorconfig` + `.gitignore` + `.gitattributes` + `.npmrc` + `.nvmrc`                                                                                                                                                                  | repo bootstraps locally                          |
| 16   | Создать `.github/` minimal skeleton: `workflows/{ci,release}.yml`, `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{feature,bug,chore}.md`, `dependabot.yml`. CI references только tools которые уже существуют или skip'аются gracefully                                                                                                                | CI runs на первом push                           |
| 17   | Установить `simple-git-hooks` + `lint-staged` в root `package.json` + конфиг `simple-git-hooks` section                                                                                                                                                                                                                                                            | pre-commit работает                              |
| 19   | Initialise empty workspace stubs: `apps/{api,promo,portal,admin,cms,docs,docs-cms,mobile}/` + `packages/{schemas,api-client,db,glossary,hooks,design-system,observability,utils,eslint-config,tsconfig}/`, каждый с минимальным `package.json` (`name: @ds/<name>`, `version: 0.0.0`, `private: true`) + опциональным per-package `turbo.json` для script-stub map | workspace discoverable                           |
| 20   | Initialise `apps/docs/` как Fumadocs Next.js app (см. ADR-0006 §2) — ADR-контент + парные design-спеки лежат в `content/adr/`. Initialise `apps/docs-cms/` как Keystatic Next.js app (ADR-0006 §3)                                                                                                                                                                 | doc portal builds                                |
| 21   | **[Manual, admin]** Apply repository settings (`allow_squash_merge=true`, `allow_rebase_merge=false`, `allow_merge_commit=false`, `delete_branch_on_merge=true`) через `gh api`. Закоммитить target-state branch-protection payload в `branch-protection.json` в корне репо. См. design spec §4 для точных команд и reactivation trigger (§2.6)                    | squash-only enforced; target rule документирован |
| 22   | Smoke test: создать первую feature-spec (`NNN-onboarding` или подобная) и пройти iteration cycle ADR-0007 §2.4 end-to-end                                                                                                                                                                                                                                          | proof of concept                                 |

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
- **Минимум moving parts на старте** — нет Vault/feature-flags/cache-server/self-hosted runner в Phase 0. Каждый из них добавляется по explicit trigger, документированному либо здесь, либо в engineering-readiness spec.
- **Branch protection включается до первого merge** — нет окна Phase 0 без guards.

### Negative

- **`apps/docs/` как Next.js app — тяжелее, чем static markdown render**. Fumadocs build занимает ~30s, при каждом ADR-edit перерасчитывается. Trade-off уже принят в ADR-0006 (single toolchain). Mitigation: Turborepo cache.
- **Free CI minutes — узкое горло**. 2000 min/мес для private repo Team plan = 5000. При 5+ PR/день к концу Pre-pilot можно упереться. Mitigation: trigger на self-hosted runner (§2.8); или upgrade до GitHub Team ($4/user/мес).
- **CODEOWNERS = одна строка с `@sidorovanthon`** — формально работает, но GitHub UI отображает «один owner на всё» как single point of failure. Mitigation: явно знаем, Phase 1 split документирован как trigger.

### Risks

- **GitHub.com блокировка из РФ** — gradual scenario (rate limits на Russian IPs, или полная блокировка). Mitigation: mirror `ds-platform` в self-hosted Gitea/Forgejo на Timeweb как read-only failover. Trigger: первое sustained недоступности GitHub.com из РФ > 24h. Trigger-ADR опишет sync mechanism.
- **changesets versioning conflict при independent releases multiple apps** — два PR одновременно меняют один package + апдейтят changeset → merge conflict в `.changeset/`. Mitigation: changesets handles это (changeset files имеют random hash names, не конфликтуют между PR); merge conflict только в `CHANGELOG.md` and `package.json`, что разрешается в обычном rebase.
- **Pre-commit hooks ломают `git commit` для AI-агента** если environment не подготовлен — Vitest crashed или ESLint config broken. Mitigation: hooks делают только lint-staged (быстро), не запускают тесты; `git commit --no-verify` остаётся valid escape hatch для AI-агента (документировано в AGENTS.md, но warning «использовал bypass»).

---

## 4. Alternatives considered (rejected или deferred)

| Alternative                                                  | Reason rejected/deferred                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS Platform code в shared strategy + code monorepo**       | Mixed strategy/code workspace = слабая граница для AI-агента: cognitive bleed между бизнес/PRD-материалом и implementation. Выделенный application-repo держит контекст агента сфокусированным. Rejected.                             |
| **Polyrepo** (один repo на app: ds-portal, ds-api, ds-admin) | Дублирует tooling в каждом (ESLint, TS config, CI yaml), теряет Turborepo cross-package cache, atomic refactors через ≥2 apps требуют orchestration. Phase 0 размер не оправдывает overhead. Rejected.                                |
| **Гибрид: backend polyrepo, frontend monorepo**              | Backend = один NestJS app (ADR-0002), нет нужды в polyrepo. Rejected.                                                                                                                                                                 |
| **Self-host Git (Gitea/Forgejo) с самого старта**            | Premature ops overhead: VPS + admin + backup + DNS + SSO с Zitadel (которое само ещё не deployed). GitHub.com покрывает Phase 0 use cases без ops cost. Trigger на mirror (см. Risks): первая блокировка. Deferred.                   |
| **Personal account как owner** (`sidorovanthon/ds-platform`) | Personal-account-as-team anti-pattern: transfer в org позже ломает PR/Issue cross-refs (хотя redirect работает), CODEOWNERS без teams = list of usernames. Rejected.                                                                  |
| **changesets в favour release-please** (Google project)      | release-please tighter coupled to conventional-commits (no opt-out); требует `release-please-action` который медленнее эволюционирует. changesets — incumbent for pnpm-monorepos 2026. Deferred (можно мигрировать позже без потерь). |
| **changesets в favour semantic-release**                     | semantic-release одна version per repo, не fits multi-app independent versioning. Rejected.                                                                                                                                           |
| **conventional-commits-only (no changesets)**                | Не поддерживает intentful version bumps (e.g., "this fix is also breaking on app-X но не на app-Y"); changeset = explicit dev statement. Rejected.                                                                                    |
| **Husky для pre-commit**                                     | Deprecated его собственным author (typicode) 2024-09 в пользу simple-git-hooks. Использование = добавлять техдолг с момента создания. Rejected.                                                                                       |
| **lefthook для pre-commit**                                  | Go binary как dependency: AI-агенты работают в varied CI containers (Vercel, GitHub Actions, locally) без Go runtime. Friction. Rejected.                                                                                             |
| **GitLab CI вместо GitHub Actions**                          | Mismatch с уже-выбранным GitHub Issues (ADR-0006 §9): cross-repo refs, PR-issue auto-close, `gh` CLI tooling — всё построено на GitHub. Rejected.                                                                                     |
| **Self-hosted Forgejo Actions / Drone / Woodpecker**         | Ops overhead в Phase 0 без value (см. §2.8). Deferred trigger.                                                                                                                                                                        |
| **GitFlow** (develop + main + release branches)              | Tooling weight для team-of-1+AI; squash-merge на main + short-lived feature branches покрывает все use-cases. Rejected.                                                                                                               |
| **Allow merge commits + rebase merge**                       | Mixed merge styles ломают changesets parsing и AI-agent reasoning о history. Rejected.                                                                                                                                                |
| **Optional CODEOWNERS**                                      | Без CODEOWNERS = нет автоматического PR-reviewer assignment в GitHub UI. Стартуем с минимальным `* @sidorovanthon` чтобы файл существовал. Accepted (см. §2.7).                                                                       |
| **GitHub Teams plan ($4/user/mo) с самого старта**           | $4/мес × 1 user = $4/мес, не cost-issue, но bringing-up без необходимости. Free plan покрывает private repo + CI 2000 min. Trigger на upgrade: исчерпан CI лимит или > 3 коллабораторов которым нужны Teams для CODEOWNERS. Deferred. |
| **Top-level `docs/` folder в ds-platform**                   | Дублирует с `apps/docs/content/` где Fumadocs serves документацию. Два места хранения = drift risk + AI-agent не знает где master. Rejected (см. §2.3).                                                                               |

---

## 5. Open follow-ups (DSO-32+ и beyond)

| ID     | Q                                                                                                                                                                                                                    | Где решается                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-R1  | Точная версия pnpm pin (10.x — какая minor)                                                                                                                                                                          | На момент step 15 implementation; берётся latest stable на дату                                                                          |
| OQ-R2  | Turborepo remote cache server (self-host vs Vercel-managed)                                                                                                                                                          | Phase 1 trigger: локальный кеш недостаточен (>50% CI time на cold cache)                                                                 |
| OQ-R3  | `tools/lint/glossary-drift.ts` импл — какой парсер MDX (gray-matter? remark?)                                                                                                                                        | Step 8 (AI-stack design spec §11) implementation                                                                                         |
| OQ-R4  | Dependabot grouping rules — все minor+patch в один PR vs per-ecosystem                                                                                                                                               | Step 16 implementation, calibrate после первых 4 weeks                                                                                   |
| OQ-R5  | Squash commit title template (по умолчанию = PR title; custom?)                                                                                                                                                      | Phase 1 enhancement если AI-agent тяжело парсит history                                                                                  |
| OQ-R6  | Phase 1 CODEOWNERS split granularity (per-app vs per-folder вглубь)                                                                                                                                                  | На момент второго инженера hired                                                                                                         |
| OQ-R7  | Container signing (cosign) trigger                                                                                                                                                                                   | First prod-build (Phase 1)                                                                                                               |
| OQ-R8  | SBOM (Syft) trigger                                                                                                                                                                                                  | Same as OQ-R7                                                                                                                            |
| OQ-R9  | GitHub Team plan upgrade trigger thresholds (точные min/мес)                                                                                                                                                         | После 2 месяцев Phase 0 telemetry                                                                                                        |
| OQ-R10 | Mirror на Gitea/Forgejo failover plan                                                                                                                                                                                | Trigger: GitHub.com sustained downtime > 24h из РФ                                                                                       |
| OQ-R12 | Self-host GHA runner на Timeweb — конкретный setup (k8s? plain VPS? которой версии actions/runner?)                                                                                                                  | Trigger из §2.8; отдельный ADR на момент                                                                                                 |
| OQ-R13 | `packages/db/` vs `apps/api/src/db/schema/` — формальное разрешение ADR-0003 §4 ↔ ADR-0006 §1 conflict                                                                                                               | **CLOSED** — ADR-0003 §4 теперь читает `packages/db/schema/` как канонический master, в согласии с ADR-0006 §1                           |
| OQ-R14 | Reactivation discipline owner — когда срабатывает trigger §2.6 (org upgrade или смена visibility репозитория), кто отвечает за re-apply полного branch-protection контракта?                                         | Default owner: Tech Lead. Трекается под той же Plane issue, что обрабатывает trigger event.                                              |
| OQ-R15 | Периодический process-level аудит compliance с merge-gate intent — нужен ли регулярный (ежемесячный?) self-audit, подтверждающий, что merges Tech Lead'а реально удовлетворили §2.6 intent (CI green, diff прочитан) | Deferred — добавляет overhead без очевидной ценности в single-developer Phase 0; пересмотреть при найме второго инженера (OQ-R6 trigger) |

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
- ADR-0006 §1, §2, §3, §9 — doc topology, Fumadocs, Keystatic, task-tracker split: все воплощаются в layout §2.3.
- ADR-0007 §2.5, §2.6, §2.10 — bootstrap, lint drift guards, autonomy ladder (интерактивные режимы ревью); AI-stack design spec §11 — migration plan: воплощается в `tools/` + `.github/workflows/`.

**Делегировано в другие задачи:**

- **DSO-32 (Pre-pilot work-items) или отдельный repo-setup work-item:** execute steps 15–22 (§2.10). Параллелится между AI-агентом (15–17, 19–20) и Tech Lead (21, 22-сопровождение).
- **Будущий ADR-NNNN (Phase 1 CODEOWNERS):** split per app/package, GitHub Teams setup. Trigger: hire #2.
- **Будущий ADR-NNNN (Self-hosted GHA runner):** Timeweb VPS + runner config. Trigger: §2.8 conditions.
- **Будущий ADR-NNNN (Container signing + SBOM):** cosign + Syft pipeline integration. Trigger: first prod build (engineering-readiness §1 Pre-pilot full).
- **Будущий ADR-NNNN (Public source-available):** если ds-platform выходит из private. Trigger: Pre-pilot done + community-сценарий.
- **Будущий ADR-NNNN (GitHub.com mirror на self-host Git):** failover. Trigger: §Risks GitHub блокировка.

**Влияет на (downstream):**

- **DSO-32+** — implementation steps 15–22.
- **Все feature-specs DS Platform** — живут в `apps/docs/content/specs/features/NNN-<slug>/` (фиксируется §2.3).
- **AGENTS.md + CLAUDE.md в `ds-platform`** — bootstraps из §2.10 step 11 (AI-stack design spec §11), включают reference на этот ADR-0008 в "Repository conventions" section.
- **Engineering-readiness spec** (`../specs/tech/2026-05-12-engineering-readiness-design-ru.md`) — runtime tooling decisions inherited; референсируется из README.md ds-platform.
