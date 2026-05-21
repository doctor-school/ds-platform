---
title: "DSP-198 — GitHub Projects v2 board setup (Design)"
description: "Org-level Projects v2 board 'DS Platform' as the operational + roadmap surface for ds-platform: single board with Status / Area fields plus native Type (Issues) / Labels (PRs) for classification, optional long-lived Milestones, 6 built-in workflows, 3 views, backfill of all closed items, Issue body convention, agent ordering procedure with In Progress resume, and a direct rewrite of the relevant AGENTS.md §2 line."
slug: dsp-198-github-projects-v2-board
status: Implemented (pending UI follow-up)
tracker: Plane DSP-198 (workspace `doctor-school`, project DSP)
board_url: https://github.com/orgs/doctor-school/projects/1
parent_issue: null
lang: en
---

# DSP-198 — GitHub Projects v2 board setup (Design)

## 1. Context

DSP-198 was carved out of DSP-193 item 4 because the `gh` CLI session running under the AI agent lacked the OAuth scopes (`read:project` + `project`) required to create or modify org-level Projects v2 boards. The owner has since refreshed those scopes against the `sidorovanthon` account, unblocking agent-driven setup.

The board is not merely a kanban. It is the **operational + roadmap surface** that two different audiences read:

- **The coding agent** — at session start, needs to know what is actively in flight, what is unblocked, and where to resume interrupted work.
- **The Tech Lead acting as PM** — needs to see the development plan, the current state, and progress against long-lived product themes, in order to give realistic estimates and communicate status.

A single board with the right fields serves both. The design therefore goes beyond "create a board and link items" to include the **Issue body convention** and **agent ordering procedure** that make the board actionable as a context surface, not just a visual artifact.

Product trajectory for context only (not encoded as a board axis):

| Era            | Scope                                                                                                                                                                                                        | Window               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **Phase 0**    | Engineering readiness: ADR scaffolding, dev-loop (AI + CI + changesets + bootstrap), local-dev (DSP-150), engineering-readiness in `bbm`. Directual hard-cutover discovery (2–3 weeks). IdP spike (~3 days). | **now** (mid-flight) |
| **v1 (Pilot)** | Email / SMS-OTP / magic-link auth, 5 of 9 product roles, no social OAuth, MFA TOTP for admin/expert, portal + admin + CMS minimal viable, Directual migration with 90-day window.                            | Q3 2026 target       |
| **v2**         | + VK ID, Yandex ID, Telegram OAuth. + `expert / moderator / support / investor` roles. WebAuthn / Passkeys. MFA TOTP upgrade for `moderator / support`. HIBP. Full CMS-Payload content pipeline.             | after v1             |
| **v3**         | + Apple Sign-In, mobile App Store distribution, `clinic_admin` role, anomaly detection / impossible travel, scale-out to 1M MAU.                                                                             | after v2             |

Releases as artifacts are produced **continuously** via changesets — every merged PR carrying a changeset emits a semver-tagged GitHub Release. They are not planning containers and do not appear on the board.

## 2. Goals + non-goals

### Goals

1. A single org-level Projects v2 board ships items from `doctor-school/ds-platform` and is the only place the agent reads to answer "what next".
2. The board exposes the axes that genuinely slice work today: **Status** (daily kanban) and **Area** (which module). Work flavour is read off native fields — **Type** (built-in Issue Type on Issues) and **Labels** (the `feature` / `bug` / `chore` / `refactor` / `docs` / `tooling` labels already mandated by AGENTS.md §2 for PRs). Milestones are present built-in but are populated only when a long-lived product theme actually exists.
3. The agent can pick the next item deterministically — including resuming In Progress work, not only starting fresh Backlog items.
4. New Issues carry a structured body sufficient for a cold-start agent to act without trawling history.
5. The setup is **reproducible**: a script in `tools/` rebuilds the board from scratch.

### Non-goals

