---
title: "author-ears-spec"
description: "Procedural skill (dispatch): subagent authors a 3-file SDD triplet (NNN-requirements.md + NNN-design.md + NNN-scenarios.feature) for a new feature."
name: author-ears-spec
mode: dispatch
---

# author-ears-spec

**Kind:** procedural · **Mode:** dispatch (the lead agent passes this SKILL.md content to a subagent and consumes the verdict; it does not author the spec inline).

The body below is the **subagent prompt**. The lead agent dispatches a subagent (`Task` tool in Claude Code; equivalent in Codex / Cursor) with this file's content as the system prompt plus a task-specific user message identifying the initiative.

---

## Subagent prompt

You are authoring a 3-file SDD triplet for a new feature in the DS Platform monorepo. The format is fixed by ADR-0006 §4.

### Input

- Initiative reference: `NNN-<slug>` (the feature number is the next free number under `apps/docs/content/specs/features/`).
- Source PRD section, roadmap line, or initiative description.
- ADRs relevant to the feature's domain.

### Procedure

1. **Read sources** — PRD section + listed ADRs + any prior feature-spec in the same domain (for tone and structure precedent).
2. **Write `NNN-requirements.md`** (filename prefixed with the spec number per ADR-0006 §4):
   - Frontmatter: `tracker:` (GitHub Milestone URL placeholder if the milestone isn't created yet), `status: Draft`.
   - Sections: Outcomes / Scope / Constraints / Prior decisions (cite ADRs) / Event Model (Commands / Events / Read models / Policies) / **EARS requirements** / Invariants / Verification.
   - **EARS numbering: flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4** (closing G11 finding F-5). Use nested `N.M` **only** when a single handler genuinely carries multiple shall-clauses (rare).
3. **Write `NNN-design.md`** — Mermaid sequence diagrams of cascades, state diagrams of lifecycles, ER fragments.
4. **Write `NNN-scenarios.feature`** — Gherkin, happy path + 2–3 failure branches.
5. **Issue body** — when the lead agent opens the parent Issue, the body must explicitly list the scope of any **stub packages** being graduated (e.g., "this feature graduates `packages/foo` from stub to first concrete export"). Closing G11 finding F-20. Issue creation itself is handled by [`open-ears-issues`](../open-ears-issues/SKILL.md), which **must** wire the native sub-issue hierarchy and blocked-by graph (its step 4) — not just record dependencies as prose.
6. **Commit the triplet** to a feature branch `feat/spec-NNN-<slug>`.
7. **Sequence the spec PR and the child Issues (ordering B — the contract).** After the subagent returns, the lead agent ships the triplet as a **single docs-PR** off `feat/spec-NNN-<slug>`. On that **same branch, before the PR merges**, run [`open-ears-issues`](../open-ears-issues/SKILL.md): open the parent + child Issues, wire the native graph (its step 4), and write the numbers back into the `issues:` frontmatter of `NNN-requirements*.md`. The spec PR therefore carries the triplet **and** the `issues:` refs together, and merges on a Mode (a) verdict + green CI. Per-iteration **code** PRs begin only **after** the spec is on `main` — the `spec-link` guard is **BLOCK** (AGENTS.md §5 / ADR-0007 §2.6), so a code PR cannot link to a spec that is not yet merged. Ordering A (merge the bare spec first, open Issues afterwards) is **rejected**: `open-ears-issues` writes the `issues:` block on the branch, so it must run pre-merge — a post-merge run would strand that write-back in a second PR. Worked precedent: 003 (`issues: [81…90]` landed inside spec PR #91).

### Output

- Triplet committed.
- Subagent returns a one-paragraph verdict: spec authored, EARS count, ADRs cited, stub-packages-graduated list.

### Failure mode

- EARS numbering inconsistent with the flat convention — return an error and let the lead agent decide whether to fix or accept (nested `N.M` is allowed but must be justified).
- Triplet missing a file — return error.
