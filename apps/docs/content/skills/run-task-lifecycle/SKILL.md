---
title: "run-task-lifecycle"
description: "Orchestration skill (inline): drive a single task end-to-end — pick/create Issue with all fields → branch → implement → review → confirm green → merge → close → set board Status → groom — invoking the existing per-step skills, never restating them."
name: run-task-lifecycle
mode: inline
---

# run-task-lifecycle

**Kind:** orchestration · **Mode:** inline (the lead agent runs this procedure itself; it dispatches subagents only at the steps marked **dispatch**).

This is the **connective** lifecycle skill. It does not re-implement any step — it names the canonical sequence and **invokes the existing catalog skill** at each gate. Its whole reason to exist is that the audit (epic #247) found the two highest-frequency deviations are at the **ends** of the lifecycle: fields not set at Issue creation (Theme B) and the lifecycle stopping short of merge→close→board-Done→groom (Theme A — "почему не отправил на ревью?", "почему ждёт моего мёржа?", "CI прошёл, но задача висит", "почему не проставил зависимости / майлстоун?"). Per **AGENTS.md §6 — "PR lifecycle runs to completion"**: "PR open" is not "done", and the agent runs through merge autonomously.

> **Cannot proceed without** — the verdict artifacts of `request-mode-a-review` (APPROVE) and the per-kind orchestration gates. The lead does not advance past a gate without its artifact in hand (ADR-0007 §2.4).

## Autonomous vs human-gated (read first)

Per AGENTS.md §4 + §6, the agent is **autonomous through merge**: it dispatches the review, confirms CI green by hand, merges, closes, sets the board, and grooms — **without waiting for the human**. A positive **Mode (a)** (subagent) or **Mode (b)** (Codex) verdict + green CI is sufficient to merge; human-merge is **not** required. The **only** human-gated path is **Mode (c)** (pure human review) — used when the human explicitly asks to review themselves. Do not stop at an intermediate step "waiting for confirmation"; the repeated correction in the audit was precisely that stop.

## Input

- A task: an existing Issue `#N`, or a need that has no Issue yet (create one first — step 1).

## Procedure

### 1. Pick or create the Issue — with all fields complete (closes Theme B)

**Deciding _which_ task to pick is the lead's own call — not an `AskUserQuestion`.** Before asking the user to choose, run the decision yourself: (1) sweep the backlog (open Issues / PRs / Dependabot / stale pins); (2) apply prerequisite-first + close-the-open-epic ordering; (3) classify the fork — a **sequencing / architecture / code-cleanliness** call you settle yourself by best-architecture (memory `feedback_spec_work_brainstorm_reuse_delegate`); only a genuine **product-scope** fork (or a true blocker) is eligible for `AskUserQuestion`. "Which of these ready tasks is more valuable" is usually yours to reason out, not the user's to adjudicate.

If the work has no Issue, create one **before touching code** (AGENTS.md §6 — no untracked work). Whether picking or creating, enforce this **field-completeness checklist** before the Issue is "ready" — every box, not prose:

- [ ] **Kind label** set — `feature` / `bug` / `chore` / `refactor` / `docs` / `tooling` (and `kind:ears-handler` / `kind:integration` for spec work). `author:*` goes in the **body**, not as a label.
- [ ] **Milestone** assigned — the long-lived product-theme milestone (e.g. `Auth foundations v1`, `Agent workflow & methodology`), not a per-spec name. An Issue with no milestone is incomplete ("почему все эти задачи не в майлстоуне?").
- [ ] **Native dependency links** wired — sub-issue under its parent **and** `blocked_by` / `blocks` edges via the REST API, **not** prose in the body. The board ordering procedure reads only the native graph.
- [ ] **Board Status** set — `node tools/gh/set-board-status.mjs <N> "Todo"` (or `In Progress` once you start). A fresh Issue not on the board / with no Status is invisible to the "By milestone" view.

For a spec-driven Issue **set**, do not hand-roll this — invoke **`open-ears-issues`** (it does the label set, parent + per-EARS children, the `surface: user-facing` integration Issues, and the native-graph wiring in one recipe). The field detail lives in `.claude/rules/repo-conventions.md` → _Issue conventions_; do not restate it here.

When you start the Issue, move it: `node tools/gh/set-board-status.mjs <N> "In Progress"`.

### 2. Branch → implement (defer to the per-kind skill)

**User-facing surface — the design-system-first cycle gates this step (AGENTS.md §6).** If the task renders a user-facing surface, run the `build-ui-from-design-system` cycle **before** this step — before moving the Issue to In Progress (step 1) and before this branch. For an element class **not yet covered** in the [design constitution](../../design/constitution.md), the cycle dispatches [`research-ui-element`](../research-ui-element/SKILL.md) first — its rendered options are the **Stage A** artifact the product owner picks from; a **covered** class is reused from the package + constitution, not re-researched. Do not enter implementation of a user-facing design on your own taste. Full cycle + Stage A/B gates: `build-ui-from-design-system`. For a surface that came through `product-discovery`, its screen LAYOUT was already owner-approved on the `author-design-mockup` mockup (ADR-0014) — build that; the element-class cycle here handles any uncovered class.

Branch off fresh `origin/main`: `<prefix>/<N>-<slug>` (§2 / repo-conventions). Then **identify the task kind (AGENTS.md §3.1) and run that skill** — do not re-derive the procedure here:

- **product-discovery** → **`do-product-discovery`** (discovery track: legacy-mine → brief + PRD → Claude Design mockup → handoff to `spec-authoring`; ADR-0014).
- **feature-iteration** → **`do-feature-iteration`** (RED→GREEN→REFACTOR, its own end-checklist + review + merge gates).
- **hotfix-pr** → **`do-hotfix-pr`**.
- **adr-revision** → **`do-adr-revision`**; **decision-debt** → **`do-decision-debt-followup`**.
- **engineering-task** (no orchestration skill) → follow the task spec directly under **AGENTS.md §3.8** discipline gates.

`do-feature-iteration` / `do-hotfix-pr` already carry steps 3–6 below internally (push → review → respond → merge). When you ran one of them, this skill's role is to **confirm those tail steps actually completed** and then run step 7 (board + groom), which they do not all cover. For an `engineering-task` (no orchestration skill), run steps 3–7 here explicitly.

### 3. Open the PR

`git push` + `gh pr create` with the template filled: kind label(s), `Closes #N`, `author:*` marker **in the body** (it is not a `gh --label`). Reference the parent epic where one exists.

### 4. Review — mandatory (dispatch)

Invoke **`request-mode-a-review`** (Mode (a) subagent). It returns a structured `VERDICT: APPROVE | REQUEST_CHANGES`. On `REQUEST_CHANGES`, route findings through **`respond-to-review`** and re-dispatch until APPROVE. This gate is non-bypassable (AGENTS.md §4, ADR-0007 §2.4) — the audit's #1 correction was the agent never dispatching review at all.

### 5. Confirm CI green by hand (Phase-0 manual gate)

`gh pr checks <N>` — confirm green **yourself**. `--auto` does **not** block on CI in Phase 0 (memory `feedback_phase0_merge_gate_manual`), so a hand-check is mandatory before merge. Baseline-already-red is noted in the PR, not silently merged over.

### 6. Merge (autonomous — do not wait for the human)

With APPROVE + green CI, invoke **`merge-when-green`**: the single command `gh pr merge <N> --auto --squash --delete-branch`. Per AGENTS.md §4 / §6, the agent merges itself — human-merge is not required (only Mode (c) review is human). Any other merge form is a process violation (ADR-0008 §2.6).

### 7. Close → board Status = Done → re-sweep + groom (closes Theme A tail)

Run all four, in order, as part of the **same** merge step — not a separate human ask ("тогда почему ты закрыл задачу?" / "CI прошёл, но задача висит"):

1. **Confirm the Issue closed** — `Closes #N` auto-closes it; verify with `gh issue view <N> --json state`. If it did not close (the keyword was missing), close it explicitly.
2. **Set board Status = Done** — `node tools/gh/set-board-status.mjs <N> "Done"`. `Closes #N` does **not** move the Projects v2 column (no closed→Done workflow is wired); this is the deterministic helper for the rule in memory `feedback_project_status_done_on_merge`. This step is part of merge, not optional.
3. **Re-sweep branches/PRs** — `gh pr list` + `git ls-remote --heads origin`; bot branches (`changeset-release/main`, `dependabot/*`, `codeql/*`) can appear post-merge (repo-conventions → _Post-merge inventory re-sweep_).
4. **Groom next** — pick the next unblocked board item (resume → rework → fresh → unblock ordering, board-design §5), or report the queue is empty. A merged task that leaves the next one un-surfaced is an incomplete lifecycle.

## Output

- Issue `#N` CLOSED, with every field complete (kind, milestone, native links, board Status = Done).
- PR merged into `main`, head branch deleted, inventory re-swept clean.
- The next task surfaced (or the queue reported empty).

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

Helper: `tools/gh/set-board-status.mjs` (alias `pnpm board:status <N> <status>`) — deterministic Projects v2 Status setter used in steps 1 and 7.
