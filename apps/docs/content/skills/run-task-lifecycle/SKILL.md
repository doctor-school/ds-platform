---
title: "run-task-lifecycle"
description: "Orchestration skill (inline): drive a single task end-to-end — pick/create Issue with all fields → branch → implement → review → confirm green → merge → close → set board Status → report — invoking the existing per-step skills, never restating them."
name: run-task-lifecycle
mode: inline
---

# run-task-lifecycle

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** orchestration · **Mode:** inline (the lead agent runs this procedure itself; it dispatches subagents only at the steps marked **dispatch**).

This is the **connective** lifecycle skill. It does not re-implement any step — it names the canonical sequence and **invokes the existing catalog skill** at each gate. Its whole reason to exist is that the audit (epic #247) found the two highest-frequency deviations are at the **ends** of the lifecycle: fields not set at Issue creation (Theme B) and the lifecycle stopping short of merge→close→board-Done→report (Theme A — "почему не отправил на ревью?", "почему ждёт моего мёржа?", "CI прошёл, но задача висит", "почему не проставил зависимости / майлстоун?"). Per **AGENTS.md §6 — "PR lifecycle runs to completion"**: "PR open" is not "done", and the agent runs through merge autonomously.

> **Cannot proceed without** — the verdict artifacts of `request-mode-a-review` (APPROVE) and the per-kind orchestration gates. The lead does not advance past a gate without its artifact in hand (ADR-0007 §2.4).

## Scope gate — before tracker or dispatch

Answers, analysis, artifact exports and authorized standard operations run directly: provide the requested result and proportionate evidence, then stop. They do not require an Issue, worktree, PR, dispatch, package install or repository-wide checks merely because the session is in this repository. Preserve maintained sources and apply the operation’s actual safety/authorization gates. For an export use the requested destination (otherwise outside the repository), verify content/destination and return its link.

Changing a maintained spec, ADR, instruction or runtime source, or explicitly requesting repository integration/publication, enters the normal lifecycle below. A request to save text does not by itself request such a change. Preserve the text's language and distinguish review recommendations from accepted decisions.

## Autonomous vs human-gated (read first)

Per AGENTS.md §4 + §6, the agent is **autonomous through merge**: it dispatches the review, confirms CI green by hand, merges, closes, sets the board, and reports — **without waiting for the human**. A positive **Mode (a)** (subagent) or **Mode (b)** (Codex) verdict + green CI is sufficient to merge; human-merge is **not** required. **Mode (c)** review is human-gated. Independently, Stage A before UI implementation, Stage B before merge, and explicit destructive-infra/release escalation gates remain owner decisions. Do not stop at an intermediate step "waiting for confirmation"; the repeated correction in the audit was precisely that stop.

## Input

- A repository-changing task that passed the Scope gate: an existing Issue `#N`, or a need that has no Issue yet (create one first — step 1).

## Procedure

### 1. Pick or create the Issue — with all fields complete (closes Theme B)

Use the owner’s named task; create or reuse its Issue without a backlog sweep. Only when the owner requested backlog selection or a continuing wave, inspect the relevant queue and apply prerequisite/claim ordering. Resolve routine implementation choices within scope; ask only for genuinely missing product decisions or authorization.

**Issue-claim protocol (parallel sessions).** Sessions run concurrently in this repo (AGENTS.md §6 — worktree-per-session), so the board is a **shared resource**: two sessions can race for the same ready item. The board Status **is** the claim, and first-claim wins:

- **`In Progress` means owned.** An item already at Status `In Progress` belongs to **another live session** — do **not** pick it. The one exception is a stop-state comment on it saying the work stopped/was handed back (the fixed four-field shape, repo-conventions → _Issue conventions_); never assume it's free without **reading that latest comment** first.
- **Queue-position check before the claim.** Answer in one line: «блокирует ли это регистрацию врача и просмотр ближайшего эфира?» (the current release's litmus, from its gate Issue). `set-board-status … "In Progress"` refuses (exit 3) an Issue outside its track's queue-head milestone — the open release with the earliest owner-set `due_on`; `--ahead-of-queue "<verbatim owner quote>"` overrides and posts the quote as the claim comment. Slice by journey: one PR may close several EARS Issues that form one user action.
- **Setting Status = `In Progress` is the claim marker — do it first.** Moving the item to `In Progress` (`node tools/gh/set-board-status.mjs <N> "In Progress"`) is the **first** action of taking a task, **before** the first deliverable edit; worktree isolation may precede the claim — it is how you stake the claim other sessions read.
- **Re-check Status immediately before branching.** Between deciding and creating the branch another session may have claimed the item. Re-read its Status right before `git … branch`; if it flipped to `In Progress` under you (someone claimed it in the gap), **yield and pick the next item** — first claim wins, no tug-of-war.
- **Grooming collides too.** When you groom the "next task" in parallel with other sessions, the same rule resolves it: claim by flipping Status, and if two sessions eye the same top item, the one that set `In Progress` first owns it; the other moves to the next unblocked item.

If the work has no Issue, create one **before touching code** (AGENTS.md §6 — no untracked work). Whether picking or creating, enforce this **field-completeness checklist** before the Issue is "ready" — every box, not prose:

- [ ] **Kind label** set — exactly one of `feature` / `bug` / `chore` / `refactor` / `docs` / `tooling` (and `kind:ears-handler` / `kind:integration` for spec work). The org **Issue Type** is auto-derived from it by `pnpm issue:create` (`bug`→Bug, `feature`→Feature, else Task) — no manual `--type` needed. `author:*` goes in the **body**, not as a label.
- [ ] **Source label** set — exactly one of the provenance taxonomy `source:owner` (requested/approved by the product owner — needs a quotable owner turn) | `source:spec` (opened from a merged feature spec, via `open-ears-issues`) | `source:retro` (filed by a wrap/retro/decision-debt ritual) | `source:agent` (agent-initiated during task execution — this step, blockers). **Pick the honest origin: `source:agent` unless the task traces to a quotable owner request (`source:owner`).** `pnpm issue:create` refuses creation without exactly one `source:*` label.
- [ ] **Track label** set — exactly one of the permanent product axis `track:academy` (academy.doctor.school surfaces, specs 012–016) | `track:doctor` (doctor showcase site `apps/doctor`, specs 017–021) | `track:platform` (shared backend/infra/process, or both sites). **The track is where the work LANDS, not who asked for it** — a shared-backend change serving both sites is `track:platform`, never the requesting site's track. `pnpm issue:create` refuses creation without exactly one `track:*` label.
- [ ] **Milestone** assigned — the track release milestone the Issue ships in (`«<Трек> R<n> — <результат>»`, e.g. «Академия R1 — Архив записей»), the track backlog («Академия · Позже» / «Витрина · Позже»), or «Platform ops & hardening» for non-roadmap work — never a per-spec name. Only an epic is exempt. An Issue with no milestone is incomplete ("почему все эти задачи не в майлстоуне?").
- [ ] **Native dependency links** wired — sub-issue under its parent where applicable, plus only genuine technical `blocked_by` / `blocks` edges with rationale via the REST API, **not** prose in the body. The board ordering procedure reads only the native graph.
- [ ] **Assignee** set — `pnpm issue:create` defaults it to `@me`; an explicit `--assignee` overrides. An unassigned Issue is incomplete.
- [ ] **On the board with a Status** — when you **create** the Issue mid-session, file it via `pnpm issue:create --title … --body-file … --label <source:*> --label <kind> --label <track:*> --milestone …` (thin `gh issue create` wrapper that **fails closed** without exactly one kind label + one `source:*` + one `track:*` + a milestone, then adds it to the board + sets Status=Todo + confirms via GraphQL and auto-derives Type/assignee), because the "Item added → Todo" auto-add is unreliable in-session (memory `reference_gh_issue_board_autoadd_delay`). For an Issue already on the board, move it with `node tools/gh/set-board-status.mjs <N> "In Progress"` once you start. A fresh Issue not on the board / with no Status is invisible to the "By milestone" view.

For a spec-driven Issue **set**, do not hand-roll this — invoke **`open-ears-issues`** (it does the label set, parent + per-EARS children, the `surface: user-facing` integration Issues, and the native-graph wiring in one recipe). The field detail lives in `.claude/rules/repo-conventions.md` → _Issue conventions_; do not restate it here.

When you start the Issue, move it: `node tools/gh/set-board-status.mjs <N> "In Progress"`.

### 2. Branch → implement (defer to the per-kind skill)

**User-facing surface — the design-system-first cycle gates this step (AGENTS.md §6).** If the task renders a user-facing surface, run the `build-ui-from-design-system` cycle **before** this step — before UI implementation; create the isolated discovery worktree and claim first when needed. For an element class **not yet covered** in the [design constitution](../../design/constitution.md), the cycle dispatches [`research-ui-element`](../research-ui-element/SKILL.md) first — its rendered options are the **Stage A** artifact the product owner picks from; a **covered** class is reused from the package + constitution, not re-researched. Do not enter implementation of a user-facing design on your own taste. Full cycle + Stage A/B gates: `build-ui-from-design-system`. For a surface that came through `product-discovery`, its screen LAYOUT was already owner-approved on the `author-design-mockup` mockup (ADR-0014) — build that; the element-class cycle here handles any uncovered class.

Create the isolated branch with `pnpm task:worktree <N> <slug> <prefix>` off fresh `origin/main`, use that worktree for reads/writes/tests, and run `pnpm install` before its first commit (§2 / repo-conventions). Then **identify the task kind (AGENTS.md §3.1) and run that skill** — do not re-derive the procedure here:

- **product-discovery** → **`do-product-discovery`** (discovery track: legacy-mine → brief + PRD → Claude Design mockup → handoff to `spec-authoring`; ADR-0014).
- **feature-iteration** → **`do-feature-iteration`** (RED→GREEN→REFACTOR, its own end-checklist + review + merge gates).
- **hotfix-pr** → **`do-hotfix-pr`**.
- **adr-revision** → **`do-adr-revision`**; **decision-debt** → **`do-decision-debt-followup`**.
- **engineering-task** (no orchestration skill) → follow the task spec directly under **AGENTS.md §3.8** discipline gates.

`do-feature-iteration` / `do-hotfix-pr` already carry steps 3–6 below internally (push → review → respond → merge). When you ran one of them, this skill's role is to **confirm those tail steps actually completed** and then run step 7 (board + report), which they do not all cover. For an `engineering-task` (no orchestration skill), run steps 3–7 here explicitly.

### 3. Open the PR

`git push` + `gh pr create` with the template filled: kind label(s), `Closes #N`, `author:*` marker **in the body** (it is not a `gh --label`). Reference the parent epic where one exists.

### 4. Review — mandatory (dispatch)

Invoke **`request-mode-a-review`** (Mode (a) subagent). It returns a structured `VERDICT: APPROVE | REQUEST_CHANGES`. On `REQUEST_CHANGES`, route findings through **`respond-to-review`** and re-dispatch until APPROVE. This gate is non-bypassable (AGENTS.md §4, ADR-0007 §2.4) — the audit's #1 correction was the agent never dispatching review at all.

### 5. Confirm CI green by hand (Phase-0 manual gate)

`pnpm merge:gate <N>` — confirm green **yourself** via the deterministic merge gate (#836: head-SHA-pinned check-runs, zero registered runs = FAIL, structured status parsing — never an ad-hoc `gh pr checks` grep/watch; canon: skill `merge-when-green` Step 1). `--auto` does **not** block on CI in Phase 0 (memory `feedback_phase0_merge_gate_manual`), so the gate is mandatory before merge. Baseline-already-red is noted in the PR, not silently merged over.

### 6. Merge (autonomous — do not wait for the human)

With APPROVE + green CI, invoke the canonical **`merge-when-green`** skill; prefer `pnpm pr:land <N>` for the complete closeout tail. Per AGENTS.md §4 / §6, the agent merges itself — human-merge is not required (Mode (c) review and the independent Stage-A/Stage-B product gates remain human). Phase-0 `--auto` and hand-rolled merge chains are forbidden; the owning skill defines the exact current command.

### 7. Close → board Status = Done → re-sweep + report

Run all four, in order, as part of the **same** merge step — not a separate human ask ("тогда почему ты закрыл задачу?" / "CI прошёл, но задача висит"):

1. **Confirm the Issue closed** — `Closes #N` auto-closes it; verify with `gh issue view <N> --json state`. If it did not close (the keyword was missing), close it explicitly. The iteration summary / result comment on the Issue must carry the `surface-decision-debt` verdict (`[]` or the list) — a merge without it is incomplete, and on a multi-task batch this is per-task, not per-session.
2. **Set board Status = Done** — `node tools/gh/set-board-status.mjs <N> "Done"`. `Closes #N` does **not** move the Projects v2 column (no closed→Done workflow is wired); this is the deterministic helper for the rule in memory `feedback_project_status_done_on_merge`. This step is part of merge, not optional.
3. **Re-sweep branches/PRs** — `gh pr list` + `git ls-remote --heads origin`; bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge (repo-conventions → _Post-merge inventory re-sweep_).
4. **Report and stop.** Complete the requested outcome; adjacent work and WARNs do not extend it. Groom/select another task only within explicitly authorized backlog or continuing-wave scope, using `groom-backlog`; evaluate ops/debt priorities there.

**Groom/triage deliverable — output contract.** When the groom is a **backlog-triage deliverable presented to the owner** (not just silently picking the next item), it opens with a **product-language synthesis** — current stage · what is burning to release and why · what defers · remaining tech-debt · open forks/contradictions — **then** a grouped full panorama of the backlog, **then** wave-chunking (≤3 PR-cycles per wave). Never lead with a thin wave plan (owner: «где сам триаж?»), and never dump a raw issue registry (owner: «список я вижу сам в GitHub») — the synthesis is the value the tracker cannot show itself (memory `feedback_groom_session_no_impl_until_signoff`).

## Output

- Issue `#N` CLOSED, with every field complete (kind, milestone, native links, board Status = Done).
- PR merged into `main`, head branch deleted, inventory re-swept clean.
- Requested result reported; stop unless continued backlog work was authorized.

## Failure mode

- **Stopping at "PR open"** and waiting for the human to ask for review / merge / close / status — the audit's highest-frequency deviation (Theme A). AGENTS.md §6 makes the full run-through the rule; this skill is its operational checklist.
- **Creating an Issue with missing fields** (no milestone, prose-only dependencies, no board Status) — Theme B. Step 1's checklist is the gate.
- **Closing the Issue but leaving the board in "In Progress"** — `Closes #N` does not move the column; step 7.2 (`set-board-status.mjs … Done`) is mandatory.
- **Restating a sub-skill's procedure here** instead of invoking it — this skill is connective by design; duplicated procedure drifts out of sync. If a step's detail is wrong, fix it in the owning skill.

## Related skills

- [../open-ears-issues/SKILL.md](../open-ears-issues/SKILL.md) — spec → Issue set with fields + native links (step 1).
- [../do-feature-iteration/SKILL.md](../do-feature-iteration/SKILL.md) · [../do-hotfix-pr/SKILL.md](../do-hotfix-pr/SKILL.md) — per-kind implement→review→merge (step 2).
- [../request-mode-a-review/SKILL.md](../request-mode-a-review/SKILL.md) · [../respond-to-review/SKILL.md](../respond-to-review/SKILL.md) — review gate (step 4).
- [../merge-when-green/SKILL.md](../merge-when-green/SKILL.md) — the single merge command (step 6).
- [../run-iteration-end-checklist/SKILL.md](../run-iteration-end-checklist/SKILL.md) · [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md) — pre-merge discipline gates.

Helpers:

- `tools/gh/create-issue.mjs` (alias `pnpm issue:create --title "<t>" --body-file <f> [--label <l> …]`) — thin wrapper over `gh issue create` that **also** adds the new Issue to the Projects v2 board and sets Status=Todo, confirming via a GraphQL `node(id)` read. Use it for **any mid-session Issue creation**: the board's "Item added → Todo" auto-add is unreliable within a session (memory `reference_gh_issue_board_autoadd_delay`), so a bare `gh issue create` can silently miss the board.
- `tools/gh/set-board-status.mjs` (alias `pnpm board:status <N> <status>`) — deterministic Projects v2 Status setter used in steps 1 and 7.
