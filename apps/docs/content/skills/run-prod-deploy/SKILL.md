---
title: "run-prod-deploy"
description: "Procedural skill (inline): the agent releases a `main` SHA to the always-on Timeweb prod environment by dispatching `deploy-prod.yml` on the owner's word in chat, polls and verifies it (Deployment record + release tag + Mattermost digest, `/v1/health`), and rolls a broken release off with its rollback mode. `pnpm deploy:prod` is break-glass only. When to propose = the D+B trigger policy (release-cycle spec §10)."
name: run-prod-deploy
mode: inline
---

# run-prod-deploy

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline.

A production release runs in GitHub Actions: the agent dispatches `.github/workflows/deploy-prod.yml` with the target SHA and the owner's word verbatim. Its `deploy` job hands the recorded `images-<sha>.json` to ds-api-prod's forced command `release prod <sha>`; the box-side release driver (a `systemd-run` unit that survives the job) downloads the codeload tree of exactly that SHA and runs every box step of `tools/deploy/prod.mjs --local`, smoke included; api-prod pulls the images `runtime-images.yml` built once for the SHA's `main` push — nothing is built on the boxes (#2981). After a terminal status the workflow cuts the release, writes the ONE GitHub Deployment record with the quote and calls the Mattermost digest. Design: the [release-pipeline tech spec](../../specs/tech/2026-10-16-release-pipeline-off-workstation-en.md) (ADR-0012 A1); tooling: [`tools/deploy/README.md`](../../../../../tools/deploy/README.md) → Release from Actions; first-time provisioning stays [`infra/deploy/README.md`](../../../../../infra/deploy/README.md) §5–§10. The workstation command `pnpm deploy:prod` is break-glass only (§6 below).

**When to propose (the D+B trigger policy — release-cycle spec §10).** The agent proposes a release when a **releasable unit** (a vertical slice / feature-spec iteration / milestone) reaches Done, is Stage-B GO, and passes the release-readiness checklist (spec §10.4) over the whole `deployedSha..<target>` range. **Every production release is triggered by the owner's word in chat**; the agent dispatches it with that word as `owner_quote`, recorded in the Deployment. The change-class (spec §10.3) decides what the proposal states: a **standing-auth** range (app/UI-only or additive expand-only-migration waves) with its green checklist; an **escalate** range (any contracting/destructive migration, auth/payment/PII flows, breaking API, infra/data-prod, or an un-certified range) also names the concrete risk, conditions and recovery path. Default to **escalate** when the class is uncertain. Ask for the word once, with the target SHA and evidence; never re-ask for what the word covers. The bootstrap `## Project reality` merged-not-deployed delta is the detection signal, not a passive cue. The agent prepares, dispatches, polls and verifies; the owner runs nothing.

Typing **`/deploy`** ([`.claude/commands/deploy.md`](../../../../../.claude/commands/deploy.md)) means: read this skill and execute it.

**Proportionate preparation:** apply portable discipline before implementation or expanding the plan: record the minimum release path, actual risks, existing rollback/recovery evidence and estimated preparation time/compute cost. Name the uncovered risk and acceptance condition for each extra check or automation; explain why existing commands/evidence are insufficient. An accepted plan, including a rehearsal, does not establish proportionality. If preparation materially exceeds the change or the need is uncertain, present concise alternatives, cost and recommendation to the owner before expanding, without re-asking for unchanged authorized routine work. Reassess when scope grows. A reviewed, reproducible one-time migration runbook is valid; the no-workarounds rule does not require a general migration platform. Verify the applicable recovery path with bounded evidence: app rollback and major-database recovery have different guarantees.

## Release-readiness checklist (spec §10.4) — run BEFORE proposing