- Iterations / sprint cycles. Explicitly out of scope per Plane DSP-198 description (team = 1+AI, no sprint cadence).
- A `Release` field on the board. Releases happen continuously via changesets — there is no planning value in pre-allocating items to release buckets.
- A `Phase` field on the board. Phase 0 / v1 / v2 / v3 are product-trajectory landmarks, not active filtering axes for the working set; if a future need emerges, it is added as an amendment to this spec.
- Pre-creating Milestones at setup. Milestones are created by the PM when an actual long-lived product theme emerges (e.g. "Auth foundations v1", "Directual cutover", "Doctor portal MVP"). Empty Milestone is the legitimate default.
- Cross-linking GitHub items with Plane DSP-XXX as a default pattern. Trackers stay strictly separated. DSP-198 itself is a rare exception (a Plane work-item about GitHub infrastructure).
- Per-app / per-module separate boards. Single board with views serves the current scale; split triggers documented in §13.
- Date fields on items for Roadmap-view timelines. Added later only if PM demands a visual timeline.
- Custom dependency-graph visualisation. Native GitHub Issues "blocked by / blocking" is sufficient.
- Bootstrap-script (`tools/agent-bootstrap.ts`) integration with the board — separate follow-up Issue after merge.

## 3. Target state

### 3.1 Board identity

- **Owner type:** ORGANIZATION (`doctor-school`).
- **Title:** `DS Platform`.
- **Visibility:** private (org-internal).
- **Number:** `1`.
- **Project ID:** `PVT_kwDOEQZdbM4BYYrZ`.
- **URL:** https://github.com/orgs/doctor-school/projects/1.

### 3.2 Fields

| Field         | Type                     | Values                                                                                                                                                                                                                                     | Filled                                                                |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Status**    | single-select (built-in) | `Backlog` / `In Progress` / `Review` / `Done`                                                                                                                                                                                              | automatic via workflows (§3.3)                                        |
| **Type**      | built-in (Issue Type)    | Org-level Issue Types. Default set `Task / Bug / Feature` is sufficient; the org admin can extend with `chore / docs / tooling / refactor` if richer typing is wanted. **PRs do not have an Issue Type** — they are classified via Labels. | manual on Issue create                                                |
| **Milestone** | built-in                 | Empty at setup. PM creates a Milestone when a long-lived product theme appears (spans multiple specs, lives weeks–months). Examples: `Auth foundations v1`, `Doctor portal MVP`, `Directual cutover`. **Milestones are NOT per-spec.**     | manual on Issue create, only when a relevant Milestone already exists |
| **Labels**    | built-in                 | Surfaced on the board as a column. For PRs, the AGENTS.md §2 mandatory label (`feature` / `bug` / `chore` / `refactor` / `docs` / `tooling`) is the PR-side analogue of Issue Type.                                                        | set on the PR per AGENTS.md §2; agent / author responsibility         |
| **Area**      | single-select (custom)   | `api` / `promo` / `portal` / `admin` / `cms` / `cms-payload` / `mobile` / `docs` / `docs-cms` / `packages` / `infra` / `tooling` / `cross-cutting`                                                                                         | manual on Issue create                                                |

**Explicitly excluded fields:** Release, Phase, Priority, Estimate, Iteration, Start date, Target date, Plane ref, Spec slug, Kind. Rationales:

- **Release** — releases happen continuously via changesets, not as planning buckets. See §2 non-goals.
- **Phase** — coarse temporal landmark, not an active filter for the working set. See §2 non-goals.
- **Priority** — drag-reorder inside the Backlog column is the single source of order. A separate priority field would create a second source and the two can diverge.
- **Estimate** — no sprint velocity tracking; 1+AI team.
- **Iteration** — explicitly out of scope.
- **Start / Target date** — no Roadmap-timeline view yet.
- **Plane ref** — strict tracker separation (memory `feedback_plane_github_strict_separation`).
- **Spec slug** — when a spec-bound Issue exists, the spec link is in the body under "Spec reference" (§7); duplicating it as a field has no slicing payoff because per-spec grouping is not a board view (specs are short-lived; their work-streams roll up through Milestone when one applies).
- **Kind** — initial design had a custom `Kind` field, but it duplicates two existing mechanisms: native Issue **Type** (for Issues) and the mandatory PR **Label** (for PRs). One source of truth per object class is cleaner than a third field that has to be kept in sync with both. Removed at clean-up after first real run.

