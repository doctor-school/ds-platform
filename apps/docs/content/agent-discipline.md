# Portable agent discipline

Read at session entry and after compaction. AGENTS.md is the constitution; this shared startup reference is mandatory for both harnesses and counted in their instruction budgets. CLAUDE.md contains only Claude bindings. Active harness instructions and explicit owner authorization take precedence over project skills.

## Session plan and authorization

First owner-facing reply: RU, ≤6 lines, followed by task kind, active Issue/spec/ADR and skill:

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Трек:** академия | витрина | платформа — active `track:*`
> **Что делаем:** 1–3 numbered deliverables
> **Зачем:** what they enable

Run `pnpm bootstrap` if the harness did not supply its snapshot. Verify a verbatim handoff with `pnpm handoff:verify`; reconcile original tracker evidence. Derived rollups and failed fetches never prove an empty backlog.

Authorization persists across turns. The approved plan covers routine implementation/lifecycle; do not ask twice for the same action. Product scope, Stage A before UI code, Stage B before merge, destructive live infra and release escalation classes retain their explicit owner gates. Mode (a)/(b) review does not replace them; Mode (c) is human review. Original approval applies only to its recorded scope; a handoff assertion alone is not evidence.

For an unresolved owner fork, explain the situation, why the answer matters and the concrete artifact to inspect. One question at a time, plain RU, through the permitted input tool or direct question. Record the owner's words/scope in the Issue/spec immediately. Pending required input ends with `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`. Optional clarification differs from approval; elapsed time is never consent.

## Capability mappings

Check actual tools, executables and receiving-agent permissions before dispatch. Names in skills request capabilities; they never prove availability.

| Capability              | Claude Code                            | Codex / portable binding                                                                                     |
| ----------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Read/search/edit        | Read, Grep, Glob, Edit/Write           | UTF-8 shell reads, `rg`, available patch tool; absolute worktree paths                                       |
| Shell                   | Bash                                   | Available shell execution; translate Bash syntax for PowerShell                                              |
| Dispatch/status/message | Agent/Task, notifications, SendMessage | Available collaboration tools; project TOML roles or capability-equivalent general agent with the same brief |
| Owner input             | AskUserQuestion                        | Permitted input tool or concise direct question                                                              |
| Browse / image          | WebFetch, Read image                   | Actual browsing/image-view tools; open primary pages, deliver artifacts separately                           |
| Browser                 | Playwright MCP or script               | Available browser capability or committed Playwright; actual live journey/evidence required                  |
| Design canvas           | Available DesignSync                   | Discover a real list/get/incremental-sync connector; missing required access is a prerequisite               |
| Session/usage           | Claude log/hook fields                 | Verified Codex rollout/portable record; missing/stale telemetry is unavailable                               |

Do not invent tools, model names or log locations. `/design-sync` and `frontend-design` are not project-catalog skills: canvas operations use the verified connector; visual direction and interaction standards use the design constitution + `research-ui-element`. No silent vendor-pack fallback.

The design product remains Claude Design. No applicable live connector means STOP on required inventory/sync/composition, retain the owner gate and track the prerequisite. A vendored approved `.dc.html` or owner-provided exact export can supply source bytes/provenance where permitted; it cannot prove an unperformed live operation or new approval. Save returned bytes programmatically; never retype a canvas or assume Claude transcript/tool-results storage.

## Dispatch, models and context

Roles: `ds-explorer` read-only scout; `ds-implementer` isolated implementation/spec author; `ds-reviewer` independent verdict, no fixes; `ds-lander` main-tree canonical tail only. Codex profiles omit model/effort and inherit supported parent settings. Claude routing stays in its overlay. If a named role is unavailable, a capable general agent receives the complete role contract; missing dispatch blocks required independent review, never author self-certification.

Briefs name ownership, worktree, spec/ADR anchors, required focused checks + full `pnpm lint` before PR, and ≤30-line returns. Use `pnpm dispatch:brief <N>` and its checklist heading. Tell workers they are not alone and must preserve others' edits. One wave, available slots and ≤4–5 independent non-overlapping Issues; ≤2 dispatch layers. Heavy evidence goes to files/PR comments; reviewer return ≤20 lines.

