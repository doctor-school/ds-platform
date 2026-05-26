---
title: "read-relevant-adrs"
description: "Procedural skill (inline): load ADRs cited in the feature-spec 'Prior decisions' and any architecturally adjacent ADRs into the lead agent's context."
name: read-relevant-adrs
mode: inline
---

# read-relevant-adrs

**Kind:** procedural · **Mode:** inline (the lead agent executes this procedure itself).

## Input

- Task context: feature-spec path `apps/docs/content/specs/features/NNN-<slug>/` **or** plain-language task description.

## Procedure

1. If a feature-spec path is given, read its `requirements.md` frontmatter and "Prior decisions" section. Collect the ADR numbers cited there.
2. `Grep` ADR titles in `apps/docs/content/adr/*-en.md` for the technical domain of the task (e.g., a task touching the API layer pulls in ADR-0002; a task touching the data layer pulls in ADR-0003).
3. Read the cited sections (not the whole ADR) — the section heading is the unit. Per AGENTS.md §6, in pre-pilot every ADR is inline-rewritten; an amendment block exists only when the original decision is running in production. If a cited section refers to such a block, read it too.
4. Carry the cited sections in the lead agent's context.
5. **Cite the loaded sections in the first user-facing reply** in the form `"per ADR-NNNN §X.Y ..."`. This citation is the artifact that proves the skill ran.

## Output

- The lead agent carries cited ADR sections in its context.
- First user-facing reply contains at least one `ADR-NNNN §X.Y` citation.

## Failure mode

- Invoking any open-ended exploration skill (`superpowers:brainstorming`) without having loaded ADRs first — process violation per G11 finding F-16. The agent ends up re-deriving an architectural answer that is already fixed in an ADR it could have read.
