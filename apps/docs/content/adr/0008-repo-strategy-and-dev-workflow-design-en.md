---
title: "Design Spec — DS Platform Repository Strategy + Dev Workflow [EN]"
description: 'This document is the implementation detail for ADR-0008. The ADR fixes "what and why"; the spec covers "exactly how": the contents of each root-level...'
lang: en
---

> **EN (this)** · **RU:** [`0008-repo-strategy-and-dev-workflow-design-ru.md`](./0008-repo-strategy-and-dev-workflow-design-ru.md)

# Design Spec — DS Platform Repository Strategy + Dev Workflow

**Date:** 2026-05-15
**Status:** Accepted
**Related to:** ADR-0008, Plane DSO-31 (`fae57ab6-f09b-4a4d-9ede-9a4f1ca504c0`)
**Brainstorm:** superpowers:brainstorming skill, symmetric to DSO-25..30 + DSO-60
**Inherits:** ADR-0001..0007

This document is the implementation detail for ADR-0008. The ADR fixes "what and why"; the spec covers "exactly how": the contents of each root-level manifest file, concrete `gh api` commands for branch protection, and AGENTS.md/CLAUDE.md sections for repo conventions.

---

## 1. Decision summary (cross-ref ADR-0008)

| Decision               | Choice                                                                                                                     | ADR-0008 §                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| GitHub org             | `doctor-school` (GitHub Free plan)                                                                                         | §2.1                        |
| Repo name + visibility | `doctor-school/ds-platform`, private                                                                                       | §2.1                        |
| Monorepo orchestrator  | Turborepo 2.x + pnpm 10.x workspaces                                                                                       | §2.2                        |
| Node version pin       | `.nvmrc` (`22`) + `packageManager: pnpm@10.x` + `engines` + `engine-strict=true`                                           | §2.2                        |
| Repo layout root       | `apps/`, `packages/`, `tools/`, `.github/`, `.changeset/`, manifest files                                                  | §2.3                        |
| Apps inventory         | api (NestJS) + promo + portal + admin + cms (Payload v3) + docs (Fumadocs) + docs-cms (Keystatic) + mobile (Expo). 8 apps. | §2.3                        |
| Packages inventory     | schemas, api-client, db, glossary, hooks, design-system, observability, utils, eslint-config, tsconfig, llm-utils          | §2.3                        |
| ADR location           | `apps/docs/content/adr/NNNN-<slug>.md` + companion `NNNN-<slug>-design.md`                                                 | §2.3                        |
| Feature spec location  | `apps/docs/content/specs/features/NNN-<slug>/{NNN-requirements.md, NNN-design.md, NNN-scenarios.feature}`                  | §2.3 (inherits ADR-0006)    |
| Tech spec location     | `apps/docs/content/specs/tech/<topic>.md`                                                                                  | §2.3 (inherits ADR-0006 §4) |
| Drizzle schema master  | `packages/db/schema/` per ADR-0006 §1 (supersedes ADR-0003 §4 location); migrations in `apps/api/drizzle/`                 | §2.3                        |
| Release tooling        | changesets + `changesets/action` GitHub workflow                                                                           | §2.4                        |
| Commit convention      | conventional-commits (light, no enforce)                                                                                   | §2.4                        |
| Merge style            | squash-only                                                                                                                | §2.4                        |
| Pre-commit hooks       | simple-git-hooks + lint-staged                                                                                             | §2.5                        |
| Branch strategy        | trunk-based, branches `feat/DSO-NN-<slug>` short-lived                                                                     | §2.6                        |
| Branch protection rule | Target-state contract per ADR-0008 §2.6 (deferred enforcement; required status check `ci` only)                            | §2.6                        |
| CODEOWNERS Phase 0     | `* @sidorovanthon`                                                                                                         | §2.7                        |
| CI runner              | GitHub-hosted `ubuntu-latest` only                                                                                         | §2.8                        |
| Dependabot             | weekly, grouped, ecosystems npm + github-actions                                                                           | §2.9                        |
| Bootstrap steps        | extends AI-stack design spec §11 + steps 15–22                                                                             | §2.10                       |

