# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo. Vendor-agnostic — readable by Claude Code, Codex, Cursor, or any future agent. Claude-Code-specific overlays live in `CLAUDE.md`.

---

## 1. What is DS Platform

DS Platform is the medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). Greenfield monorepo in **Phase 0** — architectural ADRs (0001–0008) accepted, engineering scaffolding in progress. Pre-pilot target: **2026 Q3**.

Stack at a glance (see `apps/docs/content/adr/` for full reference):

- **Backend:** NestJS + Zod + REST + openapi-typescript SDK (ADR-0002)
- **Data:** Postgres 17 + Drizzle + pgvector (ADR-0003)
- **Frontend:** Next.js 15 + Refine — 4 apps (promo / portal / admin / cms-Payload-v3) (ADR-0004)
- **Mobile:** React Native + Expo + WatermelonDB (ADR-0005)
- **Docs:** Fumadocs + Keystatic + glossary.yaml (ADR-0006)

Long-form context: `README.md`.

---

## 2. Repository conventions

**Monorepo:** pnpm 10 workspaces + Turborepo 2.x. Root commands run via `pnpm <script>`; per-package via `pnpm --filter <name> <script>`.

**Apps live in `apps/<name>/`:** api, promo, portal, admin, cms, docs, docs-cms, mobile. Shared code in `packages/<name>/`. Build/dev tooling in `tools/`.

