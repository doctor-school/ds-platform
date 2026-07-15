---
title: "DS Platform — Release Cycle & Deterministic Context Freshness — Design [EN]"
description: "Establish a mature merge→release→deploy cycle (git tag + GitHub Release + GitHub Deployment record) and make a session's model of production reality DERIVED from that cycle at SessionStart via gh + a health probe, never hand-authored prose and never an in-repo dynamic file. Root-cause fix for #927: the lead groomed the backlog three times on a prod model three releases stale because 'what is shipped / current phase' lived as rot-prone text in AGENTS.md §1 and agent memory. Direction A (full cycle) approved by owner 2026-07-15; revised after an adversarial spec review (GO-WITH-CHANGES)."
slug: release-cycle-context-freshness
status: Draft
lang: en
---

> **EN (this)** — tech-spec, EN-only (RU split is for product feature-specs only).

# DS Platform — Release Cycle & Deterministic Context Freshness — Design

**Date:** 2026-07-15
**Status:** Draft — design locked in brainstorm 2026-07-15 (owner picked Direction A), then revised after an adversarial spec review that returned **GO-WITH-CHANGES** (two blockers fixed here: the L1 trigger, and the committed manifest → now record-in-GitHub only).
**Type:** Process + tooling design. Establishes a release/deploy record cycle and rewires session-context assembly to derive from it. Not an ADR (it does not re-decide deploy topology — ADR-0012 stands); it adds the release-record + context-derivation layer on top.
**Tracker:** GitHub #927 (root — rescoped from "flag stale §1" to "derive context from a real release cycle"). Child issues per §7 wave plan.
**Applies (not inherits):** ADR-0012 (deploy topology — 2-VPS docker-compose), the pre-pilot deploy-slice design (2026-07-02), AGENTS.md §1–§6.

---

## 0. Purpose and non-purpose

**Purpose.** Two coupled outcomes:

1. **A mature release cycle** — every merge to `main` flows through a deterministic `merge → version → tag + GitHub Release → deploy → Deployment record` chain, so "what shipped, when" and "what is deployed to prod, at which SHA" are **queryable machine-readable artifacts in GitHub**, not tribal knowledge or a one-shot chat message.
2. **Session context derived from that cycle** — at SessionStart the bootstrap **derives** the project's production reality (latest release, deployed SHA + date, merged-not-deployed delta) from the GitHub Release/Deployment records + a live health probe, and surfaces it. The always-on prose (AGENTS.md §1, agent memory) **stops asserting dynamic scope/phase** and instead points at the derived source.

**Root cause being fixed.** Session `5fbaaa9c` (2026-07-15) groomed the backlog three times on a "003-auth-only / pre-pilot / зачаточный DS" model that was three releases stale, because that model was hand-written prose in `AGENTS.md §1` + memory `reference_prod_deploy_reality`. Prose describing a **moving target** rots between owner corrections. Per Anthropic's own guidance (_Effective context engineering for AI agents_), dynamic state must be **fetched/generated just-in-time**, not baked into prompts/memory; Claude Code's `/doctor` actively strips from CLAUDE.md anything derivable from the environment. "What is in prod" is exactly that.

**Design invariant (from the review): no dynamic state lands anywhere static.** Not in prose, and not in a committed file either. The moving-target record lives ONLY in GitHub's canonical trackers (Releases, Deployments) + the live app (`/v1/health`). A session reads them at start; nothing to hand-maintain, nothing to rot.

**Non-purpose (explicitly out).** No change to the deploy **topology** (ADR-0012 stands: 2-VPS docker-compose, `git archive` over SSH, no registry). No switch to a different deploy target. No npm publishing (packages remain `access: restricted`). No move off changesets for per-package changelogs. No CI-triggered automatic prod deploy — deploy stays an explicit human action; we add the **record + the un-skippable nudge**, not auto-shipping. Auto-deploy on merge is a possible future, out of scope here.

## 1. Current state (audited 2026-07-15)

