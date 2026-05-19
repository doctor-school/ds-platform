---
title: "Design Spec — DS Platform Repository Strategy + Dev Workflow [RU]"
description: "Этот документ — реализационная детализация ADR-0008. ADR фиксирует «что и почему»; spec — «как именно»: содержимое каждого root-level manifest файла,..."
lang: ru
---

> **EN:** [`0008-repo-strategy-and-dev-workflow-design-en.md`](./0008-repo-strategy-and-dev-workflow-design-en.md) · **RU (this)**

# Design Spec — DS Platform Repository Strategy + Dev Workflow

**Дата:** 2026-05-15
**Статус:** Accepted
**Связан с:** ADR-0008, Plane DSO-31 (`fae57ab6-f09b-4a4d-9ede-9a4f1ca504c0`)
**Brainstorm:** superpowers:brainstorming skill, симметрично DSO-25..30 + DSO-60
**Наследует:** ADR-0001..0007

Этот документ — реализационная детализация ADR-0008. ADR фиксирует «что и почему»; spec — «как именно»: содержимое каждого root-level manifest файла, конкретные команды `gh api` для branch protection, шаги move ADR/specs из `bbm`, AGENTS.md/CLAUDE.md sections для repo conventions.

---

## 1. Сводка решений (cross-ref ADR-0008)

| Решение                | Выбор                                                                                                                                 | ADR-0008 §                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| GitHub org             | `bbm-academy-dev` (created 2026-05-15)                                                                                                | §2.1                        |
| Repo name + visibility | `bbm-academy-dev/ds-platform`, private                                                                                                | §2.1                        |
| `bbm` repo location    | планируется transfer в org как housekeeping; не блокирует                                                                             | §2.10 step 0c               |
| Monorepo orchestrator  | Turborepo 2.x + pnpm 10.x workspaces                                                                                                  | §2.2                        |
| Node version pin       | `.nvmrc` (`22`) + `packageManager: pnpm@10.x` + `engines` + `engine-strict=true`                                                      | §2.2                        |
| Repo layout root       | `apps/`, `packages/`, `tools/`, `.github/`, `.changeset/`, manifest files                                                             | §2.3                        |
| Apps inventory         | api (NestJS) + promo + portal + admin + cms (Payload v3) + docs (Fumadocs) + docs-cms (Keystatic) + mobile (Expo). 8 apps.            | §2.3                        |
| Packages inventory     | schemas, api-client, db, glossary, hooks, design-system, observability, utils, eslint-config, tsconfig, llm-utils                     | §2.3                        |
| ADR location           | `apps/docs/content/adr/NNNN-<slug>.md` + companion `NNNN-<slug>-design.md`                                                            | §2.3                        |
| Feature spec location  | `apps/docs/content/specs/features/NNN-<slug>/{requirements,design,scenarios}.md`                                                      | §2.3 (inherits ADR-0006)    |
| Tech spec location     | `apps/docs/content/specs/tech/<topic>.md`                                                                                             | §2.3 (inherits ADR-0006 §4) |
| Drizzle schema master  | `packages/db/schema/` per ADR-0006 §1 (supersedes ADR-0003 §4 location); migrations в `apps/api/drizzle/`                             | §2.3                        |
| Release tooling        | changesets + `changesets/action` GitHub workflow                                                                                      | §2.4                        |
| Commit convention      | conventional-commits (light, no enforce)                                                                                              | §2.4                        |
| Merge style            | squash-only                                                                                                                           | §2.4                        |
| Pre-commit hooks       | simple-git-hooks + lint-staged                                                                                                        | §2.5                        |
| Branch strategy        | trunk-based, ветки `feat/DSO-NN-<slug>` short-lived                                                                                   | §2.6                        |
| Branch protection rule | 9-item list (PR required, ≥1 review, dismiss stale, status checks `ci` + `agent-review`, up-to-date, include admins, no force/delete) | §2.6                        |
| CODEOWNERS Phase 0     | `* @sidorovanthon`                                                                                                                    | §2.7                        |
| CI runner              | GitHub-hosted `ubuntu-latest` only                                                                                                    | §2.8                        |
| Dependabot             | weekly, grouped, ecosystems npm + github-actions                                                                                      | §2.9                        |
| Migration plan         | extends AI-stack design spec §11 + steps 15–22                                                                                        | §2.10                       |

---

## 2. Root-level файлы (полное содержимое)

### 2.1 `package.json` (root)

