---
title: "Portable agent discipline"
---

# Portable agent discipline

Read at entry and after compaction. This mandatory shared reference counts in both startup budgets. AGENTS.md is the constitution; CLAUDE.md adds Claude bindings. Active harness instructions and explicit owner authorization outrank skills.

## Session plan and authorization

First owner-facing reply: RU, ≤6 lines, followed by task kind, active Issue/spec/ADR and skill:

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Трек:** академия | витрина | платформа — active `track:*`
> **Что делаем:** 1–3 numbered deliverables
> **Зачем:** what they enable

Run `pnpm bootstrap` unless supplied. Verify verbatim handoffs with `pnpm handoff:verify` against original tracker evidence. Rollups or failed fetches never prove an empty backlog.

Authorization persists for its evidenced scope: record the owner's quote/source, allowed action and conditions; a handoff assertion is insufficient. Preparation approval does not authorize production cutover. Keep authorization, technical readiness and execution state separate. Reuse valid approval without asking twice. Product/UI, destructive live-infra and release escalation gates still apply; reviewer approval does not replace owner approval.

For an unresolved owner fork, explain the situation, why the answer matters and the concrete artifact to inspect. One question at a time, plain RU, through the permitted input tool or direct question. Record the owner's words/scope in the Issue/spec immediately. Pending required input ends with `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`. Optional clarification differs from approval; elapsed time is never consent.

## Capability mappings

Before dispatch check tools, executables and child permissions; skill names request capabilities, not prove availability.

| Capability              | Claude Code                            | Codex / portable binding                                                               |
| ----------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Read/search/edit        | Read, Grep, Glob, Edit/Write           | UTF-8 shell reads, `rg`, available patch tool; absolute worktree paths                 |
| Shell                   | Bash                                   | Available shell execution; translate Bash syntax for PowerShell                        |
| Dispatch/status/message | Agent/Task, notifications, SendMessage | Collaboration tools; project TOML role or equivalent general agent with the same brief |
| Owner input             | AskUserQuestion                        | Permitted input tool or concise direct question                                        |
| Browse / image          | WebFetch, Read image                   | Actual browsing/image-view tools; open primary pages, deliver artifacts separately     |
| Browser                 | Playwright MCP or script               | Available browser tool or committed Playwright; real live journey/evidence required    |
| Design canvas           | Available DesignSync                   | Real list/get/incremental-sync connector; missing required access blocks the step      |
| Session/usage           | Claude log/hook fields                 | Verified Codex rollout/portable record; missing/stale telemetry is unavailable         |

Never invent tools, models or log paths. `/design-sync` and `frontend-design` are outside the project catalog: use the verified canvas connector and design constitution + `research-ui-element`, never a silent vendor-pack fallback.

Claude Design remains the design product. Missing required live inventory/sync/composition blocks that step; retain the owner gate and track the prerequisite. Approved vendored `.dc.html` or exact owner exports supply bytes/provenance where permitted, never proof of unperformed operations or new approval. Save bytes programmatically, never retype or assume Claude tool-result storage.

## Dispatch, models and context

Roles: `ds-explorer` read-only scout; `ds-implementer` isolated implementation/spec author; `ds-reviewer` independent verdict, no fixes; `ds-lander` main-tree canonical tail only. Codex inherits parent model/effort; Claude routing stays in its overlay. An unavailable role uses a general agent with its full contract. Missing dispatch blocks required independent review, never permits self-review.

Disk profiles are not loaded roles. Until fresh-session discovery, use an available general agent with the narrow role contract, independent review/landing and inherited settings.

Before implementation/dispatch, assess the minimum path, actual risks, existing rollback/recovery and preparation cost. Each extra check or automation closes a named uncovered risk. An accepted plan alone is not proof of proportionality. If preparation materially exceeds the change or its necessity is uncertain, present concise options, cost and recommendation to the owner before expanding; reuse approval for unchanged routine work. Reassess at scope growth. Corrections identify the false claim, evidence and plan delta.

Briefs use `pnpm dispatch:brief <N>` and its checklist: ownership/worktree, ADR/spec, required checks including full lint, outcome, minimum proof and stop condition. Workers preserve others' edits; returns ≤30 lines (reviewers ≤20), evidence in artifacts. One wave: available slots, ≤4–5 independent Issues, ≤2 layers.