---

## 2. Root-level files (full contents)

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

- Exact patch versions are fixed at the time of step 15 (latest stable on the implementation date; OQ-R1).
- The `prepare` script invokes `simple-git-hooks` install automatically on every `pnpm install` (a separate post-install is not needed — `prepare` is a native lifecycle hook).
- `lint-staged` config is inline in root package.json — no separate file, fewer moving parts.
- Per-package `package.json` `name` field — `@ds/<name>` convention. `apps/docs/package.json` has `"name": "@ds/docs"` — this name is used in the `.changeset/config.json` ignore list (§2.10).
- `tools/reviewer-agent/` has its own `package.json` (workspace member) + an optional per-package `turbo.json` if script tasks differ from the root pipeline. A minimal `turbo.json` in packages/apps is not required — Turborepo falls back to the root config.

### 2.2 `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "tools/reviewer-agent"
```

`tools/agent-bootstrap.ts` and `tools/cost-ledger-sync.ts` — single-file scripts outside workspaces, run via `tsx` directly. `tools/reviewer-agent/` has several dependencies (Anthropic SDK, OpenAI SDK, gh CLI wrapper) → separate package.

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

**Remote cache:** not configured in Phase 0. Trigger to add — OQ-R2.

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

Per-package `tsconfig.json` extends base + adds `paths`, `outDir`, `composite: true` for project references.

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
    { "repo": "doctor-school/ds-platform" }
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

- `access: restricted` — no accidental `pnpm publish` will reach the public registry. Publishing strategy is decided per-package later (Phase 1+).
- `ignore: ["@ds/docs"]` — `apps/docs/` has no meaningful version (it is a static site).

---

## 3. `.github/` skeleton

### 3.1 `.github/workflows/ci.yml`

Multi-job workflow with a meta-job `ci-result` that depends on all required jobs and sets a single status check `ci`. All required jobs run in parallel after `setup`; the meta-job suffix so that branch protection sees one `ci` check.

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
    # ... analogous to lint, runs pnpm typecheck
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
    # ... ESLint rule glossary-canonical-ids runs as part of pnpm lint (already covered) — separate job for visibility WARN-line; folds into `lint` if minimising jobs is desired
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

  # ─── Meta-job: single status check for branch protection ─────────────
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

**Status check naming:** the branch protection rule (§2.6 / §4) references `ci` — the GitHub job name `ci-result` is displayed as `CI / ci-result`. To avoid confusion, you can set an explicit `name: ci` on the meta-job via `jobs.ci.name`. WARN-only jobs (module-readme, ears-tests, tdd-signal, spec-status-fresh, prior-decisions) are NOT listed in `ci-result.needs` — they appear as separate checks without blocking merge.

**Severity transition:** WARN v1 → BLOCK v2 (AI-stack design spec §11 Phase 1 transition) = remove `continue-on-error` + add job to `ci-result.needs`.

### 3.2 `.github/workflows/agent-review.yml`

> **Reference design only — not implemented in Phase 0.** ADR-0007 §2.10 establishes interactive review modes (Mode (a)/(b)/(c)) instead of an automated reviewer-bot, so `agent-review.yml` and `cost-ledger.yml` (§3.3) are not present in the repo (`agents-config.json` (§3.5) remains as a stub from earlier scaffolding and is unused while §3.2 stays dormant). The sketches below are kept as the starting point if a future ADR reinstates an automated reviewer.

Sketch (kept here as reference design only — no longer anchored in ADR-0007 after the §2 restructure that removed automated reviewer-bot from Phase 0):

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
          # This is critical: branch protection requires `agent-review` passing. If we exited non-zero
          # when the kill switch is off, all PRs would be blocked and the kill switch would become a brick.
```

