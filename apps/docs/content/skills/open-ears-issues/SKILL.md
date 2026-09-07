---
title: "open-ears-issues"
description: "Procedural skill (inline): open one GitHub Issue per EARS-N requirement in a feature spec; create the label set if missing."
name: open-ears-issues
mode: inline
---

# open-ears-issues

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** inline.

## Input

- Feature-spec path `apps/docs/content/specs/features/NNN-<slug>/`.
- Extracted list of `EARS-N` requirements from `NNN-requirements.md`.

## Procedure

> **⛔ Precondition — do not emit a WBS for unconfirmed or orphan-prone scope.** Before opening anything: **(a)** the epic/feature must be confirmed **release-critical AND owner-approved per element** — a spec authored from an agent-inflated brainstorm is not a licence to open Issues ([[feedback_owner_approved_provenance]], [[feedback_remediation_scope_anchor]]); if any EARS encodes a surface/nav the owner never named (the «Школы» tell), stop and cut it upstream, don't ticket it. **(b)** Every `blocked_by` edge represents a real technical dependency with a recorded rationale. Independent children may be simultaneously takeable. Express intended sequencing and release priority in milestones/waves, never artificial dependency edges; keep the WBS bounded by the approved scope.

1. **Verify the label set exists.** Run `gh label list | grep -E 'feature:NNN-<slug>|kind:ears-handler|agent-ready'`. If any label is missing, create it before opening any Issue:

   ```bash
   gh label create "feature:NNN-<slug>" --color BFD4F2 --description "Feature NNN <slug>"
   gh label create "kind:ears-handler" --color D4C5F9 --description "Single/grouped EARS handler(s)"
   gh label create "kind:integration" --color D4C5F9 --description "Vertical-slice / integration work (not a single EARS handler)"
   gh label create "agent-ready" --color 0E8A16 --description "Ready for an AI agent to pick up"
   ```

   Closing G11 findings F-8 and F-19: do **not** silently substitute a generic label like `enhancement` when the project-specific label is missing. Either the label set is created up front, or `surface-decision-debt` is invoked to record the substitution as a follow-up.

2. **Open the parent (feature) Issue** (if not already open) via `pnpm issue:create` and link to `NNN-requirements.md`. Title it with the track prefix the roadmap taxonomy requires — `[Академия][NNN] <feature>` or `[Витрина][NNN] <feature>` (board-design spec §7.1) — and home it on the track release milestone the feature ships in (`repo-conventions.md` → Issue conventions — e.g. «Академия R1 — Архив записей», not a per-spec name). **Create that milestone before the children:** every child inherits it from this parent in step 3, so a parent with no milestone stops the run. Pass the `feature` kind label (→ auto-derived **Type=Feature**) and `--milestone`; the spec folder is bound to the work by the `feature:NNN-<slug>` label, not the milestone. **Every Issue this skill opens — parent and children — carries the provenance label `source:spec`** (opened from the approved feature spec on its spec-PR branch; the `source:*` taxonomy is `source:owner` | `source:spec` | `source:retro` | `source:agent`, one per Issue).

