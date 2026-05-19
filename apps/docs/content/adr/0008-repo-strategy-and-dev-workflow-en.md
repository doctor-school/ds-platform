> **EN (this)** · **RU:** [`0008-repo-strategy-and-dev-workflow-ru.md`](./0008-repo-strategy-and-dev-workflow-ru.md)

# ADR-0008 — DS Platform Repository Strategy + Dev Workflow

**Date:** 2026-05-15 (last amended 2026-05-18 — Amendment A1, see §7)
**Status:** Accepted (+ Amendment A1 — org boundary correction + dev-stand infra location)
**Related to:** Plane DSO-31 (`fae57ab6-f09b-4a4d-9ede-9a4f1ca504c0`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0008-repo-strategy-and-dev-workflow-design-en.md`
**Inherits:** ADR-0001 (Authentik/Zitadel), ADR-0002 (NestJS+BullMQ), ADR-0003 (Postgres17+Drizzle), ADR-0004 (Next.js 15+Refine), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs+Keystatic+GitHub Issues), ADR-0007 (AI loop + cross-vendor reviewer + 14-step migration)

---

## 1. Context

DSO-25..30 + DSO-60 locked down the DS Platform technology stack, development methodology, and task-tracking split (Plane strategic / GitHub Issues code). What remained unresolved — the operational layer between "decisions" and "the first line of code":

- **Where** the code lives (new repo? in the existing `bbm`?), under which owner, within what boundaries
- **Structure** of the monorepo down to specific folders and manifest files (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- **Release tooling** — how apps/packages are versioned and published (changesets vs release-please vs conventional-only)
- **Pre-commit + branch protection policy** — concrete rules for the main branch and local hooks
- **CI topology** — runner choice, pipeline shape, which jobs are blocking
- **CODEOWNERS bootstrap** — who is responsible for what in Phase 0 (team-of-1+AI)
- **Node/pnpm versions** — pin strategy so that the AI agent and the human see the same environment
- **Migration of ADRs/specs from `bbm`** — into the new platform repo, so AI agents can read them in-workspace without cross-repo fetch

AI-stack design spec §11 already listed 14 steps of AI-loop tooling (bootstrap, reviewer-agent, cost-ledger, lint guards, agents-config kill switch, branch protection). Those steps remain authoritative; ADR-0008 frames them: it creates the repo skeleton inside which the §11 steps are executable.

**Hard requirements:**

- Every decision must be AI-agent-friendly: a new agent in a fresh session must be able to orient itself via bootstrap (ADR-0007 §2.5) + reading AGENTS.md/CLAUDE.md/ADRs from the workspace, without a MCP-fetch proxy.
- Phase 0 minimum moving parts: nothing that does not block the first feature-spec is introduced.
- Federal Law 152-FZ: code may live on GitHub.com (no personal data (PD) in source). Trigger to revisit — political decision or blocking of GitHub.com from the Russian Federation (RF); then mirror to Gitea/Forgejo on Timeweb; already discussed in ADR-0006 §Consequences.
- [[feedback_tech_stack_criteria_no_team_skill]]: tooling choices are not argued with "the team knows this / prototypes". Criteria — mainstream 2026, integration with the already-accepted stack, low ops overhead for team-of-1+AI.

---

## 2. Decision

### 2.1 Repo identity and owner

- **GitHub repository:** `bbm-academy-dev/ds-platform`, private until Pre-pilot launch. _[Amendment A1.1 (2026-05-18): transferred to `doctor-school/ds-platform` — see §7.]_
- **GitHub organization:** `bbm-academy-dev` (created 2026-05-15 by Tech Lead; the `bbm` repo is transferred to the same org as Phase 0 housekeeping). _[Amendment A1.1 (2026-05-18): `bbm-academy-dev` turned out to be a personal account, not an org. Current DS Platform org is `doctor-school` (created 2026-05-18). See §7.]_
- **Visibility decision Phase 1+:** keeping private vs source-available — a separate ADR when Pre-pilot is reached or a community scenario arises.
- **Relationship with `bbm` repo:** both in the same org, no submodule. `bbm` remains the strategy/holding workspace (PRD, business models, Plane tooling, transcripts). `ds-platform` — application code + platform docs.

### 2.2 Monorepo build orchestrator + package manager

- **pnpm 10.x** (workspaces) — inherited ADR-0006 §2.
- **Turborepo** — inherited ADR-0006 §2; root `turbo.json` manages the build/lint/test pipeline + remote cache (cache server — decision deferred until "local cache is insufficient", Phase 1+).
- **`packageManager` field** in root `package.json` (`pnpm@10.x`) — corepack auto-fetch, no global install needed.
- **`engines`** requires `node >= 22 < 23` (LTS Iron) + `pnpm >= 10`; `.npmrc` `engine-strict=true` blocks install on mismatch.
- **Node version pin:** `.nvmrc` with `22` + `packageManager` — two sources, both automatically honored by different tools (nvm/fnm/Volta/mise/corepack), no required client-side tool.

### 2.3 Top-level layout

Layout is inherited from ADR-0006 §10 unchanged + adds files from AI-stack design spec §11 + DSO-31 root-manifest files:

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
│   │       ├── adr/             # ADR-0001..NNNN + paired design specs
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
│   ├── docs-cms/                # Keystatic editor (ADR-0006 §3, SEPARATE Next.js app)
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
│   └── llm-utils/               # buildContext.ts etc. (ADR-0007 §2.5)
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

**The authoritative source for the layout is ADR-0006 §10.** ADR-0008 does not rename anything; it only adds root-level manifest files and the `.github/` skeleton. The discrepancy between ADR-0003 §4 (original location: `apps/api/src/db/schema/`) and ADR-0006 §1 SSOT-row (master in `packages/db/schema/`) is resolved by ADR-0003 Amendment A1: the canonical master is `packages/db/schema/`, ADR-0006 §1 SSOT-row prevails; `packages/db/` enables read-only consumers (`apps/admin`, `apps/cms`) to reference ImageRecord schema without cross-app imports. `apps/api/drizzle/` (migrations) remains unchanged per ADR-0003 §4.

**No top-level `docs/`** — all documentation is rendered by Fumadocs from `apps/docs/content/`. This preserves a single SSOT for rendering and aligns with the ADR-0006 §1, §10 topology.

**No `services/` or `infrastructure/`** at the start — backend = `apps/api/`; deployment configs (docker-compose, Coolify manifest, Caddy/Traefik) live in a separate `bbm-infra` repo (created later) or temporarily in `bbm/infra/` as today. ds-platform = pure application code.

**ADRs live in `apps/docs/content/adr/`** (rendered by Fumadocs as a section); paired design specs are placed alongside each with the same numeric prefix (`0008-repo-strategy-and-dev-workflow-en.md` + `0008-repo-strategy-and-dev-workflow-design-en.md`). This unifies the pattern with ADR-0007's split into ADR + spec.

### 2.4 Release tooling

- **changesets** (`@changesets/cli` + `@changesets/changelog-github`).
- Supports independent versioning per package (ADR-0006 multi-app), integrates with GitHub Actions via the official `changesets/action`, conventional-commits-agnostic (changeset = explicit dev intent), opt-in: a PR without a changeset = warning, not a block (BLOCK configurable per-app later).
- **Conventional Commits** — light convention for changeset summary autogen (`fix:`, `feat:`, `chore:`), not enforced in pre-commit. If a developer breaks the convention, the changeset summary is fixed manually.
- **PR merge style:** squash-only. Clean history; changesets can read squashed commits.

### 2.5 Pre-commit hooks

- **simple-git-hooks + lint-staged** (pinned versions in root `package.json`).
- Hooks Phase 0:
- `pre-commit`: `lint-staged` (ESLint --fix + Prettier on staged files)
- `commit-msg`: (optional v2) commit-message lint for conventional-commits
- Installed via `pnpm install` postinstall script (simple-git-hooks self-registers).
- **Not Husky.** The Husky author deprecated his own package 2024-09 in favour of simple-git-hooks; continuing with Husky = tech debt from day one.
- **Not lefthook.** A Go binary as a dependency — friction for AI agents in varied environments (especially CI containers without a Go runtime).

### 2.6 Branch strategy + protection

- **Trunk-based:** `main` — the only long-lived branch. Feature branches `feat/DSO-NN-<slug>` or `fix/<issue-N>-<slug>` are short-lived, merged by squash, and deleted after merge.
- **Repository settings** (separate from branch protection, via `gh api /repos/{owner}/{repo}`):
- `allow_squash_merge: true`
- `allow_rebase_merge: false`
- `allow_merge_commit: false`
- `delete_branch_on_merge: true`
  Without this, `required_linear_history` below does not enforce squash-only — rebase merge also gives linear history and breaks changesets parsing.

- **Branch protection rule on `main`** (admin-applied via GitHub UI or `gh api`, see AI-stack design spec §11 step 13):

1.  Require pull request before merging
2.  Require ≥1 approving review (`required_approving_review_count: 1`)
3.  Dismiss stale reviews on new commits
4.  Require status check `ci` — passing
5.  Require status check `agent-review` — passing (ADR-0007 §2.8)
6.  Require branches up-to-date before merging
7.  Require linear history (squash-only when only squash merge is enabled)
8.  Include administrators (Tech Lead cannot bypass himself)
9.  No force pushes
10. No deletions
11. Require conversation resolution before merge

- **`agents-config.json` kill switch** (ADR-0007 §2.11) lives in `.github/agents-config.json`, changed via a regular PR + human merge.

### 2.7 CODEOWNERS

Phase 0 (team-of-1+AI):

```
# .github/CODEOWNERS
*    @sidorovanthon
```

Trigger to split: first engineer hired. At that point CODEOWNERS is split per `apps/<name>/` and `packages/<name>/`, owners are bound to GitHub Teams (when there are ≥3 people). Until then, all PRs are reviewed by Tech Lead + reviewer-bot.

### 2.8 CI topology

- **GitHub-hosted `ubuntu-latest` runner only** in Phase 0. Free 2000 min/month for private repo (Team plan +5000) covers ~30 min/day at 1–2 PR/day.
- **Pipeline `.github/workflows/ci.yml`** — full drift detection stack per ADR-0006 §7 + AI-specific guards per ADR-0007 §2.6. Jobs run as parallel GitHub Actions jobs where possible; a meta-job `ci` depends on all required jobs and sets a single status check.

| Job                     | What it does                                                                    | Source        | Severity           |
| ----------------------- | ------------------------------------------------------------------------------- | ------------- | ------------------ |
| `setup`                 | `pnpm install --frozen-lockfile`, cache `~/.pnpm-store`                         | —             | required           |
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
| `tdd-signal`            | implementation commit without test-file (heuristic)                             | ADR-0007 §2.6 | WARN v1            |
| `spec-status-fresh`     | merged feature-PR with spec.status=Draft                                        | ADR-0007 §2.6 | WARN v1            |
| `prior-decisions-cited` | new spec without ADR-link when category ≠ docs-only                             | ADR-0007 §2.6 | WARN v1            |

- **`agent-review.yml`** — separate workflow per ADR-0007 §2.8, sets status check `agent-review`.
- **`cost-ledger.yml`** — weekly cron per ADR-0007 §2.10.
- **`release.yml`** — changesets action runs on push to `main`, opens a "Version Packages" PR or publishes if the PR is already merged.
- **Trigger to self-hosted runner (Timeweb):** (a) 2000-min cloud limit exhausted for two consecutive months, (b) a CI job needs access to the RF-private network (deploy to staging). Until either trigger — cloud-only.

### 2.9 Dependabot + supply chain

- `.github/dependabot.yml`:
- `npm` ecosystem, root + workspace packages, weekly schedule (Monday 03:00 UTC)
- `github-actions` ecosystem, weekly
- Group minor + patch updates into one PR per package-type (reduces noise)
- Auto-merge via reviewer-bot + human (Phase 2 autonomy, ADR-0007 §2.11).
- SBOM generation (Syft) — engineering-readiness spec §1 Pre-pilot, implemented in a follow-up; not present in Phase 0 CI (deferred trigger: first prod build).
- Container signing (cosign) — same, deferred trigger.
- **Dependency freshness baseline (DSO-63 mini-G):** at repo bootstrap (step 19) — dependency freshness pass, pin exact versions in the lockfile (`pnpm-lock.yaml`). **Recurring task in Plane:** quarterly dependency review (Dependabot + manual audit for major bumps + security advisory review). Proactive cadence, not reactive fix-on-bump.

### 2.10 Migration plan (steps to execute after accepting ADR-0008)

Pre-DSO-31 admin (Tech Lead, ≤10 minutes, manual):

- **0a.** Create GitHub org `bbm-academy-dev` ✅ done 2026-05-15. _[Amendment A1.1 (2026-05-18): a personal account was registered, not an org. The real org `doctor-school` was created 2026-05-18 ✅.]_
- **0b.** Create empty private repo `bbm-academy-dev/ds-platform` ✅ done 2026-05-15. _[Amendment A1.1 (2026-05-18): repo transferred → `doctor-school/ds-platform` ✅ 2026-05-18. URL: https://github.com/doctor-school/ds-platform. GitHub auto-redirect from the old path works.]_
- **0c.** (Phase 0 housekeeping, does not block) Transfer `sidorovanthon/bbm` → `bbm-academy-dev/bbm`. URL redirect remains; CLAUDE.md/links do not break.

Phase 0 implementation steps — extends AI-stack design spec §11. Steps 1–14 from AI-stack design spec §11 unchanged. Additional steps (DSO-32 children or new work-item):

| Step | Action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Output                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 15   | Initialise root `package.json` + `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json` + `.changeset/config.json` + `.editorconfig` + `.gitignore` + `.gitattributes` + `.npmrc` + `.nvmrc`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | repo bootstraps locally                      |
| 16a  | Create `.github/` minimal skeleton: `workflows/{ci,cost-ledger,release}.yml`, `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{feature,bug,chore}.md`, `dependabot.yml`, `agents-config.json`. CI references only tools that already exist (steps 1–8 AI-stack design spec §11) or skips gracefully                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | CI runs on first push without `agent-review` |
| 16b  | After AI-stack design spec §11 steps 4–5 (`packages/llm-utils/buildContext.ts` + `tools/reviewer-agent/`) — add `.github/workflows/agent-review.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | reviewer-bot activates                       |
| 17   | Install `simple-git-hooks` + `lint-staged` in root `package.json` + `simple-git-hooks` config section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | pre-commit works                             |
| 18   | **Move + rename + rewrite-refs** ADR/spec files from `bbm` into `ds-platform` (cross-repo — not `git mv`, but cp + `git rm`; see design spec §5 for exact commands). Atomically: <br/>**(a) Move ADRs:** `bbm/docs/adr/0001..0008-*.md` → `ds-platform/apps/docs/content/adr/0001..0008-*.md` (filename unchanged). <br/>**(b) Move + rename paired specs:** `bbm/docs/superpowers/specs/2026-05-1*-ds-platform-*-design.md` → `ds-platform/apps/docs/content/adr/NNNN-<slug>-design.md`, where `NNNN-<slug>` matches the name of the paired ADR (`0001-identity-provider-shortlist` → `0001-identity-provider-shortlist-design.md`). This unifies the pattern: ADR and spec reside side by side with the same numeric prefix, Fumadocs renders them as one group. <br/>**(c) Batch rewrite cross-refs:** before committing step 18, run `rg` across both repos and replace in ALL files: (i) `docs/adr/NNNN-*.md` → `apps/docs/content/adr/NNNN-*.md`; (ii) `docs/superpowers/specs/2026-05-1*-ds-platform-*-design.md` → `apps/docs/content/adr/NNNN-<slug>-design.md` (per pairing); (iii) ADR frontmatter of all 0001..0007 (`Design spec:` line) — update to the new path; (iv) AI-stack design spec globs `apps/docs/content/adr/${num}-*.md` (§297, §716, §721) → `apps/docs/content/adr/${num}-*.md`. <br/>**(d) Leave redirect:** in `bbm/docs/adr/` leave a `README.md` one-liner with the ds-platform URL. <br/>**Non-platform specs** (Plane migration, Linear migration, infra-cost, etc.) stay in `bbm/docs/superpowers/specs/` — these are BBM-level process artifacts. <br/>**Post-state verification:** `rg 'docs/adr/' ds-platform/` and `rg 'docs/superpowers/specs/.*ds-platform.*-design' ds-platform/` — both must return 0 hits (except the redirect README). |
| 19   | Initialise empty workspace stubs: `apps/{api,promo,portal,admin,cms,docs,docs-cms,mobile}/` + `packages/{schemas,api-client,db,glossary,hooks,design-system,observability,utils,eslint-config,tsconfig,llm-utils}/` + `tools/reviewer-agent/`, each with a minimal `package.json` (`name: @ds/<name>`, `version: 0.0.0`, `private: true`) + optional per-package `turbo.json` for script-stub map                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | workspace discoverable                       |
| 20   | After step 18 — initialise `apps/docs/` as a Fumadocs Next.js app (see ADR-0006 §2). Moved ADRs are already in place in `content/adr/`. Initialise `apps/docs-cms/` as a Keystatic Next.js app (ADR-0006 §3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | doc portal builds                            |
| 21   | **[Manual, admin]** Apply repository settings (`allow_squash_merge=true`, `allow_rebase_merge=false`, `allow_merge_commit=false`) + branch protection rule per §2.6 via `gh api`. See design spec §4 for exact commands                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | merge gated, squash-only enforced            |
| 22   | Smoke test: create the first feature-spec (`NNN-onboarding` or similar) and run the 8-step cycle ADR-0007 §2.4 end-to-end                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | proof of concept                             |

Dependency graph: 15 → 16a → 17 → 19 parallel with 15. 18 sequential (sensitive). 20 depends on 18. 16b depends on AI-stack design spec §11 step 5. 21 depends on 16a (branch protection requires an existing CI workflow). 22 depends on everything.

Step 18 — sensitive move (losing an artifact = bad), performed by Tech Lead manually with a per-file check. Step 21 — admin-only. Step 22 — joint Tech Lead+AI.

**Estimate:** Steps 1–22 — Sprint 3 (after Pre-pilot kickoff, ~2026-06-09 start per Plane). Until then, ADR-0008 + design spec remain documents; nothing physically happens in the `ds-platform` repo.

**Step 18 notes (DSO-63 mini-J/K, 2026-05-18):**

- **mini-J — verification script (deferred until the move):** when step 18 actually runs — add a one-time `tools/adr-move-verify.ts` (rg checks for old paths + Fumadocs `apps/docs` build before/after). Not built now (ADR move has not happened); added in the same PR as the move itself.
- **mini-K — history loss accepted:** the cross-repo move of ADRs from `bbm` to `ds-platform` does not preserve git history (cp + `git rm`; `git filter-repo` / subtree merge is overkill for ~16 files). The ADR decision history is accessible via blame in the original `bbm/docs/adr/` (read-only after the move) and via the ADR content itself (decisions, rationale, dates in frontmatter and amendments). AI agents read current state, not git log.

---

### 2.11 Accepted risks (DSO-63 mini-#14, 2026-05-18)

**GitHub vendor risk.** GitHub is accepted as the single hub (repo + CI + issues + reviewer-bot trigger + cost-ledger PR target + agent bootstrap source). Mirror / continuity infrastructure (self-hosted Gitea/GitLab + scheduled mirror) is **not built in pre-pilot** on YAGNI grounds.

**Mitigation surface for the accepted risk:**

- Local git-history clones with every developer (full history available even during a GitHub blackout).
- Plane as the source of truth for tasks (issues — secondary store).
- `.github/` workflows + configs — in repo (re-setup on a new CI ≤1 day of developer time).

**Revisit triggers (when we build mirror / continuity infra):**

- The team grows beyond 10 people (`Tech Lead + 9` — increased blast radius on outage).
- A real GitHub outage >24h OR blocked-access events.
- A legal / sanctions event threatening GitHub access from RF.
- Any of these triggers → mini-ADR justifying mirror infrastructure (Gitea / GitLab self-hosted on Timeweb, scheduled mirror, issue export).

**Cross-zone egress treatment:** GitHub is an approved channel per ADR-0011 §2.2 (channels #2, #3) with a mandatory PII scanner pre-commit + audit-egress-channels CI gate. What lands in GitHub is governed not by GitHub vendor risk, but by the egress control plane.

---

## 3. Consequences

### Positive

- **Single SSOT for platform documentation** — ADR/specs/glossary/runbooks all in `apps/docs/content/`, rendered by Fumadocs uniformly. An AI agent in ds-platform reads them via relative path without cross-repo fetch.
- **Clean `bbm` ↔ `ds-platform` boundary** — strategy/holding in one, application code in the other. Cognitive load decreases: opening either repo makes its purpose immediately clear.
- **Mainstream defaults Phase 0** — pnpm+Turborepo+changesets+simple-git-hooks — a stack that any TypeScript engineer in 2026 reads without additional learning. AI agents (Claude/Codex) are trained on these patterns.
- **Minimum moving parts at the start** — no Vault/feature-flags/cache-server/self-hosted runner in Phase 0. Each is added via an explicit trigger documented either here or in the engineering-readiness spec.
- **Branch protection enabled before the first merge** — no Phase 0 window without guards.
- **Migration plan cleanly delegated**: ADR-0008 fixes "what and why"; the `ds-platform` repo is physically created in Sprint 3 as implementation work. Nothing currently blocks continuing PRD/strategy work in `bbm`.

### Negative

- **Duplicate ADRs in two repos temporarily** — between the move (step 18) and cleanup in `bbm` there is a short period when ADR-0001..0008 exist in both. Mitigation: step 18 includes deleting the originals in `bbm` (via `git mv` or explicit `rm`), not "copy".
- **`apps/docs/` as a Next.js app — heavier than a static markdown render**. Fumadocs build takes ~30s, recalculated on every ADR edit. Trade-off already accepted in ADR-0006 (single toolchain). Mitigation: Turborepo cache.
- **Free CI minutes — a bottleneck**. 2000 min/month for private repo Team plan = 5000. At 5+ PR/day toward the end of Pre-pilot, this limit may be hit. Mitigation: trigger to self-hosted runner (§2.8); or upgrade to GitHub Team ($4/user/month).
- **`bbm-academy-dev` org name with the `-dev` suffix** — fixed as of 2026-05-15; renaming later is possible but creates a redirect/breakage window. Acceptable: the name is not user-facing (repos are private).
- **CODEOWNERS = one line with `@sidorovanthon`** — formally works, but GitHub UI displays "one owner for everything" as a single point of failure. Mitigation: this is explicitly known; Phase 1 split is documented as a trigger.
- **No `bbm` transfer to `bbm-academy-dev` org required** for DSO-31, but **recommended as housekeeping** — see step 0c. If deferred, `bbm` stays in `sidorovanthon/bbm` indefinitely; README links do not break.

### Risks

- **GitHub.com blocking from RF** — gradual scenario (rate limits on Russian IPs, or full blocking). Mitigation: mirror `ds-platform` to self-hosted Gitea/Forgejo on Timeweb as a read-only failover. Trigger: first sustained GitHub.com unavailability from RF > 24h. A trigger-ADR will describe the sync mechanism.
- **changesets versioning conflict with independent releases of multiple apps** — two PRs simultaneously change one package + update a changeset → merge conflict in `.changeset/`. Mitigation: changesets handles this (changeset files have random hash names, do not conflict between PRs); merge conflict only in `CHANGELOG.md` and `package.json`, resolved via a normal rebase.
- **Pre-commit hooks break `git commit` for the AI agent** if the environment is not prepared — Vitest crashed or ESLint config broken. Mitigation: hooks only run lint-staged (fast), do not run tests; `git commit --no-verify` remains a valid escape hatch for the AI agent (documented in AGENTS.md, but with a warning "bypass was used").
- **Step 18 move breaks links** from other markdown files to `docs/adr/0001-*.md` (e.g., in CLAUDE.md, in processed/summaries, in outputs). Mitigation: run grep before step 18, replace all `docs/adr/` occurrences with absolute links `https://github.com/bbm-academy-dev/ds-platform/blob/main/apps/docs/content/adr/...` OR leave redirect-stubs in `bbm/docs/adr/0001-*.md` with a single line `→ moved to ds-platform/apps/docs/content/adr/0001-*.md`.

---

## 4. Alternatives considered (rejected or deferred)

| Alternative                                                               | Reason rejected/deferred                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS Platform code in the existing `bbm` repo** (monorepo for everything) | Mixed strategy/code workspace = weak boundary for an AI agent; bbm must remain holding-level (PRD, business models, Plane). Cognitive bleed between strategy and implementation. Rejected.                                          |
| **Polyrepo** (one repo per app: ds-portal, ds-api, ds-admin)              | Duplicates tooling in each (ESLint, TS config, CI yaml), loses Turborepo cross-package cache, atomic refactors across ≥2 apps require orchestration. Phase 0 size does not justify the overhead. Rejected.                          |
| **Hybrid: backend polyrepo, frontend monorepo**                           | Backend = one NestJS app (ADR-0002), no need for polyrepo. Rejected.                                                                                                                                                                |
| **Self-host Git (Gitea/Forgejo) from the start**                          | Premature ops overhead: VPS + admin + backup + DNS + SSO with Authentik (which is itself not yet deployed). GitHub.com covers Phase 0 use cases without ops cost. Trigger for mirror (see Risks): first blocking. Deferred.         |
| **Personal account as owner** (`sidorovanthon/ds-platform`)               | Personal-account-as-team anti-pattern: transfer to an org later breaks PR/Issue cross-refs (though redirect works), CODEOWNERS without teams = list of usernames. Rejected.                                                         |
| **changesets in favour of release-please** (Google project)               | release-please is more tightly coupled to conventional-commits (no opt-out); requires `release-please-action` which evolves more slowly. changesets — incumbent for pnpm-monorepos 2026. Deferred (can migrate later without loss). |
| **changesets in favour of semantic-release**                              | semantic-release uses one version per repo, does not fit multi-app independent versioning. Rejected.                                                                                                                                |
| **conventional-commits-only (no changesets)**                             | Does not support intentful version bumps (e.g., "this fix is also breaking on app-X but not on app-Y"); changeset = explicit dev statement. Rejected.                                                                               |
| **Husky for pre-commit**                                                  | Deprecated by its own author (typicode) 2024-09 in favour of simple-git-hooks. Using it = adding tech debt from day one. Rejected.                                                                                                  |
| **lefthook for pre-commit**                                               | Go binary as a dependency: AI agents run in varied CI containers (Vercel, GitHub Actions, locally) without a Go runtime. Friction. Rejected.                                                                                        |
| **GitLab CI instead of GitHub Actions**                                   | Mismatch with the already-chosen GitHub Issues (ADR-0006 §9): cross-repo refs, PR-issue auto-close, agent-review via `gh` CLI — all built on GitHub. Rejected.                                                                      |
| **Self-hosted Forgejo Actions / Drone / Woodpecker**                      | Ops overhead in Phase 0 without value (see §2.8). Deferred trigger.                                                                                                                                                                 |
| **GitFlow** (develop + main + release branches)                           | Tooling weight for team-of-1+AI; squash-merge to main + short-lived feature branches covers all use cases. Rejected.                                                                                                                |
| **Allow merge commits + rebase merge**                                    | Mixed merge styles break changesets parsing and AI-agent reasoning about history. Rejected.                                                                                                                                         |
| **Optional CODEOWNERS**                                                   | Without CODEOWNERS there is no automatic PR-reviewer assignment; the reviewer-bot does not know whom to ping (although the bot is non-human). Start with a minimal `* @sidorovanthon` so the file exists. Accepted (see §2.7).      |
| **GitHub Teams plan ($4/user/mo) from the start**                         | $4/month × 1 user = $4/month, not a cost issue, but bringing it up without need. Free plan covers private repo + CI 2000 min. Trigger to upgrade: CI limit exhausted or > 3 collaborators who need Teams for CODEOWNERS. Deferred.  |
| **Top-level `docs/` folder in ds-platform**                               | Duplicates `apps/docs/content/` where Fumadocs serves documentation. Two storage locations = drift risk + the AI agent does not know where the master is. Rejected (see §2.3).                                                      |
| **ADR-0001..0007 mirrored via CI sync from `bbm`**                        | Two-source-of-truth: a PR in bbm triggers sync in ds-platform, desync is possible. Move (single source) — clean. Rejected mirror, accepted move.                                                                                    |

---

## 5. Open follow-ups (DSO-32+ and beyond)

| ID     | Q                                                                                                                                                                                                                                           | Where resolved                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| OQ-R1  | Exact pnpm pin version (10.x — which minor)                                                                                                                                                                                                 | At the time of step 15 implementation; take latest stable on the date                      |
| OQ-R2  | Turborepo remote cache server (self-host vs Vercel-managed)                                                                                                                                                                                 | Phase 1 trigger: local cache insufficient (>50% CI time on cold cache)                     |
| OQ-R3  | `tools/lint/glossary-drift.ts` implementation — which MDX parser (gray-matter? remark?)                                                                                                                                                     | Step 8 (AI-stack design spec §11) implementation                                           |
| OQ-R4  | Dependabot grouping rules — all minor+patch in one PR vs per-ecosystem                                                                                                                                                                      | Step 16 implementation, calibrate after first 4 weeks                                      |
| OQ-R5  | Squash commit title template (default = PR title; custom?)                                                                                                                                                                                  | Phase 1 enhancement if AI agent has difficulty parsing history                             |
| OQ-R6  | Phase 1 CODEOWNERS split granularity (per-app vs per-subfolder)                                                                                                                                                                             | At the time the second engineer is hired                                                   |
| OQ-R7  | Container signing (cosign) trigger                                                                                                                                                                                                          | First prod-build (Phase 1)                                                                 |
| OQ-R8  | SBOM (Syft) trigger                                                                                                                                                                                                                         | Same as OQ-R7                                                                              |
| OQ-R9  | GitHub Team plan upgrade trigger thresholds (exact min/month)                                                                                                                                                                               | After 2 months of Phase 0 telemetry                                                        |
| OQ-R10 | Mirror on Gitea/Forgejo failover plan                                                                                                                                                                                                       | Trigger: GitHub.com sustained downtime > 24h from RF                                       |
| OQ-R11 | If `bbm` transfer to org is deferred (step 0c) — update URL in CLAUDE.md, memory, processed/summaries                                                                                                                                       | Optional; does not block DSO-31                                                            |
| OQ-R12 | Self-host GHA runner on Timeweb — specific setup (k8s? plain VPS? which version of actions/runner?)                                                                                                                                         | Trigger from §2.8; separate ADR at that time                                               |
| OQ-R13 | `packages/db/` vs `apps/api/src/db/schema/` — formal resolution of ADR-0003 §4 ↔ ADR-0006 §1 conflict; here ADR-0008 fixes `packages/db/` per ADR-0006 as master, but an ADR-0003 amendment is required to officially mark §4 as superseded | Step 19 implementation (when the first schema is created); or a short ADR-amendment 0003-A |

---

## 6. Related ADRs / Delegated

**Inherited from:**

- ADR-0001 — Authentik/Zitadel: SSO for GitHub.com is not needed in Phase 0 (Enterprise plan only); decision to revisit when the team grows.
- ADR-0002 §6 — BullMQ async queue: lives as part of `apps/api/`.
- ADR-0002 §3-5 — Zod schemas + openapi-typescript: `packages/schemas/` + `packages/api-client/` (the latter — generated artifact).
- ADR-0003 §4 (Drizzle ORM + drizzle-kit migrations) + §7 (pgvector): Drizzle schemas in `packages/db/schema/` per ADR-0003 Amendment A1 (supersedes §4 original location); migrations in `apps/api/drizzle/` per ADR-0003 §4.
- ADR-0004 §2 — 4 frontend apps: promo, portal, admin, cms (Payload v3). All in `apps/`.
- ADR-0004 §7 — Payload v3 content-only: `apps/cms/`, marketing-content in `cms.*` schema namespace shared Postgres.
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule: exported from `packages/eslint-config/`.
- ADR-0005 — RN/Expo mobile: `apps/mobile/` workspace, separate build with Expo EAS.
- ADR-0006 §1, §2, §3, §9 — doc topology, Fumadocs, Keystatic, task-tracker split: all materialised in layout §2.3.
- ADR-0007 §2.5, §2.6, §2.8, §2.10, §2.11 — bootstrap, drift guards, reviewer-bot, cost-ledger, kill switch; AI-stack design spec §11 — 14-step migration plan: materialised in `tools/` + `.github/workflows/` + `.github/agents-config.json`.

**Delegated to other tasks:**

- **DSO-32 (Pre-pilot work-items) or a separate repo-setup work-item:** execute steps 15–22 (§2.10). Parallelised between AI agent (15–17, 19–20) and Tech Lead (18, 21, 22-accompaniment).
- **Future ADR-NNNN (Phase 1 CODEOWNERS):** split per app/package, GitHub Teams setup. Trigger: hire #2.
- **Future ADR-NNNN (Self-hosted GHA runner):** Timeweb VPS + runner config. Trigger: §2.8 conditions.
- **Future ADR-NNNN (Container signing + SBOM):** cosign + Syft pipeline integration. Trigger: first prod build (engineering-readiness §1 Pre-pilot full).
- **Future ADR-NNNN (Public source-available):** if ds-platform leaves private. Trigger: Pre-pilot done + community scenario.
- **Future ADR-NNNN (GitHub.com mirror to self-hosted Git):** failover. Trigger: §Risks GitHub blocking.

**Affects (downstream):**

- **DSO-32+** — implementation steps 15–22.
- **All DS Platform feature-specs** — live in `apps/docs/content/specs/features/NNN-<slug>/` (fixed by §2.3).
- **AGENTS.md + CLAUDE.md in `ds-platform`** — bootstrapped from §2.10 step 11 (AI-stack design spec §11), include a reference to this ADR-0008 in the "Repository conventions" section.
- **Engineering-readiness spec** (`docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-en.md`) — runtime tooling decisions inherited; referenced from README.md of ds-platform.

---

## 7. Amendments

### Amendment A1 — Org boundary correction + dev-stand infra location (2026-05-18, DSP-70 follow-up)

**Context:** while designing the local dev environment (`docs/superpowers/specs/2026-05-18-ds-platform-local-dev-environment-setup-design-en.md`) two inaccuracies in the original ADR-0008 surfaced:

1. **§2.1 "GitHub organization: bbm-academy-dev"** — in fact `bbm-academy-dev` is a **personal account**, not an organization. ADR-0008 §2.10 step 0a reflects that a second personal account was registered, not that an org was created. Visible at https://github.com/settings/organizations → "You are not a member of any organizations".

2. **§2.3 "No `services/` or `infrastructure/` at the start — backend = `apps/api/`; deployment configs ... live in a separate `bbm-infra` repo"** — this is a category confusion: DS Platform local dev infra (the compose stack for Postgres/Redis/etc.) **belongs to DS Platform**, not to the BBM holding. Putting it in `bbm-infra` blends client-platform infra with BBM-org infra. Plus: the dev stand is tightly coupled with the application code (a new service in the app → new env var → compose update — atomic commit).

**Decision (amendment):**

**A1.1 — GitHub org `doctor-school` (replaces §2.1 org name)**

Create GitHub org `doctor-school` (free plan: unlimited private repos + unlimited collaborators). Transfer `bbm-academy-dev/ds-platform` → `doctor-school/ds-platform` (GitHub sets the URL redirect automatically).

Mapping:

- **Org `doctor-school`** = all DS Platform repos (client-platform-level boundary, symmetric to Plane workspace `doctor-school`).
- **Personal account `bbm-academy-dev`** = remains Tech Lead's GitHub identity for BBM-holding stuff. If a separate BBM-holding org is needed later — a separate ADR.
- **Repo `sidorovanthon/bbm`** — the current working workspace (strategy/transcripts/PRD). Step 0c (transfer) **deferred** — no urgency; the `bbm` name stays under the personal account until an explicit BBM-org split is required.

ADR-0008 §2.10 step 0a → rewritten: "Create GitHub org `doctor-school` ✅ done 2026-05-18".
ADR-0008 §2.10 step 0b → rewritten: "Transfer `bbm-academy-dev/ds-platform` → `doctor-school/ds-platform` ✅ done 2026-05-18".

**A1.2 — Dev-stand infra in monorepo `ds-platform`, not in bbm-infra (replaces §2.3 statement)**

§2.3 original: "No `services/` or `infrastructure/` at the start — deployment configs ... live in a separate `bbm-infra` repo".

§2.3 amended:

- **`doctor-school/ds-platform/infra/dev-stand/`** — local dev environment compose contract (portable). See setup-design spec.
- **`doctor-school/ds-platform/infra/<other>/`** — other cross-cutting infra configs related to DS Platform (CI/CD workflows live in `.github/`, but dev-stand, observability bootstrap configs, future deployment fragments — here).
- **Prod-deploy infra** (Coolify manifests / Terraform / k3s helm) — **a separate repo** `doctor-school/ds-platform-deploy` (or similar), created at first prod deploy. Separate ADR at that time. Prod-deploy lifecycle ≠ application code (deploy configs change on their own schedule, different review audience).
- **BBM-level infra** (Plane self-host, BBM analytics tools, etc.) — separate `bbm-infra` or `bbm/infra/` repo, **not part of** the DS Platform structure.

This removes the category confusion between "BBM holding tools" and "DS Platform infra".

**A1.3 — `infra/plane/` cleanup (deferred)**

The current `bbm/infra/plane/` (CLI/MCP/Python scripts for Plane self-host) is a BBM-level toolset, **not** DS Platform. After A1.1/A1.2 it stays in the current `bbm` repo (or the future BBM-holding repo). Migration is out of scope for this amendment.

**Consequences:**

- All cross-refs to "`bbm-infra`" in ADR-0008 (§2.3, §4 alternatives table, §6 Related, §15 spec references) → reinterpreted as `doctor-school/ds-platform/infra/dev-stand/` (for dev) or `doctor-school/ds-platform-deploy` (for prod), depending on context.
- ADR-0008 §2.10 steps 15–22 (repo bootstrap) — executed under the new org `doctor-school/ds-platform`.
- DSP-150 milestone (local dev stand) — references update to the target path `doctor-school/ds-platform/infra/dev-stand/`.
- Personal account `bbm-academy-dev` is not used as owner for DS repos after the transfer.

**Why now (timing):**

The `ds-platform` repo is empty (not bootstrapped). The amendment cost = create org (~5 min) + transfer the empty repo (~1 min) + rewrite references in specs/tasks. The cost of deferring = doing the same transfer later, when the repo has commits + dependent tooling + outside contributors. Cheap now, expensive later.

**Open follow-up:**

- OQ-R14: BBM-holding org, or leave the personal account `sidorovanthon` for the `bbm` repo? — decided at the first BBM-level task that requires an org boundary.

### Amendment A2 — Branch protection simplified — remove agent-review check (2026-05-19, follow-up to ADR-0007 Amendment A1)

**Context:** ADR-0007 Amendment A1 (2026-05-19) drops the automated cross-vendor reviewer-bot (`tools/reviewer-agent/` + `.github/workflows/agent-review.yml` not implemented in Phase 0). The `agent-review` status check originally required by ADR-0008 §2.6 branch protection rule item 5 therefore has **no producer**. A required status check without a producer would block all merges on `main` indefinitely.

**Decision (amendment):**

**A2.1 — §2.6 branch protection rule item 5 removed.** The item that read:

> 5. Require status check `agent-review` — passing (ADR-0007 §2.8)

is **removed** from the §2.6 branch protection rule list.

**A2.2 — Required status checks list reduced to `[ci]`.** The branch protection rule on `main` now requires exactly one status check context: `ci` (the meta-job from §2.8 that depends on all blocking sub-jobs). The `agent-review` context is **not** in the required list.

**A2.3 — Other items unchanged.** All other §2.6 branch protection items remain in effect: PR required, ≥1 approving review, dismiss stale reviews on new commits, branches up-to-date before merge, linear history, include administrators, no force pushes, no deletions, require conversation resolution.

**Consequences:**

- The `gh api` call in the repo-strategy design spec §4.2 (which applies branch protection via `gh api PUT /repos/{owner}/{repo}/branches/main/protection`) needs the `required_status_checks[contexts][]=agent-review` line **removed** before execution in G10 of the Phase A orchestration plan.
- **Plane sub-issues description-updated** — DSP-180 (Step 13: branch protection apply) and DSP-189 (Step 21: repo settings + protection) — descriptions must reflect the new `required_status_checks = [ci]` contract.
- Merge gate semantics unchanged from the human's perspective: CI green + ≥1 human approval. The amendment only removes a required check whose producer was deleted by ADR-0007 Amendment A1.

**Why now (timing):** Branch protection has **not yet been applied** (G10 is a manual gate that has not been executed). Amending the rule list now costs ≤1 minute (text edit). Amending after application would require re-running the `gh api` call.

**Open follow-up:** none — this is a mechanical follow-up to ADR-0007 Amendment A1 with no further unknowns.

**Affects (downstream):**

- ADR-0007 §2.6 row "cross-vendor review visited" already SUPERSEDED via ADR-0007 Amendment A1 — that row referenced the same `agent-review` status check.
- Repo-strategy design spec §4.2 — `gh api` invocation parameters must drop the `agent-review` context.
- Plane DSP-180, DSP-189 — description updates (separate Plane work).