**Status check name = `agent-review`** (matches `workflow.name`). Branch protection requires passing — the workflow always exits 0 when the kill switch is off (success), or with the exit code of reviewer-agent run.ts (which itself returns 0 even if it found findings; `[BLOCKING]` markers appear in comments, not in the exit code — the human-merge gate decides).

### 3.3 `.github/workflows/cost-ledger.yml`

Per ADR-0007 §2.10. Sketch:

```yaml
name: cost-ledger

on:
  schedule:
    - cron: "0 9 * * 1" # every Monday 09:00 UTC = 12:00 MSK
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
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }} # only if apps are published to a registry; otherwise omit
```

In Phase 0 no package is published (`access: restricted`), `changesets/action` will open a "Version Packages" PR without a publish step. This is fine — the PR shows what would change, Tech Lead merges it for versioning + changelog updates.

### 3.5 `.github/agents-config.json`

```json
{
  "agents_enabled": true,
  "cross_vendor_review_required": true,
  "reviewer_vendor_default": "openai",
  "soft_cost_cap_weekly_usd": 50
}
```

Read by `agent-review.yml` (kill switch) and `cost-ledger-sync.ts`. Default `reviewer_vendor_default = openai` per ADR-0007 §Negative (Claude primary author → OpenAI reviewer).

### 3.6 `.github/CODEOWNERS`

```
# Phase 0 — single owner, all paths
*    @sidorovanthon
```

