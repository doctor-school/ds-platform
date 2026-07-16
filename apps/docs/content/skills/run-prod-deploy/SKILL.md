---
title: "run-prod-deploy"
description: "Procedural skill (inline): the agent ships origin/main to the always-on Timeweb prod environment via `pnpm deploy:prod`, with the record cycle (GitHub Deployment + release tag + Mattermost digest) it triggers, health verify, and app-only rollback. When to ship = the D+B trigger policy (release-cycle spec §10)."
name: run-prod-deploy
mode: inline
---

# run-prod-deploy

**Kind:** procedural · **Mode:** inline.

Production deploy is an **agent-run, off-CI command** — there is no CI deploy (ADR-0012: SSH deploy from the agent's deploy environment, not GitHub Actions). One command reproducibly rolls `origin/main` onto prod (api-prod public + data-prod private). This skill is the runbook; the executable form is `tools/deploy/prod.mjs`, and the operational SSOT for first-time provisioning stays [`infra/deploy/README.md`](../../../../../infra/deploy/README.md) §5–§10.

**When to run this (the D+B trigger policy — release-cycle spec §10).** The agent ships when a **releasable unit** (a vertical slice / feature-spec iteration / milestone) reaches Done, is Stage-B GO, and passes the release-readiness checklist (spec §10.4) over the whole `deployedSha..origin/main` range. For **standing-auth** change-classes (spec §10.3 — app/UI-only or additive expand-only-migration waves) the agent ships **autonomously**; for **escalate** classes (any contracting/destructive migration, auth/payment/PII flows, breaking API, infra/data-prod, or an un-certified range) it first surfaces a one-line **"ready to ship X — go?"** and waits. Default to **escalate** when the class is uncertain. The bootstrap `## Project reality` merged-not-deployed delta is the detection signal, not a passive cue. There is **no human "operator"** — the agent drives; the owner is the circuit-breaker.

Typing **`/deploy`** ([`.claude/commands/deploy.md`](../../../../../.claude/commands/deploy.md)) means: read this skill and execute it.

## Release-readiness checklist (spec §10.4) — run BEFORE deciding to ship

The D-decision gate, over the **whole deploy range** (`deployedSha..origin/main`) — a single failing item holds the deploy. The change-class (standing-auth vs escalate) is judged per **spec §10.3** (the taxonomy lives there — default-escalate on any uncertainty); the bootstrap delta line pre-computes a derivable-signal class verdict, which is the **starting point**, not the judgment (Stage-B, PII-flow, and breaking-API calls are yours to make here).

1. **Range enumerated** — `git log --oneline <deployedSha>..origin/main` (`deployedSha` from bootstrap `## Project reality`, or `curl -s https://api.doctor.school/v1/health | jq -r .version`); the triggering releasable unit is among the listed PRs.
2. **All Stage-B GO** — every `user-facing` PR in the range records `Stage-B: GO` / `Stage-B: batched at #<gate>` / `Stage-B: N/A (no visual surface) — lead-certified` (`gh pr view <N> --json body,comments`). A missing verdict = **stop** (forces escalate/hold).
3. **CI green at the deploy SHA** — `gh api repos/{owner}/{repo}/commits/$(git rev-parse origin/main)/check-runs` all green (the deploy pre-flight re-asserts this; the checklist confirms it before the D-decision).
4. **Migrations expand/contract** — `git diff --name-only <deployedSha>..origin/main -- apps/api/drizzle` ; inspect every listed `.sql`: expand-only (new nullable column / table / index) keeps an app rollback DB-safe; any contracting/destructive/backfill migration flips the class to **escalate** (spec §10.3).
5. **Rollback ready** — the app-only `--rollback <sha>` path is available (target images retained — last 3 per repo) and the DB is untouched by an app rollback (guaranteed by item 4).
6. **Clean deploy environment** — clean working tree + `git pull --ff-only origin main` (the pre-flight enforces this; verify it _before_ deciding to ship).
7. **No live broadcast (эфир gate)** — `pnpm deploy:check-live`: `CLEAR` (exit 0) proceeds; `LIVE:` or `UNKNOWN` (exit 1, fail-closed) **holds regardless of change-class** — wait for the эфир to end or bind to the maintenance window (02:00–06:00 MSK). The deploy pre-flight runs the same probe as a hard gate; an urgent mid-broadcast ship is by definition **escalate**: owner's explicit go + `--allow-live-broadcast`.

**Standing-auth** class + 1–7 green → ship autonomously. **Escalate** class — or any эфир hold — → the one-line **"ready to ship X — go?"** first, then proceed on the owner's go.

## Input

- Intent to deploy the current `origin/main`, **or** a rollback target SHA.
- The wave being deployed has merged and its CI is green on `main`.

## Preconditions (the pipeline refuses otherwise)

`pnpm deploy:prod` fixes the deploy target to **`origin/main`'s SHA** and archives exactly that ref — un-pushed local work can never reach prod. But the durable record/digest code that runs is **your local checkout's**, so before deploying:

1. **Clean working tree** — the pipeline hard-fails on a dirty tree (it ships committed `main` only).
2. **Fast-forward local `main`** — `git pull --ff-only origin main` first, so your checkout's record/digest code matches the SHA being shipped. A divergent `HEAD` is a loud WARNING (deploy still ships `origin/main`), a dirty tree is a hard fail.
3. **Green CI for that SHA** — the pipeline queries the latest check-run per name via `gh api …/commits/<sha>/check-runs` and refuses on red/pending. Escape hatch `--skip-ci-check` logs a loud warning.
4. **No live broadcast** — the pipeline runs the read-only эфир probe (`pnpm deploy:check-live`, `GET /v1/public/events`) and refuses while a broadcast is `live` **or** the probe fails (fail-closed `UNKNOWN`). Escape hatch `--allow-live-broadcast` (owner-approved urgent ship only — checklist item 7) logs a loud warning. The `--rollback` path skips this gate (an emergency rollback must never wait out an эфир).

## Procedure

### 1. Deploy

```bash
pnpm deploy:prod          # deploy origin/main (default)
```

Run it as **its own statement** — never `pnpm deploy:prod | tee log` or any pipe: a pipe returns the **pipe's** exit code (e.g. `tee`'s `0`) and masks a non-zero deploy failure, turning a red deploy green (`feedback_no_pipe_exit_significant_commands`). Redirect to a file with `> log 2>&1` if you need a transcript, then check `$?`.