**Codex tiers:** observed current input / reported `model_context_window`: ≥70% finish the wave and checkpoint; ≥85% no new dispatch, rotate to a fresh agent. These are project headroom bands, not model limits. Never use cumulative lifetime usage. Missing input/window or a token event older than 30 minutes is advisory `unavailable`, not zero, exhaustion or full enforcement. Claude fixed tiers remain in CLAUDE.md. Never fabricate `<subagent_tokens>`.

On ROTATE or measured exhausted budget: finish the atomic step, commit safe WIP, write a checkpoint (done/remaining/files/branch+SHA/next command/questions), return `ROTATE: <path>`; the lead dispatches a fresh agent, never message-continues an exhausted child. With unavailable telemetry keep bounded briefs and checkpoints, not unbounded continuation.

Interactive browser payloads go to a verifier; the lead may run compact committed Playwright scripts and owns the Stage-B stand. Check child capabilities; do lead-only work first and hand over artifacts. Stand briefs carry dev-stand.md's reset/raw destructive SQL prohibition and command log; audit it on return. Probe progress with `pnpm dispatch:probe <N>` and artifacts, not notification timing.

## Shell, verification and evidence

Use the worktree for all deliverable reads/writes/tests, including docs. Run `pnpm install` there before its first commit; no borrowed dependencies or docs-only hook skip. Stage explicit paths and inspect status/diff; never alter others' files/listeners. The lead never `cd`s into a worktree; canon: repo-conventions → Closeout.

Check each dependent command's exit (`$LASTEXITCODE` immediately in PowerShell); ancestry 1 means stale, other errors do not. GitHub multiline text uses literal UTF-8 `--body-file`. For secret-bearing config, select exact allow-listed keys; emit only required non-secret values or presence flags. Redact before stdout, never after capture. Never print broad value matches from an env file. If a secret is emitted, stop repeating it, record exposure without its value, and assess revocation/rotation through the applicable owner scope; a private log is not proof of harmlessness.

TDD: meaningful RED before production/guard logic, then GREEN. Run required focused tests, full lint and applicable static guards; after PR create run `pnpm pr:preflight <N>`. Cite precise baseline failures, never bypass them. Independent review + fresh CI + applicable owner evidence precede canonical landing. No `ci:wait` substitute after rebase.

Hooks have separate configured/trusted/observed states; `tools/hooks/README.md` owns diagnostics (`pnpm agent:doctor`): after landing, restart Codex in the target project, obtain owner review/trust of it and its exact `/hooks` definitions, then run `pnpm agent:smoke --project`. Fixtures are developer checks, not activation proof or an owner trust ceremony. Never bypass trust or expand the sandbox. Synthetic logs cannot prove live execution or persisted trust; unobserved tool paths and missing/stale telemetry remain unavailable, so discipline is manual.

## Memory and wrap

Owner-requested standalone retro authorizes analysis only; explicit `/wrap` starts the full procedure. Documentation inspection is not execution. Neither authorizes memory writes or unapproved instruction edits. Retro uses verified task/session identity and the correct adapter (`tools/retro/README.md`); unavailable logs/telemetry are evidence gaps, never unrelated newest-session substitutes or zero findings.

Codex memory requires a **direct owner request to update memory**; `/wrap` alone authorizes proposals. Once requested, this environment writes one `<timestamp>-<slug>.md` note under `C:/Users/sidor/.codex/memories/extensions/ad_hoc/notes/`. Never edit existing MEMORY.md, topics or rollouts. Elsewhere use the active harness's supplied path/policy. Claude auto-memory follows its overlay. Product approvals belong in tracker/spec artifacts.

Approved repo instruction edits use worktree/PR; personal memory notes stay outside git. `run-wrap` presents concrete edits and retains pending approval; existing explicit approval covers only that authorized subset without a duplicate ask.

## Instruction budget scope

`pnpm lint:instruction-budget` checks both root startup sets, including this mandatory reference. Claude adds AGENTS.md + CLAUDE.md + path-less rules; Codex adds root AGENTS.override.md if present, otherwise AGENTS.md. `--harness claude|codex` selects one. Each total ≤30 KB, each file ≤200 lines /25 KB. Scoped rules and role profiles are on-demand; skills/references retain Phase-0 WARN caps. Global/ancestor instructions, local memory and nested-cwd chains are outside the deterministic root total, which is not the whole model context. Codex does not implicitly import CLAUDE.md or Claude rules.
