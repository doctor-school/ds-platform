---
title: "Portable agent discipline"
---

# Portable agent discipline

Read at entry and after compaction; this shared reference counts in both startup budgets. AGENTS.md is the constitution; CLAUDE.md adds Claude bindings. Active harness instructions and explicit owner authorization outrank skills.

## Session plan and authorization

For repository changes, open in RU with task kind, active artifact and skill. Direct tasks need only the explanation useful to the result.

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Трек:** академия | витрина | платформа — active `track:*`
> **Что делаем:** 1–3 numbered deliverables
> **Зачем:** what they enable

For repository work run `pnpm bootstrap` unless supplied and inspect the named task. A resumed session checks each named Issue/PR/SHA with `gh` before its first tracker or git action and keeps established findings unless invalidated. Rollups or failed fetches do not prove an empty backlog.

Keep authorization, readiness and execution separate. Reuse the owner's evidenced quote/source, action and conditions; a handoff claim or review verdict is not owner approval, and preparation is not cutover approval. Ask only for a decision outside existing authorization; routine diagnosis and fixes need no new go. Earlier approval does not cover a CI bypass or a destructive action outside its scope.

Status and clarification questions steer ongoing work: answer briefly, then continue unless the task is canceled or replaced. A blocker holds only dependent actions; continue authorized diagnosis, preparation and independent work. Before asking for approval, prepare the decision and its evidence. When authorized work is exhausted, state what remains and wait for the owner or the external event — time is not consent.

## Capability mappings

Verify required tools and permissions before dispatch.

| Capability              | Claude Code                            | Codex / portable binding                                                          |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| Read/search/edit        | Read, Grep, Glob, Edit/Write           | UTF-8 shell reads, `rg`, available patch tool; absolute worktree paths            |
| Shell                   | Bash                                   | Available shell execution; translate Bash syntax for PowerShell                   |
| Dispatch/status/message | Agent/Task, notifications, SendMessage | Collaboration tools; project TOML role or a general agent with the same brief     |
| Owner input             | AskUserQuestion                        | Permitted input tool or concise direct question                                   |
| Browse / image          | WebFetch, Read image                   | Real browsing/image-view tools; open primary pages, deliver artifacts separately  |
| Browser                 | Playwright MCP or script               | Available browser tool or committed Playwright; real live journey evidence        |
| Design canvas           | Available DesignSync                   | Real list/get/incremental-sync connector; missing required access blocks the step |
| Session/usage           | Claude log/hook fields                 | Verified Codex rollout/portable record; missing/stale telemetry is unavailable    |

`/design-sync` and `frontend-design` are outside the project catalog: use the verified canvas connector and the design constitution + `research-ui-element` instead.

Claude Design remains the design product; missing required live inventory/sync/composition blocks that step. Approved vendored `.dc.html` or exact owner exports provide bytes/provenance where permitted, not unperformed operations or new approval. Save bytes programmatically rather than retyping them.

## Dispatch, models and context

Roles: `ds-explorer` scouts; `ds-implementer` authors in isolation; `ds-reviewer` independently reviews without fixing; `ds-lander` runs the main-tree tail. Codex inherits model/effort; Claude uses its overlay. Use a general agent with the same contract if a role is unavailable; without dispatch, required independent review is blocked rather than self-reviewed.

Proportionate execution: the requested result sets scope and completion evidence — plans, specs, reviews and handoffs do not expand it. Keep valid facts, checks and approvals; repeat only what a relevant change, contradiction or missing proof invalidates. Security, privacy and data safeguards, required review, CI and owner gates stay in place at every scale. A merge, report or subagent return is intermediate while release or other requested work remains. A session ending before the outcome (owner defers, context tier fires, worktree-pinned tail) ends with skill `handoff-prompt` as the final message. An owner gate or blocker inside a live session is a pause: post the request with evidence, state what remains, wait.

Briefs: `pnpm dispatch:brief <N>`, ownership/worktree, relevant sources, affected checks, outcome/proof/stop. Preserve others' edits. Returns carry the conclusion; details go to the PR or a scratchpad artifact. Waves: ≤4–5 Issues, ≤2 layers.

Codex tiers: current observed input / reported `model_context_window` — at 70% finish and checkpoint; at 85% no new dispatch, rotate. Use observed input, not cumulative usage; telemetry missing or over 30 minutes old is advisory `unavailable`, not zero. Claude tiers: CLAUDE.md. Do not fabricate `<subagent_tokens>`.

On ROTATE or exhausted budget: finish the atomic step, commit safe WIP, checkpoint done/remaining/files/branch+SHA/next command/questions, return `ROTATE: <path>`. Re-dispatch a fresh agent, not the exhausted child.

Delegate large interactive browser payloads. The lead owns the Stage-B stand. Stand briefs carry dev-stand.md's reset/destructive-SQL prohibition and command log; audit it on return. Probe progress with `pnpm dispatch:probe <N>` and returned artifacts.

## Shell, verification and evidence

Workers isolate themselves and use that worktree for deliverable reads/writes/tests; the lead's cwd stays in the main tree all session — where canonical landing runs (repo-conventions → Closeout) — reaching a worktree through absolute paths and `git -C`. Run `pnpm install` before a worktree's first commit so hooks run. Stage explicit paths and preserve others' files and listeners.

Use a literal UTF-8 `--body-file` for GitHub multiline text. On secret exposure stop repeating the value, record it and assess rotation within authorization.

TDD: meaningful RED before production/guard logic, then GREEN; prose needs no new tests. Select local checks for the affected behavior and reuse valid evidence. Repository PRs still run full lint, applicable static guards and `pnpm pr:preflight <N>`; direct tasks need no install or repo checks. Cite unrelated baseline failures without absorbing their repair; required CI stays blocking. Independent review where applicable + fresh CI + owner evidence precede canonical landing.

Hooks are configured, trusted and observed separately; `tools/hooks/README.md` owns activation/diagnostics (`pnpm agent:doctor`, owner review/trust, then `pnpm agent:smoke --project`). Fixtures and synthetic logs do not prove live execution or persisted trust; missing telemetry keeps discipline manual.

## Memory and wrap

An owner-requested standalone retro authorizes analysis only; explicit `/wrap` starts the full procedure. Neither authorizes memory writes or unapproved instruction edits. Retro uses verified task/session identity and the correct adapter (`tools/retro/README.md`); unavailable logs are evidence gaps, not zero findings.

Codex memory requires a direct owner request to update memory; `/wrap` alone authorizes proposals. Once requested, write one `<timestamp>-<slug>.md` note under `C:/Users/sidor/.codex/memories/extensions/ad_hoc/notes/`, leaving existing MEMORY.md, topics and rollouts untouched. Claude auto-memory follows its overlay. Product approvals belong in tracker/spec artifacts.

Approved repo instruction edits use worktree/PR; personal memory notes stay outside git. `run-wrap` presents concrete edits and retains pending approval; existing explicit approval covers only that subset.

## Instruction budget scope

`pnpm lint:instruction-budget` checks both root startup sets, including this reference. Claude adds AGENTS.md + CLAUDE.md + path-less rules; Codex adds root AGENTS.override.md if present, otherwise AGENTS.md. `--harness claude|codex` selects one. Each total ≤30 KB, each file ≤200 lines /25 KB. Scoped rules and role profiles are on-demand; skills/references keep Phase-0 WARN caps. Global/ancestor instructions, local memory and nested-cwd chains are outside the root total. Codex never imports CLAUDE.md or Claude rules.