### 3.3 Workflows (built-in presets)

All six are enabled at setup time. Activation goes through the Projects v2 GraphQL `updateProjectV2Workflow` mutation, packaged inside the setup script.

| #   | Trigger                                                                  | Action                                      |
| --- | ------------------------------------------------------------------------ | ------------------------------------------- |
| 1   | Item matches filter `repo:doctor-school/ds-platform is:open is:issue,pr` | **Auto-add** to project, `Status = Backlog` |
| 2   | Item closed                                                              | `Status → Done`                             |
| 3   | PR opened (ready-for-review, not draft)                                  | `Status → Review`                           |
| 4   | PR converted to draft                                                    | `Status → In Progress`                      |
| 5   | Item reopened                                                            | `Status → Backlog`                          |
| 6   | Item `Status = Done` for >14 days                                        | **Auto-archive**                            |

The auto-add filter is single-repo at setup. Extending to additional org repos in the future requires only adding `repo:doctor-school/<X>` to the filter — no schema change.

### 3.4 Views

Three views configured at setup. All read from the single board.

| View             | Audience | Layout         | Filter / Group                                                                                                          |
| ---------------- | -------- | -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Now**          | both     | Board (kanban) | Group by Status. No release/phase filter. Default landing view. Shows everything not archived.                          |
| **By milestone** | PM       | Table          | Filter `status != Done`. Group by Milestone. Empty-Milestone bucket holds work that does not belong to a tracked theme. |
| **By area**      | agent    | Table          | Filter `status != Done`. Group by Area. For "what is left to do in `api`" style queries.                                |

The "By milestone" view is the PM roadmap surrogate: each Milestone tile shows native percent-complete (closed / total). For ad-hoc release-readiness questions, the PM filters this view by an in-flight Milestone (e.g. `milestone = Auth foundations v1`).

ADR amendments are not promoted to a dedicated view — they are infrequent enough that an ad-hoc title search (`Amendment` or `ADR-`) or filtering by the `docs` label is sufficient. If the amendment cadence becomes load-bearing, a new view is added as an amendment to this spec.

## 4. Backfill plan

### 4.1 Scope

All 17 closed items as of 2026-05-21:

- **Closed Issues (3):** #7, #8, #10.
- **Closed PRs (14):** #1, #2, #3, #4, #5, #6, #9, #11, #12, #13, #14, #15, #16, #17 (PRs #4 and #6 closed without merge; the rest merged).
- **Open items (0):** no backlog seed; the first new Issue auto-adds via workflow #1.

### 4.2 Per-item field assignment

The setup script reads each item via `gh issue list --state all` / `gh pr list --state all` and assigns:

- **Status** — `Done` for all backfilled items (every closed item maps to `Done` regardless of merge state, since `Status` represents board-level lifecycle, not merge outcome).
- **Area** — derived from the scope segment of the conventional-commit title:
  - `feat(api)` / `fix(api)` → `api`
  - `docs(agents)` → `docs`
  - `docs(adr)` → `docs`
  - `chore(deps)` / `chore(release)` / `chore(deps-dev)` → `tooling`
  - `feat(meta)` → `cross-cutting`
  - Unknown / unparseable → left empty for manual review.
- **Milestone** — left empty for all backfill items. The closed work to date was Phase 0 scaffolding without long-lived product themes; back-assigning Milestones retroactively has no analytic payoff.
- **Type / Labels** — not touched by backfill. PR labels already exist on every PR (mandated by AGENTS.md §2). Issue Types on the three closed Issues can be set manually if useful, but Done items rarely need their typing changed.

