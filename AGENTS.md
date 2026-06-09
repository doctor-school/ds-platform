# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo. Vendor-agnostic — readable by Claude Code, Codex, Cursor, or any future agent. Claude-Code-specific overlays live in `CLAUDE.md`.

---

## 1. What is DS Platform

DS Platform is the medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). Greenfield monorepo in **Phase 0** — architectural ADRs (0001–0008) accepted, engineering scaffolding in progress. Pre-pilot target: **2026 Q3**.

Stack at a glance (full reference in `apps/docs/content/adr/`): **Backend** NestJS + Zod + REST + openapi-typescript SDK (ADR-0002); **Data** Postgres 17 + Drizzle + pgvector (ADR-0003); **Frontend** Next.js 15 + Refine — 4 apps: promo / portal / admin / cms-Payload-v3 (ADR-0004); **Mobile** React Native + Expo + WatermelonDB (ADR-0005); **Docs** Fumadocs + Keystatic + glossary.yaml (ADR-0006). Long-form context: `README.md`.

---

## 2. Repository conventions

**Monorepo:** pnpm 10 workspaces + Turborepo 2.x. Root commands run via `pnpm <script>`; per-package via `pnpm --filter <name> <script>`.

**Apps live in `apps/<name>/`:** api, promo, portal, admin, cms, docs, docs-cms, mobile. Shared code in `packages/<name>/`. Build/dev tooling in `tools/`.

