---
title: "DS Platform — Release Cycle & Deterministic Context Freshness — Design [EN]"
description: "Establish a mature merge→release→deploy cycle (git tag + GitHub Release + GitHub Deployment record) and make a session's model of production reality DERIVED from that cycle at SessionStart, never hand-authored prose. Root-cause fix for #927: the lead groomed the backlog three times on a prod model three releases stale because 'what is shipped / current phase' lived as rot-prone text in AGENTS.md §1 and agent memory. Direction A (full cycle) approved by owner 2026-07-15."
slug: release-cycle-context-freshness
status: Draft
lang: en
---

> **EN (this)** — tech-spec, EN-only (RU split is for product feature-specs only).

# DS Platform — Release Cycle & Deterministic Context Freshness — Design

**Date:** 2026-07-15
**Status:** Draft (design locked in brainstorm 2026-07-15; owner picked Direction A — full mature cycle)
**Type:** Process + tooling design. Establishes a release/deploy record cycle and rewires session-context assembly to derive from it. Not an ADR (it does not re-decide deploy topology — ADR-0012 stands); it adds the release-record + context-derivation layer on top.
**Tracker:** GitHub #927 (root — rescoped from "flag stale §1" to "derive context from a real release cycle"). Child issues per §7 wave plan.
**Applies (not inherits):** ADR-0012 (deploy topology — 2-VPS docker-compose), the pre-pilot deploy-slice design (2026-07-02), AGENTS.md §1–§6.

---

## 0. Purpose and non-purpose

**Purpose.** Two coupled outcomes:

1. **A mature release cycle** — every merge to `main` flows through a deterministic `merge → version → tag + GitHub Release → deploy → Deployment record` chain, so "what shipped, when" and "what is deployed to prod, at which SHA" are **queryable machine-readable artifacts**, not tribal knowledge or a one-shot chat message.
2. **Session context derived from that cycle** — at SessionStart the bootstrap **derives** the project's production reality (latest release, deployed SHA + date, scope) from the release/Deployment artifacts and surfaces it. The always-on prose (AGENTS.md §1, agent memory) **stops asserting dynamic scope/phase** and instead points at the derived source.

**Root cause being fixed.** Session `5fbaaa9c` (2026-07-15) groomed the backlog three times on a "003-auth-only / pre-pilot / зачаточный DS" model that was three releases stale, because that model was hand-written prose in `AGENTS.md §1` + memory `reference_prod_deploy_reality`. Prose describing a **moving target** rots between owner corrections. Per Anthropic's own guidance (_Effective context engineering for AI agents_), dynamic state must be **fetched/generated just-in-time**, not baked into prompts/memory; Claude Code's `/doctor` actively strips from CLAUDE.md anything derivable from the environment. "What is in prod" is exactly that.

**Non-purpose (explicitly out).** No change to the deploy **topology** (ADR-0012 stands: 2-VPS docker-compose, `git archive` over SSH, no registry). No switch to a different deploy target. No npm publishing (packages remain `access: restricted`). No move off changesets for per-package changelogs. No CI-triggered automatic prod deploy — deploy stays an explicit human action; we add the **record**, not auto-shipping. Auto-deploy on merge is a possible future, out of scope here.

## 1. Current state (audited 2026-07-15)

