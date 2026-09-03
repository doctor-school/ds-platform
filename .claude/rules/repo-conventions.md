---
paths:
  - ".github/**"
  - ".changeset/**"
  - "tools/gh/**"
  - "tools/lint/**"
  - "tools/deploy/**"
  - "apps/docs/content/adr/**"
  - "apps/docs/content/specs/**"
---

<!-- READ-ON-DEMAND reference (`paths:` frontmatter ⇒ NOT always-on, NOT re-injected after /compact). The frontmatter MUST stay the first bytes of the file. Command-triggered gates are indexed in AGENTS.md §0; canon behind AGENTS.md §2. -->

# Repository conventions (reference)

Canon: AGENTS.md §2. Consult when opening a branch/PR, cutting a changeset, bumping a dependency, or opening Issues from a spec.

## Monorepo layout

pnpm 10 workspaces + Turborepo 2.x. Root scripts `pnpm <script>`; per-package `pnpm --filter <name> <script>`. Apps in `apps/<name>/` (api, doctor, promo, portal, admin, cms, docs, mobile, academy-demo, showcase — 10); shared code `packages/<name>/`; tooling `tools/`.

## Branches

Trunk-based; short-lived branches off `main`, squash-merge back. Naming `<prefix>/<N>-<slug>` (`N` = Issue #, or `<TRACKER-ID>` for Plane-driven work, e.g. `chore/dsp-193-repo-hygiene`). Prefixes: `feat/`, `fix/`, `chore/`, `refactor/` (no behavior change), `docs/`, `tooling/`. Dependabot branches — leave as-is; a lockfile-conflicted Dependabot PR → comment `@dependabot recreate` (`rebase` replays commits and re-hits the same conflict).

Stale branches: auto-deleted on merge via `--delete-branch`; PRs closed without merge → `gh pr close <N> --delete-branch` in the same step — no branch outlives its PR (Dependabot: closing the PR is enough).

**Closeout — from the MAIN tree, never from a worktree.** The local branch cleanup of `--delete-branch` cannot run while the primary tree holds `main` (`fatal: 'main' is already used by worktree at …`), so the gate refuses a `.claude/worktrees/*` cwd or a checked-out PR branch (exit `4`, remedy `pnpm worktree:teardown <N>`). Return to the primary tree FIRST, then run the single entry point for the complete tail:

- `pnpm pr:land <N>` — merge gate → squash-merge → board Done → `worktree:teardown` iff `.claude/worktrees/<N>` exists → re-sweep `gh pr list` + `git ls-remote --heads origin` (bot branches can appear post-merge); forwards `--mode-a-exempt`, aborts on the first non-zero stage (skill `merge-when-green` Step 2).
- `pnpm merge:when-green <N>` — only when the post-merge tail is intentionally completed separately (it stops at the merge; board Done + teardown + re-sweep are then yours by hand).
- Raw `gh pr merge <N> --squash --delete-branch` — the exception only: the Version-Packages bot branch (`--admin` REQUIRED: the branch carries no `ci` check-run, so the ruleset refuses a plain merge — the admin PR-scoped bypass is the documented hatch; no CI, no Mode-a — see _Version-Packages release PR_ below) or manual recovery. Invoked on its own statement, never downstream of a piped gate (#928).

**Recovery — remote merge landed, local cleanup failed.** Canonical procedure: skill `merge-when-green` Step 2a (confirm `state:MERGED` → verify the remote branch is gone → `git fetch origin --prune` + `git branch -D <branch>` → `pnpm worktree:teardown <N>` and assert `git worktree list` no longer shows it). Stated once there; do not re-derive it here or in `AGENTS.md`.

## Commits, versioning, PRs

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`); squash title = PR title.

**Versioning:** changesets. User-facing PR → `pnpm changeset`; internal-only (refactor/docs/chore) — none.

**Version-Packages release PR (`changeset-release/main`) merge gate.** No `ci` check-run on the bot branch — expected, and the reason the merge takes `--admin` (the ruleset’s PR-scoped bypass); no Mode-a needed. Gate: (1) touched files are ONLY release artifacts (`.changeset/*` removals, `version` fields, `CHANGELOG.md`, lockfile) — anything else = stop; (2) main CI green at the consumed head (`gh run list --branch main`). Merge when the wave it versions has landed, not mid-wave (the bot regenerates on every main push).

**Release train & prod deploy.** Prod ships when the agent runs `pnpm deploy:prod` (ADR-0012 — off-CI SSH deploy); the agent-run deploy is the release initiator (Option A): on success it cuts the `release-YYYY.MM.DD-n` tag + GitHub Release with auto-notes at the DEPLOYED SHA (release == what shipped), records a GitHub Deployment(production, sha)+`success`, and posts the Mattermost digest — all non-fatal to the deploy. The `Version Packages` PR merge cuts no repo-level release (per-package `version` + `CHANGELOG.md` only); redeploying an already-released SHA cuts nothing (non-empty-range guard). `## Project reality` (bootstrap) derives latest-release / deployed-sha (Deployment ⋈ `/v1/health`) / the merged-not-deployed delta at SessionStart — a non-empty delta is the D-trigger signal. When the agent ships = the D+B policy: a releasable unit (slice/spec/milestone Done + Stage-B GO + release-readiness checklist) ships autonomously for standing-auth change-classes; riskier classes escalate with a one-line "ready to ship X — go?" (human circuit-breaker on a live medical platform); no human "operator" step. Full policy: release-cycle spec §10 (`apps/docs/content/specs/tech/2026-07-15-release-cycle-context-freshness-design-en.md`). Deploy/merge/migrate run as their own statement, never `| tee` (a pipe masks a non-zero exit). Runbook: skill `run-prod-deploy` (`/deploy`); tooling: `tools/deploy/README.md`.

**Bump letter** (semver, per package): `patch` = bugfix, no consumer-visible change; `minor` = additive, no break; `major` = breaking (removed/renamed exports, changed signatures/return shapes/field semantics, raised runtime floor, removed option). Pre-1.0 same rule — a breaking `0.x` goes to `1.0`, never a hidden minor. Unsure → major.

**Pre-commit:** simple-git-hooks runs `lint-staged` (ESLint `--fix` + Prettier). `--no-verify` is a valid escape hatch — log the reason in the PR description.

**CI rerun ≠ free.** A `gh run rerun … --failed` that turns a red job green obliges a `DEBT.md` flake line in the same session (job + failing step + observed root cause, `promote-when: second occurrence of the same job`); the second occurrence of the same job is an Issue — an infra step that needs a readiness wait gets fixed, not retried.

**PR template required** — kind label (`feature`/`bug`/`chore`/`refactor`/`docs`/`tooling`), `Closes #N`, author marker in the body (`author:claude` / `author:codex` / `author:human`) — a body marker, not a `gh --label`.

**`track:*` on a PR is DERIVED — never hand-set (#1600).** Do not pass a track label to `gh pr create`. The `pr-track-sync` workflow reads `Closes #N`, takes the Issue's `track:*` (the Issue is the single source of truth for the axis, gated at creation by #1583) and applies it to the PR; the author types nothing. A hand-set label that contradicts the linked Issue is NOT overwritten — the check goes red (exit 2) naming both sides, because only a human knows which of the two is wrong. Nothing to derive (no `Closes #N` — Version Packages, Dependabot — or a pre-gate Issue with no track) is green and unlabeled, not an error. Consequence this closes: a track slice over the board used to drop every PR row, i.e. exactly the work in flight.

**PR board fields.** Every PR carries ≥1 assignee AND a milestone at create time (`gh pr create --assignee … --milestone …`) — the board-row mirror of the Issue Field-contract; the `assignee-milestone` preflight guard fails an unfielded live PR. Dead PR rows (merged/closed) are removed by `pnpm pr:land` on merge; the catch-all sweep (dead rows + under-fielded open PRs) lists under `pnpm backlog:triage` → PR board hygiene.

**PR-event-gated guards run only after push — pre-flight them locally.** `registry-research`, `spec-link`, `prior-decisions`, `spec-status-fresh` need `GITHUB_EVENT_NAME=pull_request` + a PR number. Right after `gh pr create`, before dispatching Mode (a), run `pnpm pr:preflight <N>` against the LIVE PR — those four guards plus the `STATIC_GUARDS` tree-scan family (`ears-naming`, `no-stub`, … — on by default in PR-number mode), per-guard PASS/FAIL, non-zero on any fail. `--no-static` skips the static family; `pnpm pr:preflight --static` (no PR number) = static-only pre-push sweep. A UI-touch PR carries the real `registry-research:` verdict (`adopted …` / `bespoke — …` / state a net-removal — `n/a`/empty rejected) and a filled `## Product note (RU)` at create time. A body edit auto re-runs the four body-parsing guards (`pr-body-guards.yml`, `edited` event); body-gated checks in `ci.yml` (e.g. `product-note`) still need `gh run rerun <run-id> --failed` after a body-only fix. Right before merge, `pnpm pr:preflight <N> --pre-merge` runs the pre-merge gates: the `stage-b` guard (fails for a `user-facing` PR unless the body or a linked-Issue comment records `Stage-B: GO` / `Stage-B: batched at #<gate>` / `Stage-B: N/A (no visual surface) — lead-certified`) plus the deterministic CI merge gate `pnpm merge:gate <N>` (head-SHA-pinned check-runs, zero registered runs = FAIL, structured status parsing, worktree-cwd refusal; canon: skill `merge-when-green` Step 1). The gate also enforces a head-SHA-pinned Mode-a APPROVE: the latest `## Mode (a) Review` PR review's native `commit_id` must equal the current head — a rework invalidates the verdict; the AGENTS.md §3.8 no-Mode-a carve-outs (pure docs / test-only / generated-regen; the Version-Packages bot PR) pass only via the explicit, loudly-printed `--mode-a-exempt "<reason>"` flag, forwarded by both `pr:preflight <N> --pre-merge` and `pnpm merge:when-green <N>`. Pre-merge gates are intentionally NOT in the create-time preflight — Stage-B is recorded, and CI terminal, just before merge.

**Branch protection.** Live server-side as the repository ruleset `main protection`: PR required, `ci` green (non-strict), linear history, no force-push, no deletion — and **zero** required approving reviews, no thread-resolution requirement (a Mode-a comment review + a single human author would otherwise deadlock every PR). Admins bypass in `bypass_mode: pull_request` only — that is the hatch the check-run-less `changeset-release/main` merge rides on, never a licence to push to `main`. Review depth + check freshness stay with `pnpm pr:land <N>`. Payload: `branch-protection.json`; rationale: ADR-0008 §2.6.

## Dependency bumps

Two mandatory checks on any `dependencies` / `chore(deps)` / "upgrade X → Y" task:

1. Verify the REAL pins first — actual versions in `apps/*/package.json` / `packages/*/package.json` (+ `pnpm ls <pkg> -r` for transitives) before trusting the Issue title/body; "coordinated upgrade" framings are often wrong. Framing diverges from reality → reword/close the Issue first, never stretch it to fit.
2. Verify the ABI, not just declared peers — `peerDependencies` can lie. When the choice hinges on a pinned peer, grep the actual imports in the installed tarball (`grep -r "from .<peer>" node_modules/<pkg>/dist/`, or `npm pack` + unpack + grep), not `npm view <pkg> peerDependencies`. A CHANGELOG "moved/support X at <peer>" line in a patch release signals a shifted internal import.

## ADRs & specs (where the artifacts live)

**ADRs:** `apps/docs/content/adr/`, rendered at `/adr/<slug>`; paired design spec `NNNN-<slug>-design.md`.

**Feature specs:** `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `NNN-requirements.md`, `NNN-design.md`, `NNN-scenarios.feature`). One spec → multiple Issues (one per EARS-handler): the triplet ships as one docs-PR, child Issues open on that branch with their numbers written back into the `issues:` frontmatter, merging on Mode (a) + green CI; per-iteration code PRs start only after the spec is on `main` (the `spec-link` BLOCK guard). Milestones are independent of specs — a Milestone is one shippable release of one track (below). Recipe: skill `author-ears-spec` (step 7).

**Product specs (two-tier, ADR-0014).** A product epic carries a thin `apps/docs/content/specs/product/<epic>/brief.md` (JTBD, IA, feature decomposition, metrics, mined prior-art); each feature a co-located `specs/features/NNN-<slug>/NNN-product.md` PRD (user stories with stable `US-N` ids, flows, product acceptance). Both product-owner-facing → EN+RU mirror (`-ru`). The PRD is the source of the EARS triplet, never its duplicate: each EARS clause carries `realizes: US-N`. Authored upstream by `do-product-discovery` (skills `author-product-spec` + `author-design-mockup`).

## Issue conventions

New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton. Opening an Issue set from a spec: native relationships are mandatory, not prose — each child a sub-issue of the parent, blocked-by/blocking links between children; the board ordering procedure reads only this native graph (recipe: skill `open-ears-issues` step 4). Resuming In Progress items: read the latest stop-state comment first; treat its premises (likewise a handoff's) as hypotheses — reconcile against the Issues/PRs it names before acting; divergence is surfaced to the owner, never silently executed. Deterministic first pass: `pnpm handoff:verify <file>` (stdin ok) on the VERBATIM handoff (never a paraphrase — re-typing injects false STALE rows): it checks every ref (#N / PR N / SHA / branch) against `gh` + `origin/main` ancestry, flags unquotable «owner-approved» claims, exits non-zero on any stale claim, and WARNs (exit 0) when an IMPLEMENTATION handoff routes a `feature:*` user-facing Issue to code with no `NNN-product.md` PRD (ADR-0014). Stop-state comments follow a fixed four-field shape (board-design spec §6, `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md`); board ordering (resume → rework → fresh → unblock): §5.

**Field contract — `pnpm issue:create` is the ONLY creation path (raw `gh issue create` forbidden).** Every Issue: one kind label (taxonomy above) → org Type auto-derived (`bug`→Bug, `feature`→Feature, else Task); one `source:*`; exactly one `track:*` — `track:academy` (academy.doctor.school surfaces, specs 012–016) | `track:doctor` (doctor showcase site `apps/doctor`, specs 017–021) | `track:platform` (shared backend/infra/process, or both sites); `feature:NNN-*` when spec-bound; a milestone (fallback «Platform ops & hardening») — the track release milestone the Issue ships in; EARS Issues inherit the parent feature's, and an epic (`epic:` title + `feature` kind) is exempt and carries none (both enforced by `pnpm issue:create` from #1729); assignee defaults `@me`. The wrapper fails closed on a missing/duplicate kind, `source:*` or `track:*` label, or a missing milestone, before any gh call, and appends the derived Type + assignee; `pnpm backlog:triage` lists pre-gate Issues under `## Field hygiene`. Issues opened before the track gate are backfilled on touch (the lead bulk-backfills the mapped ones) — no sweep Issue.

**Track ≠ milestone ≠ epic.** The track is a permanent label axis (a product never leaves its track); the milestone is **one shippable release of one track** — 1–4 features, RU-named `«<Трек> R<n> — <результат>»` («Академия R1 — Архив записей»), `R<n>` numbering within a track, the two tracks never sharing one; a long-lived theme is NOT a milestone. Per-track backlog: «Академия · Позже» / «Витрина · Позже»; platform work takes the milestone of the release it `blocked_by`-blocks, else «Platform ops & hardening». An epic carries **no milestone** — it spans releases, its progress is the native sub-issue bar and its axis the `track:*` label. An epic Issue is a closable staged container that ends when its stages land — so a track never gets an evergreen «track epic», and a stale epic left open to represent a track is a naming error to close, not a container to keep.

**Title taxonomy.** Feature `[Академия][NNN] <English title>` / `[Витрина][NNN] …` (Type Feature, carries Start/Target dates); EARS `[NNN] EARS-k: …`; release gate `gate: <milestone name>` (Type Task); epic `epic: …` (Type Feature, no milestone, no dates). RU only in milestone names (the «· Позже» backlogs and the gate title quoting one included) and in the track prefix of a feature title. The two roadmap levels — feature and release gate — additionally carry the `roadmap` label, the ONE attribute the board's Roadmap view filters on: written by `pnpm issue:create`, audited by `pnpm backlog:triage`, never hand-set. Canon: board-design spec §7.1.

**Parallel-session claim signal.** A session taking an Issue posts a one-line claim comment (canonical opener `claim:`; `Start…`/`Taking…`/`In progress…` also count) OR creates its worktree `.claude/worktrees/<N>` — before the first edit. `pnpm backlog:triage` and `pnpm bootstrap` cross-check both and mark matches `IN-FLIGHT-ELSEWHERE (worktree|start-comment, age <a>)` instead of takeable; a stop-state comment newer than the last claim releases the comment signal (worktree signal releases on teardown). The age is surfaced — an old claim is a human call, not auto-free.

**Queue-position guard on the claim (#1855).** `In Progress` is only allowed from the track's **queue head** — the open milestone with the earliest owner-set `due_on` («· Позже» is never the head) — plus «Platform ops & hardening», a `track:platform` Issue outside any track release, and an `epic:` container; anything else exits `3` naming the head and the litmus «блокирует ли это регистрацию врача и просмотр ближайшего эфира?», and is claimable only via `--ahead-of-queue "<verbatim owner quote>"`, which posts that quote as the `claim:` comment. `pnpm backlog:triage` groups takeable rows by the same rule (QUEUE-HEAD / PLATFORM / EPIC first, AHEAD-OF-QUEUE tagged with the head it jumps).

**`blocked_by` = technical dependency ONLY, with recorded rationale.** An edge means "cannot be done before" — never "we'd rather do it later"; prioritization is handoff waves, never dependency edges. Every edge carries a recorded rationale (a body/comment line on either issue naming the blocker and why); an edge with none is a provenance-orphan to challenge, not ground truth.

**§6 threshold scope + handoff provenance.** The AGENTS.md §6 significance threshold routes newly surfaced debt (Issue vs `DEBT.md` line) at surfacing time only — never re-grading or closing already-filed Issues except on explicit owner request (a drainage directive means implement, not prune). A handoff claim that a plan is «owner-directed»/«owner-approved» requires a verbatim owner quote; without one it is UNCONFIRMED agent framing, surfaced before execution — `handoff:verify` WARNs (#989) on unquoted owner-directive framing and on qualitative completeness claims («fully drained», «backlog empty» — not ref-checkable; re-derive via `pnpm backlog:triage`), a prompt to reconcile, never a substitute for the quote.

**On merge, set the board Status to Done by hand** — `Closes #N` closes the Issue but does NOT move the Projects v2 board column (board ids: memory `feedback_project_status_done_on_merge`).