The script logs every field decision in human-readable form before applying so a dry-run mode can preview the assignment.

### 4.3 What backfill does not restore

- **Dependencies between closed items** — irrelevant once everything is Done.
- **PR review timing nuance** — PRs that were once in `Review` and then merged are placed straight in `Done`; the intermediate Review history is not reconstructed.
- **Bot-vs-content distinction beyond labels** — dependabot / changeset-release PRs land in `Done` like everything else, are not auto-archived faster (they reach 14-day archive on the same schedule).

## 5. Agent ordering procedure

This is the deterministic decision tree the agent runs at session start when asked "what should I work on?":

```
PRIORITY 1 — Resume In Progress
  Read items with Status = In Progress.
  WIP limit = 1 by convention; if multiple, pick newest updated_at.
  Read the stop-state comment (§6) on the chosen item. Resume from the
  documented entry point.
  STOP — this is the work item.

PRIORITY 2 — Rework Review-stage items
  Read items with Status = Review where the linked PR is in any of:
    - closed without merge
    - failing CI
    - has unresolved reviewer comments
  Pick the topmost by position. Owner moves it back to In Progress
  manually before agent picks it up — Projects v2 has no native trigger
  for "review requested changes".
  STOP if any match.

PRIORITY 3 — Pick fresh from Backlog
  Filter Backlog items by: all native "blocked by" dependencies are Done.
  Pick the topmost unblocked item by position.
  STOP.

PRIORITY 4 — All Backlog blocked
  Surface the topmost blocker as the actionable item — the work now is
  unblocking, not implementing.
```

`WIP limit = 1` is a documented convention, not enforced by Projects v2 column limits (which the platform does not support natively). A WIP > 1 is a soft signal that a previous session was interrupted without proper stop-state hygiene.

## 6. Stop-state convention

When an agent stops work on an In Progress item — end of session, encountered a blocker, switched priorities — the agent **must** post a comment on the Issue with the following structure:

```markdown
**Where I stopped:** <last commit / last successful command / last file read>
**What remains:** <concrete steps until Done>
**Blockers (if any):** <what is in the way; link to blocking Issue if known>
**Next session entry point:** <command, file, or link to resume>
```

This is symmetric with the Plane lifecycle hard rule in `AGENTS.md §6` — the same shape, extended to GitHub Issues. The next session's agent reads this comment before any code work on the item.

## 7. Issue body convention

A new template at `.github/ISSUE_TEMPLATE/default.md` enforces a minimum body shape on new Issues. Markdown form (not YAML form) to preserve drafting flexibility while still surfacing a default skeleton in the "New issue" UI:

```markdown
## Context

<Why now. What problem this solves. Links: parent spec
`apps/docs/content/specs/features/NNN-<slug>/` or ADR-NNNN or, only as a
rare exception, Plane DSP-XXX.>

## Scope

**In scope:**

- <concrete deliverable>

**Out of scope:**

- <what this Issue does not cover>

## Spec reference

<For a single EARS-handler: link to `requirements.md#EARS-N`.
For an ADR-amendment: link to the ADR plus the Amendment letter.
For scaffolding / tooling without a spec: write "no spec".>

## Acceptance criteria

- [ ] <observable, checkable>
- [ ] <…>

## Dependencies

**Blocked by:** <native GH "blocked by" relationships plus a one-line note
where context is non-obvious>
**Blocks:** <outbound obligations>

## Notes

