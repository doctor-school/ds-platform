---
title: Release pipeline off the owner's workstation — registry images built once, release through GitHub Actions with Environment approval
status: Accepted — direction owner-confirmed 2026-10-16 (chat), access model lead decision under owner delegation 2026-10-16
date: 2026-10-16
kind: engineering-task plan (owner-requested)
issue: 2975
---

# Release pipeline off the owner's workstation

Epic: [#2975](https://github.com/doctor-school/ds-platform/issues/2975); this document lands under [#2976](https://github.com/doctor-school/ds-platform/issues/2976). Owner request of 2026-10-15 (chat): «полноценный ресёрч по теме, нашей инфре, кодовой базе, истории выкладок, тестов… а не урывочными выводами». This document is the single place the plan lives between sessions; a session working on it reads this file first and updates §8 and §10 here, never a parallel note.

Related canon it changes or narrows: ADR-0012 (amendment A1 records the delivery decision), the release runbook (skill `run-prod-deploy`, `tools/deploy/README.md`) — it stays the runbook until §8 step (f) retires the workstation path — and the staging spec `2026-09-08-staging-previews-and-regression-contour-en.md`, whose §3 «host builds» delivery, §5 operator-machine suite run and §10 rows for #2202 (the stand is operated by hand, nothing written to GitHub) and #2701 (the stage suite gate inside `pnpm deploy:prod`) this document supersedes for the `main` slot and for production. The staging spec's slot lifecycle, golden data, regression contract and Stage-B rules stay in force.

## 1. Finding (why this exists)

**A release today depends on one personal Windows workstation staying alive, reachable and correctly configured for 20–90 minutes.** Verified in code on 2026-10-15:

- `pnpm deploy:prod` (`tools/deploy/prod.mjs`) is one foreground Node process on the owner's PC. It checks stage prerequisites (`STAGE_BASIC_AUTH_PASS`, `ssh ds-stage-1 true`), a clean tree, fetch, green CI and the release gate; runs the stage `main` check (`tools/deploy/stage-main-check.mjs`: a temporary worktree, `pnpm install`, `slot.mjs up main` — which ships the tree and builds images on ds-stage-1 — then `tools/staging/e2e-stage.mjs` runs the Playwright suite **on the PC** against `*.stage.doctor.school`); runs read-only prod checks; ships the tree (`git archive` piped over ssh, `tools/deploy/lib/remote.mjs` `shipTree`) to ds-api-prod and ds-data-prod; takes a pgbackrest backup; runs `docker compose build` **on ds-api-prod** (~192 s); verifies boot, updates the IdP, migrates, runs `up -d` (~246 s); verifies SHA, retention and smoke; and finally writes `gh release create` plus a GitHub Deployment record (`tools/deploy/deployment-record.mjs`) — **on success only**.
- Nothing detaches remote work: no `nohup`, `setsid`, `systemd-run` or `tmux`, no lock, no state file. When the client dies during `up -d` the code can only say «remote work MAY have completed» (`prod.mjs:1261`).
- Port 22 on ds-api-prod and ds-stage-1 admits only the owner PC's `/32` (`infra/deploy/terraform/network.tf:97-103`, `stage-1.tf:132-138`). No GitHub Actions workflow (seven, all `ubuntu-latest`) reaches a Timeweb host; `.github/workflows/release-digest.yml` already listens to `deployment_status`.
- The PC is the only holder of: ssh keys to the three boxes, the GitHub token (OS keyring), `TWC_TOKEN` (the full Timeweb account) with the local `terraform.tfstate`, and `STAGE_BASIC_AUTH_PASS` exported by hand. Stage and prod runtime secrets already live on the boxes.

**Measured** (each figure from a probe, a transcript or a GitHub record; nothing below is assumed):

| Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Source                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 2026-09-15 → 2026-10-15: 29 successful releases, 17 failed or aborted. Causes: release gate / CI pending / malformed PR body 6 (the gate worked); `STAGE_BASIC_AUTH_PASS` missing on the PC 3 (fixed by #2806); owner IP drifted off the ssh `/32` 2 (≥11–12 drifts since July); Docker Hub 429 + api-prod overload 2; real product/test failure 2; PC/harness kill 1; laptop sleep 0                                                                             | Claude Code transcripts + 62 GitHub Deployment records |
| Healthy release 17–25 min since the stage gate (#2705); 2026-10-09 and 2026-10-12 ~89 min; 2026-10-15 waited ~50 min on ds-stage-1 under parallel builds                                                                                                                                                                                                                                                                                                          | transcripts                                            |
| 2026-10-13 11:38:26Z: the harness killed the background `pnpm deploy:prod` («stopped because the system is running low on memory … while the session was idle», Claude Code 2.1.296, win32 — contrary to vendor docs scoping that reaper to macOS/Linux). Only the shell wrapper died; the orphaned `prod.mjs` kept acting on ds-stage-1 for 74 s, then failed spawning ssh (exit `0xC0000142`). Prod was untouched only because the step preceded the switchover | session 267cd323 transcript                            |
| Killing a local `ssh host 'loop'` client kills the remote command within ~2 s                                                                                                                                                                                                                                                                                                                                                                                     | probe 2026-10-16                                       |
| Stage suite since PR #2859 (4 workers, `retries: 0`): 9 full runs, 7 green; 3.6–4.9 min (12.2 min at 1 worker); 90–103 of ~730 tests execute; results stored nowhere durable. Playwright memory on the PC: ~0.61 GB per extra worker + ~0.29 GB fixed; 4 workers peak 2.7 GB                                                                                                                                                                                      | transcripts, PC measurement                            |
| Owner PC egress geolocates to Bangkok, TH (residential dynamic IP); PC → ds-api-prod ssh call ≈ 2.8 s — every release already crosses a border                                                                                                                                                                                                                                                                                                                    | probe                                                  |
| GitHub-hosted runners (2 jobs, Azure US): ssh connect 10/10 each at 1.6–2.2 s per call; 190 MB each way in 14.5–20 s; a 15-minute ssh session kept 90/90 ticks, rc=0, on both. HTTPS 443 runner → our boxes 60/60 (connect 0.16–0.4 s). Three probes came from three different Azure IPs — no fixed egress                                                                                                                                                        | run 38877110379 (2026-10-16) + earlier probe           |
| Timeweb Container Registry `ds-platform` (id 31207, preset 25 GB / 180 ₽/mo, project ds-platform 2568419, ru-1 SPb — the only location offered) at `ds-platform.registry.twcstorage.ru`; Bearer realm `https://api.timeweb.cloud/api/v1/k8s/cr-auth`, password = a Timeweb API token. Two restricted tokens (project ds-platform + Container Registry only): push token push+pull, pull token pull-only (push denied)                                             | owner panel + probe 2026-10-16                         |
| Registry speed: ds-stage-1 push of a 375 MB image 9 s, re-push 2 s, layer download 42–79 MB/s; GitHub runner → registry 300 MB incompressible layer 48 s (~6 MB/s), dedup re-push 4 s. For comparison ds-stage-1 pulling from ghcr.io: 221 MB in 123 s (~1.8 MB/s)                                                                                                                                                                                                | probes 2026-10-16                                      |
| Images on prod: `ds-api` 628 MB; `ds-portal` / `ds-admin` / `ds-doctor` ~395 MB; `ds-api-migrate` 1.92 GB (oversized); third-party zitadel / centrifugo / caddy / redis from ghcr.io and Docker Hub. Shipped source tarball ≈ 234 MB gz; compressed `docker save` of ds-api 116 MB                                                                                                                                                                                | `docker images` on ds-api-prod                         |
| Repo `doctor-school/ds-platform` is public on the Free org plan; Environment `production` exists; fork-PR approval policy `first_time_contributors`; Environments with required reviewers work on public repos on Free. GHCR private packages on Free include 1 GB transfer/month                                                                                                                                                                                 | GitHub settings + GitHub docs                          |

**Assumed, not yet measured:** Playwright memory on a 4-vCPU / 16 GB Linux runner (measured only on the PC; §10); the size `ds-api-migrate` shrinks to once dev dependencies leave it (§10).

The dominant point of failure is the workstation itself: of the 11 failures that were not the gate doing its job or a real product defect, 6 (IP drift, missing PC env var, harness kill) exist only because the release runs from a personal machine, and the others (registry 429, api-prod overload during on-box builds) follow from building on the boxes.

## 2. Target picture

Owner-confirmed 2026-10-16 (chat): «Да, всё так.» The design is measured against these ten properties:

| #   | Property                                                                      |
| --- | ----------------------------------------------------------------------------- |
| P1  | No personal machine in the release path                                       |
| P2  | A human decides when; the trigger is recorded                                 |
| P3  | A durable, clean executor — client death never kills a box step               |
| P4  | An automatic stage check whose results are stored                             |
| P5  | Prod is protected: one release at a time, idempotent steps, a rollback floor  |
| P6  | No secrets on personal machines; least privilege per credential               |
| P7  | Visible status, failures included                                             |
| P8  | The agent prepares, triggers and observes a release without holding prod keys |
| P9  | Proportionate cost                                                            |
| P10 | A defined fallback when the normal path is unavailable                        |

## 3. Decision

1. **Build once, in Actions, into the Timeweb registry.** On merge to `main`, a GitHub-hosted runner builds each first-party image once, tags it by the full commit SHA and pushes it to `ds-platform.registry.twcstorage.ru`. Stage and prod pull the **same** image by digest. No box builds an image. (P1, P3, P5, P9)
2. **Stage `main` converges automatically.** After the build, an Actions job converges the stage `main` slot to those images, then runs the stage suite against `*.stage.doctor.school` over HTTPS. The verdict is a check on the commit; the Playwright report is an uploaded workflow artifact. (P4, P7)
3. **Release = `workflow_dispatch` + Environment approval.** The owner — or the agent on the owner's word — dispatches the release workflow for a SHA. The workflow refuses a SHA without a green stage-suite check, then waits on Environment `production`, whose required reviewer is the owner (prevent-self-review stays off: the owner is the single approver). After approval the deploy job runs, then smoke, then writes a GitHub Deployment record for **success and failure** alike; the existing Mattermost digest (`release-digest.yml`) fires on success. A workflow `concurrency` group allows one release at a time. (P2, P5, P7, P8)
4. **Box access: GitHub-hosted runners push over hardened ssh.** Port 22 opens to the internet with the hardening set in §4; the prod key is released only inside Environment `production` after approval, the stage key only inside Environment `stage`; ds-data-prod stays private (jump through ds-api-prod). This retires the owner-`/32` rule and its IP-drift failures. (P1, P6, P8)
5. **Every long box step is a detached, locked, observable unit** (§5). The runner starts the unit and polls it; a fresh runner can reattach. (P3, P5)
6. **Secrets live where they are used** (§4). No secret is needed on any personal machine in the normal path. (P6)
7. **Break-glass.** The same box entrypoints are runnable by hand from any machine holding the owner's offline break-glass key. (P10)
8. **PR slots keep the agent-driven lifecycle and the Stage-B rules unchanged.** Their images also come from the registry — built by Actions for the PR head — instead of on-box builds. Slot mechanics stay in the staging spec. (P3, P9)

```text
merge to main
   │
   ▼
[Actions: build]  GitHub-hosted runner, push token (Environment `build`)
   │  docker build ×N ──push──▶ ds-platform.registry.twcstorage.ru/<image>:<full-sha>
   ▼
[Actions: stage-converge]  Environment `stage` (stage ssh key)
   │  ssh ds-stage-1 → forced command → systemd-run ds-stage-<sha> (pull by digest, migrate, up)
   ▼
[Actions: stage-suite]  Environment `stage` (STAGE_BASIC_AUTH_PASS, test tokens)
   │  Playwright → https://*.stage.doctor.school  ──▶ commit check + report artifact
   ▼
(human) workflow_dispatch release <sha>     ← owner, or the agent on the owner's word
   │  refuse unless stage-suite check on <sha> is green
   ▼
[Environment `production` approval]  owner = required reviewer
   │
   ▼
[Actions: deploy]  concurrency: release; prod ssh key released now
   │  ssh ds-api-prod → forced command → systemd-run ds-prod-<sha>
   │     (pull by digest · pgbackrest backup · migrate · up -d · verify · prune)
   │  runner polls the status file; a fresh runner may reattach
   ▼
[Actions: smoke + record]  GitHub Deployment success|failure ──▶ release-digest.yml → Mattermost
```

## 4. Secrets and access

| Secret                                                   | Holder                                                      | Released when                                          |
| -------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Registry push token (push + pull)                        | Environment secret of the build job                         | every build on `main` / PR head (internal PRs only)    |
| Registry pull token (pull only)                          | each box, `/etc/ds-platform/registry-pull-token` (600 root) | read by the box unit on pull                           |
| Prod ssh key (deploy user, forced command)               | Environment `production`                                    | only after the owner approves the release              |
| Stage ssh key (deploy user, forced command)              | Environment `stage`                                         | stage converge and slot jobs                           |
| `STAGE_BASIC_AUTH_PASS`, suite test tokens               | Environment `stage`                                         | stage-suite job                                        |
| Break-glass ssh key                                      | owner, offline                                              | by hand, only when the normal path is unavailable (§9) |
| `TWC_TOKEN` (full Timeweb account) + `terraform.tfstate` | owner-side admin credential                                 | never on a box, never in GitHub                        |
| Stage / prod runtime secrets                             | the boxes (unchanged)                                       | read by compose on the box                             |

The push token is today stored only on ds-stage-1 (`/etc/ds-platform/registry-push-token`); §8 step (a) moves it into the build Environment and removes it from the box.

**ssh hardening on ds-api-prod and ds-stage-1** (§8 step (e)), the standard set for a key-only admin port open to the internet:

- key-only authentication (already: `PasswordAuthentication no`);
- `PermitRootLogin no` (today `yes`);
- a dedicated `deploy` user; the CI keys in its `authorized_keys` carry `command="/usr/local/bin/ds-deploy-entrypoint",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding` — a CI key can only invoke the deploy entrypoint, never a shell;
- connection rate limiting (`MaxStartups` plus fail2ban on the sshd journal);
- `unattended-upgrades` for security patches;
- ds-data-prod keeps no public ssh; it is reached through ds-api-prod as a jump host.

**Rejected for now: a pull agent** (the OpenGitOps «pulled automatically» principle — an agent on each box polls for a desired state and closes port 22). It changes only who initiates; images, registry and approval stay identical, so switching later is cheap. Revisit trigger: a regulatory requirement (152-ФЗ / ФСТЭК) to keep admin ports closed, or log evidence of attempts beating the controls above.

## 5. Durable box steps

Every long box step — pull, backup, migrate, up, prune — runs inside a transient systemd unit, so the caller's death (runner cancelled, network cut, workstation killed) never kills it.

- **Unit name.** `systemd-run --unit=ds-<env>-<sha12> --collect -p KillMode=mixed /usr/local/bin/ds-release <env> <sha>`, `<env>` ∈ `prod`, `stage-main`, `stage-pr-<N>`. A second start with the same name fails fast — the name itself deduplicates.
- **Lock.** The entrypoint takes `flock -n /run/lock/ds-<env>.lock` for its whole life; a different SHA for the same env is refused while one runs (the workflow `concurrency` group is the first line, the lock the last).
- **Status file.** `/var/lib/ds-platform/release/<env>/<sha>.json`, written atomically (write to `*.tmp`, `fsync`, `rename`) after every step:

  ```json
  {
    "env": "prod",
    "sha": "<full sha>",
    "unit": "ds-prod-<sha12>",
    "state": "running | succeeded | failed",
    "step": "pull | backup | migrate | up | verify | prune",
    "steps": [{ "name": "pull", "startedAt": "…", "endedAt": "…", "rc": 0 }],
    "startedAt": "…",
    "updatedAt": "…",
    "error": null
  }
  ```

- **Reattach.** The runner never streams the step; it starts the unit and polls `ds-release status <env> <sha>` (status file + `systemctl show -p ActiveState,Result`), tailing `journalctl -u <unit>` into the job log. A re-run of the job for the same SHA finds the unit by name: running → it polls; succeeded → it continues to smoke and the record; failed → it reports the failed step and stops. Every step stays idempotent, as `pnpm deploy:prod` steps are today.
- **Rollback floor.** Unchanged from today: the pre-migrate pgbackrest backup and the app-only rollback to the previous image digest (`run-prod-deploy` → rollback), which with registry images becomes a pull of the previous SHA instead of a rebuild.

## 6. What this replaces

| Past decision                                                                                                                                      | Original reason                                                                                                                                                                                                                               | Holds?                                                                                                                              | Now                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Off-CI ssh deploy from the operator machine                                                                                                        | deploy keys disabled org-wide (`infra/deploy/README.md:260-266`, 2026-07-03); never compared with CI. ADR-0012 contains no off-CI rule — the attributions in `run-prod-deploy` and `tools/deploy/README.md` were wrong (corrected in this PR) | no — the reason concerned repository deploy keys, not where the deploy runs                                                         | deploy runs in GitHub Actions; ADR-0012 A1 records it                                                       |
| «раннер убираем» (owner 2026-09-09, #2095 / #2126) — no self-hosted runner                                                                         | a self-hosted runner on a public repo would execute fork PRs on our box                                                                                                                                                                       | yes                                                                                                                                 | kept — GitHub-hosted runners only                                                                           |
| «Однозначно идём в схему прода» (owner 2026-09-11, #2194) — stage delivery = prod delivery, build on the box                                       | unify stage and prod; the build-on-box shape rested partly on the claim that the box «cannot pull» GHCR images                                                                                                                                | unification yes; the GHCR claim no — the box lacked a credential (the requested token had no packages scope), it was not impossible | unification kept: stage and prod both pull the same registry images                                         |
| #2202 (owner «Го» 2026-09-14) — «nothing on the box or in GitHub decides when — the agent does»; no workflow, nothing written to GitHub            | root principle «не плодить точки отказа» (owner 2026-09-08)                                                                                                                                                                                   | the principle yes; the conclusion no — the data in §1 shows the workstation is the dominant point of failure                        | a human decides when (`workflow_dispatch` + Environment approval); GitHub executes and records              |
| #2701 (owner «Окей, реализуй» 2026-10-08) — the stage suite gate inside `pnpm deploy:prod`                                                         | no release without a green suite on the release SHA                                                                                                                                                                                           | yes                                                                                                                                 | the gate is kept, moved into the pipeline as a required check; «nothing written to GitHub» falls with #2202 |
| ssh `/32` to the owner PC (owner 2026-08-20, #1384: wider CIDR / VPN / bastion rejected, «Re-raise only if… rotation frequency becomes untenable») | smallest exposure of port 22                                                                                                                                                                                                                  | the re-raise clause is met: ≥12 drifts since July, 2 failed releases in a month                                                     | port 22 open with the §4 hardening; forced-command CI keys released per Environment                         |

## 7. Rejected alternatives

- **Workstation hardening only** (keep-awake, IP pinning, a watchdog) — fails P1 «no personal machine».
- **GHCR** — private packages on Free include 1 GB transfer/month (exceeded by one release); pulls to RU boxes at ~1.8 MB/s; needs an org setting change to go public.
- **S3 tarballs via `docker save` / `docker load`** — no layer dedup, own versioning and GC; kept only as the emergency fallback (§9).
- **Self-hosted `registry:2` on S3** — another service to run and patch.
- **Timeweb App Platform for the core stack** — compose apps forbid `volumes`, proxy only the first service, offer no stands for compose apps, no pre-deploy / migration step and no approval; orchestration would still be needed.
- **Kubernetes + GitOps** — overkill for one prod box and one operator.
- **Self-hosted CI inside Russia** — GitLab CE needs 8 vCPU / 16 GB and pull-mirroring is Premium; Forgejo / Gitea lack environments with reviewers and become a second source of truth.
- **Self-hosted GitHub runner** — fork-PR risk on a public repo (owner 2026-09-09).
- **Larger GitHub runners with a static IP** — requires a paid plan.

## 8. Execution plan

Staged; each step is independently valuable and ships as its own sub-issue of #2975. Until step (f), `pnpm deploy:prod` stays the release runbook.

| Step | Scope                                                                                                                                                                                                                                       | Value on its own                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| (a)  | Registry wiring: compose files reference `ds-platform.registry.twcstorage.ru/<image>@<digest>`; boxes log in with the pull token and pull instead of build — stage first, then prod. Shrink `ds-api-migrate` (production dependencies only) | removes on-box builds (api-prod overload, ~192 s build, Docker Hub 429 on base layers) |
| (b)  | `systemd-run` box entrypoints (`ds-release` + `status`) with lock and status file (§5); `pnpm deploy:prod` calls them                                                                                                                       | client death no longer kills a box step, even from the workstation                     |
| (c)  | Actions build-once on merge to `main` and on internal PR heads; stage `main` converge; stage-suite job with the report uploaded and the verdict as a commit check                                                                           | stored suite results; stage always on `main`; no PC RAM in the loop                    |
| (d)  | Release workflow: `workflow_dispatch` → green stage-suite check required → Environment `production` approval → deploy → smoke → Deployment record for success and failure; `concurrency` = one release                                      | a release no longer needs the workstation                                              |
| (e)  | ssh hardening (§4) on ds-api-prod and ds-stage-1; firewall opens 22 to the internet; retire the owner `/32` rule; issue the break-glass key                                                                                                 | CI reaches the boxes; IP-drift failures end                                            |
| (f)  | Retire the workstation path: rewrite skill `run-prod-deploy` and `tools/deploy/README.md` around the workflow; `tools/deploy/prod.mjs` keeps only the break-glass role or is removed                                                        | one documented release path                                                            |

Order: (a) and (b) are independent and come first; (c) needs (a); (d) needs (b), (c) and (e); (f) follows (d).

## 9. Failure modes and recovery

| Failure                                  | Effect                                                                                       | Recovery                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Timeweb registry down                    | no new pulls; running containers unaffected                                                  | emergency fallback: `docker save` of the built images to S3 from the build job, `docker load` on the box through the break-glass entrypoint |
| GitHub or the cross-border path degraded | no build / no release workflow                                                               | break-glass: the same box entrypoints run by hand from any machine holding the break-glass key, against images already in the registry      |
| Runner dies mid-step                     | none on the box — the unit keeps running                                                     | re-run the job for the same SHA; it reattaches by unit name (§5)                                                                            |
| Failed migrate                           | unit ends `failed` at `migrate`; Deployment record `failure`; prod keeps the previous images | existing rollback floor: the pre-migrate pgbackrest backup and the app-only rollback to the previous digest (`run-prod-deploy`)             |
| Two releases dispatched                  | the second waits                                                                             | workflow `concurrency` group; the box `flock` refuses a second env lock                                                                     |
| Red or missing stage-suite check         | the release workflow refuses before approval                                                 | fix forward on `main`; the gate is not bypassable                                                                                           |

## 10. Owner decisions and open items

| Decision                                                           | State                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research scope                                                     | owner 2026-10-15 (chat): «полноценный ресёрч по теме, нашей инфре, кодовой базе, истории выкладок, тестов… а не урывочными выводами»                                                                                                            |
| Target picture (§2)                                                | owner 2026-10-16 (chat): «Да, всё так.»                                                                                                                                                                                                         |
| Registry = Timeweb Container Registry                              | owner 2026-10-16 (chat): «Окей, берём Container Registry Timeweb.»                                                                                                                                                                              |
| Box access model (hosted runners over hardened ssh, §3 item 4, §4) | lead decision 2026-10-16 under owner delegation (chat): «Нет, это не ко мне вопрос, я не специалист по сетевой безопасности. Ты скажи, как это делают. Ты же проводил ресёрч бест-практик и лучше меня знаешь, как это корректно организовать.» |
| Runner and registry probes                                         | owner 2026-10-16 (chat): «Го»                                                                                                                                                                                                                   |
| Open: the registry is not in Terraform                             | the Timeweb provider has no Container Registry resource; the registry was created via the API and is documented as a manual one-off in `infra/deploy/README.md` (§8 step (a))                                                                   |
| Open: `ds-api-migrate` is 1.92 GB                                  | likely carries dev dependencies; shrinking it is part of §8 step (a)                                                                                                                                                                            |
| Open: Playwright RAM on Linux runners                              | unmeasured; the PC figures (§1) put 4 workers at ~2.7 GB, inside a standard runner's 16 GB — confirmed or corrected in §8 step (c)                                                                                                              |
