---
title: "run-prod-deploy"
description: "Procedural skill (inline): ship origin/main to the always-on Timeweb prod environment via the single manual command `pnpm deploy:prod`, with the record cycle (GitHub Deployment + release tag + Mattermost digest) it triggers, health verify, and app-only rollback."
name: run-prod-deploy
mode: inline
---

# run-prod-deploy

**Kind:** procedural · **Mode:** inline.

Production deploy is a **manual, operator-box command** — there is no CI deploy (ADR-0012: SSH deploy from the operator's machine, not GitHub Actions). One command reproducibly rolls `origin/main` onto prod (api-prod public + data-prod private). This skill is the runbook; the executable form is `tools/deploy/prod.mjs`, and the operational SSOT for first-time provisioning stays [`infra/deploy/README.md`](../../../../../infra/deploy/README.md) §5–§10.

Typing **`/deploy`** ([`.claude/commands/deploy.md`](../../../../../.claude/commands/deploy.md)) means: read this skill and execute it.

## Input

- Intent to deploy the current `origin/main`, **or** a rollback target SHA.
- The wave being deployed has merged and its CI is green on `main`.

## Preconditions (the pipeline refuses otherwise)

`pnpm deploy:prod` fixes the deploy target to **`origin/main`'s SHA** and archives exactly that ref — un-pushed local work can never reach prod. But the durable record/digest code that runs is **your local checkout's**, so before deploying:

1. **Clean working tree** — the pipeline hard-fails on a dirty tree (it ships committed `main` only).
2. **Fast-forward local `main`** — `git pull --ff-only origin main` first, so your checkout's record/digest code matches the SHA being shipped. A divergent `HEAD` is a loud WARNING (deploy still ships `origin/main`), a dirty tree is a hard fail.
3. **Green CI for that SHA** — the pipeline queries the latest check-run per name via `gh api …/commits/<sha>/check-runs` and refuses on red/pending. Escape hatch `--skip-ci-check` logs a loud warning.

## Procedure

### 1. Deploy

```bash
pnpm deploy:prod          # deploy origin/main (default)
```

Run it as **its own statement** — never `pnpm deploy:prod | tee log` or any pipe: a pipe returns the **pipe's** exit code (e.g. `tee`'s `0`) and masks a non-zero deploy failure, turning a red deploy green (`feedback_no_pipe_exit_significant_commands`). Redirect to a file with `> log 2>&1` if you need a transcript, then check `$?`.

The pipeline is fail-closed and stops at the first red step, printing a rollback pointer: pre-flight → ship (`git archive` over SSH, no registry) → data-prod `up -d --build` → **pgbackrest pre-migrate `incr` checkpoint** → api-prod `migrate → build → up -d` (images SHA-tagged `ds-api:<sha>` / `ds-portal:<sha>` / `ds-admin:<sha>`) → `caddy reload` → **truthful-success verify** (polls on-box until the running containers carry exactly `ds-*:<sha>` and are healthy — otherwise FAILED, never "OK") → image retention (last 3 tags/repo) → prod smoke (`--expect-sha`).

### 2. Record cycle (all NON-FATAL to the deploy)

After the deploy has already succeeded, the pipeline records — and by contract a `gh`/webhook failure here only WARNs, the deploy exit code stays 0:

- **GitHub Deployment** (#942) — a `Deployment(production, sha)` + `success` status carrying the release-notes digest and the health URL as `log_url`. Read by `## Project reality` (below).
- **Mattermost digest** (#868) — ONE aggregated Russian product-language note listing the `## Product note (RU)` of every product-kind PR in the `<prev-sha>..<new-sha>` range. On the local operator path the webhook is sourced from `~/.ds-platform/.env.local` (`MATTERMOST_WEBHOOK_URL`, #950) — set it there once (see the commented key in `infra/dev-stand/.env.example`); a value already in the process env wins; unset → log + skip green.

Separately, a **`Version Packages` PR merge** cuts a `release-YYYY.MM.DD-n` git tag + GitHub Release with auto-generated notes (#944) — that is the release-train event, independent of a deploy.

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

`## Project reality` (bootstrap `pnpm bootstrap`, #939) derives the latest release, the deployed SHA (GitHub Deployment ⋈ `/v1/health`), and the **merged-not-deployed delta** at SessionStart. When that delta is non-empty (product PRs merged but not shipped), it is the signal to run `/deploy` — or to record the pending-deploy delta in the session handoff.

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

Detail: `tools/deploy/README.md` (record cycle + `deploy:smoke` / `deploy:release-notes`); ADR-0012 (manual SSH deploy); `infra/deploy/README.md` §5–§10 (operational SSOT).