- **Versioning:** changesets, `access: restricted`, all packages `private:true`. `release.yml` (push→main) runs `changesets/action`, maintaining the "Version Packages" bot PR; on its merge `changeset publish` runs but is a **no-op** (nothing published) → the action's `published` output is **always false** and it **never creates a git tag or GitHub Release**.
- **Tags / Releases:** **none exist** (`git tag`, `gh release list` both empty).
- **CHANGELOGs:** per-package `apps/*/CHANGELOG.md`, `packages/*/CHANGELOG.md` — version + PR/SHA + one-line scope, **no dates**.
- **Deploy:** `pnpm deploy:prod` (`tools/deploy/prod.mjs`) — manual local command. Preflight hard-requires a **clean tree** and ships **`origin/main`'s SHA** over SSH (tolerating `HEAD != origin/main`), tagging containers `ds-api:<sha>` etc. No CI trigger, no cron. The only durable deploy record today is the running container image tag (read back via SSH `docker inspect`) and the live `GET /v1/health → {version:<sha>}`.
- **Release notes:** `tools/deploy/release-notes.mjs` (#868) renders a Mattermost digest of `prevSha..newSha` product PRs — but was invoked only from the local `deploy:prod` path (ADR-0012, off-CI), where `secrets.MATTERMOST_WEBHOOK_URL` is absent, so it had **never actually fired**, and its output was **webhook-only, never persisted** (D3/D3a below resolve both).
- **gh token:** local token carries `repo` scope (covers `repo_deployment`); creating GitHub Deployments needs no extra auth.
- **Prose drift set:** `AGENTS.md §1` (enumerates surfaces + "no pre-pilot"); memory `reference_prod_deploy_reality`, `MEMORY.md` line, `project_infra_deploy_prepilot_recon`, `feedback_phase0_merge_gate_manual`. (Memory files that narrate pre-pilot **history** are NOT rewritten — only §1's live-scope assertion is; see D5.)
- **Bootstrap:** `tools/agent-bootstrap.ts` (SessionStart hook `pnpm bootstrap`) surfaces git/Issues/PR/spec state + a STALE-MAIN banner via the `main-sync.ts` seam; already fully network-dependent (every Issue/PR line is a live `gh` call) and hard-ruled never-throw/exit-0. Carries **zero** release/deploy-scope signal — the #927 gap.

## 2. Design decisions (technical forks resolved — post-review)

**D1 — Release granularity: repo-level release train, not per-package npm releases.** Private, deployed product, no npm consumers. Per-package changeset CHANGELOGs stay as the changelog mechanism, but the **release** a session/deploy reasons about is a single whole-repo cut: one tag + one GitHub Release per release. "What is deployed" is one app tree at one SHA, not N independently-versioned packages.

**D2 — Tag + GitHub Release trigger = the version-bump commit, NOT changesets-action outputs.** _(Review blocker 1.)_ Because every package is private/restricted, `changeset publish` is inert: `published` is always false and `hasChangesets` is false on every changeset-less push — neither is a usable "Version Packages just merged" signal. Instead, the L1 job triggers when the commit pushed to `main` **is the Version-Packages merge**, detected by the squash-commit subject beginning `Version Packages` (changesets' default PR/commit title; the repo squash-merges) — with a `package.json` version-delta check as a secondary guard. It then cuts one repo-level git tag + a GitHub Release with **GitHub auto-generated notes** (categorised via a new `.github/release.yml`, which does not exist yet and W3 creates). GitHub stamps the Release date + immutable tag — fixing "no dates" for free. Auto-notes diff "since the previous release," so the **first** release needs a baseline (W0).

**D3 — Deploy record lives in GitHub, not in the repo.** _(Review blocker 2 — the committed manifest is dropped.)_ On a successful `deploy:prod`, the tool creates a GitHub **Deployment** (`environment: production`, `ref = deployed sha`) + a `deployment_status` (`success`, `log_url` = health URL, `description` = the release-notes summary), and **persists the Mattermost release-notes payload into that Deployment** (as the description/body). There is **no committed `deployed.json`**: committing from a deploy that ships `origin/main` would push to `main` outside the PR/CI convention, is undefined when run from a maintenance branch, and creates a self-referential "+1 ahead of deployed SHA" delta. GitHub is already the canonical moving-target store and the bootstrap is already network-dependent, so an in-repo mirror buys ~nothing and costs those hazards.

**D3a — the Mattermost chat digest is fired from CI off that `success` status, not from `deploy:prod` (#968).** The aggregated digest (#868) is a DEPLOY event, and `deploy:prod` ships off-CI (ADR-0012) where `secrets.MATTERMOST_WEBHOOK_URL` does not exist — so it had never fired (the interim `.env.local` fallback, #950, was a crutch that duplicated the secret onto the operator box and silently skipped when absent; it is retired). The `deployment_status: success` the deploy records (D3) is exactly the trigger: `.github/workflows/release-digest.yml` fires on it for `environment: production`, resolves the `prevSha..newSha` range from the Deployment event + `gh api …/deployments`, and posts via the ONE `release-notes.mjs` render+POST seam (`tools/ci/post-release-digest.mjs`) — where the webhook secret already lives. The deploy RECORDS; CI POSTS. Webhook is CI-secret-only; `--dry-run` renders offline. Non-fatal: a post failure WARNs, never fails the workflow.

**D4 — Context derivation (layer 3, the rescoped #927).** `tools/agent-bootstrap.ts` gains a **`## Project reality`** section, derived (never authored) from three live sources with graceful degradation:

- **What's deployed** — the latest `production` GitHub Deployment (`gh api`), cross-checked against **`GET /v1/health → {version:sha}`** (the running container = ground truth). Deployment = recorded intent; health = reality. If they disagree, or the Deployment is missing while health has a SHA, the section flags it loudly.
- **What shipped** — the latest GitHub Release (tag + date). For the **cumulative scope** (what the product _spans_, the thing that actually went stale — not just what last changed), the section points at `gh release list` / the Releases page as the authoritative shipped-history, rather than trying to auto-enumerate surfaces from a single delta.
- **The gap** — the merged-but-not-deployed delta: `git log <deployedSha>..origin/main` product-PR count, so a session sees "N product changes merged, NOT yet on prod" (the #904 blind spot made visible, and the un-skippable "deploy me" nudge).

It follows the `main-sync.ts` pattern exactly: an I/O **probe** seam (`gh`/`git`/health) → a **pure classifier** `evaluateProjectReality` (no I/O) → **message formatters**, unit-tested with fabricated probes. Path handling reuses the existing normalizers (`isSharedMainTree`, `encodeProjectSlug`).

**D5 — Purge the live-scope assertion from `AGENTS.md §1`; a single positive-invariant guard.** _(Review shrank this.)_ §1 loses its enumerated surface list + phase claim and keeps only the **stable rule**: "production is live; never tell the owner 'no production'; the authoritative deployed scope is the derived `## Project reality` bootstrap section + GitHub Releases/Deployments — never inferred from these docs." The guard-test asserts the **positive invariant** (that pointer sentence is present in §1) rather than blocklisting an open-ended set of stale phrasings, and is scoped to `AGENTS.md §1` only. It does **not** scan memory files (they legitimately narrate pre-pilot history). Memory `feedback_no_dynamic_release_state_in_prose` records the rule for authors.

**D6 — Release-train id.** Tags use `release-YYYY.MM.DD-<n>` (date + same-day ordinal), monotonic, human-legible, decoupled from per-package semver (which continues under changesets). The GitHub Release title mirrors the tag. The production GitHub Deployment references the release tag it shipped (in its `description`/payload).

## 3. Architecture — the three layers

```
 merge PR ──► release.yml (changesets/action) maintains "Version Packages" PR
                 ▼
   merge "Version Packages" PR  (squash subject "Version Packages…")
                 └─► [L1] release.yml job: cut tag release-YYYY.MM.DD-n
                          + GitHub Release (auto-notes since prev release)
                 ▼
   human runs `pnpm deploy:prod`  (unchanged topology; ships origin/main)
                 │  on success (all non-fatal to the deploy):
                 ├─► [L2] gh: create GitHub Deployment(production, sha) + status(success)
                 └─► [L2] persist release-notes payload INTO the Deployment (+ Mattermost)
                 ▼
   next SessionStart ──► `pnpm bootstrap`
                 └─► [L3] ## Project reality  (derived via gh + health; never prose/file):
                          latest release tag+date · deployed sha (Deployment ⋈ health) ·
                          merged-not-deployed delta · reconcile flag on mismatch
```

**Unit boundaries (each independently testable):**

- `L1` — a job in `release.yml` + a small `tools/release/cut-release.mjs` (pure tag-id/next-ordinal assembly seam + `gh release create` I/O) + a new `.github/release.yml` (auto-notes categories).
- `L2` — additions to `tools/deploy/prod.mjs` + a new `tools/deploy/deployment-record.mjs` (pure `buildDeploymentPayload()` + `gh api` Deployment I/O seam). No repo write.
- `L3` — a new `tools/project-reality.ts` (probe → `evaluateProjectReality` pure classifier → formatters), wired into `agent-bootstrap.ts`; mirrors `main-sync.ts`.
- `D5` — §1 edit + one positive-invariant guard-test.

## 4. Data flow & contracts

- **GitHub Deployment (the record):** `POST /repos/{o}/{r}/deployments` `{ ref:<sha>, environment:"production", auto_merge:false, required_contexts:[] }` → `POST …/deployments/{id}/statuses` `{ state:"success", log_url:<healthUrl>, description:<release-notes summary incl. releaseTag> }`. Queryable by any session via `gh api "…/deployments?environment=production&per_page=1"`.
- **`## Project reality` bootstrap section** (example):
  ```
  ## Project reality (derived from GitHub Releases/Deployments + /v1/health — never edit docs to state this)
  - Latest release: release-2026.07.15-1 (2026-07-15)
  - Deployed to prod: b9d81e6 (2026-07-15) — health ✓ matches Deployment record
  - Merged since deploy: 3 product PR(s) NOT yet on prod — run `pnpm deploy:prod` to ship.
  - Full shipped scope: see `gh release list` (cumulative), not this line.
  ```
- **Reconcile flag** fires — a loud, non-crashing banner — when: the production Deployment is missing but health reports a SHA ("deployed but unrecorded — the record cycle was skipped"); Deployment SHA ≠ health SHA ("record disagrees with reality"); or neither source is reachable ("prod-reality could not be derived — check GitHub Releases/Deployments before stating scope"). Bootstrap hard-rule: always exit 0.

## 5. Error handling

Every new seam obeys the bootstrap/main-sync hard rule: **never throw, always degrade to a printable banner + exit 0.** L3 degradation order: GitHub Deployment (via `gh`) → `/v1/health` (ground truth) → GitHub Release only → a "reality-source unavailable" banner. `deploy:prod`'s new record steps are **non-fatal** to the deploy itself (a deploy that shipped but failed to record must **warn**, not roll back) — mirroring how `release-notes.mjs` is already non-fatal. The L1 job failing to cut a tag must not break `release.yml`'s existing version-PR maintenance.

## 6. Testing

Vitest, `tools/lint/guard-tests/*.spec.ts` (convention: `*.spec.ts`). Each layer's **pure** seam is unit-tested with fabricated inputs — no git/FS/network — exactly as `main-sync.spec.ts` drives `evaluateMainSync`:

- `evaluateProjectReality` — deployed⋈health agree / disagree / Deployment-missing-but-health-present / all-unreachable / merged-not-deployed-delta; platform-agnostic paths.
- `buildDeploymentPayload` — payload shape from (sha, releaseTag, notes summary); ISO stamp shape.
- `cut-release` — tag-id format `release-YYYY.MM.DD-n`, same-day ordinal increment off the existing tag list.
- Guard-test (D5) — asserts `AGENTS.md §1` contains the positive pointer-sentence invariant (not a blocklist).

Integration smoke of the `gh`/SSH/health seams is manual (owner-run), consistent with deploy tooling today.

## 7. Wave plan (decomposition — single critical path; each wave its own child issue under #927, its own PR(s), Mode-a review, CI-green merge)

- **W0 · Baseline (unblocks everything; tiny, mostly one-time).** Freeze the `release-YYYY.MM.DD-<n>` tag format; cut a **baseline GitHub Release + tag** on the current `origin/main` head; probe `/v1/health` for the currently-deployed SHA and register a **baseline `production` GitHub Deployment** for it. Rationale: L1 auto-notes need a previous release to diff against, and L3 needs a record to read — without a baseline the first `## Project reality` is empty. No app-code touch.
- **W1 · L3 context derivation + §1 purge + guard (the recurrence-killer; #927 core).** `tools/project-reality.ts` + `evaluateProjectReality` tests + bootstrap wiring; D5 §1 edit + the positive-invariant guard-test; write memory `feedback_no_dynamic_release_state_in_prose` (already done this session). Depends on **W0** (reads its baseline). Delivers the owner-visible fix first.
- **W2 · L2 deploy record (makes it self-sustaining going forward).** `tools/deploy/deployment-record.mjs` + `buildDeploymentPayload` tests + wire into `prod.mjs`; persist release-notes into the Deployment. Touch-set `tools/deploy/*` — disjoint from W1; parallelisable after W0.
- **W3 · L1 tag + GitHub Release automation.** `release.yml` job (version-bump-commit trigger) + `tools/release/cut-release.mjs` + `.github/release.yml`. Touch-set `.github/` + `tools/release/*` — disjoint from W1/W2; parallelisable.
- **W4 · docs + skills.** `/wrap` deploy checkpoint, a new `/deploy` runbook skill, `AGENTS.md §2` versioning note, `tools/deploy/README.md`. **Sequenced after W1** (both edit `AGENTS.md` — W1 §1, W4 §2 — so serialise to avoid a conflict).

Dependency edges: `W1 blocked_by W0`; `W4 blocked_by W1`; `W2`, `W3` blocked_by nothing but land the sustaining automation (run after/alongside W0→W1). No orphan issues; all children of #927.

## 8. Acceptance criteria (rolls up the original #927 AC, corrected)

- [ ] A session's `pnpm bootstrap` prints a `## Project reality` section derived from the GitHub production Deployment + `/v1/health` + latest Release — no hand-authored scope prose, no committed dynamic file.
- [ ] `AGENTS.md §1` no longer enumerates live deploy scope/phase; it points at the derived section; a guard-test asserts that pointer invariant.
- [ ] `deploy:prod` records each successful deploy as a GitHub Deployment + status, with the release-notes payload persisted into it (not chat-only).
- [ ] Merging the "Version Packages" PR cuts a git tag + GitHub Release with dated auto-generated notes (triggered by the version-bump commit, not changesets-action `published`).
- [ ] The bootstrap surfaces the merged-but-not-deployed delta and flags a Deployment-vs-health mismatch (the #904 blind spot made visible).
- [ ] A baseline release + baseline production Deployment exist so the first derived `## Project reality` is non-empty.
- [ ] Every new seam has a pure-classifier unit test with platform-agnostic paths; nothing throws at SessionStart.
- [ ] Memory `feedback_no_dynamic_release_state_in_prose` documents the "no dynamic state in prose (or committed files)" rule.

## 9. Open questions / deferred

- **Auto-deploy-on-merge:** deferred. Once the record cycle exists, a gated auto-deploy is a small follow-up — tracked separately, not in this spec.
- **Surface inventory:** if a session ever needs a precise "what does the product span" beyond `gh release list`, deriving it from the deployed app's route/nav manifest is a future option — out of scope here; the cumulative Releases list is the interim answer.
