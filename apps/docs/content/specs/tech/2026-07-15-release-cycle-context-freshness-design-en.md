---
title: "DS Platform — Release Cycle & Deterministic Context Freshness — Design [EN]"
description: "Establish a mature merge→release→deploy cycle (git tag + GitHub Release + GitHub Deployment record) and make a session's model of production reality DERIVED from that cycle at SessionStart via gh + a health probe, never hand-authored prose and never an in-repo dynamic file. Root-cause fix for #927: the lead groomed the backlog three times on a prod model three releases stale because 'what is shipped / current phase' lived as rot-prone text in AGENTS.md §1 and agent memory. Direction A (full cycle) approved by owner 2026-07-15; revised after an adversarial spec review (GO-WITH-CHANGES). §10 (2026-07-16, #996) closes the release-INITIATION gap: a changeset-less product/app-only wave got no release; the deploy-trigger policy is now the D+B hybrid and the agent-run deploy initiates the release at the deployed SHA (release == what shipped) — an AGENTIC step, not a human operator's."
slug: release-cycle-context-freshness
status: Draft
lang: en
---

> **EN (this)** — tech-spec, EN-only (RU split is for product feature-specs only).

# DS Platform — Release Cycle & Deterministic Context Freshness — Design

**Date:** 2026-07-15 · **Revised:** 2026-07-16 (#996 — see §10)
**Status:** Draft — design locked in brainstorm 2026-07-15 (owner picked Direction A), then revised after an adversarial spec review that returned **GO-WITH-CHANGES** (two blockers fixed here: the L1 trigger, and the committed manifest → now record-in-GitHub only). **§10 (2026-07-16, #996)** is an amendment layered on top of the as-built #927 cycle (now CLOSED, shipped): it settles the **deploy-trigger policy** (the crux left unaddressed here) and moves release **initiation** from the Version-Packages merge to the agent-run deploy (Option A). §10 explicitly supersedes the release-initiation clauses of §0, §D2 and §3 (each carries a forward pointer); the record cycle (§D3/§D4), tag format (§D6), and topology (ADR-0012) are unchanged.
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

**Non-purpose (explicitly out).** No change to the deploy **topology** (ADR-0012 stands: 2-VPS docker-compose, `git archive` over SSH, no registry). No switch to a different deploy target. No npm publishing (packages remain `access: restricted`). No move off changesets for per-package changelogs. No CI-triggered automatic prod deploy — deploy stays an explicit, gated action; this original scope adds the **record + the un-skippable nudge**, not auto-shipping. **(§10 amendment, #996):** that action is **agentic, not a human operator's** — the agent runs `deploy:prod` under the D+B trigger policy (§10.2), with a human circuit-breaker only for escalate-class changes (§10.3). It is still **not** fully-automatic CI-on-merge: the agent _initiates_ on a releasable-unit signal, CI does not. Auto-deploy-on-merge (model A) remains out of scope (§9, §10.2).

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

> **Superseded by §10.5 (#996, 2026-07-16) for the _initiator_.** The Version-Packages-merge **trigger** described here does not reliably fire for a **changeset-less** product/app-only wave (no changeset → no `Version Packages` commit → no cut), so such a wave never initiates a release (#994 was the surfacing case). §10.5 moves release **initiation** to the agent-run `deploy:prod` (Option A): the deploy cuts `release-YYYY.MM.DD-n` at the **deployed** SHA (release == what shipped), reusing this section's tag-id + `--generate-notes` machinery. The `release-YYYY.MM.DD-n` **format** (§D6), the auto-notes categories (`.github/release.yml`), and `cut-release.mjs`'s pure seams are unchanged; only _what triggers the cut, and at which SHA_ changes.

**D3 — Deploy record lives in GitHub, not in the repo.** _(Review blocker 2 — the committed manifest is dropped.)_ On a successful `deploy:prod`, the tool creates a GitHub **Deployment** (`environment: production`, `ref = deployed sha`) + a `deployment_status` (`success`, `log_url` = health URL, `description` = the release-notes summary), and **persists the Mattermost release-notes payload into that Deployment** (as the description/body). There is **no committed `deployed.json`**: committing from a deploy that ships `origin/main` would push to `main` outside the PR/CI convention, is undefined when run from a maintenance branch, and creates a self-referential "+1 ahead of deployed SHA" delta. GitHub is already the canonical moving-target store and the bootstrap is already network-dependent, so an in-repo mirror buys ~nothing and costs those hazards.

**D3a — the Mattermost chat digest is fired from CI off that `success` status, not from `deploy:prod` (#968), and is anchored on the previous RELEASE TAG (#975).** The aggregated digest (#868) is a DEPLOY event, and `deploy:prod` ships off-CI (ADR-0012) where `secrets.MATTERMOST_WEBHOOK_URL` does not exist — so it had never fired (the interim `.env.local` fallback, #950, was a crutch that duplicated the secret onto the operator box and silently skipped when absent; it is retired). The `deployment_status: success` the deploy records (D3) is exactly the trigger: `.github/workflows/release-digest.yml` fires on it for `environment: production` (plus a manual `workflow_dispatch` with an optional `sha` input — empty resolves to the current prod deployed SHA, else HEAD — to re-fire a missed digest), and posts via the ONE `release-notes.mjs` render+POST seam (`tools/ci/post-release-digest.mjs`) — where the webhook secret already lives. The **prev-sha** is the commit of the latest `release-*` tag that is a **strict ancestor** of the deployed sha (a tag AT the sha is excluded), ordered by the tag's `release-YYYY.MM.DD-<n>` date + same-day ordinal (`git tag --list 'release-*' --merged`); with **no prior release tag** the baseline is the repo-root first commit, so the range is the full history — matching the GitHub Release's own `--generate-notes` "since the previous release" (D2). Anchoring on the previous _Deployment_ instead (the pre-#975 design) made the **inaugural** digest empty: the prior deploy already carried all product work, so the deploy-to-deploy delta was tooling-only and the digest wrongly read "no user-facing changes" while the Release notes listed the whole history. A digest a release announces must describe **that release**, the same range as its Release notes. The deploy RECORDS; CI POSTS. Webhook is CI-secret-only; `--dry-run` renders offline. Non-fatal: a post failure WARNs, never fails the workflow.

**D4 — Context derivation (layer 3, the rescoped #927).** `tools/agent-bootstrap.ts` gains a **`## Project reality`** section, derived (never authored) from three live sources with graceful degradation:

- **What's deployed** — the latest `production` GitHub Deployment (`gh api`), cross-checked against **`GET /v1/health → {version:sha}`** (the running container = ground truth). Deployment = recorded intent; health = reality. If they disagree, or the Deployment is missing while health has a SHA, the section flags it loudly.
- **What shipped** — the latest GitHub Release (tag + date). For the **cumulative scope** (what the product _spans_, the thing that actually went stale — not just what last changed), the section points at `gh release list` / the Releases page as the authoritative shipped-history, rather than trying to auto-enumerate surfaces from a single delta.
- **The gap** — the merged-but-not-deployed delta: `git log <deployedSha>..origin/main` product-PR count, so a session sees "N product changes merged, NOT yet on prod" (the #904 blind spot made visible, and the un-skippable "deploy me" nudge).

It follows the `main-sync.ts` pattern exactly: an I/O **probe** seam (`gh`/`git`/health) → a **pure classifier** `evaluateProjectReality` (no I/O) → **message formatters**, unit-tested with fabricated probes. Path handling reuses the existing normalizers (`isSharedMainTree`, `encodeProjectSlug`).

**D5 — Purge the live-scope assertion from `AGENTS.md §1`; a single positive-invariant guard.** _(Review shrank this.)_ §1 loses its enumerated surface list + phase claim and keeps only the **stable rule**: "production is live; never tell the owner 'no production'; the authoritative deployed scope is the derived `## Project reality` bootstrap section + GitHub Releases/Deployments — never inferred from these docs." The guard-test asserts the **positive invariant** (that pointer sentence is present in §1) rather than blocklisting an open-ended set of stale phrasings, and is scoped to `AGENTS.md §1` only. It does **not** scan memory files (they legitimately narrate pre-pilot history). Memory `feedback_no_dynamic_release_state_in_prose` records the rule for authors.

**D6 — Release-train id.** Tags use `release-YYYY.MM.DD-<n>` (date + same-day ordinal), monotonic, human-legible, decoupled from per-package semver (which continues under changesets). The GitHub Release title mirrors the tag. The production GitHub Deployment references the release tag it shipped (in its `description`/payload).

## 3. Architecture — the three layers

> **§10.7 (#996) revises this diagram's initiation edge.** Under the §10.5 amendment the repo-level release is cut by the **agent-run `deploy:prod`** at the deployed SHA — not by the `Version Packages` merge — and "human runs `pnpm deploy:prod`" below becomes "**agent** runs `pnpm deploy:prod`" under the D+B trigger policy (§10.2). The three-layer decomposition (L1/L2/L3) is otherwise unchanged; L1 relocates from the merge event to the deploy pipeline. See §10.7 for the revised flow.

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

- **Auto-deploy-on-merge:** deferred. Once the record cycle exists, a gated auto-deploy is a small follow-up — tracked separately, not in this spec. **(Update, #996):** the _trigger_ question is now answered — **not** auto-on-merge (model A, still rejected), but **D+B**: the agent _initiates_ the deploy on a releasable-unit signal, under a standing owner authorization with a circuit-breaker (§10.2). Fully-automatic CI-on-merge remains deferred.
- **Surface inventory:** if a session ever needs a precise "what does the product span" beyond `gh release list`, deriving it from the deployed app's route/nav manifest is a future option — out of scope here; the cumulative Releases list is the interim answer.

---

## 10. Release initiation & deploy-trigger policy (amendment — #996, 2026-07-16)

> **This section is an amendment layered on the as-built #927 cycle** (§1–§9, shipped and CLOSED: #939/#942/#943/#944/#968/#975). It supersedes only the release-**initiation** and deploy-**trigger** clauses called out by the forward pointers in §0, §D2, §3. Everything else — the GitHub Deployment record (§D3), the `## Project reality` derivation (§D4), the Mattermost digest anchoring (§D3a), the `release-YYYY.MM.DD-n` tag format (§D6), and the deploy **topology** (ADR-0012) — is unchanged. **Tracker:** #996.

### 10.1 The gap this closes (verified 2026-07-16)

The #927 cycle records and derives correctly, but it never answered **what triggers a prod deploy**, and its release **initiator** silently skips a whole class of waves:

- **Release notes are not the hole.** `cut-release.mjs` uses GitHub `--generate-notes`, which sweeps **all** merged PRs in the range (app-only included). Notes are complete whenever a release is cut.
- **The trigger is the hole.** `release.yml`'s `tag-release` job fires only `if: startsWith(head_commit.message, 'Version Packages')` (§D2) — a commit the changesets bot produces **only if ≥1 changeset exists**, and `cut-release.mjs`'s secondary guard additionally requires a `package.json` version delta. A **product/app-only wave with no changeset** (apps are `private:true` but **versioned** and **not** in changeset `ignore`, so they _can_ carry changesets — they just often don't) therefore **never initiates a release**. It is only swept into the _next_ release when some unrelated changeset-bearing PR triggers a cut.
- **Evidence.** PR #994 (portal app-shell, 008) merged `d565767` to `main` with **no changeset** → no `release-*` of its own; it reaches prod only via the deploy `Deployment` record + Mattermost digest, never a GitHub Release. Changeset authoring is an **unenforced convention** (`AGENTS.md §2`), so nothing caught it. As of 2026-07-16 prod (`447c3c5`) is behind `main` (`d565767`), and #994 sits **unreleased + undeployed**.
- **The agentic-ownership defect.** Several docs frame release-cutting + deploy as a **human "operator"** step (`repo-conventions.md`, `run-prod-deploy/SKILL.md`, `AGENTS.md`, this spec's §0/§3). Per owner (2026-07-16) that is itself part of the bug: cutting tags/notes/Releases **and** deploying is the **agent's** responsibility, with the human as a circuit-breaker, not the operator.

> **Do not "fix" the symptom by rushing #994 into a release/deploy.** The fix is the model below (owner directive 2026-07-16). #994's pending-deploy delta stays deferred until the §10.5 trigger lands.

### 10.2 Deploy-trigger policy = **D + B hybrid** (owner-decided 2026-07-16, verbatim "Да, фиксируй D+B")

This is the **north star**, upstream of the tag-cut mechanism (§10.5). A live platform with real users cannot deploy "из пустоты" — there must be a defined rollout policy. The policy is a hybrid of two candidate models (the full candidate set — A continuous / B owner-commanded / C cadence-train / D releasable-unit — is recorded in #996):

- **D (releasable-unit completion) — the driver.** The agent ships to prod when a **releasable unit** reaches Done **and** passes the **release-readiness checklist** (§10.4). A releasable unit is a vertical slice / feature-spec iteration / milestone that is: merged to `main`, board **Status = Done**, and **Stage-B GO**. Readiness is **detected by the agent** — the merged-not-deployed delta the bootstrap already surfaces (§D4, `## Project reality`) is the detection signal, not a passive "cue". Deploy is agentic, not a human-initiated step.
- **B (owner circuit-breaker) — the gate.** For **standing-auth change-classes** (§10.3) the agent ships **autonomously** under a standing owner authorization. For **escalate change-classes** it surfaces a **one-line** "ready to ship X — go?" and waits. A human circuit-breaker stays on a live medical platform; the agent is the driver.

**The unit of a deploy is the whole `origin/main` delta, not just the trigger.** `deploy:prod` ships `origin/main`'s SHA (§1), so a D-trigger from unit X actually ships **every** PR in `deployedSha..origin/main`. Therefore the readiness checklist and the change-class judgment (§10.3/§10.4) apply to the **entire range**, not only the triggering unit — a single escalate-class or not-yet-Stage-B'd PR anywhere in the range forces the whole deploy to escalate. This is why a session must not merge a half-ready sibling into `main` ahead of a standing-auth deploy: it would drag the deploy into escalation (or, worse, ship un-certified work). Corollary: keep `main` continuously shippable.

**Decision rule under uncertainty: escalate.** When a change's class is ambiguous, it is escalate — mirroring the repo's "unsure → major" convention (`repo-conventions.md §Commits`) and the circuit-breaker principle. The cost of a needless one-line "go?" is trivial; the cost of an autonomous risky ship on a medical platform is not.

### 10.3 Change-class taxonomy (standing-auth vs escalate)

The class is judged over the **whole deploy range** (§10.2). Default to **escalate** when uncertain.

| Signal in the range                                                                                                                                                         | Class                   | Rationale                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App/UI-only** (portal / admin / promo / cms), behavioural or visual, **no DB migration**, Stage-B GO                                                                      | **standing-auth**       | The #994 class. App-tier only; `--rollback <sha>` reverts instantly with no DB concern.                                                                                       |
| **Additive backend** with an **expand-only, backward-compatible migration** (new nullable column / new table / new index; prior app code still runs against the new schema) | **standing-auth**       | Expand/contract rule (§`tools/deploy` README, ADR-0012 §Consequences) keeps an app rollback DB-safe; the pre-migrate pgbackrest checkpoint (deploy step 4) anchors a restore. |
| **Docs / content / tooling** that only affects build-time or non-prod surfaces                                                                                              | **standing-auth**       | No runtime prod surface changes.                                                                                                                                              |
| **Any contracting / destructive / data-backfill migration** (dropped or renamed column, type narrowing, non-reversible data change)                                         | **escalate**            | An app rollback would then need a DB rollback (pgbackrest restore, RTO ≤2 h). Owner confirms the migration is safe to run.                                                    |
| **Auth / payment / medical-record / PII-touching** runtime flows                                                                                                            | **escalate**            | Highest blast radius on a live medical platform; explicit human circuit-breaker.                                                                                              |
| **Breaking API / SDK-consumer** change (removed/renamed export, changed signature or field semantics)                                                                       | **escalate**            | Cross-app contract risk; mirrors the "unsure → major" bump default.                                                                                                           |
| **Infra / topology / deploy-tooling / secret / config** change, or anything touching the **data-prod** plane beyond an additive migration                                   | **escalate**            | Outside the app tier; ADR-0012 territory.                                                                                                                                     |
| Range includes a PR **not yet Stage-B GO**, or work from a **parallel unit not certified** by this session                                                                  | **escalate**            | Do not ship un-reviewed visual/behavioural surface autonomously.                                                                                                              |
| **First deploy after a long gap / unusually large accumulated delta**                                                                                                       | **escalate** (judgment) | A big blast radius warrants a human glance even if each PR is individually standing-auth.                                                                                     |

The taxonomy is deliberately conservative — the owner set the frame ("standing-auth for _defined_ classes, escalate the riskier ones, human circuit-breaker on a live medical platform"). The owner refines the boundary at this spec's review; the standing-auth set can widen once the cycle has a track record.

### 10.4 Release-readiness checklist (gates a D-trigger)

Before an agent ships — autonomously (standing-auth) or after a "go" (escalate) — it runs this checklist over the **whole deploy range** (`deployedSha..origin/main`). It reuses and is anchored on the **`deploy-checklist`** skill (`engineering:deploy-checklist`); this is the release-cycle-specific instantiation:

1. **Range enumerated** — the merged-not-deployed product PRs are listed (bootstrap `## Project reality` delta + `git log <deployedSha>..origin/main`), and the releasable unit that triggered the deploy is among them.
2. **All Stage-B GO** — every `user-facing` PR in the range records `Stage-B: GO` (or `Stage-B: N/A (no visual surface) — lead-certified`). A missing verdict = **stop** (§10.3 forces escalate/hold).
3. **CI green at the deploy SHA** — `pnpm merge:gate` / `gh api …/commits/<sha>/check-runs` green for `origin/main`'s head (the deploy pre-flight already hard-requires this; the checklist confirms it before the D-decision).
4. **Migrations safe** — every migration in the range is **expand/contract** (backward-compatible); any contracting/destructive/backfill migration flips the class to **escalate** (§10.3). The pre-migrate pgbackrest `incr` checkpoint (deploy step 4) is the restore anchor.
5. **Rollback ready** — the app-only `--rollback <sha>` path is available (target images retained — last 3 per repo) and the DB is untouched by an app rollback (guaranteed by step 4's expand/contract).
6. **Clean deploy environment** — clean working tree, local `main` fast-forwarded to `origin/main` (so the record/digest code that runs matches the shipped SHA) — the deploy pre-flight enforces this; the checklist names it so a session verifies it _before_ deciding to ship.
7. **No live broadcast in progress (эфир gate).** The `<60s` container recreation of a `docker compose up -d` deploy (ADR-0012 §Consequences — no built-in rolling update; blue-green is a pilot trigger, not yet automated) interrupts in-flight API calls and any `api → Centrifugo` publishing during the window — a viewer inside a live webinar room can see a stall/reconnect. So a deploy **must not run while a webinar broadcast is live**, regardless of change-class — this is a **timing** gate orthogonal to §10.3 (even a standing-auth app-only change waits). Concretely: the session checks for an active room/broadcast before shipping (query the webinar/room live-state, e.g. Centrifugo presence or the room service's "live" flag); if one is live, the deploy **holds** until it ends, or — for a non-urgent change — binds to the ADR-0012 §5 maintenance window (02:00–06:00 MSK). An **urgent** fix that must ship mid-broadcast is by definition **escalate**: surface "эфир live — ship X now anyway? (viewers may blip)" and ship only on the owner's explicit go. (Detection wiring — shipped by T2, §10.8: `pnpm deploy:check-live`, a read-only probe of the public upcoming-broadcasts listing (`GET /v1/public/events`, any item with `state: "live"`), wired into the `deploy:prod` pre-flight as a fail-closed hold — `LIVE`/`UNKNOWN` both refuse; escape hatch `--allow-live-broadcast` for the owner-approved urgent-ship path.)

A **standing-auth** deploy proceeds when 1–7 pass. An **escalate** deploy — or any standing-auth deploy blocked by the эфир gate (7) — sends the one-line "ready to ship X — go?" first, then proceeds on the owner's go. Any checklist failure holds the deploy and is surfaced, never silently worked around.

### 10.5 Release-cut mechanism — **Option A** (the agent-run deploy initiates the release)

**Confirmed: Option A.** The agent-run `pnpm deploy:prod` becomes the release **initiator**. On a successful deploy the pipeline cuts **one** repo-level release at the **deployed SHA**:

- **What is cut.** `release-YYYY.MM.DD-n` (§D6 format, unchanged) with GitHub `--generate-notes` diffed **since the previous `release-*` tag** — reusing `cut-release.mjs`'s `nextReleaseTag` + the `gh release create --generate-notes` seam. **Release == what shipped**: the tag sits exactly at the SHA now live on prod.
- **Where it hooks.** In `tools/deploy/prod.mjs`, a new step **before `recordDeployment`** (`prod.mjs:485`). Cutting the release first means the subsequent GitHub Deployment record (§D3) references the **freshly-cut** tag — today `recordDeployment` reads `gh release list --limit 1` (`prod.mjs:505`), which under the old model returns a _stale_ release for a changeset-less wave. Order: **deploy succeeds → cut release at deployed SHA → record Deployment(refs new tag) → `deployment_status: success` fires the CI digest.**
- **Guard change (drop the version-delta gate for this path).** `cut-release.mjs:102-110` skips unless the HEAD commit bumps a `package.json` `version`. A changeset-less wave has **no** version delta, so this guard is exactly what suppresses its release — it must **not** gate the deploy-initiated cut. It is replaced, for this path, by a **non-empty-range guard**: cut **only if the deployed SHA is a strict descendant of the latest `release-*` tag** — i.e. the git range **`latestReleaseSha..deployedSha`** (commits reachable from the deployed SHA but not from the latest release tag) is **non-empty**. (Note the order: `A..B` is "in B, not in A"; a normal forward deploy has new commits _after_ the last release, so the last-release tag is `A` and the deployed SHA is `B`. `git rev-list --count latestReleaseSha..deployedSha > 0`, equivalently `git merge-base --is-ancestor latestReleaseSha deployedSha` AND the two SHAs differ.) A redeploy of an already-released SHA (the two SHAs are equal → empty range), or a deploy with nothing new since the last release, **skips green** (no empty release). `nextReleaseTag`'s same-day ordinal handles multiple releases per day.
- **Target the deployed SHA, not local HEAD.** `cut-release.mjs` currently targets `HEAD`; the deploy path must pass the **deployed** SHA (`origin/main`'s SHA the deploy fixed at pre-flight) as `--target`, so the tag lands on what shipped even if local `HEAD` differs.
- **Retire the Version-Packages-merge trigger for the repo-level release.** With the deploy as the sole initiator, `release.yml`'s `tag-release` job (§D2) would otherwise cut a **second**, _ahead-of-prod_ release at merge time — two releases for overlapping ranges, and a "latest release" that is not what's deployed. So the `tag-release` **trigger is retired** (the job is removed or its `if:` gutted). The changesets **`release` job stays** — it maintains per-package `version` bumps + `CHANGELOG.md` (the §D1 changelog mechanism); only the repo-level **release cut** moves to deploy time. Per-package changesets remain the changelog SSOT; the repo-level release binds to the deploy.
- **Digest compatibility (unchanged).** The CI Mattermost digest (§D3a, #975) anchors `prev-sha` on the previous `release-*` tag that is a **strict ancestor** of the deployed SHA — it **excludes** a tag _at_ the deployed SHA. Cutting the release _before_ the Deployment record therefore leaves the digest's range identical to the Release's own `--generate-notes` range: both "since the previous release". No change to `post-release-digest.mjs` is required by Option A.

**Rejected alternatives (per #996, restated for the record):**

- **B — a standalone `release:cut` command the agent must remember.** Rejected: same forget-to-run failure mode as the unenforced changeset. Initiation must ride on an action the agent already takes (the deploy), not a separate ceremony.
- **C alone — an "app-changeset" CI guard as the initiator.** Rejected as the _initiator_: the empty-changeset trick still trips `cut-release.mjs:105`'s version-delta guard, and a guard cannot _cut_ a release. A soft CI guard nudging a changeset / `## Product note (RU)` on user-facing app PRs is retained **only** as complementary **CHANGELOG hygiene** (§10.8, optional), never the release trigger.

### 10.6 Agentic ownership — no human "operator"

Cutting tags/notes/GitHub Releases **and** deploying is the **agent's** job (owner, emphatic, 2026-07-16). The framing corrections split by truth-at-time to avoid doc-ahead-of-code drift (the very rot this program fights, `feedback_no_dynamic_release_state_in_prose`):

- **Corrected in the #996 spec session (true now):** every "manual / operator-box / human runs" **framing** of the deploy → **agentic**. The agent already runs `deploy:prod`; "human operator" was always aspirationally wrong. Files: `repo-conventions.md`, `run-prod-deploy/SKILL.md`, `AGENTS.md §2`, this spec (§0/§3). **ADR-0012 is left as-is** — its "operator" hits are the _tool-choice_ sense (who picks Coolify vs Dokploy), not a release-deploy actor claim (confirmed by read, 2026-07-16); and it is live-in-prod topology, amended only via an ADR-revision if ever.
- **Corrected by the tooling PR (true only once Option A ships):** the _mechanism_ line "the **Version Packages** merge cuts the release" → "the **agent-run deploy** cuts the release at the deployed SHA". This is **not** corrected in the spec session — the docs must keep describing the **live** mechanism until §10.5's tooling lands, or they would assert an unimplemented cycle. The Option-A tooling PR (§10.8) carries this doc edit atomically with the code.

### 10.7 Revised flow (supersedes §3's initiation edge)

```
 merge PR ──► release.yml (changesets/action) maintains "Version Packages" PR
                 └─► on its merge: per-package version bump + CHANGELOG.md   (changelog SSOT — §D1, KEPT)
                     (the tag-release job's repo-level cut is RETIRED — §10.5)
                 ▼
 releasable unit Done + Stage-B GO ──► [D-trigger] agent runs release-readiness checklist (§10.4)
                 │
                 ├─ standing-auth class (§10.3) ─► agent ships autonomously
                 └─ escalate class ─────────────► agent: "ready to ship X — go?" ─► owner go ─► ship
                 ▼
 agent runs `pnpm deploy:prod`  (ADR-0012 topology unchanged; ships origin/main)
                 │  on success (all non-fatal to the deploy):
                 ├─► [L1'] cut release-YYYY.MM.DD-n at the DEPLOYED sha (--generate-notes since prev release-*)
                 ├─► [L2]  gh: create Deployment(production, sha) + status(success)  ⟵ refs the fresh tag
                 └─► [L2]  persist release-notes payload INTO the Deployment; CI digest fires off `success`
                 ▼
 next SessionStart ──► `pnpm bootstrap` ──► [L3] ## Project reality (latest release == deployed sha; delta → next D-trigger)
```

The three testable units are unchanged in shape (§3); **L1 relocates** from a `release.yml` job on the merge event to a step in the deploy pipeline (`prod.mjs`), and its guard changes from version-delta to non-empty-range (§10.5).

### 10.8 Tooling decomposition (the #996 issues — opened blocked_by this spec on `main`)

Each is a `tooling` Issue, full fields, `blocked_by` this spec landing on `main` (the spec is the contract they implement). Single critical path:

- **T1 · Option-A release-cut on deploy (core).** `prod.mjs`: add the cut step before `recordDeployment`, targeting the deployed SHA. `cut-release.mjs`: add a deploy-initiated entry that takes an explicit `targetSha` and swaps the version-delta guard for the non-empty-range guard (keep the pure `nextReleaseTag`/`parseReleaseTag` seams + their unit tests). `release.yml`: retire the `tag-release` trigger. **Atomically** carries the §10.6 _mechanism_ doc edits (`repo-conventions.md`, `AGENTS.md §2`, `run-prod-deploy/SKILL.md`, `tools/deploy/README.md` release-record table). Pure-seam unit tests (non-empty-range guard; target-SHA plumbing) per §6.
- **T2 · D+B trigger operationalisation.** Encode the release-readiness checklist (§10.4) + change-class taxonomy (§10.3) into the `run-prod-deploy` skill and/or the `deploy-checklist` skill so a session executes them deterministically; wire the bootstrap `## Project reality` delta as the explicit D-trigger detection signal (surface "releasable unit ready — standing-auth | escalate" rather than a passive cue); and wire the **live-эфир detection** for §10.4 item 7 (query the webinar/room live-state — Centrifugo presence or the room service "live" flag — and hold/escalate a deploy while a broadcast is live). Doc/skill + a read-only live-state probe; no prod-code risk. Shipped (#1000): the §10.4 checklist is a runnable procedure in `run-prod-deploy`, the bootstrap delta line renders the derived `standing-auth | escalate` verdict (`classifyDeployRange`, default-escalate), and `pnpm deploy:check-live` (wired into the deploy pre-flight) is the live-эфир probe.
- **T3 · (optional) CHANGELOG-hygiene CI guard.** A **soft** guard nudging a changeset / `## Product note (RU)` on user-facing app PRs — complementary hygiene, **explicitly not** the release initiator (§10.5). Lowest priority; may be declined.

### 10.9 Acceptance criteria (#996 revision)

- [ ] The revised spec defines a **deploy-trigger policy** (D+B) and a **defined release initiator for product/app-only waves** (Option A), settled, not open.
- [ ] The **change-class taxonomy** (standing-auth vs escalate) and the **release-readiness checklist** are documented and conservative (default-escalate).
- [ ] Once T1 ships: a product feature merged to `main` deterministically lands in a `release-*` GitHub Release with notes **at the deployed SHA**, as an **agentic** deploy step — no reliance on remembering a changeset, no human-operator step, no ahead-of-prod double release.
- [ ] All "operator / manual / human" release-deploy **framings** are corrected to agentic ownership (spec session); the **mechanism** description rides atomically with T1.
- [ ] Memory + instructions reconciled to the D+B / Option-A model.
