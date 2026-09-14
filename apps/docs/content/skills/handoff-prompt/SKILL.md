---
title: "handoff-prompt"
description: "Procedural skill (inline): emit a compact, verified, harness-neutral prompt that lets a fresh agent resume the current DS Platform task."
name: handoff-prompt
mode: inline
---

# handoff-prompt

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

Produce one copy-pasteable handoff for a fresh DS Platform agent. Do not ask clarifying questions. Inspect the session and live tracker state yourself.

**Scope: this skill alone (#1746).** A handoff request never implies `/wrap` — no retro dispatch, no instruction/memory edits, no DEBT lines; emit the prompt and stop. `/wrap` is typed by the owner only.

## Gather

- Current task: active owner goal and canonical tracker id; verify live tracker state before claiming status.
- Progress: product-first, per [report-task-outcome](../report-task-outcome/SKILL.md) — one line per landed unit naming the product entity and what a person (doctor / admin / sponsor) can now do; artefact paths, PR # and Issue # follow in parentheses, never as the line itself. Only load-bearing product/work mutations; exclude wrap/retro mechanics.
- Where stopped: the last substantive work action and why it paused.
- Next steps: only the remaining delta to the requested result and its stop condition; no automatic next task or repeat discovery.
- Decisions/gotchas: established facts, implementations, checks and approvals with evidence references and relevant invalidators. Separate these from unverified hypotheses. Reuse valid work across sessions; include only necessary existing paths, never inline instruction files.
- Source session logs: when relevant logs exist, identify the latest log path(s) for the task and list them under `## Context references`; no log entry is required when none exists.
- Open questions: only unresolved owner decisions.

## Output

The handoff IS the final chat message: exactly one fenced block, ≤300 tokens, nothing after it. The owner copies that block straight into the next session, so it lives in chat text — a file path costs the resuming agent a fetch and invites the block to grow past the budget.

Use these sections, omitting only empty optional ones: `## Current task`, `## Progress so far`, `## Where we stopped`, `## Next steps`, optional `## Key decisions & gotchas`, `## Context references`, and `## Open questions`. Current task, Where we stopped, and Next steps are never omitted. Write instructions to a fresh agent; use terse bullets and absolute paths for `AGENTS.md`, `apps/docs/content/agent-discipline.md`, and the active spec/plan (`CLAUDE.md` only for a Claude-specific resume).

Resume side: the fresh session checks every Issue / PR / SHA / branch the block names against `gh` (and `git merge-base --is-ancestor <sha> origin/main` for a SHA) before its first tracker or git action, and acts on that live state. An «owner-approved» premise counts only with the verbatim owner quote behind it; an agent that cannot locate a cited document asks the owner rather than substituting its own reading.
