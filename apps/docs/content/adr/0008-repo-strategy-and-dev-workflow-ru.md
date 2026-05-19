---
title: "ADR-0008 — DS Platform Repository Strategy + Dev Workflow [RU]"
description: "DSO-25..30 + DSO-60 зафиксировали технологический стек DS Platform, методологию разработки и task-tracking split (Plane strategic / GitHub Issues..."
lang: ru
---

> **EN:** [`0008-repo-strategy-and-dev-workflow-en.md`](./0008-repo-strategy-and-dev-workflow-en.md) · **RU (this)**

# ADR-0008 — DS Platform Repository Strategy + Dev Workflow

**Дата:** 2026-05-15 (last amended 2026-05-18 — Amendment A1, см. §7)
**Статус:** Accepted (+ Amendment A1 — org boundary correction + dev-stand infra location)
**Связан с:** Plane DSO-31 (`fae57ab6-f09b-4a4d-9ede-9a4f1ca504c0`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0008-repo-strategy-and-dev-workflow-design-ru.md`
**Наследует:** ADR-0001 (Authentik/Zitadel), ADR-0002 (NestJS+BullMQ), ADR-0003 (Postgres17+Drizzle), ADR-0004 (Next.js 15+Refine), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs+Keystatic+GitHub Issues), ADR-0007 (AI loop + cross-vendor reviewer + 14-step migration)

---

## 1. Context

DSO-25..30 + DSO-60 зафиксировали технологический стек DS Platform, методологию разработки и task-tracking split (Plane strategic / GitHub Issues code). Что осталось не зафиксировано — операционный слой между «решениями» и «первой строкой кода»:

- **Где** живёт код (новый repo? в текущем `bbm`?), под каким владельцем, в каких границах
- **Структура** monorepo до конкретных папок и manifest-файлов (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- **Release tooling** — как версионируются и публикуются apps/packages (changesets vs release-please vs conventional-only)
- **Pre-commit + branch protection policy** — concrete rules для main-ветки и local hooks
- **CI topology** — runner choice, pipeline shape, какие jobs blocking
- **CODEOWNERS bootstrap** — кто ответственен за что в Phase 0 (team-of-1+AI)
- **Версии Node/pnpm** — pin strategy, чтобы AI-агент и человек видели одно окружение
- **Перенос ADR/spec'ов из `bbm`** — в новый platform-repo, чтобы AI-агенты читали их в-workspace без cross-repo fetch

AI-stack design spec §11 уже перечислил 14 шагов AI-loop tooling (bootstrap, reviewer-agent, cost-ledger, lint guards, agents-config kill switch, branch protection). Эти шаги остаются authoritative; ADR-0008 их обрамляет: создаёт repo skeleton, в котором §11 шаги выполнимы.

**Hard requirements:**

- Каждое решение AI-agent-friendly: новый агент в свежей сессии должен ориентироваться через bootstrap (ADR-0007 §2.5) + чтение AGENTS.md/CLAUDE.md/ADRs из workspace, без MCP-fetch proxy.
- Phase 0 minimum moving parts: ничего, что не блокирует первую feature-spec, не вводится.
- 152-ФЗ: код может жить на GitHub.com (нет ПДн в source). Trigger to revisit — политическое решение или блокировка GitHub.com из РФ (тогда mirror в Gitea/Forgejo на Timeweb; уже обсуждалось в ADR-0006 §Consequences).
- [[feedback_tech_stack_criteria_no_team_skill]]: выбор tooling не аргументируется «команда умеет / прототипы». Критерии — mainstream 2026, integration с уже-принятым стеком, low ops overhead для team-of-1+AI.

---

## 2. Decision

### 2.1 Repo identity и владелец

- **GitHub repository:** `bbm-academy-dev/ds-platform`, private до Pre-pilot launch. _[Amendment A1.1 (2026-05-18): transferred to `doctor-school/ds-platform` — см. §7.]_
- **GitHub organization:** `bbm-academy-dev` (создан 2026-05-15 Tech Lead; `bbm` repo переносится в эту же org в Phase 0 housekeeping). _[Amendment A1.1 (2026-05-18): `bbm-academy-dev` оказался personal account, не org. Текущий org для DS Platform — `doctor-school` (создан 2026-05-18). См. §7.]_
- **Visibility decision Phase 1+:** оставить private vs source-available — отдельный ADR при достижении Pre-pilot или появлении community-сценария.
- **Связь с `bbm` repo:** оба в одной org, без submodule. `bbm` остаётся strategy/holding workspace (PRD, business models, Plane tooling, транскрипты). `ds-platform` — application code + platform docs.

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
│   ├── workflows/{ci,agent-review,cost-ledger,release}.yml
│   ├── agents-config.json       # kill switch (ADR-0007 §2.11)
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
    ├── reviewer-agent/          # workspace package (ADR-0007 §2.8)
    ├── cost-ledger-sync.ts      # ADR-0007 §2.10
    └── lint/
        ├── spec-link-lint.ts          # ADR-0007 §2.6
        ├── ears-test-lint.ts          # ADR-0007 §2.6
        ├── glossary-mdx-lint.ts       # ADR-0006 §6 (layer 2)
        ├── events-lint.ts             # ADR-0006 §7 (events drift)
        ├── module-readme-lint.ts      # ADR-0006 §7 (warn v1)
        └── generated-artifacts-check.ts  # ADR-0006 §7
```

**Источник правды для layout — ADR-0006 §10.** ADR-0008 ничего не переименовывает; добавляет только root-level manifest файлы и `.github/`-skeleton. Расхождение между ADR-0003 §4 (original location: `apps/api/src/db/schema/`) и ADR-0006 §1 SSOT-row (master в `packages/db/schema/`) разрешено ADR-0003 Amendment A1: канонический master — `packages/db/schema/`, ADR-0006 §1 SSOT-row prevails; `packages/db/` enables read-only консьюмерам (`apps/admin`, `apps/cms`) ImageRecord schema без cross-app import. `apps/api/drizzle/` (миграции) остаётся unchanged per ADR-0003 §4.

**No top-level `docs/`** — вся документация рендерится через Fumadocs из `apps/docs/content/`. Это сохраняет один SSOT для рендера и совпадает с ADR-0006 §1, §10 топологией.

**No `services/` или `infrastructure/`** на старте — backend = `apps/api/`; deployment-конфиги (docker-compose, Coolify manifest, Caddy/Traefik) живут в отдельном `bbm-infra` repo (создаётся позже) или временно в `bbm/infra/` как сейчас. ds-platform = pure application code.

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
- **Repository settings** (отдельно от branch protection, через `gh api /repos/{owner}/{repo}`):
- `allow_squash_merge: true`
- `allow_rebase_merge: false`
- `allow_merge_commit: false`
- `delete_branch_on_merge: true`
  Без этого `required_linear_history` ниже не enforce'ит squash-only — rebase merge тоже даёт linear history и ломает changesets parsing.

- **Branch protection rule на `main`** (admin-applied через GitHub UI или `gh api`, см. AI-stack design spec §11 step 13):

1.  Require pull request before merging
2.  Require ≥1 approving review (`required_approving_review_count: 1`)
3.  Dismiss stale reviews on new commits
4.  Require status check `ci` — passing
5.  Require status check `agent-review` — passing (ADR-0007 §2.8)
6.  Require branches up-to-date before merging
7.  Require linear history (squash-only когда merge enabled только squash)
8.  Include administrators (Tech Lead не может byпасить себя)
9.  No force pushes
10. No deletions
11. Require conversation resolution before merge

- **`agents-config.json` kill switch** (ADR-0007 §2.11) live в `.github/agents-config.json`, изменяется обычным PR + human merge.

### 2.7 CODEOWNERS

Phase 0 (team-of-1+AI):

```
# .github/CODEOWNERS
*    @sidorovanthon
```

Trigger на split: первый наём инженера. Тогда CODEOWNERS разрезается per `apps/<name>/` и `packages/<name>/`, владельцы привязываются к GitHub Teams (если будет ≥3 человека). До этого все PR ревьюит Tech Lead + reviewer-bot.

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

- **`agent-review.yml`** — отдельный workflow per ADR-0007 §2.8, выставляет status check `agent-review`.
- **`cost-ledger.yml`** — weekly cron per ADR-0007 §2.10.
- **`release.yml`** — changesets action runs on push to `main`, opens "Version Packages" PR или publishes если PR уже merged.
- **Trigger на self-hosted runner (Timeweb):** (a) исчерпан 2000-min cloud limit два месяца подряд, (b) появилась нужда CI-job'у иметь доступ в RF-private network (deploy to staging). До любого из триггеров — cloud-only.

### 2.9 Dependabot + supply chain

- `.github/dependabot.yml`:
- `npm` ecosystem, root + workspace packages, weekly schedule (понедельник 03:00 UTC)
- `github-actions` ecosystem, weekly
- Group minor + patch updates в один PR per package-type (reduces noise)
- Auto-merge через reviewer-bot + human (Phase 2 autonomy, ADR-0007 §2.11).
- SBOM генерация (Syft) — engineering-readiness spec §1 Pre-pilot, реализуется в follow-up; в Phase 0 CI её ещё нет (deferred trigger: first prod build).
- Container signing (cosign) — там же, deferred trigger.
- **Dependency freshness baseline (DSO-63 mini-G):** при repo bootstrap (step 19) — dependency freshness pass, pin exact versions в lockfile (`pnpm-lock.yaml`). **Recurring task в Plane:** quarterly dependency review (Dependabot + manual audit для major bumps + security advisories review). Это не реактивный fix-on-bump, а proactive cadence.

### 2.10 Migration plan (что выполнить после accept ADR-0008)

Pre-DSO-31 admin (Tech Lead, ≤10 минут, ручной):

- **0a.** Create GitHub org `bbm-academy-dev` ✅ done 2026-05-15. _[Amendment A1.1 (2026-05-18): был зарегистрирован personal account, не org. Реальная org `doctor-school` создана 2026-05-18 ✅.]_
- **0b.** Create empty private repo `bbm-academy-dev/ds-platform` ✅ done 2026-05-15. _[Amendment A1.1 (2026-05-18): repo transferred → `doctor-school/ds-platform` ✅ 2026-05-18. URL: https://github.com/doctor-school/ds-platform. GitHub auto-redirect со старого пути работает.]_
- **0c.** (Phase 0 housekeeping, не блокирует) Transfer `sidorovanthon/bbm` → `bbm-academy-dev/bbm`. URL redirect остаётся; CLAUDE.md/links не ломаются. _[Amendment A1.1 (2026-05-18): deferred indefinitely; `bbm` repo остаётся под personal account `sidorovanthon` пока не появится отдельная BBM-holding org (OQ-R14).]_

Phase 0 implementation steps — extends AI-stack design spec §11. Шаги 1–14 из AI-stack design spec §11 unchanged. Additional шаги (DSO-32 children или новый work-item):

| Step | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Output                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 15   | Initialise root `package.json` + `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json` + `.changeset/config.json` + `.editorconfig` + `.gitignore` + `.gitattributes` + `.npmrc` + `.nvmrc`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | repo bootstraps locally                   |
| 16a  | Создать `.github/` minimal skeleton: `workflows/{ci,cost-ledger,release}.yml`, `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{feature,bug,chore}.md`, `dependabot.yml`, `agents-config.json`. CI references только tools которые уже существуют (steps 1–8 AI-stack design spec §11) или skip'аются gracefully                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | CI runs на первом push без `agent-review` |
| 16b  | После AI-stack design spec §11 steps 4–5 (`packages/llm-utils/buildContext.ts` + `tools/reviewer-agent/`) — добавить `.github/workflows/agent-review.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | reviewer-bot активируется                 |
| 17   | Установить `simple-git-hooks` + `lint-staged` в root `package.json` + конфиг `simple-git-hooks` section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | pre-commit работает                       |
| 18   | **Move + rename + rewrite-refs** ADR/spec файлов из `bbm` в `ds-platform` (cross-repo — не `git mv`, а cp+`git rm`; см. design spec §5 для точных команд). Атомарно: <br/>**(a) Move ADRs:** `bbm/docs/adr/0001..0008-*.md` → `ds-platform/apps/docs/content/adr/0001..0008-*.md` (имя файла unchanged). <br/>**(b) Move + rename paired specs:** `bbm/docs/superpowers/specs/2026-05-1*-ds-platform-*-design.md` → `ds-platform/apps/docs/content/adr/NNNN-<slug>-design.md`, где `NNNN-<slug>` совпадает с именем парной ADR (`0001-identity-provider-shortlist` → `0001-identity-provider-shortlist-design.md`). Это унифицирует pattern: ADR и spec лежат рядом, имеют одинаковый numeric prefix, Fumadocs рендерит их как одну группу. <br/>**(c) Batch rewrite cross-refs:** перед коммитом step 18 пройтись `rg` по обоим repos и заменить во ВСЕХ файлах: (i) `docs/adr/NNNN-*.md` → `apps/docs/content/adr/NNNN-*.md`; (ii) `docs/superpowers/specs/2026-05-1*-ds-platform-*-design.md` → `apps/docs/content/adr/NNNN-<slug>-design.md` (per pairing); (iii) ADR frontmatter всех 0001..0007 (`Design spec:` line) — обновить на новый путь; (iv) AI-stack design spec globs `apps/docs/content/adr/${num}-*.md` (§297, §716, §721) → `apps/docs/content/adr/${num}-*.md`. <br/>**(d) Leave redirect:** в `bbm/docs/adr/` оставить `README.md` one-liner с URL ds-platform. <br/>**Non-platform spec'ы** (Plane migration, Linear migration, infra-cost, и т.д.) остаются в `bbm/docs/superpowers/specs/` — это процесс-артефакты BBM-уровня. <br/>**Post-state verification:** `rg 'docs/adr/' ds-platform/` and `rg 'docs/superpowers/specs/.*ds-platform.*-design' ds-platform/` — оба должны вернуть 0 hits (кроме redirect README). |
| 19   | Initialise empty workspace stubs: `apps/{api,promo,portal,admin,cms,docs,docs-cms,mobile}/` + `packages/{schemas,api-client,db,glossary,hooks,design-system,observability,utils,eslint-config,tsconfig,llm-utils}/` + `tools/reviewer-agent/`, каждый с минимальным `package.json` (`name: @ds/<name>`, `version: 0.0.0`, `private: true`) + опциональным per-package `turbo.json` для script-stub map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | workspace discoverable                    |
| 20   | После step 18 — initialise `apps/docs/` как Fumadocs Next.js app (см. ADR-0006 §2). Moved ADRs уже на месте в `content/adr/`. Initialise `apps/docs-cms/` как Keystatic Next.js app (ADR-0006 §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | doc portal builds                         |
| 21   | **[Manual, admin]** Apply repository settings (`allow_squash_merge=true`, `allow_rebase_merge=false`, `allow_merge_commit=false`) + branch protection rule per §2.6 через `gh api`. См. design spec §4 для точных команд                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | merge gated, squash-only enforced         |
| 22   | Smoke test: создать первую feature-spec (`NNN-onboarding` или подобная) и пройти 8-step cycle ADR-0007 §2.4 end-to-end                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | proof of concept                          |

Dependency graph: 15 → 16a → 17 → 19 параллельно с 15. 18 sequential (sensitive). 20 depends on 18. 16b depends on AI-stack design spec §11 step 5. 21 depends on 16a (branch protection требует existing CI workflow). 22 depends на всё.

Step 18 — sensitive move (потеря artifact = плохо), делается Tech Lead вручную с per-file проверкой. Step 21 — admin-only. Step 22 — joint Tech Lead+AI.

**Estimate:** Steps 1–22 — Спринт 3 (после Pre-pilot kickoff, ~2026-06-09 start per Plane). До этого ADR-0008 + design spec остаются документами, ничего в `ds-platform` repo физически не происходит.

**Step 18 notes (DSO-63 mini-J/K, 2026-05-18):**

- **mini-J — verification script (deferred до момента move):** при выполнении step 18 — добавить one-time `tools/adr-move-verify.ts` (rg-checks на старые пути + Fumadocs `apps/docs` build before/after). Не строим script сейчас (ADR-move ещё не делается); добавляется в той же PR, что и сам move.
- **mini-K — history loss accepted:** при cross-repo move ADR'ов из `bbm` в `ds-platform` git-history не сохраняется (cp+`git rm` подход; `git filter-repo` / subtree merge — overkill для ~16 файлов). История ADR-решений доступна через blame в исходном `bbm/docs/adr/` (read-only после move) и через ADR-content сам (decisions, rationale, dates явно в frontmatter и amendments). AI-агенты читают current state, не git log.

---

### 2.11 Accepted risks (DSO-63 mini-#14, 2026-05-18)

**GitHub vendor risk.** GitHub принят как single hub (repo + CI + issues + reviewer-bot trigger + cost-ledger PR target + agent bootstrap source). Mirror / continuity infrastructure (self-hosted Gitea/GitLab + scheduled mirror) **не строится в pre-pilot** из YAGNI-соображений.

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
- **Чистая граница `bbm` ↔ `ds-platform`** — strategy/holding в одном, application code в другом. Cognitive load снижается: открыв любой из repos, понятно что внутри.
- **Mainstream defaults Phase 0** — pnpm+Turborepo+changesets+simple-git-hooks — стек, который любой TypeScript-инженер 2026 читает без дополнительного обучения. AI-агент (Claude/Codex) тренирован на этих паттернах.
- **Минимум moving parts на старте** — нет Vault/feature-flags/cache-server/self-hosted runner в Phase 0. Каждый из них добавляется по explicit trigger, документированному либо здесь, либо в engineering-readiness spec.
- **Branch protection включается до первого merge** — нет окна Phase 0 без guards.
- **Migration plan делегирован clean**: ADR-0008 фиксирует «что и почему», `ds-platform` repo физически создаётся в Спринте 3 как implementation work. Сейчас ничего не блокирует продолжение PRD/strategy work в `bbm`.

### Negative

- **Дубликат ADR в двух repos временно** — между моментом move (step 18) и cleanup в `bbm` есть короткий период когда ADR-0001..0008 живут в обоих. Mitigation: step 18 включает удаление originals в `bbm` (через `git mv` или explicit `rm`), не «copy».
- **`apps/docs/` как Next.js app — тяжелее, чем static markdown render**. Fumadocs build занимает ~30s, при каждом ADR-edit перерасчитывается. Trade-off уже принят в ADR-0006 (single toolchain). Mitigation: Turborepo cache.
- **Free CI minutes — узкое горло**. 2000 min/мес для private repo Team plan = 5000. При 5+ PR/день к концу Pre-pilot можно упереться. Mitigation: trigger на self-hosted runner (§2.8); или upgrade до GitHub Team ($4/user/мес).
- **`bbm-academy-dev` org name с `-dev` суффиксом** — fixed на 2026-05-15, переименование позже возможно но создаёт redirect/breakage окно. Acceptable: имя не user-facing (репо приватные).
- **CODEOWNERS = одна строка с `@sidorovanthon`** — формально работает, но GitHub UI отображает «один owner на всё» как single point of failure. Mitigation: явно знаем, Phase 1 split документирован как trigger.
- **No bbm transfer в `bbm-academy-dev` org требуется** для DSO-31, но **рекомендуется как housekeeping** — see step 0c. Если откладывается, `bbm` остаётся в `sidorovanthon/bbm` неопределённо долго, ссылки в README не ломаются.

### Risks

- **GitHub.com блокировка из РФ** — gradual scenario (rate limits на Russian IPs, или полная блокировка). Mitigation: mirror `ds-platform` в self-hosted Gitea/Forgejo на Timeweb как read-only failover. Trigger: первое sustained недоступности GitHub.com из РФ > 24h. Trigger-ADR опишет sync mechanism.
- **changesets versioning conflict при independent releases multiple apps** — два PR одновременно меняют один package + апдейтят changeset → merge conflict в `.changeset/`. Mitigation: changesets handles это (changeset files имеют random hash names, не конфликтуют между PR); merge conflict только в `CHANGELOG.md` and `package.json`, что разрешается в обычном rebase.
- **Pre-commit hooks ломают `git commit` для AI-агента** если environment не подготовлен — Vitest crashed или ESLint config broken. Mitigation: hooks делают только lint-staged (быстро), не запускают тесты; `git commit --no-verify` остаётся valid escape hatch для AI-агента (документировано в AGENTS.md, но warning «использовал bypass»).
- **Step 18 move ломает ссылки** из других markdown файлов на `docs/adr/0001-*.md` (например в CLAUDE.md, в processed/summaries, в outputs). Mitigation: пройтись grep'ом перед step 18, заменить все `docs/adr/` на абсолютные ссылки `https://github.com/bbm-academy-dev/ds-platform/blob/main/apps/docs/content/adr/...` ИЛИ оставить redirect-stubs в `bbm/docs/adr/0001-*.md` с одной строкой `→ moved to ds-platform/apps/docs/content/adr/0001-*.md`.

---

## 4. Alternatives considered (rejected или deferred)

| Alternative                                                    | Reason rejected/deferred                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS Platform code в текущем `bbm` repo** (monorepo для всего) | Mixed strategy/code workspace = слабая граница для AI-агента; bbm должен оставаться holding-level (PRD, бизнес-модели, Plane). Cognitive bleed между strategy и implementation. Rejected.                                             |
| **Polyrepo** (один repo на app: ds-portal, ds-api, ds-admin)   | Дублирует tooling в каждом (ESLint, TS config, CI yaml), теряет Turborepo cross-package cache, atomic refactors через ≥2 apps требуют orchestration. Phase 0 размер не оправдывает overhead. Rejected.                                |
| **Гибрид: backend polyrepo, frontend monorepo**                | Backend = один NestJS app (ADR-0002), нет нужды в polyrepo. Rejected.                                                                                                                                                                 |
| **Self-host Git (Gitea/Forgejo) с самого старта**              | Premature ops overhead: VPS + admin + backup + DNS + SSO с Authentik (которое само ещё не deployed). GitHub.com покрывает Phase 0 use cases без ops cost. Trigger на mirror (см. Risks): первая блокировка. Deferred.                 |
| **Personal account как owner** (`sidorovanthon/ds-platform`)   | Personal-account-as-team anti-pattern: transfer в org позже ломает PR/Issue cross-refs (хотя redirect работает), CODEOWNERS без teams = list of usernames. Rejected.                                                                  |
| **changesets в favour release-please** (Google project)        | release-please tighter coupled to conventional-commits (no opt-out); требует `release-please-action` который медленнее эволюционирует. changesets — incumbent for pnpm-monorepos 2026. Deferred (можно мигрировать позже без потерь). |
| **changesets в favour semantic-release**                       | semantic-release одна version per repo, не fits multi-app independent versioning. Rejected.                                                                                                                                           |
| **conventional-commits-only (no changesets)**                  | Не поддерживает intentful version bumps (e.g., "this fix is also breaking on app-X но не на app-Y"); changeset = explicit dev statement. Rejected.                                                                                    |
| **Husky для pre-commit**                                       | Deprecated его собственным author (typicode) 2024-09 в пользу simple-git-hooks. Использование = добавлять техдолг с момента создания. Rejected.                                                                                       |
| **lefthook для pre-commit**                                    | Go binary как dependency: AI-агенты работают в varied CI containers (Vercel, GitHub Actions, locally) без Go runtime. Friction. Rejected.                                                                                             |
| **GitLab CI вместо GitHub Actions**                            | Mismatch с уже-выбранным GitHub Issues (ADR-0006 §9): cross-repo refs, PR-issue auto-close, agent-review через `gh` CLI — всё построено на GitHub. Rejected.                                                                          |
| **Self-hosted Forgejo Actions / Drone / Woodpecker**           | Ops overhead в Phase 0 без value (см. §2.8). Deferred trigger.                                                                                                                                                                        |
| **GitFlow** (develop + main + release branches)                | Tooling weight для team-of-1+AI; squash-merge на main + short-lived feature branches покрывает все use-cases. Rejected.                                                                                                               |
| **Allow merge commits + rebase merge**                         | Mixed merge styles ломают changesets parsing и AI-agent reasoning о history. Rejected.                                                                                                                                                |
| **Optional CODEOWNERS**                                        | Без CODEOWNERS = нет автоматического PR-reviewer assignment, reviewer-bot не знает кого pинговать (хотя bot — non-human). Стартуем с минимальным `* @sidorovanthon` чтобы файл существовал. Accepted (см. §2.7).                      |
| **GitHub Teams plan ($4/user/mo) с самого старта**             | $4/мес × 1 user = $4/мес, не cost-issue, но bringing-up без необходимости. Free plan покрывает private repo + CI 2000 min. Trigger на upgrade: исчерпан CI лимит или > 3 коллабораторов которым нужны Teams для CODEOWNERS. Deferred. |
| **Top-level `docs/` folder в ds-platform**                     | Дублирует с `apps/docs/content/` где Fumadocs serves документацию. Два места хранения = drift risk + AI-agent не знает где master. Rejected (см. §2.3).                                                                               |
| **ADR-0001..0007 mirrored через CI sync из `bbm`**             | Two-source-of-truth: PR в bbm триггерит sync в ds-platform, рассинхрон возможен. Move (один source) — clean. Rejected mirror, accepted move.                                                                                          |

---

## 5. Open follow-ups (DSO-32+ и beyond)

| ID     | Q                                                                                                                                                                                                                                                | Где решается                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| OQ-R1  | Точная версия pnpm pin (10.x — какая minor)                                                                                                                                                                                                      | На момент step 15 implementation; берётся latest stable на дату                            |
| OQ-R2  | Turborepo remote cache server (self-host vs Vercel-managed)                                                                                                                                                                                      | Phase 1 trigger: локальный кеш недостаточен (>50% CI time на cold cache)                   |
| OQ-R3  | `tools/lint/glossary-drift.ts` импл — какой парсер MDX (gray-matter? remark?)                                                                                                                                                                    | Step 8 (AI-stack design spec §11) implementation                                           |
| OQ-R4  | Dependabot grouping rules — все minor+patch в один PR vs per-ecosystem                                                                                                                                                                           | Step 16 implementation, calibrate после первых 4 weeks                                     |
| OQ-R5  | Squash commit title template (по умолчанию = PR title; custom?)                                                                                                                                                                                  | Phase 1 enhancement если AI-agent тяжело парсит history                                    |
| OQ-R6  | Phase 1 CODEOWNERS split granularity (per-app vs per-folder вглубь)                                                                                                                                                                              | На момент второго инженера hired                                                           |
| OQ-R7  | Container signing (cosign) trigger                                                                                                                                                                                                               | First prod-build (Phase 1)                                                                 |
| OQ-R8  | SBOM (Syft) trigger                                                                                                                                                                                                                              | Same as OQ-R7                                                                              |
| OQ-R9  | GitHub Team plan upgrade trigger thresholds (точные min/мес)                                                                                                                                                                                     | После 2 месяцев Phase 0 telemetry                                                          |
| OQ-R10 | Mirror на Gitea/Forgejo failover plan                                                                                                                                                                                                            | Trigger: GitHub.com sustained downtime > 24h из РФ                                         |
| OQ-R11 | Если `bbm` transfer в org откладывается (step 0c) — обновление URL в CLAUDE.md, memory, processed/summaries                                                                                                                                      | Опционально; не блокирует DSO-31                                                           |
| OQ-R12 | Self-host GHA runner на Timeweb — конкретный setup (k8s? plain VPS? которой версии actions/runner?)                                                                                                                                              | Trigger из §2.8; отдельный ADR на момент                                                   |
| OQ-R13 | `packages/db/` vs `apps/api/src/db/schema/` — формальное разрешение ADR-0003 §4 ↔ ADR-0006 §1 conflict; здесь ADR-0008 фиксирует `packages/db/` per ADR-0006 как master, но требуется amendment ADR-0003 чтобы официально пометить §4 superseded | Step 19 implementation (когда первая schema создаётся); либо короткий ADR-amendment 0003-A |

---

## 6. Related ADRs / Делегировано

**Наследуется от:**

- ADR-0001 — Authentik/Zitadel: SSO для GitHub.com не нужен в Phase 0 (Enterprise plan only); решение revisit при росте команды.
- ADR-0002 §6 — BullMQ async queue: живёт как часть `apps/api/`.
- ADR-0002 §3-5 — Zod schemas + openapi-typescript: `packages/schemas/` + `packages/api-client/` (последний — generated артефакт).
- ADR-0003 §4 (Drizzle ORM + drizzle-kit migrations) + §7 (pgvector): Drizzle schemas в `packages/db/schema/` per ADR-0003 Amendment A1 (supersedes §4 original location); миграции в `apps/api/drizzle/` per ADR-0003 §4.
- ADR-0004 §2 — 4 frontend apps: promo, portal, admin, cms (Payload v3). Все в `apps/`.
- ADR-0004 §7 — Payload v3 content-only: `apps/cms/`, marketing-content в `cms.*` schema namespace shared Postgres.
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule: `packages/eslint-config/` экспортирует.
- ADR-0005 — RN/Expo mobile: `apps/mobile/` workspace, отдельный build с Expo EAS.
- ADR-0006 §1, §2, §3, §9 — doc topology, Fumadocs, Keystatic, task-tracker split: все воплощаются в layout §2.3.
- ADR-0007 §2.5, §2.6, §2.8, §2.10, §2.11 — bootstrap, drift guards, reviewer-bot, cost-ledger, kill switch; AI-stack design spec §11 — 14-step migration plan: воплощается в `tools/` + `.github/workflows/` + `.github/agents-config.json`.

**Делегировано в другие задачи:**

- **DSO-32 (Pre-pilot work-items) или отдельный repo-setup work-item:** execute steps 15–22 (§2.10). Параллелится между AI-агентом (15–17, 19–20) и Tech Lead (18, 21, 22-сопровождение).
- **Будущий ADR-NNNN (Phase 1 CODEOWNERS):** split per app/package, GitHub Teams setup. Trigger: hire #2.
- **Будущий ADR-NNNN (Self-hosted GHA runner):** Timeweb VPS + runner config. Trigger: §2.8 conditions.
- **Будущий ADR-NNNN (Container signing + SBOM):** cosign + Syft pipeline integration. Trigger: first prod build (engineering-readiness §1 Pre-pilot full).
- **Будущий ADR-NNNN (Public source-available):** если ds-platform выходит из private. Trigger: Pre-pilot done + community-сценарий.
- **Будущий ADR-NNNN (GitHub.com mirror на self-host Git):** failover. Trigger: §Risks GitHub блокировка.

**Влияет на (downstream):**

- **DSO-32+** — implementation steps 15–22.
- **Все feature-specs DS Platform** — живут в `apps/docs/content/specs/features/NNN-<slug>/` (фиксируется §2.3).
- **AGENTS.md + CLAUDE.md в `ds-platform`** — bootstraps из §2.10 step 11 (AI-stack design spec §11), включают reference на этот ADR-0008 в "Repository conventions" section.
- **Engineering-readiness spec** (`docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-ru.md`) — runtime tooling decisions inherited; референсируется из README.md ds-platform.

---

## 7. Amendments

### Amendment A1 — Org boundary correction + dev-stand infra location (2026-05-18, DSP-70 follow-up)

**Контекст:** при дизайне local dev environment (`docs/superpowers/specs/2026-05-18-ds-platform-local-dev-environment-setup-design-ru.md`) выявлены две неточности в original ADR-0008:

1. **§2.1 «GitHub organization: bbm-academy-dev»** — фактически `bbm-academy-dev` это **personal account**, не organization. ADR-0008 §2.10 step 0a отражает то, что был зарегистрирован второй personal account, не создана org. Visible at https://github.com/settings/organizations → «You are not a member of any organizations».

2. **§2.3 «`No services/` или `infrastructure/` на старте — backend = `apps/api/`; deployment-конфиги... живут в отдельном `bbm-infra` repo»** — это category-confusion: локальная dev-инфра DS Platform (compose-стек для Postgres/Redis/etc.) **принадлежит DS Platform**, не BBM-holding'у. Помещение её в `bbm-infra` смешивает client-platform infra с BBM-org infra. Plus: dev-стенд tightly coupled с application code (новый сервис в app → новый env var → compose update — атомарный commit).

**Решение (амендмент):**

**A1.1 — GitHub org `doctor-school` (replaces §2.1 org name)**

Создать GitHub org `doctor-school` (free plan: unlimited private repos + unlimited collaborators). Transfer `bbm-academy-dev/ds-platform` → `doctor-school/ds-platform` (GitHub автоматически ставит URL redirect).

Mapping:

- **Org `doctor-school`** = все DS Platform repos (client-platform-level boundary, симметрично Plane workspace `doctor-school`).
- **Personal account `bbm-academy-dev`** = остаётся как Tech Lead's GitHub identity для BBM-holding-stuff. Если позже понадобится отдельная org для BBM-holding — отдельный ADR.
- **Repo `sidorovanthon/bbm`** — текущий рабочий workspace (strategy/transcripts/PRD). Step 0c (transfer) **deferred** — нет срочности; имя `bbm` остаётся под personal account до явной BBM-org нарезки.

ADR-0008 §2.10 step 0a → переписан: «Create GitHub org `doctor-school` ✅ done 2026-05-18».
ADR-0008 §2.10 step 0b → переписан: «Transfer `bbm-academy-dev/ds-platform` → `doctor-school/ds-platform` ✅ done 2026-05-18».

**A1.2 — Dev-stand infra в monorepo `ds-platform`, не в bbm-infra (replaces §2.3 statement)**

§2.3 original: «No `services/` или `infrastructure/` at the start — deployment-конфиги ... живут в отдельном `bbm-infra` repo».

§2.3 amended:

- **`doctor-school/ds-platform/infra/dev-stand/`** — local dev environment compose-контракт (portable). См. setup-design spec.
- **`doctor-school/ds-platform/infra/<other>/`** — другие cross-cutting infra-конфиги, относящиеся к DS Platform (CI/CD workflows live в `.github/`, но dev-stand, observability bootstrap configs, future deployment fragments — здесь).
- **Prod-deploy infra** (Coolify manifests / Terraform / k3s helm) — **отдельный repo** `doctor-school/ds-platform-deploy` (или подобное), создаётся в момент первого prod-deploy. Отдельный ADR при создании. Lifecycle prod-deploy ≠ application code (deploy-конфиги меняются по своему расписанию, отдельная аудитория ревью).
- **BBM-уровневая infra** (Plane self-host, BBM analytics tools, etc.) — отдельный `bbm-infra` или `bbm/infra/` repo, **не часть** DS Platform-структуры.

Это устраняет category-confusion между «BBM-holding tools» и «DS Platform infra».

**A1.3 — `infra/plane/` cleanup (deferred)**

Текущий `bbm/infra/plane/` (CLI/MCP/Python скрипты для Plane self-host) — это BBM-уровневый toolset, **не** DS Platform. После A1.1/A1.2 он остаётся в текущем `bbm` repo (или в будущий BBM-holding repo). Migration вне scope amendment'а.

**Consequences:**

- Все cross-refs «`bbm-infra`» в ADR-0008 (§2.3, §4 alternatives table, §6 Related, §15 spec references) → переинтерпретируются как `doctor-school/ds-platform/infra/dev-stand/` (для dev) или `doctor-school/ds-platform-deploy` (для prod), в зависимости от контекста.
- ADR-0008 §2.10 steps 15–22 (repo bootstrap) — выполняются под new org `doctor-school/ds-platform`.
- DSP-150 milestone (local dev stand) — references обновляются на target path `doctor-school/ds-platform/infra/dev-stand/`.
- Personal account `bbm-academy-dev` не используется как owner для DS-репо после transfer'а.

**Why now (timing):**

`ds-platform` repo пустой (не bootstrap'нут). Цена amendment'а = создать org (~5 мин) + transfer пустого repo (~1 мин) + переписать references в spec'ах/задачах. Цена откладывания = делать тот же transfer позже, когда в repo будут commits + dependent tooling + outside contributors. Дёшево сейчас, дорого потом.

**Open follow-up:**

- OQ-R14: BBM-holding org или оставить personal account `sidorovanthon` для `bbm` repo? — решается при первой BBM-уровневой задаче, требующей org boundary.

### Amendment A2 — Branch protection simplified — remove agent-review check (2026-05-19, follow-up to ADR-0007 Amendment A1)

**Контекст:** ADR-0007 Amendment A1 (2026-05-19) drop'ает automated cross-vendor reviewer-bot (`tools/reviewer-agent/` + `.github/workflows/agent-review.yml` не реализуются в Phase 0). Status check `agent-review`, исходно требуемый ADR-0008 §2.6 branch protection rule item 5, теперь **без producer'а**. Required status check без producer'а будет блокировать все merge'и в `main` бессрочно.

**Решение (амендмент):**

**A2.1 — §2.6 branch protection rule item 5 убран.** Пункт, который читался:

> 5. Require status check `agent-review` — passing (ADR-0007 §2.8)

**убран** из списка §2.6 branch protection.

**A2.2 — Required status checks list сведён к `[ci]`.** Branch protection rule на `main` теперь требует ровно один status check context: `ci` (мета-job из §2.8, зависящий от всех blocking sub-job'ов). Context `agent-review` **не** в required-листе.

**A2.3 — Остальные пункты без изменений.** Все остальные §2.6 branch protection items остаются в силе: PR обязателен, ≥1 approving review, dismiss stale reviews on new commits, branches up-to-date before merge, linear history, include administrators, no force pushes, no deletions, require conversation resolution.

**Consequences:**

- Вызов `gh api` в repo-strategy design spec §4.2 (применяющий branch protection через `gh api PUT /repos/{owner}/{repo}/branches/main/protection`) требует **убрать** строку `required_status_checks[contexts][]=agent-review` до выполнения в G10 Phase A orchestration plan.
- **Plane sub-issues description-updated** — DSP-180 (Step 13: branch protection apply) и DSP-189 (Step 21: repo settings + protection) — описания должны отразить новый контракт `required_status_checks = [ci]`.
- Семантика merge gate с точки зрения человека не меняется: CI green + ≥1 human approval. Амендмент только убирает required check, чей producer удалён ADR-0007 Amendment A1.

**Why now (timing):** Branch protection **ещё не применён** (G10 — manual gate, не выполнен). Правка списка правил сейчас стоит ≤1 минуты (text edit). Правка после применения потребует пере-запуска `gh api` вызова.

**Open follow-up:** нет — это механический follow-up к ADR-0007 Amendment A1 без дальнейших unknowns.

**Affects (downstream):**

- ADR-0007 §2.6 строка «cross-vendor review visited» уже SUPERSEDED через ADR-0007 Amendment A1 — она ссылалась на тот же status check `agent-review`.
- Repo-strategy design spec §4.2 — параметры `gh api` invocation должны убрать context `agent-review`.
- Plane DSP-180, DSP-189 — обновления описаний (отдельная Plane-работа).