```json
{
  "name": "ds-platform",
  "private": true,
  "version": "0.0.0",
  "description": "Doctor.School Platform monorepo",
  "license": "UNLICENSED",
  "packageManager": "pnpm@10.7.0",
  "engines": {
    "node": ">=22.0.0 <23.0.0",
    "pnpm": ">=10.0.0"
  },
  "scripts": {
    "bootstrap": "tsx tools/agent-bootstrap.ts",
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "test": "turbo run test",
    "typecheck": "turbo run typecheck",
    "changeset": "changeset",
    "version-packages": "changeset version",
    "release": "changeset publish",
    "prepare": "simple-git-hooks"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "@changesets/changelog-github": "^0.5.0",
    "simple-git-hooks": "^2.11.0",
    "lint-staged": "^15.2.0",
    "turbo": "^2.3.0",
    "typescript": "^5.5.0",
    "tsx": "^4.19.0"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged"
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,mjs,cjs}": ["eslint --fix"],
    "*.{md,json,yaml,yml,css}": ["prettier --write"]
  }
}
```

**Notes:**

- Точные patch versions фиксируются на момент step 15 (latest stable на дату implementation; OQ-R1).
- `prepare` script вызывает `simple-git-hooks` install автоматически при каждом `pnpm install` (post-install не нужен — `prepare` lifecycle native).
- `lint-staged` config inline в root package.json — нет отдельного файла, меньше moving parts.
- Per-package `package.json` `name` field — `@ds/<name>` convention. `apps/docs/package.json` имеет `"name": "@ds/docs"` — это имя используется в `.changeset/config.json` ignore list (§2.10).
- `tools/reviewer-agent/` имеет собственный `package.json` (workspace member) + опциональный per-package `turbo.json` если script tasks отличаются от root pipeline. Минимальный `turbo.json` в packages/apps не обязателен — Turborepo делает fallback to root config.

### 2.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools/reviewer-agent"
```

`tools/agent-bootstrap.ts` и `tools/cost-ledger-sync.ts` — single-file scripts вне workspaces, запускаются через `tsx` напрямую. `tools/reviewer-agent/` имеет несколько зависимостей (Anthropic SDK, OpenAI SDK, gh CLI wrapper) → отдельный package.

### 2.3 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local", "tsconfig.base.json"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["^typecheck"],
      "outputs": ["coverage/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

**Remote cache:** не настраиваем в Phase 0. Trigger to add — OQ-R2.

### 2.4 `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "incremental": true
  },
  "exclude": ["node_modules", "dist", ".next", "coverage"]
}
```

Per-package `tsconfig.json` extends base + добавляет `paths`, `outDir`, `composite: true` для project references.

### 2.5 `.nvmrc`

```
22
```

### 2.6 `.npmrc`

```ini
engine-strict=true
auto-install-peers=true
strict-peer-dependencies=false
prefer-workspace-packages=true
link-workspace-packages=true
```

### 2.7 `.editorconfig`

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false  # Markdown trailing spaces = line breaks
```

### 2.8 `.gitignore`

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build artifacts
dist/
build/
.next/
.turbo/
out/
coverage/
*.tsbuildinfo

# Environment
.env
.env.local
.env.*.local

# Editor
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea/
*.swp

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Tests
.vitest-cache/
playwright-report/
test-results/

