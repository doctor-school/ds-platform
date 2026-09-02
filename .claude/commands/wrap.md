---
description: End-of-session wrap — independent retro → propose → apply+compact → repo/task hygiene → handoff.
---

# /wrap — end-of-session feedback-improvement + close-out loop

Only the owner types `/wrap` — an agent never starts it on its own, and a handoff request is not a wrap (#1746, guard `wrap-owner-only`). Typing `/wrap` means: **read the `run-wrap` catalog skill now and execute its stages in order.** That skill —
[`apps/docs/content/skills/run-wrap/SKILL.md`](../../apps/docs/content/skills/run-wrap/SKILL.md) — is the **single canonical, authoritative source** of the wrap procedure: every stage, gate, output, and failure mode lives there. This file is only a thin entry pointer; it deliberately restates **no** stage detail (that duplication was the drift this consolidation removed — "the path is the contract", AGENTS.md).

See the skill for the non-negotiables it enforces — the stage-1 retro is a **separate independent agent** (never self-review), stage 2's **approval gate is mandatory**, stage 3 **compacts, never appends** (budget stays green), and the wrap's own edits **land via a PR**, not left uncommitted in the shared main tree.
