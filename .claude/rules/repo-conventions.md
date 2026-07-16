<!-- Auto-loaded reference (no `paths:` frontmatter ⇒ always-on). Detail behind AGENTS.md §2. -->

# Repository conventions (reference)

Canon: AGENTS.md §2. Consult when opening a branch/PR, cutting a changeset, bumping a dependency, or opening Issues from a spec.

## Monorepo layout

pnpm 10 workspaces + Turborepo 2.x. Root scripts `pnpm <script>`; per-package `pnpm --filter <name> <script>`. Apps in `apps/<name>/` (api, promo, portal, admin, cms, docs, docs-cms, mobile); shared code `packages/<name>/`; tooling `tools/`.

## Branches

Trunk-based; short-lived branches off `main`, squash-merge back. Naming `<prefix>/<N>-<slug>` (`N` = Issue #, or `<TRACKER-ID>` for Plane-driven work, e.g. `chore/dsp-193-repo-hygiene`). Prefixes: `feat/`, `fix/`, `chore/`, `refactor/` (no behavior change), `docs/`, `tooling/`. Dependabot branches — leave as-is.

Stale branches: auto-deleted on merge via `--delete-branch`; PRs closed without merge → `gh pr close <N> --delete-branch` in the same step — no branch outlives its PR (Dependabot: closing the PR is enough). Post-merge re-sweep: after merging a PR touching `.changeset/`, `.github/workflows/*`, dependency manifests, or security configs, re-run `gh pr list` + `git ls-remote --heads origin` before declaring the session done — bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge.

## Commits, versioning, PRs

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`); squash title = PR title.

**Versioning:** changesets. User-facing PR → `pnpm changeset`; internal-only (refactor/docs/chore) — none.

**Version-Packages release PR (`changeset-release/main`) merge gate.** No CI checks on the bot branch — expected; no Mode-a needed. Gate: (1) touched files are ONLY release artifacts (`.changeset/*` removals, `version` fields, `CHANGELOG.md`, lockfile) — anything else = stop; (2) main CI green at the consumed head (`gh run list --branch main`). Merge when the wave it versions has landed, not mid-wave (the bot regenerates on every main push).

**Release train & prod deploy.** Prod ships when the agent runs `pnpm deploy:prod` (ADR-0012 — off-CI SSH deploy); the agent-run deploy is the release initiator (Option A): on success it cuts the `release-YYYY.MM.DD-n` tag + GitHub Release with auto-notes at the DEPLOYED SHA (release == what shipped), records a GitHub Deployment(production, sha)+`success`, and posts the Mattermost digest — all non-fatal to the deploy. The `Version Packages` PR merge cuts no repo-level release (per-package `version` + `CHANGELOG.md` only); redeploying an already-released SHA cuts nothing (non-empty-range guard). `## Project reality` (bootstrap) derives latest-release / deployed-sha (Deployment ⋈ `/v1/health`) / the merged-not-deployed delta at SessionStart — a non-empty delta is the D-trigger signal. When the agent ships = the D+B policy: a releasable unit (slice/spec/milestone Done + Stage-B GO + release-readiness checklist) ships autonomously for standing-auth change-classes; riskier classes escalate with a one-line "ready to ship X — go?" (human circuit-breaker on a live medical platform); no human "operator" step. Full policy: release-cycle spec §10 (`apps/docs/content/specs/tech/2026-07-15-release-cycle-context-freshness-design-en.md`). Deploy/merge/migrate run as their own statement, never `| tee` (a pipe masks a non-zero exit). Runbook: skill `run-prod-deploy` (`/deploy`); tooling: `tools/deploy/README.md`.

**Bump letter** (semver, per package): `patch` = bugfix, no consumer-visible change; `minor` = additive, no break; `major` = breaking (removed/renamed exports, changed signatures/return shapes/field semantics, raised runtime floor, removed option). Pre-1.0 same rule — a breaking `0.x` goes to `1.0`, never a hidden minor. Unsure → major.

**Pre-commit:** simple-git-hooks runs `lint-staged` (ESLint `--fix` + Prettier). `--no-verify` is a valid escape hatch — log the reason in the PR description.

**PR template required** — kind label (`feature`/`bug`/`chore`/`refactor`/`docs`/`tooling`), `Closes #N`, author marker in the body (`author:claude` / `author:codex` / `author:human`) — a body marker, not a `gh --label`.

**PR-event-gated guards run only after push — pre-flight them locally.** `registry-research`, `spec-link`, `prior-decisions`, `spec-status-fresh` need `GITHUB_EVENT_NAME=pull_request` + a PR number. Right after `gh pr create`, before dispatching Mode (a), run `pnpm pr:preflight <N>` against the LIVE PR — those four guards plus the `STATIC_GUARDS` tree-scan family (`ears-naming`, `no-stub`, … — on by default in PR-number mode), per-guard PASS/FAIL, non-zero on any fail. `--no-static` skips the static family; `pnpm pr:preflight --static` (no PR number) = static-only pre-push sweep. A UI-touch PR carries the real `registry-research:` verdict (`adopted …` / `bespoke — …` / state a net-removal — `n/a`/empty rejected) and a filled `## Product note (RU)` at create time. A body edit auto re-runs the four body-parsing guards (`pr-body-guards.yml`, `edited` event); body-gated checks in `ci.yml` (e.g. `product-note`) still need `gh run rerun <run-id> --failed` after a body-only fix. Right before merge, `pnpm pr:preflight <N> --pre-merge` runs the pre-merge gates: the `stage-b` guard (fails for a `user-facing` PR unless the body or a linked-Issue comment records `Stage-B: GO` / `Stage-B: batched at #<gate>` / `Stage-B: N/A (no visual surface) — lead-certified`) plus the deterministic CI merge gate `pnpm merge:gate <N>` (head-SHA-pinned check-runs, zero registered runs = FAIL, structured status parsing, worktree-cwd refusal; canon: skill `merge-when-green` Step 1). The gate also enforces a head-SHA-pinned Mode-a APPROVE: the latest `## Mode (a) Review` PR review's native `commit_id` must equal the current head — a rework invalidates the verdict; the AGENTS.md §3.8 no-Mode-a carve-outs (pure docs / test-only / generated-regen; the Version-Packages bot PR) pass only via the explicit, loudly-printed `--mode-a-exempt "<reason>"` flag, forwarded by both `pr:preflight <N> --pre-merge` and `pnpm merge:when-green <N>`. Pre-merge gates are intentionally NOT in the create-time preflight — Stage-B is recorded, and CI terminal, just before merge.

**Branch protection.** Contract (ADR-0008 §2.6) enforced by convention + local hooks in Phase 0; server-side deferred (GitHub Free + private repo blocks the API). Payload: `branch-protection.json`; full contract, substitutes, reactivation trigger: ADR-0008 §2.6.

## Dependency bumps

Two mandatory checks on any `dependencies` / `chore(deps)` / "upgrade X → Y" task:

1. Verify the REAL pins first — actual versions in `apps/*/package.json` / `packages/*/package.json` (+ `pnpm ls <pkg> -r` for transitives) before trusting the Issue title/body; "coordinated upgrade" framings are often wrong. Framing diverges from reality → reword/close the Issue first, never stretch it to fit.
2. Verify the ABI, not just declared peers — `peerDependencies` can lie. When the choice hinges on a pinned peer, grep the actual imports in the installed tarball (`grep -r "from .<peer>" node_modules/<pkg>/dist/`, or `npm pack` + unpack + grep), not `npm view <pkg> peerDependencies`. A CHANGELOG "moved/support X at <peer>" line in a patch release signals a shifted internal import.

## ADRs & specs (where the artifacts live)

**ADRs:** `apps/docs/content/adr/`, rendered at `/adr/<slug>`; paired design spec `NNNN-<slug>-design.md`.

**Feature specs:** `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `NNN-requirements.md`, `NNN-design.md`, `NNN-scenarios.feature`). One spec → multiple Issues (one per EARS-handler): the triplet ships as one docs-PR, child Issues open on that branch with their numbers written back into the `issues:` frontmatter, merging on Mode (a) + green CI; per-iteration code PRs start only after the spec is on `main` (the `spec-link` BLOCK guard). Milestones are independent of specs — a Milestone tracks a long-lived product theme spanning multiple specs. Recipe: skill `author-ears-spec` (step 7).

**Product specs (two-tier, ADR-0014).** A product epic carries a thin `apps/docs/content/specs/product/<epic>/brief.md` (JTBD, IA, feature decomposition, metrics, mined prior-art); each feature a co-located `specs/features/NNN-<slug>/NNN-product.md` PRD (user stories with stable `US-N` ids, flows, product acceptance). Both product-owner-facing → EN+RU mirror (`-ru`). The PRD is the source of the EARS triplet, never its duplicate: each EARS clause carries `realizes: US-N`. Authored upstream by `do-product-discovery` (skills `author-product-spec` + `author-design-mockup`).

## Issue conventions

New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton (Context / Scope / Spec reference / Acceptance criteria / Dependencies / Notes). Opening an Issue set from a spec: native relationships are mandatory, not prose — each child a sub-issue of the parent, blocked-by/blocking links between children; the board ordering procedure reads only this native graph (recipe: skill `open-ears-issues` step 4). Resuming In Progress items: read the latest stop-state comment first; treat its factual premises (likewise a handoff's) as hypotheses — reconcile against the comments/bodies of every Issue/PR it names (`gh issue view <N> --comments` / `gh pr view <N>`) before the first action; divergence is surfaced to the owner, never silently executed. Deterministic first pass: `pnpm handoff:verify <handoff-file>` (stdin ok) on the VERBATIM handoff — never a hand-retyped paraphrase (re-typing injects false STALE rows). It checks every extractable ref (#N / PR N / SHA / branch) against `gh` state + `origin/main` ancestry, flags «owner-approved» claims with no quotable owner turn, exits non-zero on any stale claim; it also WARNs (exit 0) when an IMPLEMENTATION/feature-iteration handoff routes a `feature:*`-labelled user-facing Issue straight to code while its feature-spec has no `NNN-product.md` PRD (ADR-0014). Stop-state comments follow a fixed four-field shape — canonical form: board-design spec §6 (`apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md`); board ordering (resume → rework → fresh → unblock): §5 of the same spec.

**Parallel-session claim signal.** A session taking an Issue posts a one-line claim comment (canonical opener `claim:`; `Start…`/`Taking…`/`In progress…` also count) OR creates its worktree `.claude/worktrees/<N>` — before the first edit. `pnpm backlog:triage` and `pnpm bootstrap` cross-check both signals and mark matches `IN-FLIGHT-ELSEWHERE (worktree|start-comment, age <a>)` instead of takeable; a stop-state comment newer than the last claim releases the comment signal (the worktree signal releases on teardown). The age is always surfaced, never auto-suppressed — an old claim is a human judgment call, not an auto-free slot.

**`blocked_by` = technical dependency ONLY, with recorded rationale.** An edge means "cannot be done before" — never "we'd rather do it later"; prioritization is expressed as handoff waves, never as dependency edges. Every edge carries a recorded rationale (a body/comment line on either issue naming the blocker and why); an edge with no rationale on either side is a provenance-orphan to challenge, not ground truth.

**§6 threshold scope + handoff provenance.** The AGENTS.md §6 significance threshold routes newly surfaced debt (Issue vs `DEBT.md` line) at surfacing time only — never a mandate to re-grade or close already-filed Issues; that re-triage happens only on an explicit owner request (a drainage directive means implement, not prune). A handoff/stop-state claim that a plan is «owner-directed»/«owner-approved» requires a verbatim owner quote; without one it is UNCONFIRMED agent framing, surfaced to the owner before execution — `handoff:verify` emits a non-blocking WARN (#989) on unquoted owner-directive framing and on qualitative completeness claims («fully drained», «backlog empty», «всё вычищено» — not ref-checkable; re-derive via `pnpm backlog:triage`), but the WARN is a prompt to reconcile, never a substitute for the quote.

**On merge, set the board Status to Done by hand** — `Closes #N` closes the Issue but does NOT move the Projects v2 board column (board ids: memory `feedback_project_status_done_on_merge`).