# Tooling state
.changeset/.changeset-version
```

### 2.9 `.gitattributes`

```gitattributes
* text=auto eol=lf
*.{cmd,[cC][mM][dD]} text eol=crlf
*.{bat,[bB][aA][tT]} text eol=crlf
*.{png,jpg,gif,ico,webp,avif,woff2,pdf} binary
```

### 2.10 `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": [
    "@changesets/changelog-github",
    { "repo": "bbm-academy-dev/ds-platform" }
  ],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@ds/docs"]
}
```

- `access: restricted` — никакой случайный `pnpm publish` не уйдёт в публичный registry. Publishing strategy решается per-package позже (Phase 1+).
- `ignore: ["@ds/docs"]` — `apps/docs/` не имеет смысла версионировать (это статика).

---

## 3. `.github/` skeleton

### 3.1 `.github/workflows/ci.yml`

Multi-job workflow с meta-job `ci-result` который depends-on все required jobs и выставляет единый status check `ci`. Все required-jobs параллельно после `setup`; meta-job suffix чтобы branch protection видел один `ci` check.

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  TURBO_TELEMETRY_DISABLED: 1

jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # changesets + lychee need full history
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile

  # ─── Core build/test/lint (parallel after setup) ─────────────────────
  lint:
    needs: setup
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
  types:
    needs: setup
    runs-on: ubuntu-latest
    # ... аналогично lint, runs pnpm typecheck
  unit:
    needs: setup
    runs-on: ubuntu-latest
    # ... pnpm test
  build:
    needs: setup
    runs-on: ubuntu-latest
    # ... pnpm build
  docs-build:
    needs: setup
    runs-on: ubuntu-latest
    # ... pnpm --filter @ds/docs build  (ADR-0006 §7)

  # ─── Drift guards from ADR-0006 §7 (12 checks) ───────────────────────
  api-drift:
    needs: setup
    # ... Spectral lint apps/api openapi.json + diff against openapi.snapshot.json
  db-drift:
    needs: setup
    # ... pnpm --filter @ds/db exec drizzle-kit check
  events-drift:
    needs: setup
    # ... pnpm exec tsx tools/lint/events-lint.ts
  generated-artifacts:
    needs: setup
    # ... pnpm generate:all --check
  markdown-links:
    needs: setup
    # ... lycheeverse/lychee-action@v2 with args: --no-progress --include-fragments .
  module-readme:
    needs: setup
    continue-on-error: true # WARN v1
    # ... pnpm exec tsx tools/lint/module-readme-lint.ts

  # ─── Glossary 4-layer validation from ADR-0006 §6 ────────────────────
  glossary-mdx:
    needs: setup
    # ... pnpm exec tsx tools/lint/glossary-mdx-lint.ts
  glossary-ids:
    needs: setup
    # ... ESLint rule glossary-canonical-ids runs as part of pnpm lint (already covered) — отдельный job для visibility WARN-line; folds into `lint` если хочется минимизировать jobs
  glossary-roundtrip:
    needs: setup
    # ... pnpm exec tsx tools/lint/glossary-roundtrip-lint.ts

  # ─── AI-specific guards from ADR-0007 §2.6 ───────────────────────────
  spec-link:
    needs: setup
    # ... pnpm exec tsx tools/lint/spec-link-lint.ts (BLOCK)
  ears-tests:
    needs: setup
    continue-on-error: true # WARN v1
    # ... pnpm exec tsx tools/lint/ears-test-lint.ts
  tdd-signal:
    needs: setup
    continue-on-error: true # WARN v1
    # ... pnpm exec tsx tools/lint/tdd-signal-lint.ts
  spec-status-fresh:
    needs: setup
    continue-on-error: true # WARN v1
    # ... pnpm exec tsx tools/lint/spec-status-lint.ts
  prior-decisions:
    needs: setup
    continue-on-error: true # WARN v1
    # ... pnpm exec tsx tools/lint/prior-decisions-lint.ts

  # ─── Meta-job: единый status check для branch protection ─────────────
  ci-result:
    needs:
      [
        lint,
        types,
        unit,
        build,
        docs-build,
        api-drift,
        db-drift,
        events-drift,
        generated-artifacts,
        markdown-links,
        glossary-mdx,
        glossary-roundtrip,
        spec-link,
      ]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Aggregate
        run: |
          if [ "${{ contains(needs.*.result, 'failure') }}" = "true" ]; then
            echo "Required job failed"; exit 1
          fi
          echo "All required jobs green"
```

**Status check naming:** branch protection rule (§2.6 / §4) reference `ci` — это GitHub job name `ci-result` показывается как `CI / ci-result`. Чтобы избежать confusion, можно явно `name: ci` на meta-job через `jobs.ci.name`. WARN-only jobs (module-readme, ears-tests, tdd-signal, spec-status-fresh, prior-decisions) НЕ перечислены в `ci-result.needs` — они показываются как separate checks без блока merge.

**Severity transition:** WARN v1 → BLOCK v2 (AI-stack design spec §11 Phase 1 transition) = убрать `continue-on-error` + добавить job в `ci-result.needs`.

### 3.2 `.github/workflows/agent-review.yml`

Per ADR-0007 §2.8. Sketch:

```yaml
name: agent-review

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  contents: read

concurrency:
  group: agent-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Check kill switch
        id: kill
        run: |
          ENABLED=$(jq -r '.agents_enabled' .github/agents-config.json)
          echo "enabled=$ENABLED" >> $GITHUB_OUTPUT
      - name: Run reviewer-agent
        if: steps.kill.outputs.enabled == 'true'
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm exec tsx tools/reviewer-agent/run.ts --pr ${{ github.event.pull_request.number }}
      - name: Mark as skipped if kill switch off
        if: steps.kill.outputs.enabled != 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh pr comment ${{ github.event.pull_request.number }} --body "[REVIEWER-DISABLED] Agent kill switch off; merge gates relaxed."
          # NB: workflow exit 0 → status check `agent-review` becomes `success` automatically.
          # Это критично: branch protection требует `agent-review` passing. Если бы мы exit'или non-zero
          # при kill switch off, все PR были бы заблокированы и kill switch стал бы кирпичом.
```

**Status check name = `agent-review`** (соответствует `workflow.name`). Branch protection требует passing — workflow всегда exit 0 если kill switch off (success), либо exit code reviewer-agent run.ts (который сам returns 0 даже если посчитал findings; mаrkers `[BLOCKING]` в комментариях, не в exit code — human-merge gate решает).