The gate covers the **whole deploy range** (`deployedSha..<target>`): a failing item holds deployment, not useful authorized diagnosis/preparation. Answer status questions briefly and continue the requested release unless canceled/replaced. If a gate needs an owner decision, prepare its evidence, options and exact request; explicitly wait only when useful authorized work is exhausted. Never turn a status answer into abandonment or bypass a failed gate. The change-class (standing-auth vs escalate) is judged per **spec §10.3** (default-escalate on any uncertainty); the bootstrap delta line pre-computes a derivable-signal class verdict, which is the **starting point**, not the judgment (Stage-B, PII-flow, and breaking-API calls are yours to make here).

1. **Range enumerated** — `git log --oneline <deployedSha>..<target>` (`deployedSha` from bootstrap `## Project reality`, or `curl -s https://api.doctor.school/v1/health | jq -r .version`; the target is normally `origin/main`'s head); the triggering releasable unit is among the listed PRs.
2. **All Stage-B GO** — every `user-facing` PR in the range records `Stage-B: GO` / `Stage-B: batched at #<gate>` / `Stage-B: N/A (no visual surface) — lead-certified` (`gh pr view <N> --json body,comments`). A missing verdict = **stop** (forces escalate/hold).
3. **CI green at the target SHA** — `gh api repos/{owner}/{repo}/commits/<sha>/check-runs` all green (the release pre-flight re-asserts this).
4. **Migrations expand/contract** — `git diff --name-only <deployedSha>..<target> -- apps/api/drizzle` ; inspect every listed `.sql`: expand-only (new nullable column / table / index) keeps an app rollback DB-safe; any contracting/destructive/backfill migration flips the class to **escalate** (spec §10.3).

   **Contract-migration gate.** A migration dropping a column/constraint, or guarding itself with a `RAISE EXCEPTION` on non-empty data, runs INSIDE the release (the box-side `migrate` step) — a violated precondition aborts the **release**. Always **escalate**. All of the following hold, or the release **HOLDS**:

   - **(a) Precondition re-verified on prod immediately before the dispatch** — not earlier; the number moves under you. Read-only, from a break-glass session (§6):
     ```bash
     ssh ds-data-prod "sudo docker exec ds-data-prod-postgres-1 psql -U ds -d ds_prod -Atc 'select count(*) from experts'"
     ```
   - **(b) Authoring freeze for the release window** — announce to the admin operators that the affected entity is not created or edited from the count until the health verify (§3) passes, then **re-run the count after that announcement**: the second read gates the dispatch.
   - **(c) Pre-migrate restore point recorded** — the release takes a pgbackrest pre-migrate `incr` backup (`infra/deploy/README.md` → step 4, DSO-129); confirm it in the driver unit's journal, record its label/timestamp in the release record comment. (Dev-stand counterpart: `.claude/rules/dev-stand.md` → «Snapshot before migrate»; never `dev:snapshot` on prod.)

   Unmet ⇒ hold the range; never weaken the migration, never delete prod rows to satisfy it — open the spec-mandated data path as its own Issue, then ship. Named instances (add a line, not a section):

   - **0028 — `experts` structured-name contract (#1642).** `apps/api/drizzle/0028_cultured_princess_powerful.sql` drops three `experts_*` constraints and `experts.name` irreversibly, raising `EARS-20: … explicit reviewed per-id mapping` on ANY `experts` row. Gate = (a); `count > 0` ⇒ hold + open the per-id mapping (012-requirements EARS-20).

5. **Rollback ready** — the previous release is a target of the rollback mode (§4): one of the latest 3 `release-*` Releases, its `images-<sha>.json` recorded, and the DB untouched by an app rollback (guaranteed by item 4).
6. **Target on `main`** — a full 40-hex SHA contained in `main`. The workflow ships exactly that commit's codeload tree and runs the record code of `main`; no workstation checkout takes part. The pre-flight refuses any other SHA.
7. **No live broadcast (эфир gate)** — `pnpm deploy:check-live`: `CLEAR` (exit 0) proceeds; `LIVE:` or `UNKNOWN` (exit 1, fail-closed) **holds regardless of change-class** — wait for the эфир to end or bind to the maintenance window (02:00–06:00 MSK). The release pre-flight runs the same probe as a hard gate with no override; an urgent mid-broadcast ship is by definition **escalate** and goes through break-glass `--allow-live-broadcast` (§6) on the owner's explicit go.

8. **Release gate clear (spec §10.10)** — no OPEN global `release-blocker` Issue (`gh issue list --label release-blocker --state open`), no OPEN prerequisite named by `Release-requires: #N, #M` in a selected PR body, and no selected PR's OPEN batched Stage-B gate (item 2's marker, read from PR body OR linked `Closes #N` Issue comments). The pre-flight enforces all three, fail-closed. PR prerequisites apply only to the selected `<live deployed>..<target>` range, including hotfixes; absent/`none` means no prerequisites. Track rollout actions/postchecks with timing and an execution/check plan, never circular preconditions of their own activation.

   When a release is held, name the target SHA/range, exact failed gate and evidence. Reassess every global label: it requires an evidenced hazard to ANY deployment, why narrower controls are insufficient, and an exit condition. Remove obsolete labels with an evidence comment, keeping remaining work OPEN; this is correcting applicability, not bypassing a valid hold. Deferred work, incomplete post-release checks or an unexplained CI flake alone do not qualify. Use the pinned-release/exemption path only with its required authorization. A failed test-email wait is not evidence of production mail failure.

   **The pre-flight reads Issue STATE, not its content.** A batched Stage-B gate whose owner GO is already recorded in a comment still holds the release while the Issue is OPEN — `tools/deploy/release-gate.mjs` never parses the GO. So when the gate has its GO **and** the owner has given the release word, **close the gate Issue first, then dispatch**; closing it is the completion of the gate, not paperwork deferred to after the ship. `--release-gate-exempt "<reason>"` exists only on break-glass `pnpm deploy:prod`, for a gate that genuinely cannot be closed yet (it still tracks open work), never a shortcut around closing a satisfied one — and only on the **owner's explicit go** (release-cycle spec §10.10).

9. **Session-invalidating changes announced** — a change in the range that re-derives the session fingerprint forces every signed-in user and operator to sign in again on deploy; ship it in a quiet window with the owner ack recorded on the PR. Standing entry: **deploy #1736 invalidates all sessions once — quiet window, owner ack 2026-09-02** (https://github.com/doctor-school/ds-platform/pull/1736#issuecomment-5505979858).

10. **IdP provisioning drift — pipeline-owned (#1997), verify the step's result.** Every release runs `infra/dev-stand/idp/provision.sh` on api-prod (after `up -d`, before the truthful-success verify) and reads the password-complexity policy back from the instance, comparing it against `@ds/schemas` `PASSWORD_MIN_LENGTH` at the deployed SHA — a failed converge or a rejected read-back FAILS the release. `git diff --name-only <deployedSha>..<target> -- infra/dev-stand/idp/provision.sh` non-empty tells you to expect «converged» rather than «already» lines in the driver unit's journal. Provisioning is **not** rolled back (converge steps are forward-only); the manual command (`infra/deploy/README.md` → step 9) stays the recovery path. Precedent #1994: the 003 EARS-36 length-only policy shipped in code, the prod instance kept the provider default, registration 422'd for 18 days until the re-run on 2026-09-07 — that gap is what the pipeline step closes.

11. **Stage suite green on the target SHA — pipeline-owned.** Environment-level risk (prod build, real IdP, real-shaped data) is covered once per release on the shared stage `main` slot: `stage.yml` converges slot `main` on every `main` push, runs the full stage suite and posts the `stage-suite` commit status on the SHA (release-pipeline spec §3 item 3). The release pre-flight requires it `success`; a missing, pending or red status refuses — wait for `stage.yml` on that SHA, or fix its cause. Read it before proposing: `gh api repos/{owner}/{repo}/commits/<sha>/statuses --jq '.[] | select(.context=="stage-suite") | .state' | head -1`.

Record three separate facts before execution: authorization (the owner's word, verbatim, with its source and scope), readiness (each required check's evidence), and execution (not started / running / verified result). A preparation-only go never becomes a cutover go. After execution, attach the actual release/deployment and health evidence.

## `main` stays deployable — revert by default (spec §10.10)

A release ships the WHOLE `deployedSha..<target>` range, so one broken merged PR holds every other merged PR out of prod. When a merged PR is discovered broken ahead of its fix:

- **Revert it from `main`** — the default, not the fallback. A normal revert PR (`git revert <squash-sha>`) under the normal rules: Conventional-Commit title, linked defect Issue, Mode-a review, green CI, changeset if the reverted change was user-facing. The fix re-lands later as its own PR.
- **Or track the fix as a prerequisite of the offending PR** when a revert is disproportionate: add `Release-requires: #N` to its body and record why. Only releases including that PR wait. Use global `release-blocker` solely for evidenced risks to ANY deployment, recording why narrower controls cannot protect it and an exit condition. Remove the label when that universal risk ends; do not falsely close remaining work.

Never leave a known-broken PR on `main` without a revert or an applicable tracked release hold: the next release must not ship it silently.

## Procedure

### 1. Pre-flight reads, then the proposal

Run checklist items 1–11 (above); items 6–8 and 11 are the ones the workflow's `preflight` job re-checks (`tools/deploy/release-runner.mjs preflight --sha <sha>`: SHA in `main` · `stage-suite` success · CI green · release gate · live-broadcast gate · recorded `images-<sha>.json`). Propose the release to the owner in chat: target SHA, range, class, evidence. Wait for the owner's word.

### 2. Dispatch on the owner's word

```bash
gh workflow run deploy-prod.yml --ref main -f sha=<40-hex sha on main> -f owner_quote="<the owner's words, verbatim>"
```

Run it as **its own statement** — never piped (`| tee` returns the pipe's exit code and masks a failure). An empty or whitespace-only `owner_quote` is refused first. `concurrency: deploy-prod` runs one release at a time, never cancelled.

### 3. Poll the run, then verify

```bash
gh run list --workflow deploy-prod.yml --limit 1 --json databaseId,status,conclusion
gh run watch <run-id> --exit-status
```

The `deploy` job prints status lines only (Actions logs are public); the box step detail stays in the driver unit's journal. After a terminal status the workflow cuts `release-YYYY.MM.DD-n` at the deployed SHA on success (`--generate-notes` since the previous `release-*` that is an ancestor; a redeploy of an already-released SHA cuts nothing — the non-empty-range guard), writes the ONE `Deployment(production, sha)` record for success **and** failure with the quote, and on a newly recorded success calls `release-digest.yml` (`workflow_call`). The `Version Packages` PR merge cuts no repo-level release (per-package `version` + `CHANGELOG.md` only).

Verify, all three:

- **Deployment record** — `gh api repos/{owner}/{repo}/deployments?environment=production\&sha=<sha>` has the record, its latest status `success`, the quote in its description.
- **Health** — `curl -s https://api.doctor.school/v1/health | jq -r .version` equals the deployed SHA.
- **Digest CONTENT, not the HTTP 200** (retro 2026-07-15) — grep the `release-digest` run log for the delivered product-PR count (`delivered … (N product PR(s))`). A "release done" claim is FORBIDDEN until N>0 **or** an intentional zero is explicitly acknowledged to the owner. **Any change to the notes/digest machinery** additionally requires a golden-output dry-run (`node tools/deploy/release-notes.mjs --dry-run --prev-sha <prev> --new-sha <new>`, `DELIVERY_ENV=prod`) against the ACTUAL next `prev..new` delta, eyeballed, before merge (#968 shipped an empty-digest bug a dry-run would have caught).

Then the **release-milestone close-out** (#1729): when the range ships the LAST open feature of a track-release milestone (its gate Issue's `blocked_by` graph is drained), close the gate Issue and the milestone (`gh api -X PATCH repos/doctor-school/ds-platform/milestones/<n> -f state=closed`). A milestone with open features stays OPEN; roadmap dates belong to `pnpm roadmap:forecast`.

**Lost contact is not a failure.** When ssh to ds-api-prod fails four times in a row or the release does not finish within 60 min, the job records the Deployment status `error` («could not determine») and fails, while the driver unit keeps running on the box. Re-dispatch the same SHA with the same quote: it reattaches (`attached`) or answers `already-succeeded` and records the verdict — never two success records, cuts or digests. `pnpm deploy:probe` gives the box reality in one line (`<LIVE|DEGRADED|UNREACHABLE> health=<sha> …`) when you need it before deciding.

### 4. Rollback (app-only, no owner word)

When a release visibly broke production (failed post-deploy smoke, site or login down), roll it off at once and report to the owner (owner decision 2026-10-22):

```bash
gh workflow run deploy-prod.yml --ref main -f mode=rollback -f sha=<target sha> -f reason="<why>"
```

The target is one of the latest 3 `release-*` Releases, strictly behind the live SHA, with its `images-<sha>.json` recorded; no stage-suite, release-gate or live-broadcast check (a rollback never waits out an эфир). The box runs the migration floor and `up -d` the target's images pulled by digest — no build, no migrate, no DB change. The ONE Deployment record reads `rollback to <sha12> — <reason>`; Mattermost gets «откат прода на <sha12>: <reason>»; no release cut, no digest. Verify the record and `/v1/health` as in §3. A **bad migration** (not app code) needs a pgbackrest restore — [`infra/deploy/README.md`](../../../../../infra/deploy/README.md) → Rollback; that needs the owner's word.

### 5. After a release — the merged-not-deployed nudge

`## Project reality` (bootstrap `pnpm bootstrap`, #939) derives the latest release, the deployed SHA (GitHub Deployment ⋈ `/v1/health`), and the **merged-not-deployed delta** at SessionStart. A non-empty delta renders the explicit **D-trigger verdict** (spec §10.2/§10.3): `class standing-auth (…)` or `class escalate (…)` from the range's touch-set (`classifyDeployRange` in `tools/project-reality.ts`; uncomputable defaults to escalate). Treat it as the detection signal: run the checklist over the range and, if a releasable unit is ready, propose the release. A requested release remains unfinished until deployment and required verification are evidenced. If a real gate prevents progress, record the remaining delta and the exact decision/event awaited; a merge, handoff or status report is not release completion.

### 6. Break-glass: `pnpm deploy:prod`

The workstation command runs only under the owner's offline `breakglass` key (it connects as `breakglass@ds-api-prod`; data-prod through its ProxyJump as `deploy`) and only on the owner's word — for what the workflow deliberately does not do: a hotfix `--ref`, a workstation `--rollback`, and the gate exceptions `--skip-ci-check` / `--allow-live-broadcast` / `--release-gate-exempt "<reason>"`. It runs the same pre-flight modules and box steps, cuts the release and records the Deployment itself. Detail: [`tools/deploy/README.md`](../../../../../tools/deploy/README.md) → `pnpm deploy:prod`. Run it as its own statement; it needs a clean, fast-forwarded `main` checkout (its record code is the checkout's).

**Hotfix (`--ref <sha>`, spec §10.11).** When prod needs ONE already-merged fix and the rest of `main` is not ready. Not for unmerged work, not for a feature preview — land the fix on `main` first, always. Pushing the hotfix branch runs `runtime-images.yml` for it (`ref: "hotfix/<N>-<slug>"`); a `--ref` target is no `main` push, so the pre-flight runs the PC stage `main` check (`stage-main-check.mjs`: `stage:slot up main --ref <sha>` + the full `e2e:stage main --expect-sha <sha>` from a clean detached checkout; needs `STAGE_BASIC_AUTH_PASS`, stage ssh and an authenticated `gh` — `tools/staging/README.md`).

```bash
curl -s https://api.doctor.school/v1/health | jq -r .version    # DEPLOYED
gh pr view <PR#> --json mergeCommit -q .mergeCommit.oid          # FIX
git fetch origin --tags
git switch -c hotfix/<N>-<slug> <DEPLOYED>
git cherry-pick -x <FIX>            # repeat for each already-merged fix, oldest first
git push -u origin hotfix/<N>-<slug>
gh workflow run ci.yml --ref hotfix/<N>-<slug>
gh run list --workflow ci.yml --branch hotfix/<N>-<slug> --limit 1             # wait for green
gh run list --workflow runtime-images.yml --branch hotfix/<N>-<slug> --limit 1 # wait for green
pnpm deploy:prod --ref $(git rev-parse origin/hotfix/<N>-<slug>)
git push origin --delete hotfix/<N>-<slug> && git branch -D hotfix/<N>-<slug>   # once recorded
```

The pre-flight refuses a target that is not a strict descendant of the LIVE deployed SHA, or that carries any commit with no equivalent on `origin/main` (native `git cherry` equivalence, or a canonical `-x` receipt plus clean replay with an exact target-tree match). A conflicted cherry-pick is a signal to re-sequence, never to hand-resolve. The Release is titled «… — Hotfix». After a hotfix, prod sits on an off-main SHA: the bootstrap delta is anchored on `git merge-base origin/main <deployedSha>`; the next ordinary release gets prod back on the train.

## Output

- The target SHA live on prod; `curl …/v1/health | jq .version` == deployed SHA.
- ONE GitHub Deployment(production) record carrying the owner quote (or the rollback reason); a release tag on success; the Mattermost digest posted with N>0 product PRs (or an acknowledged zero).

## Failure modes

- **Dispatching without the owner's word**, or with a paraphrase — every release needs the word verbatim in `owner_quote`. A rollback needs none.
- **Piping a release command** (`| tee`) — masks a non-zero exit; run it standalone.
- **`preflight` refuses** — the job names the gate: SHA not in `main`, `stage-suite` missing/pending/red (wait for `stage.yml`), CI red, release gate, live broadcast, or **no recorded images** (`recorded images for <sha>: …` — no branch-push `runtime-images.yml` run for the SHA, a run in progress, a failed run, an expired artifact, or a manifest that is not `ref: "main"`). Nothing was touched; fix the cause, then re-dispatch. Never build on the box.
- **`runtime-images.yml` red on an npm registry 503** while pulling into the Runtime images — a registry blip, not a code defect: `gh run rerun <run-id> --failed`, and record the flake in `DEBT.md` in the same session (repo-conventions → «CI rerun ≠ free»).
- **Pre-swap boot verify red (`freshly pulled image(s) do NOT boot: portal=EXITED`)** — **prod is untouched**: nothing was swapped, no migration applied, the previous containers still serve. A build defect to fix on `main` (usually a dependency bump), caught pre-merge by the `standalone-boot` CI job; never a rollback.
- **Smoke RED only on the doctor host after a green Caddy step (#2050)** — the running `caddy` container holds the old Caddyfile inode. Recovery from a break-glass session: `ssh breakglass@ds-api-prod "sudo sh -c 'cd /home/deploy/ds-platform/infra/deploy/compose/api-prod && docker compose restart caddy'"`, then re-dispatch the same SHA (idempotent) and confirm the smoke is green on all hosts.
- **Rolling back to a SHA outside the latest 3 releases** — the rollback pre-flight refuses it; roll _forward_ instead (a release of a fixed `main` SHA).
- **Treating a record WARN or a lost-contact `error` as a failed release** — read the box state (`pnpm deploy:probe`) and re-dispatch the same SHA; the record is written once.

## Related skills

- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md) — land the PR before it can be released.
- [../run-wrap/SKILL.md](../run-wrap/SKILL.md) — stage 4 checks the merged-not-deployed delta at session end.

Detail: `tools/deploy/README.md` (Release from Actions, Rollback mode, break-glass `pnpm deploy:prod`, `deploy:smoke` / `deploy:release-notes`); ADR-0012 (2-VPS topology; A1 = the release-pipeline direction); release-pipeline tech spec `specs/tech/2026-10-16-release-pipeline-off-workstation-en.md`; release-cycle spec §10 (D+B trigger policy); `infra/deploy/README.md` §5–§10 (operational SSOT).
