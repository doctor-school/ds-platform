---
title: "DSP-198 — GitHub Projects v2 board setup (Design)"
description: "Org-level Projects v2 board 'DS Platform' as the operational + roadmap surface for ds-platform: single board with Status / Area / Priority fields plus native Type (Issues) / Labels (PRs) for classification, Milestone = one shippable release of one track, feature-level Start / Target dates, a Roadmap view, the roadmap level taxonomy (epic / feature / EARS task / release gate / platform task), 6 built-in workflows, backfill of all closed items, Issue body convention, agent ordering procedure with In Progress resume, and a direct rewrite of the relevant AGENTS.md §2 line."
slug: dsp-198-github-projects-v2-board
status: Implemented — revised 2026-09-02 (roadmap taxonomy, #1726)
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
- **The Tech Lead acting as PM** — needs to see the development plan, the current state, and progress towards the next shippable release of each track, in order to give realistic estimates and communicate status.

A single board with the right fields serves both. The design therefore goes beyond "create a board and link items" to include the **Issue body convention** and **agent ordering procedure** that make the board actionable as a context surface, not just a visual artifact.

Product trajectory for context only (not encoded as a board axis):

| Era            | Scope                                                                                                                                                                                                    | Window               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **Phase 0**    | Engineering readiness: ADR scaffolding, dev-loop (AI + CI + changesets + bootstrap), local-dev (DSP-150), engineering-readiness spec. Directual hard-cutover discovery (2–3 weeks). IdP spike (~3 days). | **now** (mid-flight) |
| **v1 (Pilot)** | Email / SMS-OTP / magic-link auth, 5 of 9 product roles, no social OAuth, MFA TOTP for admin/expert, portal + admin + CMS minimal viable, Directual migration with 90-day window.                        | Q3 2026 target       |
| **v2**         | + VK ID, Yandex ID, Telegram OAuth. + `expert / moderator / support / investor` roles. WebAuthn / Passkeys. MFA TOTP upgrade for `moderator / support`. HIBP. Full CMS-Payload content pipeline.         | after v1             |
| **v3**         | + Apple Sign-In, mobile App Store distribution, `clinic_admin` role, anomaly detection / impossible travel, scale-out to 1M MAU.                                                                         | after v2             |

**Release artifact ≠ release plan.** The deployed artifact is produced continuously: `pnpm deploy:prod` cuts a `release-YYYY.MM.DD-n` tag + GitHub Release at the deployed SHA, and per-package versions come from changesets. Those artifacts are records of what shipped; they are not planning containers and do not appear on the board.

The _plan_ is carried by **Milestones**: one milestone = one shippable increment of ONE track (see §3.2). This is the axis the Roadmap view (§3.4) renders and the level taxonomy (§7.1) hangs off. The two axes never merge — a `release-*` tag says what is live, a milestone says what is next.

Two product tracks exist, and they never share a milestone:

| Track           | Label            | Surface                                  | Specs   |
| --------------- | ---------------- | ---------------------------------------- | ------- |
| **Академия**    | `track:academy`  | `academy.doctor.school`                  | 012–016 |
| **Витрина**     | `track:doctor`   | doctor.school storefront (`apps/doctor`) | 017–021 |
| _(non-roadmap)_ | `track:platform` | shared backend / infra / process         | —       |

## 2. Goals + non-goals

### Goals

1. A single org-level Projects v2 board ships items from `doctor-school/ds-platform` and is the only place the agent reads to answer "what next".
2. The board exposes the axes that genuinely slice work today: **Status** (daily kanban), **Area** (which module) and **Priority** (ordering hint inside a column). Work flavour is read off native fields — **Type** (built-in Issue Type on Issues) and **Labels** (the `feature` / `bug` / `chore` / `refactor` / `docs` / `tooling` labels already mandated by AGENTS.md §2 for PRs).
3. **Milestone carries the release plan.** Every Issue that is part of a product track sits in the milestone of the release it ships in; the milestone is the planning container, not a filing theme.
4. **The Roadmap view is readable by a human PM** — it shows feature-level Issues only, grouped by milestone, with Start / Target dates. EARS tasks never appear on it; they show as sub-issue progress on their parent.
5. The agent can pick the next item deterministically — including resuming In Progress work, not only starting fresh Todo items.
6. New Issues carry a structured body sufficient for a cold-start agent to act without trawling history.
7. The setup is **reproducible**: a script in `tools/` rebuilds the board from scratch.

### Non-goals

- Iterations / sprint cycles. Explicitly out of scope per Plane DSP-198 description (team = 1+AI, no sprint cadence). The release milestone is the only time container.
- A custom `Release` single-select field on the board. Release membership is the **Milestone**, and one axis is enough — a parallel field guarantees drift. (A `Release` field existed on the board before this revision; §3.2 records its retirement.)
- A `Phase` field on the board. Phase 0 / v1 / v2 / v3 are product-trajectory landmarks, not active filtering axes for the working set; if a future need emerges, it is added as a revision of this spec.
- Start / Target dates on EARS-handler Issues. Dates live only on feature-level and release-gate Issues (§3.2) — dating every handler is bookkeeping no one reads.
- Cross-linking GitHub items with Plane DSP-XXX as a default pattern. Trackers stay strictly separated. DSP-198 itself is a rare exception (a Plane work-item about GitHub infrastructure).
- Per-app / per-module separate boards. Single board with views serves the current scale; split triggers documented in §13.
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

| Field           | Type                     | Values                                                                                                                                                                                                                                                            | Filled                                                                                                                         |
| --------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Status**      | single-select (built-in) | `Todo` / `In Progress` / `Review` / `Done`                                                                                                                                                                                                                        | automatic via workflows (§3.3)                                                                                                 |
| **Type**        | built-in (Issue Type)    | Org-level Issue Types. Default set `Task / Bug / Feature` is sufficient; the org admin can extend with `chore / docs / tooling / refactor` if richer typing is wanted. **PRs do not have an Issue Type** — they are classified via Labels.                        | manual on Issue create                                                                                                         |
| **Milestone**   | built-in                 | **One shippable increment of ONE track** — the release plan (see below). Named `«<Трек> R<n> — <результат>»`, e.g. «Академия R1 — Архив записей». Backlog bucket per track: «Академия · Позже» / «Витрина · Позже». Non-roadmap work: «Platform ops & hardening». | mandatory on Issue create for every level except an epic (`pnpm issue:create` fails closed; the epic exemption ships in #1729) |
| **Start date**  | date (custom)            | Roadmap bar start. Set **only** on feature-level and release-gate Issues; filled when the first child EARS Issue moves to In Progress.                                                                                                                            | manual, on the first child entering In Progress                                                                                |
| **Target date** | date (custom)            | Roadmap bar end. Set **only** on feature-level and release-gate Issues; a **forecast**, not a commitment (see below).                                                                                                                                             | semi-automatic (`pnpm roadmap:forecast`), owner override                                                                       |
| **Priority**    | single-select (custom)   | Ordering hint used when the Todo column grows past a screen. Accepted as an addition to the original design.                                                                                                                                                      | manual, optional                                                                                                               |
| **Labels**      | built-in                 | Surfaced on the board as a column. Carries the `track:*` axis, the kind label, `source:*` and `feature:NNN-*`. For PRs, the AGENTS.md §2 mandatory label (`feature` / `bug` / `chore` / `refactor` / `docs` / `tooling`) is the PR-side analogue of Issue Type.   | set per `.claude/rules/repo-conventions.md` → Issue conventions                                                                |
| **Area**        | single-select (custom)   | `api` / `promo` / `portal` / `admin` / `cms` / `cms-payload` / `mobile` / `docs` / `packages` / `infra` / `tooling` / `cross-cutting`                                                                                                                             | manual on Issue create                                                                                                         |

#### Milestone semantics (the release plan)

- A milestone is **one shippable increment of one track**. It holds **1–4 feature-level Issues**; 5 or more means the release is too big and must be split.
- The two product tracks **never share a milestone** — «Академия» and «Витрина» ship independently.
- Name: `«<Трек> R<n> — <результат>»`. `R<n>` numbers **within a track**, so «Академия R1» and «Витрина R1» coexist. Examples: «Академия R1 — Архив записей», «Академия R2 — Новая главная», «Витрина R1 — MVP витрины».
- Each track has one dateless backlog milestone — «Академия · Позже», «Витрина · Позже» — holding everything beyond the two nearest releases.
- **Platform work takes the milestone of the release it blocks**, wired by a native `blocked_by` edge. Platform work that blocks nothing scheduled stays in «Platform ops & hardening», the non-roadmap bucket that never appears on the Roadmap view.
- **An epic has no milestone.** An epic spans releases by nature, so pinning it to one would misreport the release it is filed under; its progress is the native sub-issue bar and its axis is its `track:*` label. `pnpm issue:create` exempts an epic (`epic:` title prefix + `feature` kind) from the milestone requirement — implemented in #1729.
- Every milestone owns a **release gate Issue** (`gate: <milestone name>`, §7.1) that carries the milestone's dates and the weekly forecast comment.

Owner decision (2026-09-02) on naming: «Milestones и префикс трека по-русски, остальной заголовок как есть, английский — подтверждаю» — milestone names and the track prefix are Russian; the rest of an Issue title stays English.

#### Date semantics (forecast, not commitment)

Owner decision (2026-09-02) on where dates live: «Предпочитаю первый вариант» — Start / Target date fields exist **only** on feature-level Issues and release gate Issues (≈15 dated items at any time), never on EARS-handler Issues.

- **Target date** is a _forecast_, derived from the trailing 4-week EARS-throughput of that track over the remaining open EARS children. It is recomputed by `pnpm roadmap:forecast` and re-posted **weekly as a comment on the release gate Issue**, so the forecast history is auditable.
- **Manual override is owner-only** and is marked by an explicit body line on the Issue; the forecast script must not overwrite an overridden date.
- **Start date** is set **manually**, once the first child Issue moves to In Progress — never guessed ahead of real work. `pnpm roadmap:forecast` writes Target only and never touches Start.

**Explicitly excluded fields:** Release, Phase, Estimate, Iteration, Plane ref, Spec slug, Kind. Rationales:

- **Release** — a custom single-select `Release` field was added to the board after the original setup and is **retired by this revision**: release membership is the Milestone. Its three values migrate to milestones («Релиз 1 — архив» → «Академия R1 — Архив записей», «Релиз 2 — главная» → «Академия R2 — Новая главная», «Релиз 3 — витрина MVP» → «Витрина R1 — MVP витрины»); the migration itself is board work, not spec work.
- **Phase** — coarse temporal landmark, not an active filter for the working set. See §2 non-goals.
- **Estimate** — no sprint velocity tracking; 1+AI team. Throughput is measured from closed EARS Issues instead (see date semantics above).
- **Iteration** — explicitly out of scope; the release milestone is the time container.
- **Plane ref** — strict tracker separation (memory `feedback_plane_github_strict_separation`).
- **Spec slug** — when a spec-bound Issue exists, the spec link is in the body under "Spec reference" (§7); duplicating it as a field has no slicing payoff because per-spec grouping is not a board view (specs are short-lived; their work-streams roll up through Milestone when one applies).
- **Kind** — initial design had a custom `Kind` field, but it duplicates two existing mechanisms: native Issue **Type** (for Issues) and the mandatory PR **Label** (for PRs). One source of truth per object class is cleaner than a third field that has to be kept in sync with both. Removed at clean-up after first real run.

### 3.3 Workflows (built-in presets)

All six are enabled at setup time. Activation goes through the Projects v2 GraphQL `updateProjectV2Workflow` mutation, packaged inside the setup script.

| #   | Trigger                                                                  | Action                                   |
| --- | ------------------------------------------------------------------------ | ---------------------------------------- |
| 1   | Item matches filter `repo:doctor-school/ds-platform is:open is:issue,pr` | **Auto-add** to project, `Status = Todo` |
| 2   | Item closed                                                              | `Status → Done`                          |
| 3   | PR opened (ready-for-review, not draft)                                  | `Status → Review`                        |
| 4   | PR converted to draft                                                    | `Status → In Progress`                   |
| 5   | Item reopened                                                            | `Status → Todo`                          |
| 6   | Item `Status = Done` for >14 days                                        | **Auto-archive**                         |

The auto-add filter is single-repo at setup. Extending to additional org repos in the future requires only adding `repo:doctor-school/<X>` to the filter — no schema change.

### 3.4 Views

All views read from the single board.

| View             | Audience | Layout         | Filter / Group                                                                                                                                                                                                              |
| ---------------- | -------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Roadmap**      | PM/owner | **Roadmap**    | Filter `-label:kind:ears-handler` only — Done stays visible so a shipped release still renders its bar. Group by **Milestone**. Date fields **Start date → Target date**; milestone markers on. The PM-facing plan surface. |
| **Now**          | both     | Board (kanban) | Group by Status. No release/phase filter. Default landing view. Shows everything not archived.                                                                                                                              |
| **By milestone** | PM       | Table          | Filter `status != Done`. Group by Milestone. Native percent-complete per milestone for release-readiness questions.                                                                                                         |
| **By area**      | agent    | Table          | Filter `status != Done`. Group by Area. For "what is left to do in `api`" style queries.                                                                                                                                    |
| **Closed**       | both     | Table          | Filter `status = Done`. Archive lookup.                                                                                                                                                                                     |

**Roadmap readability is the design constraint.** Only feature-level Issues appear on the Roadmap view — the `-label:kind:ears-handler` filter is what makes it legible, and EARS work is visible instead as the parent feature's native sub-issue progress bar. Beyond the two nearest releases of a track, features sit in the track's «· Позже» milestone with no dates, so the timeline never renders speculative bars.

ADR revisions are not promoted to a dedicated view — they are infrequent enough that an ad-hoc title search (`ADR-`) or filtering by the `docs` label is sufficient. If the ADR-revision cadence becomes load-bearing, a new view is added when this spec is next revised.

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
- **Milestone** — left empty for all backfill items. The closed work to date was Phase 0 scaffolding, predating the release milestones; back-assigning Milestones retroactively has no analytic payoff.
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

PRIORITY 3 — Pick fresh from Todo
  Filter Todo items by: all native "blocked by" dependencies are Done.
  Pick the topmost unblocked item by position.
  STOP.

PRIORITY 4 — All Todo blocked
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

<For a single EARS-handler: link to `NNN-requirements.md#EARS-N`.
For an ADR revision: link to the ADR (and the specific § being changed).
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

### 7.1 Roadmap taxonomy

Five Issue levels exist. Each has exactly one place in the hierarchy, one title pattern and one dates rule — this table is the contract the board, the views and `pnpm issue:create` all read.

| Level             | Org Type | Title pattern                                          | Parent                       | Milestone                                                                 | Start / Target dates | On Roadmap view              |
| ----------------- | -------- | ------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------- | -------------------- | ---------------------------- |
| **Epic**          | Feature  | `epic: <English title>`                                | none                         | **none** — an epic spans releases (§3.2)                                  | no                   | no                           |
| **Feature**       | Feature  | `[Академия][NNN] <English title>` / `[Витрина][NNN] …` | the epic, when one exists    | the release it ships in                                                   | **yes**              | **yes**                      |
| **EARS task**     | Task     | `[NNN] EARS-k: <English clause>`                       | its feature                  | inherits the parent feature's                                             | no                   | no (sub-issue progress only) |
| **Release gate**  | Task     | `gate: <milestone name>`                               | none                         | the milestone it gates                                                    | **yes**              | **yes**                      |
| **Platform task** | Task     | `<English title>` (no track prefix)                    | none, or the blocked feature | the release it blocks (via `blocked_by`), else «Platform ops & hardening» | no                   | no                           |

**Naming rule.** Russian appears in milestone names (the two «· Позже» backlogs included, and the release-gate title that quotes one) and in the track prefix of a feature title. Everything else — the rest of the title, the body, labels, spec prose — stays English. Owner decision (2026-09-02): «Milestones и префикс трека по-русски, остальной заголовок как есть, английский — подтверждаю».

**Epic rule.** An epic is a **closable initiative** — a set of Issues that ends when they drain. Owner decision (2026-09-02): «Эпик - это набор задач, который должен закрываться по мере их дренажа». There is therefore no evergreen per-track epic: the track lives in the `track:*` label and in the milestone name, never in a permanently open epic Issue. An epic carries **no milestone and no dates**: it spans releases, so its schedule is the schedule of the features inside it and its readout is the native sub-issue progress bar. Reference examples: #1240 (Academy public surface) and #1430 (Two-site IA relaunch) — both closable, both draining; they still carry thematic milestones today and are stripped of them in Stage 4 (#1730).

**Release gate rule.** Every milestone has exactly one gate Issue. It carries native `blocked_by` edges to every feature in the release, so "is the release ready" is answered by the native dependency graph rather than by prose. It holds the milestone's Start / Target dates and receives the weekly `pnpm roadmap:forecast` comment (§3.2). Reference examples: #1671 and #1672 — both still carry their pre-revision «Release N gate: …» titles and are renamed to `gate: <milestone name>` in Stage 4 (#1730).

**Forecast rule.** Target date = today + (open EARS children ÷ the track's trailing 4-week EARS-throughput), recomputed weekly and posted as a comment on the gate Issue. An owner override replaces the computed value and is marked by a body line on the Issue; the script never overwrites an overridden date.

## 8. AGENTS.md edits

Two direct edits — no append-only / superseded-block semantics. `AGENTS.md` is a living convention doc; outdated text is replaced in place.

### 8.1 Milestone semantics in §2

`AGENTS.md §2 Repository conventions` currently says, regarding feature specs:

> One spec → one GitHub Milestone → multiple Issues (one per EARS-handler).

This is replaced by:

> One spec → multiple Issues (one per EARS-handler). Milestones are independent of specs: a Milestone is one shippable release of ONE track (1–4 features), named `«<Трек> R<n> — <результат>»`. Specs themselves do not become Milestones, and the two tracks never share a milestone.

The reasoning trail lives in this spec §1 + §3.2 + §3.4 + §7.1, not in `AGENTS.md`. The operating detail — the field contract and the track/milestone/epic distinction — lives in `.claude/rules/repo-conventions.md` → Issue conventions.

### 8.2 Insert §2.1 Issue conventions

Between `§2 Repository conventions` and `§3 Work protocol`, add:

> **§2.1 Issue conventions.** New Issues use the `.github/ISSUE_TEMPLATE/default.md` skeleton (Context / Scope / Spec reference / Acceptance criteria / Dependencies / Notes). Agents resuming In Progress items read the latest stop-state comment first. Stop-state comments follow a fixed four-field shape — see `apps/docs/content/specs/tech/2026-05-21-dsp-198-github-projects-v2-board-design.md` §6 for the canonical form. The board ordering procedure (resume → rework → fresh → unblock) is documented in §5 of the same spec.

Both edits ship in the same PR as the rest of DSP-198, because the conventions are useless without the board and the board is far less useful without the conventions.

## 9. Setup script

Lives at `tools/setup-project-board.ts`. Run-once at bootstrap; kept in-repo afterwards as the disaster-recovery source of truth for board configuration.

### 9.1 Sequence

1. **Project creation.** `gh project create --owner doctor-school --title "DS Platform" --format json` → capture `PROJECT_NUMBER` and `PROJECT_ID`.
2. **Field creation.** The custom fields are `Area` (single-select), `Priority` (single-select) and `Start date` / `Target date` (date); create via `gh project field-create`. Built-in `Status` field has its option set adjusted to the four target values (script warns + defers to UI if defaults differ to avoid item data loss on re-create). Built-in `Type`, `Milestone`, `Labels` require no field creation.
3. **Workflow activation.** For each of the six workflows in §3.3, call the GraphQL `updateProjectV2Workflow` mutation with the appropriate trigger / action payload.
4. **View creation.** For each view in §3.4, configure via UI (the GraphQL view-mutation surface is preview-only) — the `Roadmap` layout, its date-field pair and its milestone markers are UI-only settings.
5. **Backfill.**
   - Fetch closed Issues and PRs via `gh issue list --state all --json …` / `gh pr list --state all --json …`.
   - For each item: `gh project item-add --owner doctor-school --url <html_url>`.
   - For each added item: set Status + Area per §4.2. Milestone, Type, Labels untouched.
6. **Audit log.** Write a final summary to stdout: items processed, fields assigned, ambiguous title parses listed for manual review.

The script does **not** create any Milestone objects — release milestones are created per track when the release is planned (`«<Трек> R<n> — <результат>»`, §3.2), together with their gate Issue.

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

1. Org-level Projects v2 board `DS Platform` exists in org `doctor-school`, visibility = private. URL recorded inline in this spec via a follow-up edit after the script's first successful run.
2. Fields configured: `Status` (4 options), `Area` (12 options), `Priority`, `Start date`, `Target date`. Built-in `Type`, `Milestone`, `Labels` fields are enabled (no Milestone objects created at setup).
3. All six workflows (§3.3) are enabled and active.
4. All views (§3.4) are configured with the correct filter / group / layout — including `Roadmap` (layout roadmap, group by Milestone, filter `-label:kind:ears-handler`, dates Start → Target).
5. All 17 closed items are linked, `Status = Done`. Area assigned per §4.2 (with unambiguous-parse failures logged for manual review). Milestone / Type / Labels untouched by backfill.
6. `tools/setup-project-board.ts` is committed, idempotent, and supports `--dry-run`.
7. `.github/ISSUE_TEMPLATE/default.md` is committed and surfaces in the "New issue" UI (verified manually).
8. `AGENTS.md §2` is rewritten per §8.1 and `§2.1 Issue conventions` is inserted per §8.2 — both in the same PR.
9. Plane DSP-198 is moved to `Done` with a result comment containing: board URL, links to the script + template + AGENTS.md changes, and a note of any backfill items whose Kind / Area were left empty for manual review.

## 11. Verification

Manual checks after the script's first successful run:

- `gh project view <PROJECT_NUMBER> --owner doctor-school --format json` — fields and workflows enumerated.
- Open the board in a browser and confirm: every §3.4 view renders, the `Roadmap` view shows no EARS-handler rows, Todo column is empty, Done column shows the 17 backfilled items.
- Create a throwaway Issue in `doctor-school/ds-platform` — confirm auto-add fires (workflow #1) and the Issue appears in Todo. Close it; confirm workflow #2 moves it to Done. Delete it.

No automated test harness — this is a one-off setup script, not a recurring pipeline.

## 12. Risks + mitigations

| Risk                                                                                                             | Mitigation                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub renames or deprecates a workflow trigger before the script runs.                                          | The script reads each workflow's available triggers from the API before activating; on mismatch it logs and skips, leaving the workflow inactive rather than crashing.                 |
| Auto-add filter unexpectedly pulls in items from forks or transferred repos.                                     | Filter is anchored to `repo:doctor-school/ds-platform`. Forks live outside the org and do not match. Transferred repos away from the org also stop matching.                           |
| `Status` built-in field cannot have its option set fully replaced; some platforms require additive-only changes. | The script first attempts in-place update; on failure, creates a new single-select field `Status (custom)` with the four target options and migrates items. Logged as a fallback path. |
| Backfill heuristics misclassify Area on items with non-conventional titles.                                      | Script logs every ambiguous parse; AC #5 requires manual review of these. The misclassification is recoverable via UI.                                                                 |
| WIP > 1 in `In Progress` due to forgotten stop-state hygiene.                                                    | Documented convention only; not enforced. The ordering procedure §5 handles WIP > 1 by picking newest updated_at. A future tightening (e.g., a CI lint) is out of scope here.          |
| A release milestone grows past 4 features and the Roadmap bar becomes meaningless.                               | The 1–4-feature cap (§3.2) is the split trigger: overflow features move to the next `R<n>` of the same track, or to that track's «· Позже» bucket.                                     |
| The weekly forecast overwrites an owner's manual Target date.                                                    | `pnpm roadmap:forecast` skips any Issue carrying the override body line (§3.2); the override is owner-only by design.                                                                  |

## 13. When to revisit / split

The single-board design holds until any of the following triggers fire:

- A second human owner with a bounded scope appears (e.g., Product Lead taking sole ownership of `cms-payload` content).
- v1 implementation crosses ~50 concurrently open items — at that point a separate `v1 — pilot` board might reduce noise on the operational view.
- More than 100 open items concurrently — the single Todo column drag-reorder UX breaks down.
- A second org-repo with an independent lifecycle joins the board.
- A third product track appears — the two-track milestone naming (`«<Трек> R<n> — …»`) and the Roadmap grouping would need re-deriving, not just extending.

Each trigger reopens this spec as a revision, not as a fresh design.

## 14. Out of scope

- Bootstrap-script (`tools/agent-bootstrap.ts`) integration with the board — separate follow-up Issue.
- Per-app split boards — see §13 triggers.
- Start / Target dates on EARS-handler Issues — see §3.2.
- Sprint cycles / iterations — explicit non-goal per DSP-198 description.
- Cross-tracker Plane DSP-XXX field — strict separation rule (`feedback_plane_github_strict_separation`).
- Custom dependency-graph visualisation — native GH "blocked by / blocking" suffices.
- ADR-0006 §9 and ADR-0007 still describe the retired «long-lived product theme» milestone model; their inline rewrite (EN + RU parity) is #1738, blocked by this revision landing on `main`.
- The board migration that applies this design (retire the `Release` field, create the release milestones, add the Roadmap view) and the `pnpm roadmap:forecast` tooling — separate staged Issues under epic #1726.