- **Versioning:** changesets, `access: restricted`. `release.yml` (push→main) runs `changesets/action`, maintaining the "Version Packages" bot PR; on its merge `changeset publish` runs but is a **no-op** (no npm) → **it never creates a git tag or GitHub Release**.
- **Tags / Releases:** **none exist** (`git tag`, `gh release list` both empty).
- **CHANGELOGs:** per-package `apps/*/CHANGELOG.md`, `packages/*/CHANGELOG.md` — version + PR/SHA + one-line scope, **no dates**.
- **Deploy:** `pnpm deploy:prod` (`tools/deploy/prod.mjs`) — manual local command. Ships `origin/main`'s SHA over SSH, tags containers `ds-api:<sha>` / `ds-portal:<sha>` / `ds-admin:<sha>`. Gated by clean-tree + green-CI preflight; **no CI trigger, no cron**. The **only** durable deploy record is the running container image tag (read back via SSH `docker inspect`) and the live `GET /v1/health → {version:<sha>}`.
- **Release notes:** `tools/deploy/release-notes.mjs` (#868) posts a Mattermost digest of `prevSha..newSha` product PRs after deploy — **webhook-only, never persisted**.
- **Prose drift set (to be purged of dynamic state):** `AGENTS.md §1`; memory `reference_prod_deploy_reality`, `MEMORY.md` line, `project_infra_deploy_prepilot_recon`, `feedback_phase0_merge_gate_manual`, `feedback_live_surface_staleness_is_defect`.
- **Bootstrap:** `tools/agent-bootstrap.ts` (SessionStart hook `pnpm bootstrap`) surfaces git/Issues/PR/spec state + a STALE-MAIN banner. Carries **zero** release/deploy-scope signal — the #927 gap.

## 2. Design decisions (technical forks resolved)

**D1 — Release granularity: repo-level release train, not per-package npm releases.** This is a private, deployed product with no npm consumers. The per-package changeset CHANGELOGs remain the changelog mechanism, but the **release** a session/deploy reasons about is a single whole-repo cut. One tag + one GitHub Release per release. Rationale: "what is deployed" is one app tree at one SHA, not N independently-versioned packages.

**D2 — Tagging + GitHub Release for private packages.** `changeset publish` won't tag (no npm publish). We extend `release.yml`: when the "Version Packages" PR merges (detected via `changesets/action` `hasChangesets`/published outputs, or by the version-bump commit), a job creates **one repo-level git tag** and a **GitHub Release** whose notes are GitHub **auto-generated** from merged PRs since the previous release (`.github/release.yml` categories by PR label). GitHub stamps the Release date + immutable tag — this fixes "no dates" for free. Release version = a monotonic release train id (see D6).

**D3 — Deploy record: GitHub Deployment API is the SSOT; a committed manifest mirrors it in-repo.** On a successful `deploy:prod`, the tool creates a GitHub **Deployment** (`environment: production`, `ref/sha`) + a `deployment_status` (`success`, with the health URL as `log_url`), giving a queryable per-environment history. It also writes/commits `infra/deploy/deployed.json` (`{ sha, deployedAt, releaseTag, surfaces[] }`) as the in-repo, offline-readable mirror (so the bootstrap can read prod-reality without a network/API call, degrading gracefully). The Mattermost payload is additionally persisted (attached to the Deployment or the manifest), not just POSTed.

**D4 — Context derivation (layer 3, the rescoped #927).** `tools/agent-bootstrap.ts` gains a **`## Project reality`** section derived, in priority order, from: (a) `infra/deploy/deployed.json` (offline, in-repo — primary), (b) the latest GitHub Release (tag + date + scope), (c) `GET /v1/health` deployed SHA when reachable (opportunistic, short-timeout, never blocking). It follows the `main-sync.ts` pattern exactly: an I/O **probe** seam → a **pure classifier** (`evaluateProjectReality`) → **message formatters**, unit-tested with fabricated probes (no git/FS/network). It surfaces: latest release tag+date, deployed SHA+date, and the merged-but-not-yet-deployed delta (`git log <deployedSha>..origin/main` count of product PRs) — so a session sees "N product changes merged since last deploy" (the #904 situation made visible).

**D5 — Purge dynamic scope from prose; add a guard.** `AGENTS.md §1` and the memory files lose their hand-written scope/phase assertions; §1 keeps only the **stable rule** ("production is live; never tell the owner 'no production'; the authoritative deployed scope is the derived `## Project reality` bootstrap section + GitHub Releases/Deployments — never inferred from these docs"). A lint guard (extending the existing guard-tests harness) fails if `AGENTS.md §1` / memory reintroduce enumerated deploy-scope prose (surface lists, "pre-pilot", "003-only", SHA/phase claims), so the drift cannot silently return. Memory feedback `feedback_no_dynamic_release_state_in_prose` records the rule.

**D6 — Release-train id.** Tags use `release-YYYY.MM.DD-<n>` (date + same-day ordinal), monotonic and human-legible, decoupled from per-package semver (which continues under changesets). The GitHub Release title mirrors the tag. `deployed.json.releaseTag` links a deploy to its release.

## 3. Architecture — the three layers

```
 merge PR ──► release.yml (changesets/action)
                 │  maintains "Version Packages" PR
                 ▼
   merge "Version Packages" PR ──► [L1] cut tag `release-YYYY.MM.DD-n`
                 │                        + GitHub Release (auto notes)
                 ▼
   human runs `pnpm deploy:prod` (unchanged topology)
                 │  on success:
                 ├─► [L2] create GitHub Deployment(production, sha) + status
                 ├─► [L2] write+commit infra/deploy/deployed.json (mirror)
                 └─► [L2] persist Mattermost release-notes payload
                 ▼
   next SessionStart ──► `pnpm bootstrap`
                 └─► [L3] ## Project reality  (derived, never prose):
                          latest release tag+date · deployed sha+date ·
                          merged-not-deployed delta · reconcile directive
```

**Unit boundaries (each independently testable):**

- `L1` — CI job in `release.yml` + a small `tools/release/cut-release.mjs` (pure tag/notes assembly seam + gh calls).
- `L2` — additions to `tools/deploy/prod.mjs` + a new `tools/deploy/deployment-record.mjs` (pure `buildDeployedManifest()` + gh Deployment I/O seam).
- `L3` — a new `tools/project-reality.ts` (probe → `evaluateProjectReality` pure classifier → formatters), wired into `agent-bootstrap.ts`'s banner block; mirrors `main-sync.ts`.
- `D5` — prose edits + a guard-test spec.

## 4. Data flow & contracts

- **`infra/deploy/deployed.json`** (committed by `deploy:prod`): `{ "sha": string, "deployedAt": ISO8601, "releaseTag": string|null, "surfaces": string[], "healthUrl": string }`. `surfaces` is derived from the release-notes PR set (product-kind PR titles), NOT hand-authored.
- **GitHub Deployment**: `environment=production`, `ref=<sha>`, `description`=release-notes summary; status `success`/`failure` with `log_url=healthUrl`.
- **`## Project reality` bootstrap section** (example):
  ```
  ## Project reality (derived — never edit AGENTS.md to state this)
  - Latest release: release-2026.07.15-1 (2026-07-15)
  - Deployed to prod: b9d81e6 (2026-07-15) — health: app.doctor.school/v1/health
  - Merged since deploy: 3 product PR(s) NOT yet on prod — run `pnpm deploy:prod` to ship.
  ```
- **Reconcile directive** fires when `deployed.json` is missing/older than the latest release by > a threshold, or unreadable: a loud banner "prod-reality could not be derived — check GitHub Releases/Deployments before stating scope", never a crash (bootstrap hard-rule: always exit 0).

## 5. Error handling

Every new seam obeys the bootstrap/main-sync hard rule: **never throw, always degrade to a printable banner + exit 0**. Network/gh/SSH failures downgrade `## Project reality` to the in-repo `deployed.json`; a missing manifest downgrades to "reality-source unavailable — reconcile from GitHub Releases". `deploy:prod`'s new record steps are **non-fatal** to the deploy itself (a deploy that shipped but failed to record must warn, not roll back) — mirroring how `release-notes.mjs` is already non-fatal.

## 6. Testing

Vitest, `tools/lint/guard-tests/*.spec.ts` (convention: `*.spec.ts`, not `*.test.ts`). Each layer's **pure** seam is unit-tested with fabricated inputs — no git/FS/network — exactly as `main-sync.spec.ts` drives `evaluateMainSync`:

- `evaluateProjectReality` — fresh vs stale vs unreadable vs merged-not-deployed-delta classification, platform-agnostic paths.
- `buildDeployedManifest` — surfaces derivation from a PR set; ISO stamp shape.
- `cut-release` note/tag assembly — id format `release-YYYY.MM.DD-n`, ordinal increment.
- Guard-test (D5) — asserts `AGENTS.md §1` / memory contain no enumerated deploy-scope prose.
  Integration smoke of the gh/SSH seams is manual (owner-run), consistent with deploy tooling today.

## 7. Wave plan (decomposition — single critical path, ≤3 PR-cycles per wave)

Touch-sets are disjoint enough to parallelize where marked; #927 (root) tracks L3.

- **W1 · L3 context derivation + prose purge (#927 rescoped + child):** `tools/project-reality.ts` + bootstrap wiring + `evaluateProjectReality` tests; D5 prose purge of AGENTS.md §1 + memory + the drift guard-test. Depends on nothing (reads `deployed.json` if present, degrades if not). **Highest owner value — kills the recurrence directly.** Ships first.
- **W2 · L2 deploy record:** `deployed.json` writer + GitHub Deployment + persisted release-notes in `deploy:prod`. Depends on nothing structurally; produces the artifact W1 prefers. Parallel with W1 (disjoint files: `tools/deploy/*` vs `tools/project-reality.ts` + docs).
- **W3 · L1 tag + GitHub Release:** `release.yml` job + `tools/release/cut-release.mjs` + `.github/release.yml` categories. Depends on nothing; feeds `releaseTag` into W2's manifest (soft link — W2 tolerates `releaseTag: null`).
- **W4 · docs + skills:** `/wrap`, `/deploy` (new runbook skill), AGENTS.md §2 versioning note, `tools/deploy/README.md` update to describe the record cycle. Follows W1–W3.

Each wave = its own issue(s) under #927, its own PR(s), Mode-a review, CI-green merge. No orphan issues; child of #927.

## 8. Acceptance criteria (rolls up the original #927 AC, corrected)

- [ ] A session's `pnpm bootstrap` prints a `## Project reality` section derived from `deployed.json` / GitHub Releases / health — no hand-authored scope prose involved.
- [ ] `AGENTS.md §1` + the memory drift set no longer assert enumerated deploy scope / phase; a guard-test fails if they reintroduce it.
- [ ] `deploy:prod` records each successful deploy as a GitHub Deployment + a committed `deployed.json` + a persisted release-notes payload.
- [ ] Merging the "Version Packages" PR cuts a git tag + GitHub Release with dated auto-generated notes.
- [ ] The bootstrap surfaces the merged-but-not-deployed delta (the #904 blind spot made visible).
- [ ] Every new seam has a pure-classifier unit test with platform-agnostic paths; nothing throws at SessionStart.
- [ ] Memory `feedback_no_dynamic_release_state_in_prose` documents the "no dynamic state in prose" rule.

## 9. Open questions

- **Backfill:** should we cut a `release-2026.07.15-1` tag/Release for the current `main` head and seed `deployed.json` from a one-time health probe, so the cycle starts from a known baseline? (Recommended yes, as W1's first commit — otherwise the first bootstrap has nothing to derive from.)
- **Auto-deploy-on-merge:** deferred. Once the record cycle exists, a gated auto-deploy is a small follow-up — tracked separately, not in this spec.