### 3.3 `.github/workflows/cost-ledger.yml`

Per ADR-0007 §2.10. Sketch:

```yaml
name: cost-ledger

on:
  schedule:
    - cron: "0 9 * * 1" # каждый понедельник 09:00 UTC = 12:00 МСК
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Pull usage + open PR
        env:
          ANTHROPIC_ADMIN_KEY: ${{ secrets.ANTHROPIC_ADMIN_KEY }}
          OPENAI_ADMIN_KEY: ${{ secrets.OPENAI_ADMIN_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm exec tsx tools/cost-ledger-sync.ts
```

### 3.4 `.github/workflows/release.yml`

```yaml
name: release

on:
  push:
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Create release PR or publish
        uses: changesets/action@v1
        with:
          version: pnpm run version-packages
          publish: pnpm run release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }} # только если apps публикуются в registry; иначе omit
```

В Phase 0 ни один package не публикуется (`access: restricted`), `changesets/action` будет открывать "Version Packages" PR без publish step. Это OK — PR показывает what would change, Tech Lead merge'ит для версионирования + changelog обновления.

### 3.5 `.github/agents-config.json`

```json
{
  "agents_enabled": true,
  "cross_vendor_review_required": true,
  "reviewer_vendor_default": "openai",
  "soft_cost_cap_weekly_usd": 50
}
```

Read by `agent-review.yml` (kill switch) и `cost-ledger-sync.ts`. Default `reviewer_vendor_default = openai` per ADR-0007 §Negative (Claude primary author → OpenAI reviewer).

### 3.6 `.github/CODEOWNERS`

```
# Phase 0 — single owner, all paths
*    @sidorovanthon
```

