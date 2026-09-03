---
title: "handoff-prompt"
description: "Procedural skill (inline): emit a compact, verified, harness-neutral prompt that lets a fresh agent resume the current DS Platform task."
name: handoff-prompt
mode: inline
---

# handoff-prompt

Produce one copy-pasteable handoff for a fresh DS Platform agent. Do not ask clarifying questions. Inspect the session and live tracker state yourself.

**Scope: this skill alone (#1746).** A handoff request never implies `/wrap` — no retro dispatch, no instruction/memory edits, no DEBT lines; emit the prompt and stop. `/wrap` is typed by the owner only.

## Gather

- Current task: active owner goal and canonical tracker id; verify live tracker state before claiming status.
- Progress: product-first, per [report-task-outcome](../report-task-outcome/SKILL.md) — one line per landed unit naming the product entity and what a person (doctor / admin / sponsor) can now do; artefact paths, PR # and Issue # follow in parentheses, never as the line itself. Only load-bearing product/work mutations; exclude wrap/retro mechanics.
- Where stopped: the last substantive work action and why it paused.
- Next steps: concrete continuation, chunked into waves of at most three full PR cycles.
- Decisions/gotchas and context paths: include only what the next agent needs; paths must exist. Never inline instruction files.
- Source session logs: when relevant logs exist, identify the latest log path(s) for the task and list them under `## Context references`; no log entry is required when none exists.
- Open questions: only unresolved owner decisions.

## Output

Emit exactly one fenced block, ≤300 tokens, with no trailing text. The first line is mandatory:

`FIRST ACTION: pipe this verbatim block through \`pnpm handoff:verify\` before any tracker/git action.`

Then use these sections, omitting only empty optional ones: `## Current task`, `## Progress so far`, `## Where we stopped`, `## Next steps`, optional `## Key decisions & gotchas`, `## Context references`, and `## Open questions`. Current task, Where we stopped, and Next steps are never omitted. Write instructions to a fresh agent; use terse bullets and absolute paths for `AGENTS.md`, `CLAUDE.md`, and the active spec/plan.

Before emitting, write the draft to a gitignored temp file and run `pnpm handoff:verify <file>`. Any STALE row blocks output until corrected.
