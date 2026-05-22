---
title: "ADR-0008 — DS Platform Repository Strategy + Dev Workflow [EN]"
description: "DSO-25..30 + DSO-60 locked down the DS Platform technology stack, development methodology, and task-tracking split (Plane strategic / GitHub Issues..."
lang: en
---

> **EN (this)** · **RU:** [`0008-repo-strategy-and-dev-workflow-ru.md`](./0008-repo-strategy-and-dev-workflow-ru.md)

# ADR-0008 — DS Platform Repository Strategy + Dev Workflow

**Date:** 2026-05-15 (last amended 2026-05-19 — Amendment A3, see §7)
**Status:** Accepted (+ Amendment A2 — `agent-review` check removed; + Amendment A3 — server-side branch protection deferred until plan/visibility change)
**Related to:** Plane DSO-31 (`fae57ab6-f09b-4a4d-9ede-9a4f1ca504c0`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0008-repo-strategy-and-dev-workflow-design-en.md`
**Inherits:** ADR-0001 (Authentik/Zitadel), ADR-0002 (NestJS+BullMQ), ADR-0003 (Postgres17+Drizzle), ADR-0004 (Next.js 15+Refine), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs+Keystatic+GitHub Issues), ADR-0007 (AI loop + cross-vendor reviewer + 14-step migration)

---

## 1. Context

DSO-25..30 + DSO-60 locked down the DS Platform technology stack, development methodology, and task-tracking split (Plane strategic / GitHub Issues code). What remained unresolved — the operational layer between "decisions" and "the first line of code":

- **Where** the code lives, under which owner, within what boundaries
- **Structure** of the monorepo down to specific folders and manifest files (root `package.json`, `pnpm-workspace.yaml`, `turbo.json`)
- **Release tooling** — how apps/packages are versioned and published (changesets vs release-please vs conventional-only)
- **Pre-commit + branch protection policy** — concrete rules for the main branch and local hooks
- **CI topology** — runner choice, pipeline shape, which jobs are blocking
- **CODEOWNERS bootstrap** — who is responsible for what in Phase 0 (team-of-1+AI)
- **Node/pnpm versions** — pin strategy so that the AI agent and the human see the same environment

AI-stack design spec §11 already listed 14 steps of AI-loop tooling (bootstrap, reviewer-agent, cost-ledger, lint guards, agents-config kill switch, branch protection). Those steps remain authoritative; ADR-0008 frames them: it creates the repo skeleton inside which the §11 steps are executable.

**Hard requirements:**

- Every decision must be AI-agent-friendly: a new agent in a fresh session must be able to orient itself via bootstrap (ADR-0007 §2.5) + reading AGENTS.md/CLAUDE.md/ADRs from the workspace, without a MCP-fetch proxy.
- Phase 0 minimum moving parts: nothing that does not block the first feature-spec is introduced.
- Federal Law 152-FZ: code may live on GitHub.com (no personal data (PD) in source). Trigger to revisit — political decision or blocking of GitHub.com from the Russian Federation (RF); then mirror to Gitea/Forgejo on Timeweb; already discussed in ADR-0006 §Consequences.
- [[feedback_tech_stack_criteria_no_team_skill]]: tooling choices are not argued with "the team knows this / prototypes". Criteria — mainstream 2026, integration with the already-accepted stack, low ops overhead for team-of-1+AI.

---

## 2. Decision

### 2.1 Repo identity and owner

- **GitHub repository:** `doctor-school/ds-platform`, private until Pre-pilot launch.
- **GitHub organization:** `doctor-school` (GitHub Free plan: unlimited private repos + unlimited collaborators). All DS Platform repos live here — a client-platform-level boundary symmetric to the Plane workspace `doctor-school`.
- **Visibility decision Phase 1+:** keeping private vs source-available — a separate ADR when Pre-pilot is reached or a community scenario arises.

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

**Backend is a single app, not a service mesh** — backend = `apps/api/` (no top-level `services/`). Local dev-environment configs (the docker-compose dev stand) live in `infra/dev-stand/` within this repo — tightly coupled to application code (a new service → a new env var → a compose update, one atomic commit). Production deployment configs (Coolify manifests / Terraform) live in a separate `doctor-school/ds-platform-deploy` repo, created at first prod deploy. `apps/` + `packages/` hold pure application code.

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

### 2.10 Repository bootstrap steps

Pre-DSO-31 admin (Tech Lead, ≤10 minutes, manual):

- **0.** Create GitHub org `doctor-school` (GitHub Free plan) + empty private repo `doctor-school/ds-platform`. URL: https://github.com/doctor-school/ds-platform.

Phase 0 implementation steps — extends AI-stack design spec §11. Steps 1–14 from AI-stack design spec §11 unchanged. Additional steps (DSO-32 children or new work-item):

| Step | Action                                                                                                                                                                                                                                                                                                                                                                                            | Output                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 15   | Initialise root `package.json` + `pnpm-workspace.yaml` + `turbo.json` + `tsconfig.base.json` + `.changeset/config.json` + `.editorconfig` + `.gitignore` + `.gitattributes` + `.npmrc` + `.nvmrc`                                                                                                                                                                                                 | repo bootstraps locally                      |
| 16a  | Create `.github/` minimal skeleton: `workflows/{ci,cost-ledger,release}.yml`, `CODEOWNERS`, `pull_request_template.md`, `ISSUE_TEMPLATE/{feature,bug,chore}.md`, `dependabot.yml`, `agents-config.json`. CI references only tools that already exist (steps 1–8 AI-stack design spec §11) or skips gracefully                                                                                     | CI runs on first push without `agent-review` |
| 16b  | After AI-stack design spec §11 steps 4–5 (`packages/llm-utils/buildContext.ts` + `tools/reviewer-agent/`) — add `.github/workflows/agent-review.yml`                                                                                                                                                                                                                                              | reviewer-bot activates                       |
| 17   | Install `simple-git-hooks` + `lint-staged` in root `package.json` + `simple-git-hooks` config section                                                                                                                                                                                                                                                                                             | pre-commit works                             |
| 19   | Initialise empty workspace stubs: `apps/{api,promo,portal,admin,cms,docs,docs-cms,mobile}/` + `packages/{schemas,api-client,db,glossary,hooks,design-system,observability,utils,eslint-config,tsconfig,llm-utils}/` + `tools/reviewer-agent/`, each with a minimal `package.json` (`name: @ds/<name>`, `version: 0.0.0`, `private: true`) + optional per-package `turbo.json` for script-stub map | workspace discoverable                       |
| 20   | Initialise `apps/docs/` as a Fumadocs Next.js app (see ADR-0006 §2) — ADR content + paired design specs reside in `content/adr/`. Initialise `apps/docs-cms/` as a Keystatic Next.js app (ADR-0006 §3)                                                                                                                                                                                            | doc portal builds                            |
| 21   | **[Manual, admin]** Apply repository settings (`allow_squash_merge=true`, `allow_rebase_merge=false`, `allow_merge_commit=false`) + branch protection rule per §2.6 via `gh api`. See design spec §4 for exact commands                                                                                                                                                                           | merge gated, squash-only enforced            |
| 22   | Smoke test: create the first feature-spec (`NNN-onboarding` or similar) and run the 8-step cycle ADR-0007 §2.4 end-to-end                                                                                                                                                                                                                                                                         | proof of concept                             |

Dependency graph: 15 → 16a → 17 → 19 parallel with 15. 20 depends on 19. 16b depends on AI-stack design spec §11 step 5. 21 depends on 16a (branch protection requires an existing CI workflow). 22 depends on everything.

Step 21 — admin-only. Step 22 — joint Tech Lead+AI.

**Estimate:** Steps 15–22 — Sprint 3 (after Pre-pilot kickoff, ~2026-06-09 start per Plane).

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
- **Single-purpose repo** — `ds-platform` holds application code + platform docs and nothing else. An AI agent opening the repo sees one coherent scope, with no strategy or business material to wade through.
- **Mainstream defaults Phase 0** — pnpm+Turborepo+changesets+simple-git-hooks — a stack that any TypeScript engineer in 2026 reads without additional learning. AI agents (Claude/Codex) are trained on these patterns.
- **Minimum moving parts at the start** — no Vault/feature-flags/cache-server/self-hosted runner in Phase 0. Each is added via an explicit trigger documented either here or in the engineering-readiness spec.
- **Branch protection enabled before the first merge** — no Phase 0 window without guards.

### Negative

- **`apps/docs/` as a Next.js app — heavier than a static markdown render**. Fumadocs build takes ~30s, recalculated on every ADR edit. Trade-off already accepted in ADR-0006 (single toolchain). Mitigation: Turborepo cache.
- **Free CI minutes — a bottleneck**. 2000 min/month for private repo Team plan = 5000. At 5+ PR/day toward the end of Pre-pilot, this limit may be hit. Mitigation: trigger to self-hosted runner (§2.8); or upgrade to GitHub Team ($4/user/month).
- **CODEOWNERS = one line with `@sidorovanthon`** — formally works, but GitHub UI displays "one owner for everything" as a single point of failure. Mitigation: this is explicitly known; Phase 1 split is documented as a trigger.

### Risks

- **GitHub.com blocking from RF** — gradual scenario (rate limits on Russian IPs, or full blocking). Mitigation: mirror `ds-platform` to self-hosted Gitea/Forgejo on Timeweb as a read-only failover. Trigger: first sustained GitHub.com unavailability from RF > 24h. A trigger-ADR will describe the sync mechanism.
- **changesets versioning conflict with independent releases of multiple apps** — two PRs simultaneously change one package + update a changeset → merge conflict in `.changeset/`. Mitigation: changesets handles this (changeset files have random hash names, do not conflict between PRs); merge conflict only in `CHANGELOG.md` and `package.json`, resolved via a normal rebase.
- **Pre-commit hooks break `git commit` for the AI agent** if the environment is not prepared — Vitest crashed or ESLint config broken. Mitigation: hooks only run lint-staged (fast), do not run tests; `git commit --no-verify` remains a valid escape hatch for the AI agent (documented in AGENTS.md, but with a warning "bypass was used").

---

## 4. Alternatives considered (rejected or deferred)

| Alternative                                                  | Reason rejected/deferred                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DS Platform code in a shared strategy + code monorepo**    | Mixed strategy/code workspace = weak boundary for an AI agent: cognitive bleed between business/PRD material and implementation. A dedicated application repo keeps the agent's context focused. Rejected.                          |
| **Polyrepo** (one repo per app: ds-portal, ds-api, ds-admin) | Duplicates tooling in each (ESLint, TS config, CI yaml), loses Turborepo cross-package cache, atomic refactors across ≥2 apps require orchestration. Phase 0 size does not justify the overhead. Rejected.                          |
| **Hybrid: backend polyrepo, frontend monorepo**              | Backend = one NestJS app (ADR-0002), no need for polyrepo. Rejected.                                                                                                                                                                |
| **Self-host Git (Gitea/Forgejo) from the start**             | Premature ops overhead: VPS + admin + backup + DNS + SSO with Authentik (which is itself not yet deployed). GitHub.com covers Phase 0 use cases without ops cost. Trigger for mirror (see Risks): first blocking. Deferred.         |
| **Personal account as owner** (`sidorovanthon/ds-platform`)  | Personal-account-as-team anti-pattern: transfer to an org later breaks PR/Issue cross-refs (though redirect works), CODEOWNERS without teams = list of usernames. Rejected.                                                         |
| **changesets in favour of release-please** (Google project)  | release-please is more tightly coupled to conventional-commits (no opt-out); requires `release-please-action` which evolves more slowly. changesets — incumbent for pnpm-monorepos 2026. Deferred (can migrate later without loss). |
| **changesets in favour of semantic-release**                 | semantic-release uses one version per repo, does not fit multi-app independent versioning. Rejected.                                                                                                                                |
| **conventional-commits-only (no changesets)**                | Does not support intentful version bumps (e.g., "this fix is also breaking on app-X but not on app-Y"); changeset = explicit dev statement. Rejected.                                                                               |
| **Husky for pre-commit**                                     | Deprecated by its own author (typicode) 2024-09 in favour of simple-git-hooks. Using it = adding tech debt from day one. Rejected.                                                                                                  |
| **lefthook for pre-commit**                                  | Go binary as a dependency: AI agents run in varied CI containers (Vercel, GitHub Actions, locally) without a Go runtime. Friction. Rejected.                                                                                        |
| **GitLab CI instead of GitHub Actions**                      | Mismatch with the already-chosen GitHub Issues (ADR-0006 §9): cross-repo refs, PR-issue auto-close, agent-review via `gh` CLI — all built on GitHub. Rejected.                                                                      |
| **Self-hosted Forgejo Actions / Drone / Woodpecker**         | Ops overhead in Phase 0 without value (see §2.8). Deferred trigger.                                                                                                                                                                 |
| **GitFlow** (develop + main + release branches)              | Tooling weight for team-of-1+AI; squash-merge to main + short-lived feature branches covers all use cases. Rejected.                                                                                                                |
| **Allow merge commits + rebase merge**                       | Mixed merge styles break changesets parsing and AI-agent reasoning about history. Rejected.                                                                                                                                         |
| **Optional CODEOWNERS**                                      | Without CODEOWNERS there is no automatic PR-reviewer assignment; the reviewer-bot does not know whom to ping (although the bot is non-human). Start with a minimal `* @sidorovanthon` so the file exists. Accepted (see §2.7).      |
| **GitHub Teams plan ($4/user/mo) from the start**            | $4/month × 1 user = $4/month, not a cost issue, but bringing it up without need. Free plan covers private repo + CI 2000 min. Trigger to upgrade: CI limit exhausted or > 3 collaborators who need Teams for CODEOWNERS. Deferred.  |
| **Top-level `docs/` folder in ds-platform**                  | Duplicates `apps/docs/content/` where Fumadocs serves documentation. Two storage locations = drift risk + the AI agent does not know where the master is. Rejected (see §2.3).                                                      |

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

- **DSO-32 (Pre-pilot work-items) or a separate repo-setup work-item:** execute steps 15–22 (§2.10). Parallelised between AI agent (15–17, 19–20) and Tech Lead (21, 22-accompaniment).
- **Future ADR-NNNN (Phase 1 CODEOWNERS):** split per app/package, GitHub Teams setup. Trigger: hire #2.
- **Future ADR-NNNN (Self-hosted GHA runner):** Timeweb VPS + runner config. Trigger: §2.8 conditions.
- **Future ADR-NNNN (Container signing + SBOM):** cosign + Syft pipeline integration. Trigger: first prod build (engineering-readiness §1 Pre-pilot full).
- **Future ADR-NNNN (Public source-available):** if ds-platform leaves private. Trigger: Pre-pilot done + community scenario.
- **Future ADR-NNNN (GitHub.com mirror to self-hosted Git):** failover. Trigger: §Risks GitHub blocking.

**Affects (downstream):**

- **DSO-32+** — implementation steps 15–22.
- **All DS Platform feature-specs** — live in `apps/docs/content/specs/features/NNN-<slug>/` (fixed by §2.3).
- **AGENTS.md + CLAUDE.md in `ds-platform`** — bootstrapped from §2.10 step 11 (AI-stack design spec §11), include a reference to this ADR-0008 in the "Repository conventions" section.
- **Engineering-readiness spec** (`../specs/tech/2026-05-12-engineering-readiness-design-en.md`) — runtime tooling decisions inherited; referenced from README.md of ds-platform.

---

## 7. Amendments

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

### Amendment A3 — Server-side branch protection deferred (GitHub Free + private blocks enforcement) (2026-05-19)

**Context:** When G10 of the Phase A orchestration plan tried to apply branch protection on `doctor-school/ds-platform` via `gh api PUT /repos/{owner}/{repo}/branches/main/protection` (the §2.6 rule list, post-A2), GitHub returned HTTP 403 `"Upgrade to GitHub Pro or make this repository public to enable this feature"`. The same paywall applies to GitHub Rulesets (the newer ruleset API also 403s on private repos in a Free-plan organisation). The `doctor-school` organisation is on the GitHub Free plan; the repository is private (per §2 "Repository: private until Pre-pilot launch"). The Tech Lead has decided **no paid plan upgrades** in Phase 0.

This makes the entire §2.6 rule list — required status checks, required reviewing approval, dismiss stale reviews, linear history, conversation resolution, `include administrators`, force-push prevention, deletion prevention — **inapplicable as server-side enforcement** until either the org plan is upgraded (Team / Enterprise) or the repository is made public. The `gh api` payload itself is technically correct (verified during G10 dry-run); GitHub is simply refusing to install any protection rule on this repo at this billing tier.

**Decision (amendment):**

**A3.1 — §2.6 reframed as _target state_, not current state.** The 8-item rule list in §2.6 (post-A2: 7 items, with `agent-review` removed) is preserved verbatim as the **target branch-protection contract** that will be applied once the reactivation trigger fires. It is not the current operational state.

**A3.2 — Interim (Phase 0) merge gate is _process-level_, not server-side.** While §2.6 cannot be enforced server-side, the same merge-gate intent is preserved via local + convention-level substitutes:

| §2.6 target rule (post-A2)                           | Phase 0 process-level substitute                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. PR required before merge to `main`                | Convention: Tech Lead never `git push origin main` directly; all changes go through a PR. No technical block — relies on AGENTS.md hard rule + AI-agent compliance.                                                                                                                                 |
| 2. ≥1 approving review                               | Convention: Tech Lead reads the diff before clicking merge (single-developer flow; "self-review = read-the-diff"). When a second human reviewer is available, requested via PR sidebar; not enforceable as required.                                                                                |
| 3. Dismiss stale reviews on new commits              | Manual: Tech Lead re-reads the diff after any push that follows an earlier read. Convention only.                                                                                                                                                                                                   |
| 4. Required status check `ci` — passing              | `gh pr merge --auto --squash` is the standard merge command (see AGENTS.md). GitHub holds the merge until all checks pass; equivalent to required-status-check semantics for the single-developer happy path. CI still runs on every PR and is visible in the PR check-runs UI.                     |
| 5. Branches up-to-date before merge (`strict: true`) | `gh pr merge --auto --squash` rebases-or-fails depending on repo setting; manual `git pull --rebase origin main` before push is the convention.                                                                                                                                                     |
| 6. Linear history (squash-only)                      | Enforced at repo-level via "Allow squash merging" + disable merge-commits + disable rebase-merge in `Settings → General → Pull Requests` (this is **not** branch protection and is **not** paywalled; applied as part of A3 closure).                                                               |
| 7. `include administrators`                          | Not applicable in interim — no server-side rule to bypass. Convention: Tech Lead does not push to `main` directly even when technically possible.                                                                                                                                                   |
| 8. No force pushes / no deletions                    | Convention only. G3 installed simple-git-hooks (pre-commit + lint-staged) — no pre-push hook; force-push and branch-delete are not technically blocked. Tech Lead's hard rule: never `git push --force` against `main`; never `git push --delete origin main`. Reactivation makes this server-side. |
| 9. Required conversation resolution                  | Convention only — GitHub still surfaces unresolved threads in the merge button UI; Tech Lead reads before merging.                                                                                                                                                                                  |

**A3.3 — Lint guards (ADR-0007 §2.6 BLOCK/WARN table) semantics under interim.** Rows marked `BLOCK` in ADR-0007 §2.6 assume a required `ci` status check that hard-rejects merge. Under A3, `BLOCK` means **CI job exits red and the Tech Lead treats that as a merge-blocker by convention** — same operational outcome on the single-developer happy path, no server-side guarantee. See ADR-0007 §2.6 footnote (added in the same change set as this amendment) for the explicit clarification.

**A3.4 — Reactivation trigger.** §2.6 rule list (post-A2: 7 items) is applied verbatim via `gh api PUT …/branches/main/protection` (or equivalent ruleset) the first time **any** of these conditions becomes true:

- The `doctor-school` org upgrades to GitHub Team or Enterprise plan (gives branch protection on private repos).
- The `doctor-school/ds-platform` repo is made public (gives branch protection on public repos at Free plan).
- The repo migrates to another forge (Forgejo / GitLab self-hosted etc.) where the equivalent feature is free — separate ADR if this happens.

The payload to apply on trigger is committed to `branch-protection.json` at repo root (kept in tree as documentation; not consumed by any current automation).

**Consequences:**

- **§2.6 normative status:** target-state contract, not current state. Implementations and reviewers should not assume any §2.6 item is currently enforced server-side on `main`.
- **Merge-gate semantics for the human:** unchanged in **intent** (CI green + human read-the-diff before merge); changed in **mechanism** (no server-side block; convention + `gh pr merge --auto`).
- **`enforce_admins: true` semantics lost in interim.** When §2.6 reactivates, the Tech Lead is intentionally not exempt; until then there is no admin-bypass to worry about because there is no rule.
- **G10 of the Phase A orchestration plan reclassified.** Originally "Apply branch protection". Now: "Apply repo settings (squash-only merge, auto-delete head branches) + document reactivation trigger." Plane DSP-180 / DSP-189 cancelled with the reactivation trigger captured in a comment (see Plane). No new pre-push instrumentation in interim — the existing G3 pre-commit hook (simple-git-hooks + lint-staged on staged files) plus `gh pr merge --auto --squash` cover the merge-gate intent without duplicating CI locally.
- **AGENTS.md updated** in the same change set: `gh pr merge --auto --squash` codified as the standard merge command; Tech Lead human-merge gate made explicit.
- **Audit trail unaffected.** Git history + GitHub PR record + Plane work-item history remain the audit surface; A3 does not change what is recorded, only what is _enforced_.

**Why now (timing):** G10 surfaced the paywall during the dry-run. Applying §2.6 is impossible; reclassifying it is a 30-minute amendment that prevents future agents from treating §2.6 as current operational truth and wasting cycles attempting re-application. Cheap to amend now; expensive to leave silently broken.

**Open follow-up:**

- **OQ-R15 (reactivation discipline).** When the trigger fires, who is responsible for re-applying §2.6? Default owner: Tech Lead. Tracked under the same Plane issue that handles the trigger event (org upgrade or repo visibility change).
- **OQ-R16 (process-level audit).** Is there value in a periodic (monthly?) self-audit that Tech Lead's recent merges actually satisfied §2.6 intent (CI was green, diff was read)? Deferred — adds overhead without obvious value in single-developer Phase 0.

**Affects (downstream):**

- ADR-0007 §2.6 BLOCK/WARN table — footnote added clarifying interim semantics (see ADR-0007 update in same change set).
- AGENTS.md root — interim merge-flow section added.
- Plane DSP-180 and DSP-189 — Cancelled with reactivation trigger captured in comments.
- Repo-strategy design spec §4.2 — Amendment SD3 added mirroring A3 (the `gh api` snippet is preserved as the target-state payload; not removed).
- `branch-protection.json` at repo root — committed as the verbatim target-state payload, ready to apply on trigger.