**Codex tiers:** observed current input / reported `model_context_window`: ≥70% finish the wave and checkpoint; ≥85% no new dispatch, rotate to a fresh agent. These are project headroom bands, not model limits. Never use cumulative lifetime usage. Missing input/window or a token event older than 30 minutes is advisory `unavailable`, not zero, exhaustion or full enforcement. Claude fixed tiers remain in CLAUDE.md. Never fabricate `<subagent_tokens>`.

On ROTATE or measured exhausted budget: finish the atomic step, commit safe WIP, write a checkpoint (done/remaining/files/branch+SHA/next command/questions), return `ROTATE: <path>`; the lead dispatches a fresh agent, never message-continues an exhausted child. With unavailable telemetry keep bounded briefs and checkpoints, not unbounded continuation.

Interactive browser payloads go to a verifier subagent; committed compact Playwright scripts can run under the lead. Check child capabilities before assigning them; perform lead-only operations first and hand over durable artifacts. The lead owns the persistent Stage-B stand. Stand-capable briefs must carry dev-stand.md's reset/raw destructive SQL prohibition and command log; audit that log on return. Probe actual progress with `pnpm dispatch:probe <N>` where supported and artifacts, not notification timing.

## Shell, verification and evidence

Use the worktree for all deliverable reads/writes/tests, including docs. Run `pnpm install` there before its first commit; no borrowed dependencies or docs-only hook skip. Stage explicit paths and inspect status/diff; never alter others' files/listeners.

Run dependent commands sequentially, check every exit. PowerShell native exit is `$LASTEXITCODE`, captured immediately; `$?` is Boolean. Git ancestry is 0=fresh, 1=stale, other=error; verify fetch and both SHA resolutions first. Never turn all errors into “stale” with an echo chain. Multiline GitHub text uses literal UTF-8 `--body-file`.

TDD: meaningful RED before production/guard logic, then GREEN. Run required focused tests, full lint and applicable static guards; after PR create run `pnpm pr:preflight <N>`. Cite precise baseline failures, never bypass them. Independent review + fresh CI + applicable owner evidence precede canonical landing. No `ci:wait` substitute after rebase.

Hooks have separate configured/trusted/observed states. `tools/hooks/README.md` owns diagnostics: `pnpm agent:doctor`, `pnpm agent:smoke --prepare`, then `--run <fixture>` in a fresh CLI. Runtime `/hooks` trust is an owner action; never bypass trust or expand the sandbox. A missing hook means manual discipline, never a claim that enforcement ran. Observations cannot prove persisted trust.

## Memory and wrap

Only owner-entered `/wrap` starts wrap; handoff never does. An explicitly requested skill audit may inspect wrap without executing it. Retro uses verified task/session identity and the correct adapter (`tools/retro/README.md`); unavailable logs/telemetry are evidence gaps, never unrelated newest-session substitutes or zero findings.

Codex memory requires a **direct owner request to update memory**; `/wrap` alone authorizes proposals. Once requested, this environment writes one `<timestamp>-<slug>.md` note under `C:/Users/sidor/.codex/memories/extensions/ad_hoc/notes/`. Never edit existing MEMORY.md, topics or rollouts. Elsewhere use the active harness's supplied path/policy. Claude auto-memory follows its overlay. Product approvals belong in tracker/spec artifacts.

Approved repo instruction edits use worktree/PR; personal memory notes stay outside git. `run-wrap` presents concrete edits and retains pending approval; existing explicit approval covers only that authorized subset without a duplicate ask.

## Instruction budget scope

`pnpm lint:instruction-budget` checks both root startup sets, including this mandatory reference. Claude adds AGENTS.md + CLAUDE.md + path-less rules; Codex adds root AGENTS.override.md if present, otherwise AGENTS.md. `--harness claude|codex` selects one. Each total ≤30 KB, each file ≤200 lines /25 KB. Scoped rules and role profiles are on-demand; skills/references retain Phase-0 WARN caps. Global/ancestor instructions, local memory and nested-cwd chains are outside the deterministic root total, which is not the whole model context. Codex does not implicitly import CLAUDE.md or Claude rules.