Phase 1 trigger (hire #2): replace на per-path patterns + GitHub Teams.

### 3.7 `.github/pull_request_template.md`

```markdown
## Summary

<!-- 1-3 sentences: what changed and why -->

## Linked

- Closes #<issue-number> (or "Relates #N" if partial)
- Spec: <link to apps/docs/content/specs/features/NNN-<slug>/ if feature-PR>
- ADR: <link to apps/docs/content/adr/NNNN-\*.md if architectural decision>

## Type

<!-- One label MUST apply; tracker enforces -->

- [ ] feature
- [ ] bug
- [ ] chore
- [ ] refactor
- [ ] docs

## Author

<!-- For reviewer-bot vendor detection (ADR-0007 §Negative) -->

- [ ] author:claude
- [ ] author:codex
- [ ] author:human

## Checklist

- [ ] Tests green (unit + e2e where applicable)
- [ ] `pnpm generate:all` artifacts up-to-date
- [ ] Linked spec status updated if applicable
- [ ] Changeset added if user-facing change (`pnpm changeset`)
- [ ] Glossary updated if new domain terms introduced
```

### 3.8 `.github/ISSUE_TEMPLATE/feature.md`

```markdown
---
name: Feature implementation
about: One EARS-handler / one piece of functionality from a feature-spec
labels: ["feature"]
---

**Linked feature spec:** apps/docs/content/specs/features/NNN-<slug>/

**EARS reference:** EARS-N.M (link to requirements.md line)

**Acceptance criteria:**

- [ ] ...

**Notes:**

<!-- context, blockers, related Issues -->
```

`bug.md` и `chore.md` — аналогично короткие шаблоны.

### 3.9 `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
      time: "03:00"
      timezone: UTC
    open-pull-requests-limit: 5
    groups:
      minor-and-patch:
        update-types: [minor, patch]

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 3
```

Не настраиваем per-directory npm sub-configs — pnpm-monorepo single root install handles everything.

---

## 4. Branch protection + repo settings — конкретные `gh api` вызовы

Per ADR-0008 §2.6, step 21. Admin запускает оба вызова один раз:

**4.1 Repository settings — enforce squash-only:**

```bash
gh api \
  --method PATCH \
  -H "Accept: application/vnd.github+json" \
  /repos/bbm-academy-dev/ds-platform \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=false \
  -F allow_merge_commit=false \
  -F delete_branch_on_merge=true \
  -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY
```

Без отключения `allow_rebase_merge` + `allow_merge_commit` любой контрибьютор может выбрать rebase-merge или merge-commit, что ломает changesets parsing (changesets ожидает один squashed commit на PR) и AI-agent reasoning о history.

**4.2 Branch protection rule:**

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/bbm-academy-dev/ds-platform/branches/main/protection \
  -f required_status_checks[strict]=true \
  -f required_status_checks[contexts][]=ci \
  -f enforce_admins=true \
  -f required_pull_request_reviews[dismiss_stale_reviews]=true \
  -f required_pull_request_reviews[required_approving_review_count]=1 \
  -f required_pull_request_reviews[require_code_owner_reviews]=false \
  -f restrictions=null \
  -f allow_force_pushes=false \
  -f allow_deletions=false \
  -f required_linear_history=true \
  -f required_conversation_resolution=true
```

`required_linear_history=true` enforces squash или rebase merge (matches §2.4 squash-only).

`require_code_owner_reviews=false` Phase 0 — CODEOWNERS = одна строка `* @sidorovanthon`, и Tech Lead обычно author'ит PR; включение rule создавало бы recursion ("ты не можешь approve свой PR"). Phase 1 (hire #2) — переключить в `true`.

`required_conversation_resolution=true` — все PR-комментарии reviewer-bot'а должны быть resolved перед merge.

---

## 5. Move steps 18 — конкретные команды

Step 18 (ADR-0008 §2.10) выполняется Tech Lead вручную. **`git mv` cross-repo не работает** (отказывается с error: source and destination не в одном working tree) — это два разных git repos. Используем `cp` + `git rm` в bbm + `git add` в ds-platform.

**Decision: git history для ADR файлов теряется** — она остаётся в `bbm` git log (раздел `docs/adr/` retained for historical lookups). Сохранение history через `git filter-repo --path docs/adr/` + cross-repo merge — overkill для 8 файлов. Acceptable trade-off для Phase 0.

**В ds-platform repo (Bash или PowerShell):**

```bash
# Bash
cd /path/to/ds-platform
mkdir -p apps/docs/content/adr
cp /path/to/bbm/docs/adr/0001-identity-provider-shortlist-ru.md       apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0002-backend-core-stack-ru.md                 apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0003-data-layer-stack-ru.md                   apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0004-frontend-stack-ru.md                     apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0005-mobile-stack-ru.md                       apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0006-documentation-and-ssot-ru.md             apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0007-ai-stack-ru.md                            apps/docs/content/adr/
cp /path/to/bbm/docs/adr/0008-repo-strategy-and-dev-workflow-ru.md     apps/docs/content/adr/

# Companion design specs — copy + rename to NNNN-<slug>-design.md pattern
cp /path/to/bbm/docs/superpowers/specs/0001-identity-provider-shortlist-design-ru.md  apps/docs/content/adr/0001-identity-provider-shortlist-design.md
cp /path/to/bbm/docs/superpowers/specs/0002-backend-core-stack-design-ru.md         apps/docs/content/adr/0002-backend-core-stack-design.md
cp /path/to/bbm/docs/superpowers/specs/0003-data-layer-stack-design-ru.md           apps/docs/content/adr/0003-data-layer-stack-design.md
cp /path/to/bbm/docs/superpowers/specs/0004-frontend-stack-design-ru.md       apps/docs/content/adr/0004-frontend-stack-design.md
cp /path/to/bbm/docs/superpowers/specs/0005-mobile-stack-design-ru.md         apps/docs/content/adr/0005-mobile-stack-design.md
cp /path/to/bbm/docs/superpowers/specs/0006-documentation-and-ssot-design-ru.md   apps/docs/content/adr/0006-documentation-and-ssot-design.md
cp /path/to/bbm/docs/superpowers/specs/0007-ai-stack-design-ru.md             apps/docs/content/adr/0007-ai-stack-design.md
cp /path/to/bbm/docs/superpowers/specs/0008-repo-strategy-and-dev-workflow-design-ru.md        apps/docs/content/adr/0008-repo-strategy-and-dev-workflow-design.md

git add apps/docs/content/adr/
git commit -m "docs(adr): import ADR-0001..0008 + design specs from bbm repo"
```

**PowerShell-эквивалент** (если Анton работает в Windows-shell — copy-команды одинаково; `git` команды unchanged):

```powershell
Copy-Item C:\Users\sidor\repos\bbm\docs\adr\*.md C:\Users\sidor\repos\ds-platform\apps\docs\content\adr\
Copy-Item C:\Users\sidor\repos\bbm\docs\superpowers\specs\2026-05-1*-ds-platform-*-design.md C:\Users\sidor\repos\ds-platform\apps\docs\content\adr\
# Затем вручную rename каждый -design.md per pattern выше
```

**В bbm repo cleanup:**

```bash
cd /path/to/bbm
git rm apps/docs/content/adr/0001-identity-provider-shortlist-ru.md
git rm apps/docs/content/adr/0002-backend-core-stack-ru.md
# ... все 8 ADR файлов
git rm apps/docs/content/adr/0001-identity-provider-shortlist-design-ru.md
# ... все 8 design specs

# Создать stub README в docs/adr/
mkdir -p docs/adr
```

Создать `docs/adr/README.md` (содержимое; на Windows PowerShell — через VS Code/Notepad, heredoc `cat <<EOF` ломается, см. memory `feedback_tech_stack_criteria_no_team_skill` Windows-нотес в общих правилах):

```markdown
# ADR for DS Platform

ADRs and design specs for the DS Platform technical stack have moved to:
**https://github.com/bbm-academy-dev/ds-platform/tree/main/apps/docs/content/adr**

This `bbm` repository hosts BBM-level strategy and business documents only.

Historical ADR-0001..0008 (created here before ds-platform repo existed): see git history.
```

```bash
git add docs/adr/README.md
git commit -m "docs(adr): move platform ADRs to bbm-academy-dev/ds-platform"
```

**Updated references:** grep BBM repo и заменить inline-paths. На Windows PowerShell используется `Select-String`:

```powershell
Select-String -Path '**/*.md','**/*.json' -Pattern 'docs/adr/' -SimpleMatch
```

Bash:

```bash
grep -rn "docs/adr/" --include='*.md' --include='*.json' .
```

Найденные ссылки в CLAUDE.md, processed/summaries, outputs/, memory/MEMORY.md — заменить на `https://github.com/bbm-academy-dev/ds-platform/blob/main/apps/docs/content/adr/...` или relative ref (если в ds-platform repo).

**NOT moved (остаются в bbm):**

- Все `docs/superpowers/specs/` файлы, которые **не** относятся к платформенному стеку: Plane migration, Linear migration, infra-cost research, business-process design specs
- `outputs/`, `transcripts/`, `models/`, `knowledge-base/documents/` — BBM-level artifacts
- `infra/plane/` — Plane management tooling (BBM-level)
- `CLAUDE.md`, `MEMORY.md` — BBM-level agent instructions (новый CLAUDE.md создаётся в ds-platform отдельно — per AI-stack design spec §11 step 12)

---

## 6. AGENTS.md / CLAUDE.md sections для ds-platform

Сверх baseline из ADR-0006/0007, добавить repository conventions section:

### 6.1 AGENTS.md "Repository conventions" section (skeleton)

```markdown
## Repository conventions

**Monorepo:** pnpm 10 workspaces + Turborepo. Root commands run via `pnpm <script>`; per-package via `pnpm --filter <name> <script>`.

**Apps live in `apps/<name>/`**: api (NestJS backend), promo, portal, admin, cms, docs, mobile. Shared code in `packages/<name>/`. Build/dev tooling in `tools/`.

**Branch strategy:** trunk-based. New work goes into `feat/DSO-NN-<slug>` or `fix/<N>-<slug>` short-lived branches. Squash-merge into main; ветка удаляется автоматически.

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Light convention — squash-merge title is enforced via PR title, not commit-message linter.

**Versioning:** changesets. Любой user-facing PR → добавь changeset через `pnpm changeset` (interactive). Bug fixes = patch, new features = minor, breaking = major. Internal-only PR (refactor, docs, chore) — без changeset.

**Pre-commit:** simple-git-hooks runs lint-staged on staged files (ESLint --fix + Prettier). Если hook ломает commit спутанно — `git commit --no-verify` valid escape hatch, но залогируй reason в PR description.

**PR template обязателен** — ставь правильный label (feature/bug/chore/refactor/docs), линкуй Issue (`Closes #N`), помечай author (claude/codex/human) для reviewer-bot vendor detection.

**Branch protection:** main защищена. PR требует: passing `ci` + `agent-review` status checks, ≥1 human approval, conversation resolved, branch up-to-date, linear history, no force push.

**ADRs live in `apps/docs/content/adr/`**, render через Fumadocs at `/adr/<slug>`. Парный design spec — `NNNN-<slug>-design.md` рядом.

**Feature specs live in `apps/docs/content/specs/features/NNN-<slug>/`** (3 файла: requirements.md, design.md, scenarios.feature). One spec → one GitHub Milestone → multiple Issues per EARS-handler.
```

### 6.2 CLAUDE.md "Repository conventions" overlay (Claude Code-specific)

```markdown
## Repository conventions (Claude Code overlay)

[inherit AGENTS.md "Repository conventions" — listed above]

**SessionStart hook** в `.claude/settings.json`:
\`\`\`json
{
"hooks": {
"sessionStart": {
"command": "pnpm bootstrap",
"captureToAdditionalContext": true
}
}
}
\`\`\`

Output bootstrap'а (≤2 KB live state snapshot) автоматически в `additionalContext` каждой свежей сессии. Не нужно вручную читать git log / gh issue list — bootstrap всё даёт.

**Tool priority в ds-platform repo:**

1. `gh` CLI — для GitHub Issues, PRs, releases (primary, AI-friendly через JSON output)
2. MCP `mcp__plugin_github_github__*` — только для read-tasks которые не покрывает `gh` (rare)
3. `pp-plane` CLI — для cross-tracker references (когда нужно сослаться на Plane DSO-XXX из ADR/spec). Не для code-level Issues.

**Plane vs GitHub Issues split** (ADR-0006 §9):

- DS Platform code-level Issues → GitHub Issues в этом repo (`gh issue ...`)
- BBM strategic Issues, cross-team milestones → Plane workspace `doctor-school`

**Не дёргать `pp-plane` CLI для code-tasks** — это создавало бы duplicate sources.
```

---

## 7. README.md (ds-platform root)

Skeleton, конкретное содержимое заполняется на step 15:

```markdown
# DS Platform

Doctor.School medical-education platform (B2B sponsor → B2D doctor).

## Status

Phase 0 (greenfield, brainstorm complete). Pre-pilot target: 2026 Q3 (TBD).

## Stack

- **Backend:** NestJS + Zod + REST + openapi-typescript (ADR-0002); `apps/api/`
- **Data:** Postgres 17 + Drizzle + pgvector (ADR-0003); schemas в `packages/db/`, migrations в `apps/api/drizzle/`
- **Frontend:** Next.js 15 + Refine; 4 apps — `apps/promo/`, `apps/portal/`, `apps/admin/`, `apps/cms/` (Payload v3 content-only) (ADR-0004)
- **Mobile:** React Native + Expo + WatermelonDB (ADR-0005); `apps/mobile/`
- **Docs:** Fumadocs (`apps/docs/`) + Keystatic editor (`apps/docs-cms/`) + glossary.yaml в `apps/docs/content/product/glossary/` (ADR-0006)
- **AI dev loop:** Claude Code + Codex async + reviewer-bot (ADR-0007)
- **Repo:** pnpm workspaces + Turborepo + changesets + GitHub-hosted CI (ADR-0008)
- **Identity:** Authentik/Zitadel (ADR-0001 §8 — TBD per spike) + Cerbos RBAC (ADR-0003 §5)

Full reference: `apps/docs/content/adr/`.

Runtime/operational tooling (Coolify preview, Caddy, GlitchTip, Loki, Vault, Unleash): see [engineering-readiness spec](https://github.com/bbm-academy-dev/bbm/blob/main/docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-ru.md).

## Prerequisites

- Node 22 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` auto-fetches from `packageManager`)
- gh CLI (`brew install gh` / `winget install GitHub.cli`)