Phase 1 trigger (hire #2): replace with per-path patterns + GitHub Teams.

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

**EARS reference:** EARS-N (link to `NNN-requirements.md` line)

**Acceptance criteria:**

- [ ] ...

**Notes:**

<!-- context, blockers, related Issues -->
```

`bug.md` and `chore.md` — similarly short templates.

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

No per-directory npm sub-configs are configured — pnpm-monorepo single root install handles everything.

---

## 4. Branch protection + repo settings — concrete `gh api` calls

Per ADR-0008 §2.6, step 21. Admin runs §4.1 once. **§4.2 is target-state**, not currently applied: GitHub Free + private repo blocks the branch-protection API (HTTP 403 from both the legacy endpoint and the rulesets API). The payload below is committed verbatim to `branch-protection.json` at repo root as documentation; it is applied via `gh api` only when any reactivation trigger in ADR-0008 §2.6 fires. Required status checks contain `ci` only (single meta-job from §3.1); there is no automated reviewer-bot in Phase 0 (ADR-0007 §2.10 dropped that flow).

**4.1 Repository settings — enforce squash-only:**

```bash
gh api \
  --method PATCH \
  -H "Accept: application/vnd.github+json" \
  /repos/doctor-school/ds-platform \
  -F allow_squash_merge=true \
  -F allow_rebase_merge=false \
  -F allow_merge_commit=false \
  -F delete_branch_on_merge=true \
  -F squash_merge_commit_title=PR_TITLE \
  -F squash_merge_commit_message=PR_BODY
```

Without disabling `allow_rebase_merge` + `allow_merge_commit` any contributor can choose rebase-merge or merge-commit, which breaks changesets parsing (changesets expects one squashed commit per PR) and AI-agent reasoning about history.

**4.2 Branch protection rule:**

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/doctor-school/ds-platform/branches/main/protection \
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

`required_linear_history=true` enforces squash or rebase merge (matches §2.4 squash-only).

`require_code_owner_reviews=false` Phase 0 — CODEOWNERS = one line `* @sidorovanthon`, and Tech Lead is typically the PR author; enabling the rule would create recursion ("you cannot approve your own PR"). Phase 1 (hire #2) — switch to `true`.

`required_conversation_resolution=true` — all reviewer-bot PR comments must be resolved before merge.

---

## 5. AGENTS.md / CLAUDE.md sections for ds-platform

Beyond the baseline from ADR-0006/0007, add a repository conventions section:

### 5.1 AGENTS.md "Repository conventions" section (skeleton)

```markdown
## Repository conventions

**Monorepo:** pnpm 10 workspaces + Turborepo. Root commands run via `pnpm <script>`; per-package via `pnpm --filter <name> <script>`.

**Apps live in `apps/<name>/`**: api (NestJS backend), promo, portal, admin, cms, docs, mobile. Shared code in `packages/<name>/`. Build/dev tooling in `tools/`.

**Branch strategy:** trunk-based. New work goes into `feat/DSO-NN-<slug>` or `fix/<N>-<slug>` short-lived branches. Squash-merge into main; branch deleted automatically.

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Light convention — squash-merge title is enforced via PR title, not commit-message linter.

**Versioning:** changesets. Any user-facing PR → add a changeset via `pnpm changeset` (interactive). Bug fixes = patch, new features = minor, breaking = major. Internal-only PR (refactor, docs, chore) — no changeset.

**Pre-commit:** simple-git-hooks runs lint-staged on staged files (ESLint --fix + Prettier). If the hook breaks a commit unexpectedly — `git commit --no-verify` is a valid escape hatch, but log the reason in the PR description.

**PR template is required** — set the correct label (feature/bug/chore/refactor/docs), link the Issue (`Closes #N`), mark the author (claude/codex/human) for reviewer-bot vendor detection.

**Branch protection:** main is protected. A PR requires: passing `ci` + `agent-review` status checks, ≥1 human approval, conversation resolved, branch up-to-date, linear history, no force push.

**ADRs live in `apps/docs/content/adr/`**, rendered by Fumadocs at `/adr/<slug>`. Paired design spec — `NNNN-<slug>-design.md` alongside.

**Feature specs live in `apps/docs/content/specs/features/NNN-<slug>/`** (3 files: `NNN-requirements.md`, `NNN-design.md`, `NNN-scenarios.feature`). One spec → one GitHub Milestone → multiple Issues per EARS-handler.
```

### 5.2 CLAUDE.md "Repository conventions" overlay (Claude Code-specific)

```markdown
## Repository conventions (Claude Code overlay)

[inherit AGENTS.md "Repository conventions" — listed above]

**SessionStart hook** in `.claude/settings.json`:
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

Bootstrap output (≤2 KB live state snapshot) is automatically placed in `additionalContext` for every fresh session. No need to manually read git log / gh issue list — bootstrap provides everything.

**Tool priority in ds-platform repo:**

1. `gh` CLI — for GitHub Issues, PRs, releases (primary, AI-friendly via JSON output)
2. MCP `mcp__plugin_github_github__*` — only for read-tasks not covered by `gh` (rare)
3. `pp-plane` CLI — for cross-tracker references (when referencing Plane DSO-XXX from ADR/spec). Not for code-level Issues.

**Plane vs GitHub Issues split** (ADR-0006 §9):

- DS Platform code-level Issues → GitHub Issues in this repo (`gh issue ...`)
- Strategic Issues, cross-team milestones → Plane workspace `doctor-school`

**Do not invoke `pp-plane` CLI for code tasks** — this would create duplicate sources.
```

---

## 6. README.md (ds-platform root)

Skeleton, specific contents filled in at step 15:

```markdown
# DS Platform

Doctor.School medical-education platform (B2B sponsor → B2D doctor).

## Status

Phase 0 (greenfield, brainstorm complete). Pre-pilot target: 2026 Q3 (TBD).

## Stack

- **Backend:** NestJS + Zod + REST + openapi-typescript (ADR-0002); `apps/api/`
- **Data:** Postgres 17 + Drizzle + pgvector (ADR-0003); schemas in `packages/db/`, migrations in `apps/api/drizzle/`
- **Frontend:** Next.js 15 + Refine; 4 apps — `apps/promo/`, `apps/portal/`, `apps/admin/`, `apps/cms/` (Payload v3 content-only) (ADR-0004)
- **Mobile:** React Native + Expo + WatermelonDB (ADR-0005); `apps/mobile/`
- **Docs:** Fumadocs (`apps/docs/`) + Keystatic editor (`apps/docs-cms/`) + glossary.yaml in `apps/docs/content/product/glossary/` (ADR-0006)
- **AI dev loop:** Claude Code + Codex async + reviewer-bot (ADR-0007)
- **Repo:** pnpm workspaces + Turborepo + changesets + GitHub-hosted CI (ADR-0008)
- **Identity:** Zitadel (ADR-0001 §8, closed per DSP-209) + Cerbos RBAC (ADR-0003 §5)

Full reference: `apps/docs/content/adr/`.

Runtime/operational tooling (Coolify preview, Caddy, GlitchTip, Loki, Vault, Unleash): see [engineering-readiness spec](apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md).

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

See AGENTS.md (universal constitution) and CLAUDE.md (Claude Code overlay).

## Owners

@sidorovanthon (Phase 0 single owner; CODEOWNERS splits at hire #2).
```

---

## 7. Open follow-ups (references to ADR-0008 §5)

All open questions (OQ-R1..R12) are listed in ADR-0008 §5 with triggers. This spec details them only when a trigger fires — without premature speculation.

Concrete workflow when a trigger fires (any of OQ-R1..R12):

1. Tech Lead or the AI agent notices the condition (CI minutes exhausted, hire #2, blocked PR due to GitHub down)
2. A new Plane work-item is opened with a description of the trigger
3. A brainstorm is started (superpowers:brainstorming) → new ADR (ADR-0009+) → companion design spec
4. Implementation steps — children work-items

---

## 8. Cross-refs

- **ADR-0001** §8 — IdP = Zitadel (closed per §8 / DSP-209): when team SSO for GitHub Enterprise plan appears — reuse the same tenant, not a separate one.
- **ADR-0002** §6 — `apps/api/` implements NestJS + BullMQ.
- **ADR-0002** §3-5 — `packages/schemas/` (Zod SSOT) + `packages/api-client/` (openapi-typescript generated SDK).
- **ADR-0003** §4 — Drizzle TS schemas in `packages/db/schema/` + drizzle-kit SQL diff migrations in `apps/api/drizzle/`; §7 — pgvector in the same Postgres.
- **ADR-0004** §2 — 4 frontend Next.js apps (`apps/promo/`, `apps/portal/`, `apps/admin/`, `apps/cms/`).
- **ADR-0004** §7 — Payload v3 in `apps/cms/` (content-only, `cms.*` schema namespace shared Postgres).
- **ADR-0004** §13 — `packages/eslint-config/` exports the `no-vercel-only-api` rule.
- **ADR-0005** — `apps/mobile/` — Expo SDK 53, separate build/release pipeline (Expo EAS).
- **ADR-0006** §1, §2, §3, §6, §7, §9, §10 — doc topology, Fumadocs, Keystatic, glossary, drift guards, task-tracker split: materialised in layout §2.3 + tooling §3.
- **ADR-0007** §2.4 (8-step cycle), §2.5 (bootstrap), §2.6 (drift guards), §2.8 (reviewer-bot), §2.10 (cost-ledger), §2.11 (autonomy + kill switch); **AI-stack design spec §11** (14-step migration plan): this ADR-0008 + spec — operational ground for §11 migration steps.
- **Engineering-readiness spec** (`../specs/tech/2026-05-12-engineering-readiness-design-en.md`) — runtime tooling defaults: Caddy/Traefik, Coolify, GlitchTip, Loki+Prometheus+Tempo, Vault, Unleash, Beget DNS. Referenced from `README.md` § Runtime tooling. Not duplicated in ADR-0008.

---

## 9. Source

- Brainstorm session 2026-05-15 with Tech Lead (superpowers:brainstorming)
- Inherited decisions: ADR-0001..0007 (DSO-25..30 + DSO-60)
- Plane DSO-31 ticket scope (open decisions + scope-notes)
- Current ds-platform repo context: `doctor-school/ds-platform`