**Branch strategy:** trunk-based; short-lived branches off `main`, squash-merge back. Naming (`<prefix>/<N>-<slug>`, `N` = GitHub Issue # — or `<TRACKER-ID>` for Plane-driven work without a GitHub Issue, e.g. `chore/dsp-193-repo-hygiene`):

- `feat/` — new feature
- `fix/` — bug fix
- `chore/` — maintenance task
- `refactor/` — code restructure without behavior change
- `docs/` — documentation-only changes
- `tooling/` — build / CI / dev-tooling changes

Dependabot branches (`dependabot/...`) — leave as-is, do not rename.

**Stale branches.** Auto-deleted on merge via `--delete-branch` in the squash-merge command. For PRs closed **without** merge, delete the branch in the same step (`gh pr close <N> --delete-branch`). Do not leave un-merged branches alive longer than the PR they came from. Dependabot branches Dependabot owns — closing the PR is enough; Dependabot will recreate when a new bump arrives.

**Post-merge inventory re-sweep.** After merging a PR that touches `.changeset/`, `.github/workflows/*`, dependency manifests, or security configs, re-run `gh pr list` and `git ls-remote --heads origin` once more before declaring the session done. Automation-generated bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge and would otherwise leave the repo non-clean.

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Squash-merge title enforced via PR title.

**Versioning:** changesets. User-facing PR → `pnpm changeset`. Internal-only (refactor/docs/chore) — no changeset.

**Bump letter** (semver, per package):

- `patch` — bugfix; no API change; no new exports; no consumer-visible behavior change.
- `minor` — additive change: new feature, new exports, new optional fields, new endpoints; no breaking change.
- `major` — breaking change: removed or renamed exports, changed function signatures, changed return shapes, changed semantics of an existing field, raised minimum runtime/Node version, removed support for an option.
- Pre-1.0 (`0.x.y`) follows the same rule: `0.x → 0.(x+1)` is `minor` only if no breaking change; if there is a breaking change, bump `major` (`0.x → 1.0`). We don't reuse `0.x` minors to hide breakage.
- When unsure between `minor` and `major`, default to `major` — consumers can pin loosely against minor but cannot recover from an undetected breaking change shipped as minor.

**Pre-commit:** simple-git-hooks runs `lint-staged` (ESLint `--fix` + Prettier). `--no-verify` is a valid escape hatch — log the reason in the PR description.

**PR template required** — set label (`feature` / `bug` / `chore` / `refactor` / `docs` / `tooling`), link Issue (`Closes #N`), mark author (`author:claude` / `author:codex` / `author:human`).

**Branch protection.** Target-state contract (ADR-0008 §2.6) is enforced by convention + local hooks during Phase 0; server-side enforcement is deferred per ADR-0008 Amendment A3 (GitHub Free + private repo blocks the branch-protection API). Verbatim payload at `branch-protection.json`. See ADR-0008 §2.6 + A3 for the full contract and reactivation trigger.

**Merge command (single, mandatory):**

```bash
gh pr merge <PR-number> --auto --squash --delete-branch
```

`--auto` waits for CI; `--squash` enforces linear history; `--delete-branch` cleans up.

**ADRs** live in `apps/docs/content/adr/`, rendered at `/adr/<slug>`. Paired design spec — `NNNN-<slug>-design.md`.

**Feature specs** live in `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `requirements.md`, `design.md`, `scenarios.feature`). One spec → multiple Issues (one per EARS-handler). Milestones are used independently of specs: a Milestone tracks a long-lived product theme (`Auth foundations v1`, `Directual cutover`, `Doctor portal MVP`) that typically spans multiple specs and lives weeks–months. Specs themselves do not become Milestones. Format spec moved into `apps/docs/content/skills/author-ears-spec/SKILL.md`.

---

## 2.1 Issue conventions

New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton (Context / Scope / Spec reference / Acceptance criteria / Dependencies / Notes). Agents resuming In Progress items read the latest stop-state comment first. Stop-state comments follow a fixed four-field shape — see `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md` §6 for the canonical form. The board ordering procedure (resume → rework → fresh → unblock) is documented in §5 of the same spec.

---

## 3. Work protocol

Every agent session, regardless of vendor, follows this three-step entry — **identify task kind → cite entry point → load skill**.

### 3.1 Identify task kind

| Kind              | Trigger                                                       | Skill                                                         |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| feature-iteration | One EARS handler inside an existing feature-spec              | `apps/docs/content/skills/do-feature-iteration/SKILL.md`      |
| hotfix-pr         | Code-level bug; no feature-spec required                      | `apps/docs/content/skills/do-hotfix-pr/SKILL.md`              |
| adr-amendment     | Edit to an existing ADR                                       | `apps/docs/content/skills/do-adr-amendment/SKILL.md`          |
| decision-debt     | Closing a silent-decision artifact surfaced earlier           | `apps/docs/content/skills/do-decision-debt-followup/SKILL.md` |
| engineering-task  | Phase A bootstrap (DSP-160 sub-issue), CI hardening, scaffold | No skill — follow the task spec directly                      |
| spec-authoring    | New feature-spec / new ADR / new design-spec                  | `superpowers:brainstorming` (sole allowed exception)          |

If the kind is ambiguous, stop and ask Tech Lead.

### 3.2 Cite the entry point

In the first user-facing reply, state: kind, active artifact (Issue #N / spec path / ADR section), skill being dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly. Do not rely on vendor-specific auto-discovery — **the path is the contract**.

### 3.4 Superpowers whitelist (single exception)

`superpowers:brainstorming` is the only `superpowers:*` skill allowed for project work, and only for spec-authoring. After brainstorming concludes, **do not chain into `superpowers:writing-plans`** — the `requirements.md` / `design.md` triplet is the plan (ADR-0007 §2.4 via `do-feature-iteration`). All other `superpowers:*` skills, and any chain initiated internally by a superpowers skill, are explicitly disallowed for project work. They may be referenced as implementation patterns inside project SKILL.md content, but not as the orchestrator.

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

Per ADR-0007 Amendment A1.3 (2026-05-19). Three modes:

- **Mode (a)** — same-session subagent dispatch with `request-mode-a-review` skill. Lead agent finishes work → dispatches subagent with the reviewer prompt → subagent reads diff + spec + ADRs and returns a structured verdict (APPROVE / REQUEST_CHANGES).
- **Mode (b)** — parallel Codex CLI session reviewing the PR independently.
- **Mode (c)** — pure human review in the GitHub UI.

LLM credentials live in the human's terminal, not in CI secrets. **No automated reviewer-bot.**

**Merge gate.** A positive Mode (a) or Mode (b) verdict + green CI is sufficient to merge via `gh pr merge --auto --squash --delete-branch`; human-merge is **not** required (ADR-0007 Amendment A1.4 refined + Amendment A2). Mode (c) reviews remain a single human decision. Procedure detail: `apps/docs/content/skills/request-mode-a-review/SKILL.md` and `apps/docs/content/skills/merge-when-green/SKILL.md`.

---

## 5. Lint guards

The CI lint guards from ADR-0007 §2.6 (Amendment A1.5) act as nudges visible in the PR Checks UI for the human reviewer and the author-agent. Full table lives in **ADR-0007 §2.6**. `spec-link` is BLOCK; others are WARN in Phase 0.

---

## 6. Hard rules

- **SDD.** No production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`. If absent, invoke `superpowers:brainstorming` per §3.4 to author one.
- **TDD.** No production code without a failing test. Naming: `it('EARS-N: ...')`. Flat numbering per ADR-0006 Amendment A1; nested `N.M` only when a single handler carries multiple shall-clauses.
- **Trackers.** Code-level → GitHub Issues here; strategic / cross-team → Plane workspace `doctor-school`. Never both.
- **Plane lifecycle.** When the task is a Plane work-item: move to `In Progress` with a start comment before code work; on completion, move to `Done` with a result comment containing artifacts (links to files/PRs/pages), what was done, open questions, and what is unblocked. If the task stays incomplete, leave a status comment with "where we stopped / what remains" instead of dropping it silently. Tooling: `plane-pp-cli` for reads; Plane MCP (`mcp__plane-pp-mcp__*`) for state changes and comments (see §3.7).
- **Roles, not names** in any spec / ADR / design doc.
- **Direct push to `main` is forbidden.** Single merge command: `gh pr merge <N> --auto --squash --delete-branch`.
- **Project skill catalog.** Only `apps/docs/content/skills/`. Vendor-specific skill auto-discovery is not used to dispatch project work. The path is the contract.
- **Discipline gates.** `run-iteration-end-checklist` and `request-mode-a-review` produce artifacts the lead agent cannot bypass — whether dispatched by an orchestration skill or run directly for an engineering-task (§3.8). Without their outputs, merge is forbidden (ADR-0007 Amendment A2).
- **Decision-debt.** Any silent deviation from a documented convention MUST surface via `surface-decision-debt`. The output may be `[]`, but the invocation is required before the iteration summary — or, for an engineering-task, before the Plane / Issue result comment (§3.8).

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

| Thing                             | Location                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| ADRs                              | `apps/docs/content/adr/NNNN-<slug>.md`                                                |
| Companion design specs            | `apps/docs/content/adr/NNNN-<slug>-design.md`                                         |
| Feature specs                     | `apps/docs/content/specs/features/NNN-<slug>/{requirements,design,scenarios.feature}` |
| Tech specs (brainstorm)           | `apps/docs/content/specs/tech/<topic>.md`                                             |
| **Project skill catalog**         | **`apps/docs/content/skills/<name>/SKILL.md`**                                        |
| Glossary                          | `apps/docs/content/product/glossary/` (file-per-term, Keystatic-managed)              |
| API contract SSOT                 | `packages/schemas/` (Zod)                                                             |
| DB schema SSOT                    | `packages/db/schema/` (Drizzle)                                                       |
| Generated SDK                     | `packages/api-client/` (do not edit by hand)                                          |
| Generated glossary IDs            | `packages/glossary/ids.ts` (do not edit by hand)                                      |
| Lint tools                        | `tools/lint/*.ts`                                                                     |
| Bootstrap script                  | `tools/agent-bootstrap.ts` (run via `pnpm bootstrap`)                                 |
| Strategic / cross-team work-items | Plane workspace `doctor-school` (projects DSP, DSC, DSM, DSO)                         |
| DS Platform code-level Issues     | **GitHub Issues** in this repo                                                        |

**Tracker rule** (ADR-0006 §9): `gh` CLI first for code-level Issues; `pp-plane` only for cross-tracker references (e.g., a Plane DSO-XXX milestone cited from an ADR or spec).