2b. **Sibling inventory — mandatory for a `track:doctor` / `track:academy` spec** (AGENTS.md §6 «Cross-front capability reuse before invention», #1821). Before ANY child Issue is opened, dispatch a read-only scout (`ds-explorer`) over `apps/portal`, `apps/doctor` and `packages/` for EVERY capability the EARS rows name — feed, card, calendar, filter, query/URL codec, live-state resolution, room entry, shell, formatter, whatever the spec says. The scout returns, per capability: the canonical location if one exists, the two hosts' consumers, whether the thing is shared, extractable or genuinely absent, **and the target feature package / extraction wave** read from the registry column «Target package / wave». Then, still before `pnpm issue:create`: **(a)** write/refresh the rows in the registry `apps/docs/content/specs/product/two-site-ia/capability-ownership.md` (it is the checked-in answer key, and a stale row is the failure this step exists to prevent), and **(b)** put the answer into each child's body `Reuse:` field. The vocabulary is fixed (one value per capability):

- `canon: packages/<x>` — the feature package already owns the behaviour; the host adds a route file plus host-config fields and nothing else.
- `extract-from: apps/portal/<file> (#<wave-issue>)` — the other host runs it today and the named extraction-wave Issue moves it into the package; the child Issue is `blocked_by` that wave Issue.
- `host-only: <allowlist reason>` — genuinely host-specific. **Requires a row in the registry section «Host-file allowlist» added in the SAME PR**; without that row the value is invalid and the run stops.
- `new: <reason>` — neither host ships it and no package owns it yet.

**An EARS Issue whose behaviour the other host already ships is not opened for implementation.** It is closed as a duplicate of the extraction-wave Issue (`blocked_by` that Issue, `Reuse: extract-from …`) — re-implementing it on the second host is the fork this step exists to prevent (021 → #1996). Only the host-config diff (copy, route, brand, authz envelope) stays as its own child Issue. `pnpm issue:create` fails closed on a storefront-track Issue without that line, so an unanswered capability stops the run rather than producing an Issue that describes existing Academy behaviour as new Doctor work.

3. **For each EARS-N**, open a child Issue:

   ```bash
   pnpm issue:create \
     --parent <parent-issue> \
     --title "[NNN] EARS-N: <description>" \
     --label "feature,feature:NNN-<slug>,kind:ears-handler,agent-ready,source:spec,track:<academy|doctor|platform>" \
     --body "Spec: apps/docs/content/specs/features/NNN-<slug>/. Parent: #<parent-issue>."
   ```

   **`--parent <P>` is mandatory for a `kind:ears-handler` child** (#1729): the wrapper fails closed without it, INHERITS the parent's release milestone (so no `--milestone` is passed here — a differing one is rejected rather than silently overriding the parent's release) and makes the sub-issue link itself.

   Use **`pnpm issue:create`** (the field-gated wrapper — repo-conventions → _Issue conventions_), **never** raw `gh issue create`: it fails closed unless exactly one kind label + one `source:*` + one `track:*` are present, plus a milestone — supplied here by `--parent` inheritance rather than an explicit `--milestone` — then adds the Issue to the board (Status=Todo) and **auto-derives** the org Type from the kind label (the `feature` kind label here → **Type=Feature**) and defaults the assignee to `@me` — so `--type`/`--assignee` are not passed here. The `feature` kind label is **required by the gate** and is additional to `kind:ears-handler` (which classifies the handler, not the org Type). Always pass `--body` (or `--body-file`) — without it the CLI opens an editor and hangs. Fill the body's **Dependencies** field (`Blocked by:` / `Blocks:`) with the human-readable graph — prose alone is **not** sufficient; it must be backed by the native links set in step 4.

3a. **Open integration / vertical-slice Issues — `surface: user-facing` specs only** (closing F-22). **Real-dependency done-criterion (threshold canon):** every Issue routed through the AGENTS.md §6 significance threshold carries a done-criterion naming the real dependency it waits on — closing it requires that dependency delivered and wired, never a placeholder standing in (the #1559/#1556 pattern). The "1 EARS = 1 child Issue" rule of step 3 covers **handlers only**; for a `user-facing` spec it mechanically produces a backend-only Issue set (this is exactly how 003 left the portal forms unowned). Read the spec's `surface:` frontmatter:

- **`surface: backend-only`** → skip this step; the handler Issues are the complete WBS.
- **`surface: user-facing`** → for every user-facing slice that **no handler Issue owns** (the form/page existence, the request→enter-code two-step UX, error display, redirect-after-auth, the portal↔BFF wiring), open an **integration Issue** with `kind:integration` (not `kind:ears-handler`) and the browser/E2E acceptance baked into its AC. If the slice is a **named** out-of-scope deferral from the spec, open a tracked follow-up Issue for it rather than leaving it implicit. Wire it into the native graph in step 4 like any child. A scaffold/stub whose code comment promises future wiring ("wired in F2/F3") **MUST** have a corresponding open Issue — a code comment is not a tracked obligation. **Batched-UI slices are re-cut at open time (the #595 lesson):** when the handler children are expected to merge backend-only with «Stage-B: batched at #NNN», the batched slice Issue MUST itself be decomposed into separate children by deliverable class — the surface wiring (Refine/portal UI), the browser-E2E journey, and any cross-cutting test suites — never one Issue folding them all into a single unit of work (one such combined brief consumed >1h / ~465K tokens in a single subagent, 2026-07-08; memory `feedback_decompose_integration_slices_before_dispatch`).

3b. **Grouping — tightly-coupled EARS may share one child, but not silently.** The 1-EARS-1-Issue default of step 3 is for handlers workable independently. When several EARS have an **intersecting file-touch set and cannot be parallelized** (e.g. one shell component + one route own EARS-1…13), they MAY collapse into a single child — but only with **(a)** the title reading `EARS-a..b` and the body listing the folded `EARS-N` ids explicitly, and **(b)** a `surface-decision-debt` note recording the grouping (it is a documented deviation from the 1:1 default, AGENTS.md §6). Do **not** bundle EARS under `kind:ears-handler` without both. This touch-set rationale governs **OPEN-time** WBS grouping; `feedback_wave_plan_by_touch_set` governs the distinct **DISPATCH-time** serialization of the same intersecting set.

4. **Wire the native relationships** (mandatory — prose in the body is not machine-readable, and the board ordering procedure reads only the native graph). Two relationship types, set via the GitHub REST API through `gh api`:
   - **Sub-issue hierarchy** — already wired by `pnpm issue:create --parent <P>` in step 3; the REST recipe below is the **verification / repair** side, and the creation path for a child filed before #1729.
   - **Blocked-by / blocking** — set the dependency edges between children (and on the parent where it applies). This is the part step 3 does NOT do for you.

   Both endpoints take the target's **numeric database id** (not the issue number) — `gh api repos/$OWNER/$REPO/issues/<n> --jq .id`. Resolve the ids once (a `number → id` lookup); avoid a fresh round-trip per edge when wiring a whole set.

   ```bash
   OWNER=doctor-school; REPO=ds-platform                     # set once; reused by every call below
   id() { gh api "repos/$OWNER/$REPO/issues/$1" --jq .id; }  # number → DB id

   # Verify the sub-issue links `issue:create --parent` already made:
   gh api "repos/$OWNER/$REPO/issues/<P>/sub_issues" --jq '.[].number'

   # Repair path only — attach child #C as a sub-issue of parent #P (sub_issue_id = DB id of #C):
   gh api --method POST "repos/$OWNER/$REPO/issues/<P>/sub_issues" -F sub_issue_id="$(id <C>)"

   # Mark child #B as blocked by #A (issue_id = DB id of #A, the blocker):
   gh api --method POST "repos/$OWNER/$REPO/issues/<B>/dependencies/blocked_by" -F issue_id="$(id <A>)"
   ```

   GitHub derives the reciprocal edge automatically — setting `blocked_by` on #B makes #A "blocks" #B; do **not** double-wire the other direction. Verify with the read endpoints: `gh api repos/$OWNER/$REPO/issues/<P>/sub_issues` and `gh api repos/$OWNER/$REPO/issues/<B>/dependencies/blocked_by`. Worked example: 003's parent #80 + children #81–#90 are wired this way.

5. **Record the Issue numbers** in the feature-branch commit message and add an `issues:` block to the `NNN-requirements.md` frontmatter (`issues: [N1, N2, N3, …]`).

## Output

- Parent Issue + N child Issues open.
- Native links set: each child is a sub-issue of the parent, and the blocked-by graph is wired; every body's **Dependencies** field matches the native graph.
- `NNN-requirements.md` frontmatter updated with the Issue numbers.

## Failure mode

- Substituting `enhancement` (or any other generic label) without a follow-up via `surface-decision-debt` — F-8 / F-19 pattern.
- Forgetting `--body` and letting the CLI hang — defensive fix at the call site.
- Recording dependencies only as prose in the body and skipping the native links (step 4) — the board ordering procedure reads the native graph, so prose-only dependencies leave the operational surface blind. This is the gap #93 closes.
- Opening only handler Issues for a `surface: user-facing` spec and skipping step 3a — the user-facing slices (forms, wiring, browser E2E) stay unowned and the "five green features over a non-functional product" failure recurs. This is the F-22 gap (#132); precedent #131 had to be created retroactively for 003.
- **Creating ordering-only blockers** — a prior EARS or release gate is a blocker only when a real technical prerequisite prevents delivery. Record that reason; priority and wave ordering are not dependency edges.
- **Ticketing unconfirmed / invented scope** — turning an agent-inflated brainstorm into an Issue set before the owner approved each element (the «Школы» child #796). The Precondition gate exists to stop this at open time.

## Related skills

- [../surface-decision-debt/SKILL.md](../surface-decision-debt/SKILL.md)
