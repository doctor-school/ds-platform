<!-- Auto-loaded reference (epic #247 / #250; no `paths:` frontmatter ⇒ always-on, in context every session).
     Relocated from AGENTS.md §2 / §2.1 — the detail behind §2's one-liners. -->

# Repository conventions (reference)

Canon: AGENTS.md §2 — the core carries the one-line rule; this file carries the detail and is auto-loaded with it. Consult it when opening a branch/PR, cutting a changeset, bumping a dependency, or opening Issues from a spec.

## Monorepo layout

pnpm 10 workspaces + Turborepo 2.x. Root commands run via `pnpm <script>`; per-package via `pnpm --filter <name> <script>`. Apps live in `apps/<name>/` (api, promo, portal, admin, cms, docs, docs-cms, mobile); shared code in `packages/<name>/`; build/dev tooling in `tools/`.

## Branches

Trunk-based; short-lived branches off `main`, squash-merge back. Naming `<prefix>/<N>-<slug>` (`N` = GitHub Issue #, or `<TRACKER-ID>` for Plane-driven work without an Issue, e.g. `chore/dsp-193-repo-hygiene`). Prefixes: `feat/` (feature), `fix/` (bug), `chore/` (maintenance), `refactor/` (restructure, no behavior change), `docs/` (docs-only), `tooling/` (build / CI / dev-tooling). Dependabot branches (`dependabot/...`) — leave as-is, do not rename.

**Stale branches.** Auto-deleted on merge via `--delete-branch` in the squash-merge command. For PRs closed **without** merge, delete the branch in the same step (`gh pr close <N> --delete-branch`). Do not leave un-merged branches alive longer than the PR they came from. Dependabot branches Dependabot owns — closing the PR is enough; Dependabot recreates when a new bump arrives.

**Post-merge inventory re-sweep.** After merging a PR that touches `.changeset/`, `.github/workflows/*`, dependency manifests, or security configs, re-run `gh pr list` and `git ls-remote --heads origin` once more before declaring the session done. Automation-generated bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge and would otherwise leave the repo non-clean.

## Commits, versioning, PRs

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Squash-merge title enforced via PR title.

**Versioning:** changesets. User-facing PR → `pnpm changeset`. Internal-only (refactor/docs/chore) — no changeset.

**Bump letter** (semver, per package): `patch` = bugfix, no API or consumer-visible behavior change; `minor` = additive (new feature / exports / optional fields / endpoints), no breaking change; `major` = breaking (removed or renamed exports, changed signatures, return shapes, or field semantics, raised runtime floor, removed option). Pre-1.0 follows the same rule — a breaking `0.x` goes to `1.0`, never a hidden `0.x` minor. When unsure between `minor` and `major`, default to `major`: consumers can pin loosely but cannot recover from an undetected breaking change shipped as minor.

**Pre-commit:** simple-git-hooks runs `lint-staged` (ESLint `--fix` + Prettier). `--no-verify` is a valid escape hatch — log the reason in the PR description.

**PR template required** — set kind label (`feature` / `bug` / `chore` / `refactor` / `docs` / `tooling`), link Issue (`Closes #N`), mark author in the **body** (`author:claude` / `author:codex` / `author:human`). Note: `author:*` is a body marker, not a label that `gh pr create --label` accepts (memory `reference_pr_author_label_not_real`).

**PR-event-gated guards run only after push — pre-flight them locally.** `registry-research`, `spec-link`, `prior-decisions`, and `spec-status-fresh` are hard-gated to `GITHUB_EVENT_NAME=pull_request` + a PR number, so they **cannot** run pre-push — a missing PR-body marker (e.g. the `registry-research:` line a UI-touching PR needs) surfaces as a CI red + rerun, not a local failure. Right after `gh pr create` and **before** dispatching Mode (a), run **`pnpm pr:preflight <N>`** against the LIVE PR — it sets `GITHUB_EVENT_NAME=pull_request PR_NUMBER=<N>` and runs all four guards in one shot, reporting a per-guard PASS/FAIL summary and exiting non-zero if any fails, so a missing PR-body marker / spec link is fixed in the same beat instead of surfacing as a CI red + rerun.

**Branch protection.** Target-state contract (ADR-0008 §2.6) is enforced by convention + local hooks during Phase 0; server-side enforcement is deferred — GitHub Free + private repo blocks the branch-protection API. Verbatim payload at `branch-protection.json`. See ADR-0008 §2.6 for the full contract, the interim process-level substitutes, and the reactivation trigger.

## Dependency bumps

Two hard-won checks on any `dependencies` / `chore(deps)` / "upgrade X → Y" task (memory `feedback_dep_bump_verification`):

1. **Verify the REAL pins first** — read the actual versions in `apps/*/package.json` / `packages/*/package.json` (+ `pnpm ls <pkg> -r` for transitives) **before** trusting the Issue title/body. "Coordinated upgrade" framings are often wrong — many suites release packages independently. If the framing diverges from reality, reword/close the Issue first; never stretch it to fit.
2. **Verify the ABI, not just declared peers** — declared `peerDependencies` can lie. When the version choice hinges on a pinned peer, check the **actual imports in the installed tarball** (`grep -r "from .<peer>" node_modules/<pkg>/dist/`, or `npm pack <pkg>@<v>` + unpack + grep) rather than trusting `npm view <pkg> peerDependencies`. A CHANGELOG "moved/support X at <peer>" line in a _patch_ release signals an internal import may have shifted even though the peer-range didn't.

## ADRs & specs (where the artifacts live)

**ADRs** live in `apps/docs/content/adr/`, rendered at `/adr/<slug>`. Paired design spec — `NNNN-<slug>-design.md`.

**Feature specs** live in `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `NNN-requirements.md`, `NNN-design.md`, `NNN-scenarios.feature`). One spec → multiple Issues (one per EARS-handler): the triplet ships as **one docs-PR**, child Issues open on that branch with their numbers written back into the `issues:` frontmatter, merging on a Mode (a) verdict + green CI; per-iteration **code** PRs start only **after** the spec is on `main` (the `spec-link` BLOCK guard). Milestones are independent of specs — a Milestone tracks a long-lived product theme (e.g. `Auth foundations v1`) spanning multiple specs; specs do not become Milestones. Full format + recipe: `apps/docs/content/skills/author-ears-spec/SKILL.md` (step 7).

**Product specs (two-tier, ADR-0014).** A product epic carries a thin `apps/docs/content/specs/product/<epic>/brief.md` (JTBD, IA, feature decomposition, metrics, mined prior-art); each feature carries a co-located `specs/features/NNN-<slug>/NNN-product.md` PRD (user stories with stable `US-N` ids, flows, product acceptance). Both are product-owner-facing → EN+RU mirror (`-ru`). The PRD is the **source** of the EARS triplet, never its duplicate: each EARS clause carries `realizes: US-N` back to a PRD story. Authored upstream by `do-product-discovery` (skills `author-product-spec` + `author-design-mockup`), before the EARS `spec-authoring` step.

## Issue conventions

New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton (Context / Scope / Spec reference / Acceptance criteria / Dependencies / Notes). When opening an Issue set from a spec, native GitHub relationships are **mandatory, not optional prose**: attach each child as a **sub-issue** of the parent and set the **blocked-by/blocking** links between children — the board ordering procedure reads only this native graph (board-design §5). The recipe lives in `apps/docs/content/skills/open-ears-issues/SKILL.md` step 4. Agents resuming In Progress items read the latest stop-state comment first. Stop-state comments follow a fixed four-field shape — see `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md` §6 for the canonical form. The board ordering procedure (resume → rework → fresh → unblock) is documented in §5 of the same spec.

**On merge, set the board Status to Done by hand** — `Closes #N` closes the Issue but does NOT move the Projects v2 board column (memory `feedback_project_status_done_on_merge` carries the board ids).
