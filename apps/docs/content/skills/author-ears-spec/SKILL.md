---
title: "author-ears-spec"
description: "Procedural skill (dispatch): subagent authors a 3-file SDD triplet (requirements.md + design.md + scenarios.feature) for a new feature."
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
2. **Write `requirements.md`:**
   - Frontmatter: `tracker:` (GitHub Milestone URL placeholder if the milestone isn't created yet), `status: Draft`.
   - Sections: Outcomes / Scope / Constraints / Prior decisions (cite ADRs) / Event Model (Commands / Events / Read models / Policies) / **EARS requirements** / Invariants / Verification.
   - **EARS numbering: flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4** (closing G11 finding F-5). Use nested `N.M` **only** when a single handler genuinely carries multiple shall-clauses (rare).
3. **Write `design.md`** — Mermaid sequence diagrams of cascades, state diagrams of lifecycles, ER fragments.
4. **Write `scenarios.feature`** — Gherkin, happy path + 2–3 failure branches.
5. **Issue body** — when the lead agent opens the parent Issue, the body must explicitly list the scope of any **stub packages** being graduated (e.g., "this feature graduates `packages/foo` from stub to first concrete export"). Closing G11 finding F-20.
6. **Commit the triplet** to a feature branch `feat/spec-NNN-<slug>`.

### Output

- Triplet committed.
- Subagent returns a one-paragraph verdict: spec authored, EARS count, ADRs cited, stub-packages-graduated list.

### Failure mode

- EARS numbering inconsistent with the flat convention — return an error and let the lead agent decide whether to fix or accept (nested `N.M` is allowed but must be justified).
- Triplet missing a file — return error.