**Branch strategy:** trunk-based; short-lived branches off `main`, squash-merge back. Naming `<prefix>/<N>-<slug>` (`N` = GitHub Issue #, or `<TRACKER-ID>` for Plane-driven work without an Issue, e.g. `chore/dsp-193-repo-hygiene`). Prefixes: `feat/` (feature), `fix/` (bug), `chore/` (maintenance), `refactor/` (restructure, no behavior change), `docs/` (docs-only), `tooling/` (build / CI / dev-tooling). Dependabot branches (`dependabot/...`) — leave as-is, do not rename.

**Stale branches.** Auto-deleted on merge via `--delete-branch` in the squash-merge command. For PRs closed **without** merge, delete the branch in the same step (`gh pr close <N> --delete-branch`). Do not leave un-merged branches alive longer than the PR they came from. Dependabot branches Dependabot owns — closing the PR is enough; Dependabot will recreate when a new bump arrives.

**Post-merge inventory re-sweep.** After merging a PR that touches `.changeset/`, `.github/workflows/*`, dependency manifests, or security configs, re-run `gh pr list` and `git ls-remote --heads origin` once more before declaring the session done. Automation-generated bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge and would otherwise leave the repo non-clean.

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Squash-merge title enforced via PR title.

**Versioning:** changesets. User-facing PR → `pnpm changeset`. Internal-only (refactor/docs/chore) — no changeset.

**Bump letter** (semver, per package): `patch` = bugfix, no API or consumer-visible behavior change; `minor` = additive (new feature / exports / optional fields / endpoints), no breaking change; `major` = breaking (removed or renamed exports, changed signatures, return shapes, or field semantics, raised runtime floor, removed option). Pre-1.0 follows the same rule — a breaking `0.x` goes to `1.0`, never a hidden `0.x` minor. When unsure between `minor` and `major`, default to `major`: consumers can pin loosely but cannot recover from an undetected breaking change shipped as minor.

**Pre-commit:** simple-git-hooks runs `lint-staged` (ESLint `--fix` + Prettier). `--no-verify` is a valid escape hatch — log the reason in the PR description.

**PR template required** — set label (`feature` / `bug` / `chore` / `refactor` / `docs` / `tooling`), link Issue (`Closes #N`), mark author (`author:claude` / `author:codex` / `author:human`).

**Branch protection.** Target-state contract (ADR-0008 §2.6) is enforced by convention + local hooks during Phase 0; server-side enforcement is deferred — GitHub Free + private repo blocks the branch-protection API. Verbatim payload at `branch-protection.json`. See ADR-0008 §2.6 for the full contract, the interim process-level substitutes, and the reactivation trigger.

**Merge** — single mandatory command; the command itself is the §6 Hard rule (Direct push to `main` is forbidden), and `merge-when-green` carries the flag rationale and violation list.

**ADRs** live in `apps/docs/content/adr/`, rendered at `/adr/<slug>`. Paired design spec — `NNNN-<slug>-design.md`.

**Feature specs** live in `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `NNN-requirements.md`, `NNN-design.md`, `NNN-scenarios.feature`). One spec → multiple Issues (one per EARS-handler): the triplet ships as **one docs-PR**, child Issues open on that branch with their numbers written back into the `issues:` frontmatter, merging on a Mode (a) verdict + green CI; per-iteration **code** PRs start only **after** the spec is on `main` (the `spec-link` BLOCK guard, §5). Milestones are independent of specs — a Milestone tracks a long-lived product theme (e.g. `Auth foundations v1`) spanning multiple specs; specs do not become Milestones. Full format + recipe: `author-ears-spec/SKILL.md` (step 7).

---

## 2.1 Issue conventions

New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton (Context / Scope / Spec reference / Acceptance criteria / Dependencies / Notes). When opening an Issue set from a spec, native GitHub relationships are **mandatory, not optional prose**: attach each child as a **sub-issue** of the parent and set the **blocked-by/blocking** links between children — the board ordering procedure reads only this native graph (board-design §5). The recipe lives in `apps/docs/content/skills/open-ears-issues/SKILL.md` step 4. Agents resuming In Progress items read the latest stop-state comment first. Stop-state comments follow a fixed four-field shape — see `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md` §6 for the canonical form. The board ordering procedure (resume → rework → fresh → unblock) is documented in §5 of the same spec.

---

## 3. Work protocol

Every agent session, regardless of vendor, follows this three-step entry — **identify task kind → cite entry point → load skill**.

### 3.1 Identify task kind

| Kind              | Trigger                                                       | Skill                                                         |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| feature-iteration | One EARS handler inside an existing feature-spec              | `apps/docs/content/skills/do-feature-iteration/SKILL.md`      |
| hotfix-pr         | Code-level bug; no feature-spec required                      | `apps/docs/content/skills/do-hotfix-pr/SKILL.md`              |
| adr-revision      | Edit to an existing ADR (inline rewrite by default)           | `apps/docs/content/skills/do-adr-revision/SKILL.md`           |
| decision-debt     | Closing a silent-decision artifact surfaced earlier           | `apps/docs/content/skills/do-decision-debt-followup/SKILL.md` |
| engineering-task  | Phase A bootstrap (DSP-160 sub-issue), CI hardening, scaffold | No skill — follow the task spec directly                      |
| spec-authoring    | New feature-spec / new ADR / new design-spec                  | `superpowers:brainstorming` (sole allowed exception)          |

If the kind is ambiguous, stop and ask Tech Lead.

### 3.2 Cite the entry point

In the first user-facing reply, state: kind, active artifact (Issue #N / spec path / ADR section), skill being dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly. Do not rely on vendor-specific auto-discovery — **the path is the contract**.

### 3.4 Superpowers whitelist (single exception)

`superpowers:brainstorming` is the only `superpowers:*` skill allowed for project work, and only for spec-authoring. After brainstorming concludes, **do not chain into `superpowers:writing-plans`** — the `NNN-requirements.md` / `NNN-design.md` triplet is the plan (ADR-0007 §2.4 via `do-feature-iteration`). All other `superpowers:*` skills, and any chain initiated internally by a superpowers skill, are explicitly disallowed for project work. They may be referenced as implementation patterns inside project SKILL.md content, but not as the orchestrator.

### 3.5 Bootstrap

Run `pnpm bootstrap` (alias `tsx tools/agent-bootstrap.ts`) for git/Issue/PR/spec state. Claude Code does this via SessionStart hook (`.claude/settings.json`) automatically.

### 3.6 Permission-mode disclosure

If the session is launched with `--dangerously-skip-permissions`, the agent assumes the discipline responsibility that CI guards would otherwise enforce. If CI guards are themselves broken, bypass mode amplifies the gap.

### 3.7 Plane lifecycle entry (if applicable)

If the active task is a Plane work-item (DSP-XXX / DSO-XXX), the very first action after identifying task kind is the Plane lifecycle entry: (1) move the task to `In Progress`, (2) post a start comment describing the planned approach. This precedes any code or doc edit. The end-of-session counterpart — move to `Done` + result comment — is in §6 Hard rules (Plane lifecycle).

**Tooling.** `plane-pp-cli` reads work-items but is **read-only** for them in the current Plane CE — state changes and comments go through the Plane MCP (`mcp__plane-pp-mcp__*`). Use the CLI for lookups, the MCP for the lifecycle writes.

### 3.8 Engineering-task discipline (no orchestration skill)

`engineering-task` is the only kind with no orchestration skill (§3.1) — but the §6 discipline gates still apply. Because no skill carries them, the lead agent runs them directly:

- **`surface-decision-debt`** (inline) — mandatory before the result comment. Reflect on silent deviations from a documented convention; output `[]` or a list. For a Plane work-item, the result lands in the Plane result comment, which serves as the iteration summary.
- **`request-mode-a-review`** (dispatch) — mandatory before merge, same gate as any code or docs PR (§4).
- **`run-iteration-end-checklist`** is **not** dispatched for an engineering-task — CI already runs `test` / `typecheck` / `lint` / generate-drift. Its remaining items (module README, `apps/docs/content/architecture/`, `apps/docs/content/operations/` runbook, glossary terms) are an inline self-check the lead performs before opening the PR.

---

## 4. Review modes

Per ADR-0007 §2.10. Three modes:

- **Mode (a)** — same-session subagent dispatch with `request-mode-a-review` skill. Lead agent finishes work → dispatches subagent with the reviewer prompt → subagent reads diff + spec + ADRs and returns a structured verdict (APPROVE / REQUEST_CHANGES).
- **Mode (b)** — parallel Codex CLI session reviewing the PR independently.
- **Mode (c)** — pure human review in the GitHub UI.

LLM credentials live in the human's terminal, not in CI secrets. **No automated reviewer-bot.**

**Merge gate.** A positive Mode (a) or Mode (b) verdict + green CI is sufficient to merge via `gh pr merge --auto --squash --delete-branch`; human-merge is **not** required (ADR-0007 §2.4, §2.10). Mode (c) reviews remain a single human decision. Procedure detail: `apps/docs/content/skills/request-mode-a-review/SKILL.md` and `apps/docs/content/skills/merge-when-green/SKILL.md`.

---

## 5. Lint guards

The CI lint guards from ADR-0007 §2.6 act as nudges visible in the PR Checks UI for the human reviewer and the author-agent. Full table lives in **ADR-0007 §2.6**. `spec-link` is BLOCK; others are WARN in Phase 0.

---

## 6. Hard rules

- **SDD.** No production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`. If absent, invoke `superpowers:brainstorming` per §3.4 to author one.
- **Vertical slices over horizontal layers (F-22).** Every feature-spec declares `surface: backend-only | user-facing` in `NNN-requirements.md` frontmatter; a genuine backend-only spec is verified by Vitest e2e alone, but a `user-facing` feature owns its UI deliverable in the **same** WBS as its backend. Backend-first is allowed only as an explicit, tracked out-of-scope deferral named in the spec — never a silent default. A UI surface in any EARS _trigger_ forbids `surface: backend-only` (anti-hide guard). Rule + precedents enforced by `author-ears-spec`, `open-ears-issues` step 3a, `run-iteration-end-checklist` item 12.
- **No untracked seam / scaffold (F-22).** A scaffold, stub, fake, or fail-closed seam standing in for a real deliverable is decision-debt: it MUST be a tracked open Issue with an explicit "done against the real dependency" criterion — a code comment ("wired in F2/F3") is not an obligation the tracker can see. A `user-facing` theme's Definition of Done is "a vertical slice is completable end-to-end", not "all backend handlers merged". Detail: `open-ears-issues` step 3a.
- **No workarounds, no patches, no temporary hacks — build it right the first time.** A workaround, monkey-patch, local source edit "just to make it run", manual one-off step, hardcoded value standing in for missing config, or any "temporary" measure is **forbidden** — in code _and_ in process. If a prerequisite is not ready (the backend capability a UI needs, a build/boot defect, missing recipe config, an unverified dependency), you **STOP and fix the prerequisite properly first**, as its own tracked Issue wired as a blocking dependency (`blocked_by`) — you do not paper over it to keep moving. Corollaries: (a) **never rush a UI/integration layer ahead of the backend it depends on** — if the live path isn't ready, the slice isn't ready (this is the F-22 failure mode); (b) **verification only counts against clean, committed code** — a green observed against a patched/hacked/locally-mutated state is not a real green and must not be reported as one (ties to the no-fake-green rule); (c) if you catch yourself reaching for a workaround, that is the signal to re-sequence the work, not to apply it. The urge to "just get it working now" is the smell. Detail + rationale: memory `feedback_no_workarounds_build_clean`.
- **TDD.** No production code without a failing test. Naming: `it('EARS-N: ...')`. Flat numbering per ADR-0006 §4; nested `N.M` only when a single handler carries multiple shall-clauses.
- **Trackers.** Code-level → GitHub Issues here; strategic / cross-team → Plane workspace `doctor-school`. Never both.
- **Plane lifecycle.** When the task is a Plane work-item: move to `In Progress` with a start comment before code work; on completion, move to `Done` with a result comment containing artifacts (links to files/PRs/pages), what was done, open questions, and what is unblocked. If the task stays incomplete, leave a status comment with "where we stopped / what remains" instead of dropping it silently. Tooling: `plane-pp-cli` for reads; Plane MCP (`mcp__plane-pp-mcp__*`) for state changes and comments (see §3.7).
- **Roles, not names** in any spec / ADR / design doc.
- **Direct push to `main` is forbidden.** Single merge command: `gh pr merge <N> --auto --squash --delete-branch`.
- **Project skill catalog.** Only `apps/docs/content/skills/`. Vendor-specific skill auto-discovery is not used to dispatch project work. The path is the contract.
- **Discipline gates.** `run-iteration-end-checklist` and `request-mode-a-review` produce artifacts the lead agent cannot bypass — whether dispatched by an orchestration skill or run directly for an engineering-task (§3.8). Without their outputs, merge is forbidden (ADR-0007 §2.4 — verdict-gated cycle).
- **Decision-debt.** Any silent deviation from a documented convention MUST surface via `surface-decision-debt`. The output may be `[]`, but the invocation is required before the iteration summary — or, for an engineering-task, before the Plane / Issue result comment (§3.8).
- **Amendment vs inline rewrite discipline.** In pre-pilot (paper-architecture, no production code) there are NO amendment blocks in ADR / spec / design docs — an amendment is justified only when the original decision is running in production. Everywhere else: inline rewrite, the body reading as if the current decision were always the decision. "SUPERSEDED / per Amendment X" callouts as the source of a prose rule are forbidden; the history of paper-architecture evolution lives in `git log`, not the document body.

---

## 7. Roles

Per memory `reference_team_roles.md`. **Specs / ADRs / process docs use roles, not names.**

| Role                             | Responsibility                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Tech Lead / System Architect** | IT architecture, AI orchestration, product engineering, bizmodel; primary author of code in Phase 0        |
| **Product Lead**                 | Doctor.School owner, MBA marketer, pharma sales, domain expertise; primary author of product / PRD content |
| **Partner / Strategic**          | Strategic partner (data centers, AI wellness adjacency); not in dev loop                                   |

In **Phase 0**, Tech Lead is the **single CODEOWNERS owner** (ADR-0008 §2.7) and the single human approver on PRs.

---

## 8. Where things live

| Thing                             | Location                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| ADRs                              | `apps/docs/content/adr/NNNN-<slug>.md`                                                                    |
| Companion design specs            | `apps/docs/content/adr/NNNN-<slug>-design.md`                                                             |
| Feature specs                     | `apps/docs/content/specs/features/NNN-<slug>/{NNN-requirements.md, NNN-design.md, NNN-scenarios.feature}` |
| Tech specs (brainstorm)           | `apps/docs/content/specs/tech/<topic>.md`                                                                 |
| **Project skill catalog**         | **`apps/docs/content/skills/<name>/SKILL.md`**                                                            |
| Glossary                          | `apps/docs/content/product/glossary/` (file-per-term, Keystatic-managed)                                  |
| API contract SSOT                 | `packages/schemas/` (Zod)                                                                                 |
| DB schema SSOT                    | `packages/db/schema/` (Drizzle)                                                                           |
| Generated SDK                     | `packages/api-client/` (do not edit by hand)                                                              |
| Generated glossary IDs            | `packages/glossary/ids.ts` (do not edit by hand)                                                          |
| Lint tools                        | `tools/lint/*.ts`                                                                                         |
| Bootstrap script                  | `tools/agent-bootstrap.ts` (run via `pnpm bootstrap`)                                                     |
| Strategic / cross-team work-items | Plane workspace `doctor-school` (projects DSP, DSC, DSM, DSO)                                             |
| DS Platform code-level Issues     | **GitHub Issues** in this repo                                                                            |

**Tracker rule** (ADR-0006 §9): `gh` CLI first for code-level Issues; `pp-plane` only for cross-tracker references (e.g., a Plane DSO-XXX milestone cited from an ADR or spec).

---

## 9. Local Dev Stand

The local dev stand (Postgres, Redis, MinIO, `idp`, Centrifugo, Cerbos, Mailpit) runs as a Docker Compose stack. It is a **two-layer model** (setup-design §2.1): a portable contract in git (`infra/dev-stand/compose.core.yml`, `.env.example`, README) plus a per-developer recipe kept outside git (`.env.local`, `compose.override.yml`). The rules below are **portable** — they hold on every recipe. Recipe-specific endpoints, paths, and failure modes live in the developer's personal `~/.ds-platform/AGENT_NOTES.md`, never here.

Full design: [`local-dev-environment-setup-design`](./apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md) (§8 AI-agent integration). Bootstrap checklist, DX-command cheat sheet, and container-isolation rules: [`infra/dev-stand/README.md`](./infra/dev-stand/README.md).

### 9.1 Endpoints — read from `.env.local`, never hardcode

Service endpoints (`DATABASE_URL`, `REDIS_URL`, `S3_ENDPOINT`, `CENTRIFUGO_URL`, `CERBOS_URL`, `IDP_ISSUER`, `SMTP_HOST`…) are **recipe-specific** and live in the developer's `~/.ds-platform/.env.local`. Agents read them from there (or from the running process env) — they MUST NOT hardcode a host or port in code, specs, or this file. The `HOST` differs per recipe (`truenas.local`, `localhost`, a cloud VM…); a hardcoded endpoint silently breaks every other recipe.

### 9.2 DX commands

The stack is driven by `pnpm dev:*` (env-driven launcher `tools/dev/run.mjs`, DSP-156): it reads `.env.local`, picks the transport, and runs `docker compose` against the stand. Full cheat sheet (`dev:up` / `down` / `status` / `logs` / `restart` / `psql` / `snapshot` / `rollback` / `reset-db` / `config`) with per-command behavior: [`infra/dev-stand/README.md` → DX commands](./infra/dev-stand/README.md#dx-commands).

### 9.3 Rules for agents

- **Snapshot before migrate.** Before `pnpm drizzle:migrate`, ALWAYS run `pnpm dev:snapshot pre-mig-<short-desc>` first. The `drizzle:migrate` wrapper chains this automatically (setup-design §9.2), but a manual migration or a raw `drizzle-kit migrate` call bypasses the wrapper — snapshot first by hand.
- **Never edit files inside volumes.** Container volumes (Postgres `pgdata`, Redis dumps, MinIO buckets) hold **live data**. Do not edit, copy over, or `rm` files inside them directly — go through the service (`psql`, an S3 client) or a snapshot/rollback. A direct write to a live `pgdata` corrupts the database.
- **LAN endpoints are trusted, not egress.** Dev-stand services are LAN endpoints — the LAN is classified as a trusted network (setup-design §8.3). Do NOT route stand traffic (e.g. `truenas.local`) through the egress PII scanner (ADR-0011); these are intra-zone calls.
- **No source code on the remote Docker host.** Only Docker volumes live on a remote box. `apps/*` and `packages/*` stay on the developer's local NVMe (setup-design §2.2).

### 9.4 Baseline failure modes

| Symptom                          | Check                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack not running / service down | `pnpm dev:status`, then `pnpm dev:logs <service>` / `pnpm dev:restart <service>`.                                                                                                                                      |
| Endpoint unreachable             | Verify the value in `.env.local`; confirm the service is up via `dev:status`.                                                                                                                                          |
| Host port already in use         | Inspect listening ports (`netstat` / `ss`); remap the host-side port in the recipe override.                                                                                                                           |
| `*.local` host does not resolve  | mDNS failure — fall back to the static IP. Recipe-specific causes (Windows network profile, WSL2 NAT) and the static IP are in the developer's `AGENT_NOTES.md` and `infra/dev-stand/README.md` → Bootstrap checklist. |