## Install + Run

\`\`\`bash
pnpm install
pnpm bootstrap # AI-agent live state snapshot
pnpm dev # all apps in parallel
pnpm --filter @ds/api dev # single app
\`\`\`

## Contribute

See AGENTS.md (universal constitution) и CLAUDE.md (Claude Code overlay).

## Owners

@sidorovanthon (Phase 0 single owner; CODEOWNERS splits at hire #2).
```

---

## 8. Open follow-ups (ссылки на ADR-0008 §5)

Все open questions (OQ-R1..R12) перечислены в ADR-0008 §5 с triggers. Spec их детализирует только когда trigger fires — без premature speculation.

Конкретный workflow когда trigger fires (any of OQ-R1..R12):

1. Tech Lead или AI-агент замечает условие (CI minutes исчерпаны, hire #2, blocked PR из-за GitHub down)
2. Открывается новый Plane work-item с описанием trigger
3. Запускается brainstorm (superpowers:brainstorming) → новый ADR (ADR-0009+) → companion design spec
4. Implementation шаги — children work-items

---

## 9. Cross-refs

- **ADR-0001** §8 — IdP shortlist (Authentik **или Zitadel** — TBD per §8 spike): при появлении team SSO для GitHub Enterprise plan — reuse того же tenant, не отдельный.
- **ADR-0002** §6 — `apps/api/` имплементирует NestJS + BullMQ.
- **ADR-0002** §3-5 — `packages/schemas/` (Zod SSOT) + `packages/api-client/` (openapi-typescript generated SDK).
- **ADR-0003** §4 — Drizzle TS schemas (location: `packages/db/schema/` per ADR-0003 Amendment A1, supersedes §4 original location) + drizzle-kit SQL diff migrations в `apps/api/drizzle/`; §7 — pgvector в той же Postgres.
- **ADR-0004** §2 — 4 frontend Next.js apps (`apps/promo/`, `apps/portal/`, `apps/admin/`, `apps/cms/`).
- **ADR-0004** §7 — Payload v3 в `apps/cms/` (content-only, `cms.*` schema namespace shared Postgres).
- **ADR-0004** §13 — `packages/eslint-config/` экспортирует `no-vercel-only-api` rule.
- **ADR-0005** — `apps/mobile/` — Expo SDK 53, отдельный build/release pipeline (Expo EAS).
- **ADR-0006** §1, §2, §3, §6, §7, §9, §10 — doc topology, Fumadocs, Keystatic, glossary, drift guards, task-tracker split: воплощается в layout §2.3 + tooling §3.
- **ADR-0007** §2.4 (8-step cycle), §2.5 (bootstrap), §2.6 (drift guards), §2.8 (reviewer-bot), §2.10 (cost-ledger), §2.11 (autonomy + kill switch); **AI-stack design spec §11** (14-step migration plan): этот ADR-0008 + spec — operational ground для §11 migration steps.
- **Engineering-readiness spec** (`docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-ru.md`) — runtime tooling defaults: Caddy/Traefik, Coolify, GlitchTip, Loki+Prometheus+Tempo, Vault, Unleash, Beget DNS. Referenced from `README.md` § Runtime tooling. Не дублируется в ADR-0008.

---

## 10. Source

- Brainstorm-сессия 2026-05-15 с Tech Lead (superpowers:brainstorming)
- Inherited decisions: ADR-0001..0007 (DSO-25..30 + DSO-60)
- Plane DSO-31 ticket scope (открытые decisions + scope-notes)
- Текущий контекст ds-platform repo: `bbm-academy-dev/ds-platform` (created 2026-05-15)

---

## 11. Amendments

### Amendment SD2 — agent-review check removed per ADR-0008 Amendment A2 (2026-05-19)

**Контекст:** ADR-0007 Amendment A1 (2026-05-19) дропнул автоматический cross-vendor reviewer-bot (`tools/reviewer-agent/` + `.github/workflows/agent-review.yml` не реализованы в Phase 0). ADR-0008 Amendment A2 сократил required checks в branch protection до `[ci]`. Этот spec — реализационная детализация этих check'ов, поэтому payload `gh api` в §4.2 должен следовать.

**Change:** §4.2 branch-protection `gh api` snippet — строка `-f required_status_checks[contexts][]=agent-review` удалена (EN + RU). Других изменений в этом amendment нет. §1 summary row и §3.2 (`agent-review.yml` skeleton) / §3.3 (`cost-ledger.yml`) / §3.5 (`agents-config.json`) оставлены в spec'е как inherited reference — их producers дропнуты ADR-0007 Amendment A1, семантика vestigial. Будут пересмотрены, если будущая ADR вернёт автоматический reviewer.

**Effect:** Plane sub-issues DSP-180 (`gh api` branch-protection call) и DSP-189 (manual gate setup) потребляют исправленный payload upstream — отдельный change request на эти тикеты не нужен.

**Cross-refs:** ADR-0007 §Amendment A1, ADR-0008 §Amendment A2, AI-stack design spec §6/§7/§10 SUPERSEDED callouts.

### Amendment SD3 — `gh api` payload сохранён как target-state; не применяется в Phase 0 (2026-05-19, follow-up к ADR-0008 Amendment A3)

**Контекст:** ADR-0008 Amendment A3 (2026-05-19) переформулирует §2.6 как target-state, не current state — branch protection нельзя применить на `doctor-school/ds-platform` пока org на GitHub Free и репо private (HTTP 403 и от legacy branch-protection API, и от rulesets API). Этот spec в §4.2 документирует `gh api` invocation, реализующий §2.6; A3 меняет _что мы делаем_ с этим invocation, а не его содержание.

**Change:** §4.2 snippet `gh api PUT …/branches/main/protection` — **сохранён дословно** (post-SD2: без `agent-review`). Теперь он аннотирован как target-state payload, применяемый когда сработает любой reactivation trigger (ADR-0008 A3.4). Snippet **не выполняется в G10**; G10 переклассифицирован per A3 (apply repo settings + закоммитить `branch-protection.json` + cancel DSP-180/DSP-189). Новой pre-push инструментации в interim не вводим — покрыто в A3 Consequences.

**Reactivation procedure (когда trigger срабатывает):**

1. Перечитать ADR-0008 §2.6 (post-A2) и подтвердить, что 7-item list всё ещё представляет desired contract.
2. Запустить §4.2 `gh api` call (payload уже зафиксирован в `branch-protection.json` в корне репо).
3. Проверить через `gh api repos/doctor-school/ds-platform/branches/main/protection` (200 OK + matching payload).
4. Открыть follow-up чтобы вернуть §2.6 обратно в current-state и убрать A3 interim-substitute таблицу.

**Cross-refs:** ADR-0008 §Amendment A3, AGENTS.md root (interim merge-flow), `branch-protection.json` в корне репо.