<Free text. Agents post stop-state comments (§6) here.>
```

The template is English-only (consistent with `AGENTS.md`, ADRs, and existing specs).

**Applicability:**

- Applies to **new** Issues from the moment the template ships.
- Does **not** retroactively rewrite existing Issue bodies.
- Does **not** apply to PR descriptions — PRs use the separate template documented in `AGENTS.md §2`.

## 8. AGENTS.md edits

Two direct edits — no amendment/append semantics. `AGENTS.md` is a living convention doc; outdated text is replaced in place.

### 8.1 Invert Milestone semantics in §2

`AGENTS.md §2 Repository conventions` currently says, regarding feature specs:

> One spec → one GitHub Milestone → multiple Issues (one per EARS-handler).

This is replaced by:

> One spec → multiple Issues (one per EARS-handler). Milestones are used independently of specs: a Milestone tracks a long-lived product theme (`Auth foundations v1`, `Directual cutover`, `Doctor portal MVP`) that typically spans multiple specs and lives weeks–months. Specs themselves do not become Milestones.

The reasoning trail (why the inversion happened) lives in this spec §2 + §3.2 + §3.4, not in `AGENTS.md`.

### 8.2 Insert §2.1 Issue conventions

Between `§2 Repository conventions` and `§3 Work protocol`, add:

> **§2.1 Issue conventions.** New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton (Context / Scope / Spec reference / Acceptance criteria / Dependencies / Notes). Agents resuming In Progress items read the latest stop-state comment first. Stop-state comments follow a fixed four-field shape — see `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md` §6 for the canonical form. The board ordering procedure (resume → rework → fresh → unblock) is documented in §5 of the same spec.

Both edits ship in the same PR as the rest of DSP-198, because the conventions are useless without the board and the board is far less useful without the conventions.

## 9. Setup script

Lives at `tools/setup-project-board.ts`. Run-once at bootstrap; kept in-repo afterwards as the disaster-recovery source of truth for board configuration.

### 9.1 Sequence

1. **Project creation.** `gh project create --owner doctor-school --title "DS Platform" --format json` → capture `PROJECT_NUMBER` and `PROJECT_ID`.
2. **Field creation.** The only custom field is `Area`; create via `gh project field-create` (single-select). Built-in `Status` field has its option set adjusted to the four target values (script warns + defers to UI if defaults differ to avoid item data loss on re-create). Built-in `Type`, `Milestone`, `Labels` require no field creation.
3. **Workflow activation.** For each of the six workflows in §3.3, call the GraphQL `updateProjectV2Workflow` mutation with the appropriate trigger / action payload.
4. **View creation.** For each of the three views in §3.4, configure via UI (the GraphQL view-mutation surface is preview-only).
5. **Backfill.**
   - Fetch closed Issues and PRs via `gh issue list --state all --json …` / `gh pr list --state all --json …`.
   - For each item: `gh project item-add --owner doctor-school --url <html_url>`.
   - For each added item: set Status + Area per §4.2. Milestone, Type, Labels untouched.
6. **Audit log.** Write a final summary to stdout: items processed, fields assigned, ambiguous title parses listed for manual review.

The script does **not** create any Milestone objects — Milestones are created by the PM through the GitHub UI when a long-lived theme emerges.

### 9.2 Idempotency

Every step checks for prior state before mutating:

- Project creation: list projects under the org first; if a project named `DS Platform` already exists, reuse its number / id and skip creation.
- Field creation: read the project's current fields; skip creation of any field already present with matching name.
- Workflow activation: read current workflow state; only set the parts that differ.
- View creation: list current views; skip creation of any view with a matching name.
- Backfill: `gh project item-list` to enumerate existing items; skip items already linked.

A second run of the script after a successful first run is a no-op apart from the audit summary.

### 9.3 Dry-run

Flag `--dry-run` prints every intended mutation to stdout without executing. Used for review before the first irreversible run.

## 10. Acceptance criteria

1. Org-level Projects v2 board `DS Platform` exists in org `doctor-school`, visibility = private. URL recorded as an amendment to this spec.
2. Fields configured: `Status` (4 options), `Area` (13 options). Built-in `Type`, `Milestone`, `Labels` fields are enabled (no objects created at setup).
3. All six workflows (§3.3) are enabled and active.
4. All three views (§3.4) are configured with the correct filter / group / layout.
5. All 17 closed items are linked, `Status = Done`. Area assigned per §4.2 (with unambiguous-parse failures logged for manual review). Milestone / Type / Labels untouched by backfill.
6. `tools/setup-project-board.ts` is committed, idempotent, and supports `--dry-run`.
7. `.github/ISSUE_TEMPLATE/default.md` is committed and surfaces in the "New issue" UI (verified manually).
8. `AGENTS.md §2` is rewritten per §8.1 and `§2.1 Issue conventions` is inserted per §8.2 — both in the same PR.
9. Plane DSP-198 is moved to `Done` with a result comment containing: board URL, links to the script + template + AGENTS.md changes, and a note of any backfill items whose Kind / Area were left empty for manual review.

## 11. Verification

Manual checks after the script's first successful run:

- `gh project view <PROJECT_NUMBER> --owner doctor-school --format json` — fields and workflows enumerated.
- Open the board in a browser and confirm: three views render, Backlog column is empty, Done column shows the 17 backfilled items, Milestone column is empty (no Milestone objects exist yet).
- Create a throwaway Issue in `doctor-school/ds-platform` — confirm auto-add fires (workflow #1) and the Issue appears in Backlog. Close it; confirm workflow #2 moves it to Done. Delete it.

No automated test harness — this is a one-off setup script, not a recurring pipeline.

## 12. Risks + mitigations

| Risk                                                                                                             | Mitigation                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub renames or deprecates a workflow trigger before the script runs.                                          | The script reads each workflow's available triggers from the API before activating; on mismatch it logs and skips, leaving the workflow inactive rather than crashing.                 |
| Auto-add filter unexpectedly pulls in items from forks or transferred repos.                                     | Filter is anchored to `repo:doctor-school/ds-platform`. Forks live outside the org and do not match. Transferred repos away from the org also stop matching.                           |
| `Status` built-in field cannot have its option set fully replaced; some platforms require additive-only changes. | The script first attempts in-place update; on failure, creates a new single-select field `Status (custom)` with the four target options and migrates items. Logged as a fallback path. |
| Backfill heuristics misclassify Area on items with non-conventional titles.                                      | Script logs every ambiguous parse; AC #5 requires manual review of these. The misclassification is recoverable via UI.                                                                 |
| WIP > 1 in `In Progress` due to forgotten stop-state hygiene.                                                    | Documented convention only; not enforced. The ordering procedure §5 handles WIP > 1 by picking newest updated_at. A future tightening (e.g., a CI lint) is out of scope here.          |
| PM does not create Milestones, so the "By milestone" view is permanently empty.                                  | Acceptable. Until a long-lived theme exists, "By milestone" simply renders one bucket "No milestone" — the cost is one ignored view, not broken automation.                            |

## 13. When to revisit / split

The single-board design holds until any of the following triggers fire:

- A second human owner with a bounded scope appears (e.g., Product Lead taking sole ownership of `cms-payload` content).
- v1 implementation crosses ~50 concurrently open items — at that point a separate `v1 — pilot` board might reduce noise on the operational view.
- More than 100 open items concurrently — the single Backlog column drag-reorder UX breaks down.
- A second org-repo with an independent lifecycle joins the board (Plane-tracked `bbm` does not count — it uses Plane, not Projects v2).
- A real demand for a Roadmap-timeline view emerges (then date fields per Milestone, and a Roadmap view added — amendment, not redesign).

Each trigger reopens this spec as an amendment, not as a fresh design.

## 14. Out of scope

- Bootstrap-script (`tools/agent-bootstrap.ts`) integration with the board — separate follow-up Issue.
- Per-app split boards — see §13 triggers.
- Date fields on items for Roadmap-view timelines — see §13.
- Sprint cycles / iterations — explicit non-goal per DSP-198 description.
- Cross-tracker Plane DSP-XXX field — strict separation rule (`feedback_plane_github_strict_separation`).
- Custom dependency-graph visualisation — native GH "blocked by / blocking" suffices.
- Pre-creating Milestone objects at setup — see §3.2 and §9.1.
