---
title: "Portable agent discipline"
---

# Portable agent discipline

Read at entry and after compaction. This mandatory shared reference counts in both startup budgets. AGENTS.md is the constitution; CLAUDE.md adds Claude bindings. Active harness instructions and explicit owner authorization outrank skills.

## Session plan and authorization

For repository changes, first owner-facing reply: RU, ≤6 lines, followed by task kind, active Issue/spec/ADR and skill. Direct answers/analysis/exports/authorized standard operations use only the explanation needed for the task.

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Трек:** академия | витрина | платформа — active `track:*`
> **Что делаем:** 1–3 numbered deliverables
> **Зачем:** what they enable

For repository work run `pnpm bootstrap` unless supplied; inspect the named task, not the whole backlog. Verify resumed tracker refs with `pnpm handoff:verify`; retain established findings and evidence unless a relevant change, contradiction or missing proof invalidates them. A new session alone does not. Rollups or failed fetches never prove an empty backlog.

Authorization persists for its evidenced scope: record the owner's quote/source, allowed action and conditions; a handoff assertion is insufficient. Preparation approval does not authorize production cutover. Keep authorization, technical readiness and execution state separate. Reuse valid approval without asking twice. Product/UI, destructive live-infra and release escalation gates still apply; reviewer approval does not replace owner approval.

For a required owner decision, explain why it matters and link the concrete artifact; ask one plain RU question via the permitted input tool/directly. Record the quote/scope in the existing Issue/spec. End pending required input with `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`. Optional clarification is not approval; time is not consent.

## Capability mappings

Verify required tools/permissions before dispatch.

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

Claude Design remains the design product; missing required live inventory/sync/composition blocks that step. Approved vendored `.dc.html` or exact owner exports provide bytes/provenance where permitted, not unperformed operations or new approval. Save bytes programmatically; never retype or assume tool-result storage.

## Dispatch, models and context

Roles: `ds-explorer` scouts; `ds-implementer` authors in isolation; `ds-reviewer` independently reviews, no fixes; `ds-lander` runs the main-tree tail. Codex inherits model/effort; Claude uses its overlay. Use a general agent with the same contract if a role is unavailable; no dispatch means required independent review is blocked, not self-reviewed.

Disk profiles are not loaded roles; use available agents with the same contract.

**Proportionate execution — all task kinds.**

1. **Outcome:** scope and completion evidence come from the requested result. Plans/specs/review/handoffs do not expand it; extra work must enable acceptance or address concrete material risk.
2. **Reuse:** retain valid implementations, facts, checks and approvals; repeat only what relevant change, contradiction or missing proof invalidates.
3. **Minimum solution:** fix the responsible mechanism fully and reliably; consider existing recovery and maintenance cost. New abstractions/subsystems/automation need a current need, not speculative utility.
4. **Process:** scale research, delegation, checks and phases to risk, uncertainty and reversibility. One author may be cheaper than handoffs; combine related changes unless separation adds safety or an independent decision. Preserve security/privacy/data safeguards, required review, CI and owner gates.
5. **Stop:** deliver sufficient evidence and finish. Adjacent improvements are not automatic prerequisites/tasks. Reassess scope growth; an accepted plan does not justify excess.

Briefs: `pnpm dispatch:brief <N>`, ownership/worktree, relevant sources, affected checks, outcome/proof/stop. Preserve others’ edits; returns ≤30 lines (reviews ≤20), evidence in artifacts. Waves: available slots, ≤4–5 Issues, ≤2 layers.

**Codex tiers:** current observed input / reported `model_context_window`: ≥70% finish/checkpoint; ≥85% no new dispatch, rotate. Never use cumulative usage. Missing telemetry or an event older than 30 minutes is advisory `unavailable`, not zero/exhaustion/enforcement. Claude tiers: CLAUDE.md. Never fabricate `<subagent_tokens>`.