The pipeline is fail-closed and stops at the first red step, printing a rollback pointer: pre-flight → ship (`git archive` over SSH, no registry) → data-prod `up -d --build` → **pgbackrest pre-migrate `incr` checkpoint** → api-prod `migrate → build → up -d` (images SHA-tagged `ds-api:<sha>` / `ds-portal:<sha>` / `ds-admin:<sha>`) → `caddy reload` → **truthful-success verify** (polls on-box until the running containers carry exactly `ds-*:<sha>` and are healthy — otherwise FAILED, never "OK") → image retention (last 3 tags/repo) → prod smoke (`--expect-sha`).

**A deploy can never hang silently (#905).** Every ssh channel carries keepalive flags (dead half-open connection → loud non-zero exit in ~60s), and each streamed remote step runs under a per-step no-output watchdog (5 min build-class, 2 min elsewhere; flowing output resets it). A tripped watchdog kills the step and exits non-zero with `STALLED: <step> — no output for <N>m; remote work MAY have completed.` That is a **channel** verdict, not a box verdict — before re-running or rolling back, check box reality with one command:

```bash
pnpm deploy:probe   # ONE line: <LIVE|DEGRADED|UNREACHABLE> health=<sha> api/portal/admin images+status
```

(hand fallback: `curl -fsS https://api.doctor.school/v1/health ; ssh ds-api-prod docker ps`). If the probe shows the new SHA live and healthy, the remote work completed — a plain re-run of `pnpm deploy:prod` is a safe idempotent no-op; if it shows the old SHA, re-run; if the box is unreachable, fix connectivity first — never fire blind state-changes at it.

### 2. Record cycle (all NON-FATAL to the deploy)

After the deploy has already succeeded, the pipeline records — and by contract a `gh`/webhook failure here only WARNs, the deploy exit code stays 0:

- **Release cut** (#996/§10.5, Option A) — **the agent-run deploy is the release initiator.** Before the Deployment record, the pipeline cuts `release-YYYY.MM.DD-n` at the **deployed SHA** (`--generate-notes` diffed since the previous `release-*`), so the Release == what shipped and the Deployment record then references the fresh tag. Cutting is **skipped green** on a redeploy of an already-released SHA (the non-empty-range guard: cut only if the deployed SHA is a strict descendant of the latest `release-*` tag). Seam: `tools/release/cut-release.mjs` → `cutDeployRelease`.
- **GitHub Deployment** (#942) — a `Deployment(production, sha)` + `success` status carrying the release-notes digest and the health URL as `log_url`. Read by `## Project reality` (below).

The **`Version Packages` PR merge** no longer cuts a repo-level release — it maintains per-package `version` + `CHANGELOG.md` only (§D1, the changelog SSOT). The repo-level release cut is the deploy step above; the former `release.yml` `tag-release` trigger is retired (§10.5).

### 2a. Mattermost release digest — fired from CI, not from `deploy:prod` (#968)

The aggregated Russian product-language digest (#868) — ONE note listing the `## Product note (RU)` of every product-kind PR in the `<prev-sha>..<new-sha>` range — is **no longer posted by `deploy:prod`**. It fires from CI: `.github/workflows/release-digest.yml` triggers on `deployment_status: success` for `environment: production` (the very Deployment §2 records), resolves the prev/new SHA range from the Deployment event + `gh api`, and posts via `tools/ci/post-release-digest.mjs` → `release-notes.mjs` using `secrets.MATTERMOST_WEBHOOK_URL` (which already lives in CI). Non-fatal: a post failure WARNs, never fails the workflow. No `.env.local` webhook to configure in the agent's environment (the #950 crutch is retired). For an offline render check, run `node tools/deploy/release-notes.mjs --prev-sha <sha|none> --new-sha <sha> --dry-run` (with `DELIVERY_ENV=prod`).

### 2b. Verify the digest CONTENT, not the HTTP 200 (retro 2026-07-15)

After the release digest fires, confirm it is non-empty before any release-cut or "done" claim: grep the `release-digest` workflow run-log for the delivered product-PR count (`delivered … (N product PR(s))`) — a release-cut / "cycle done" claim is FORBIDDEN until N>0 **or** an intentional zero is explicitly acknowledged to the owner. Read the rendered digest BODY; a `success`/HTTP-200 is send-status, not the surface. **Any change to the notes/digest machinery** additionally requires a golden-output dry-run (`node tools/deploy/release-notes.mjs --dry-run --prev-sha <prev> --new-sha <new>`) against the ACTUAL next `prev..new` delta, eyeballed, before merge — a unit test of the range function is not sufficient (#968 shipped an empty-digest bug a dry-run would have caught).

### 3. Health verify

```bash
curl -s https://api.doctor.school/v1/health | jq .version   # → the deployed SHA
```

`version` present **and equal** to the deployed SHA confirms the live build. (The pipeline's own smoke step already asserts this; this is the over-HTTP re-check.)

### 4. Rollback (app-only)

```bash
pnpm deploy:prod --rollback <sha>   # up -d a prior SHA-tagged image; NO rebuild, NO migrate, NO DB change
```

The target images must still be on the box (retention keeps the last 3). Rollback reverts only the app tier — the DB is untouched (expand/contract migrations keep prior app code compatible). A **bad migration** (not app code) needs a pgbackrest restore — see [`infra/deploy/README.md`](../../../../../infra/deploy/README.md) → Rollback; the DB was checkpointed pre-migrate.

## After a deploy — the merged-not-deployed nudge

`## Project reality` (bootstrap `pnpm bootstrap`, #939) derives the latest release, the deployed SHA (GitHub Deployment ⋈ `/v1/health`), and the **merged-not-deployed delta** at SessionStart. A non-empty delta renders the explicit **D-trigger verdict** (spec §10.2/§10.3): the line carries `class standing-auth (…)` or `class escalate (…)` derived from the range's touch-set (`classifyDeployRange` in `tools/project-reality.ts` — migration / backend / infra / workflow / deploy-tooling touches escalate; uncomputable defaults to escalate). Treat it as the detection signal: run the §10.4 checklist (above) over the range and, if a releasable unit is ready, ship it (autonomously for standing-auth, else escalate "ready to ship X — go?") — or record the pending-deploy delta in the session handoff.

## Output

- `origin/main` live on prod; `curl …/v1/health | jq .version` == deployed SHA.
- A GitHub Deployment(production) recorded; Mattermost digest posted (both non-fatal).

## Failure modes

- **Piping the deploy command** (`| tee`) — masks a non-zero exit, a red deploy reads green. Run it standalone (`feedback_no_pipe_exit_significant_commands`).
- **Deploying a dirty tree / stale local `main`** — the record/digest code that runs is your checkout's; ff-only `main` first, commit/stash first.
- **Treating a record-cycle WARN as a deploy failure** — the Deployment/digest steps run only after success and are non-fatal by contract.
- **Rolling back to a pruned SHA** — retention keeps the last 3 tags; if the image is gone, roll _forward_ (check out that commit's `main` and `pnpm deploy:prod`).

## Related skills

- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md) — land the PR before it can be deployed.
- [../run-wrap/SKILL.md](../run-wrap/SKILL.md) — stage 4 checks the merged-not-deployed delta at session end.

Detail: `tools/deploy/README.md` (record cycle + `deploy:smoke` / `deploy:release-notes`); ADR-0012 (off-CI SSH deploy topology); release-cycle spec §10 (D+B trigger policy); `infra/deploy/README.md` §5–§10 (operational SSOT).