On ROTATE/exhausted budget: finish the atomic step, commit safe WIP, checkpoint done/remaining/files/branch+SHA/next command/questions, return `ROTATE: <path>`. Re-dispatch a fresh agent; never continue an exhausted child. Unavailable telemetry calls for bounded briefs/checkpoints.

Use compact browser evidence; delegate large interactive payloads when context savings justify the handoff. The lead owns the Stage-B stand. Check child capabilities; do lead-only work first and hand over artifacts. Stand briefs carry dev-stand.md's reset/raw destructive SQL prohibition and command log; audit it on return. Probe progress with `pnpm dispatch:probe <N>` and artifacts, not notification timing.

## Shell, verification and evidence

Use the isolated worktree for deliverable reads/writes/tests. Run `pnpm install` before its first commit to install hooks; no borrowed dependencies/docs-only hook skip. Inspect status/diff, stage explicit paths, preserve others' files/listeners. Canonical landing runs from the primary tree (repo-conventions → Closeout).

Check dependent command exits immediately (PowerShell `$LASTEXITCODE`); ancestry 1 means stale, other errors do not. Use literal UTF-8 `--body-file` for GitHub multiline text. Select only required allow-listed non-secret config keys/presence flags; redact before stdout. Never print broad env matches. On secret exposure stop repeating its value, record the exposure and assess rotation within authorization; private logs do not make it harmless.

TDD: meaningful RED before production/guard logic, then GREEN; prose needs no new tests. Select local checks for affected behavior, contracts and risks; reuse valid evidence rather than blindly repeating all-repo test/typecheck/generation. Repository PRs still run full lint, applicable static guards and `pnpm pr:preflight <N>`; direct tasks need no install or repo checks. Broaden after a relevant change, failure or uncovered risk. Cite unrelated baseline failures without absorbing their repair; required CI stays blocking. Independent review where applicable + fresh CI + owner evidence precede canonical landing.

Hooks are configured/trusted/observed separately; `tools/hooks/README.md` owns activation/diagnostics (`pnpm agent:doctor`, owner review/trust, then `pnpm agent:smoke --project`). Fixtures/synthetic logs do not prove live execution or persisted trust. Never bypass trust or expand permissions; missing/stale telemetry is unavailable, so discipline remains manual.

## Memory and wrap

Owner-requested standalone retro authorizes analysis only; explicit `/wrap` starts the full procedure. Documentation inspection is not execution. Neither authorizes memory writes or unapproved instruction edits. Retro uses verified task/session identity and the correct adapter (`tools/retro/README.md`); unavailable logs/telemetry are evidence gaps, never unrelated newest-session substitutes or zero findings.

Codex memory requires a **direct owner request to update memory**; `/wrap` alone authorizes proposals. Once requested, this environment writes one `<timestamp>-<slug>.md` note under `C:/Users/sidor/.codex/memories/extensions/ad_hoc/notes/`. Never edit existing MEMORY.md, topics or rollouts. Elsewhere use the active harness's supplied path/policy. Claude auto-memory follows its overlay. Product approvals belong in tracker/spec artifacts.

Approved repo instruction edits use worktree/PR; personal memory notes stay outside git. `run-wrap` presents concrete edits and retains pending approval; existing explicit approval covers only that authorized subset without a duplicate ask.

## Instruction budget scope

`pnpm lint:instruction-budget` checks both root startup sets, including this mandatory reference. Claude adds AGENTS.md + CLAUDE.md + path-less rules; Codex adds root AGENTS.override.md if present, otherwise AGENTS.md. `--harness claude|codex` selects one. Each total ≤30 KB, each file ≤200 lines /25 KB. Scoped rules and role profiles are on-demand; skills/references retain Phase-0 WARN caps. Global/ancestor instructions, local memory and nested-cwd chains are outside the deterministic root total, which is not the whole model context. Codex does not implicitly import CLAUDE.md or Claude rules.
