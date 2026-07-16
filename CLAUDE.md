@AGENTS.md

# CLAUDE.md — Claude Code overlay for DS Platform

All conventions in [`AGENTS.md`](./AGENTS.md) apply (imported above). This file adds only Claude-Code-specific tooling. Detail lives in `.claude/rules/*.md` (**auto-loaded** alongside this file at session start) and the skill catalog (**read on demand**) — don't inline-grow this file (anti-bloat budget: ≤200 lines / ≤25 KB **per always-on file**, checked by `pnpm lint:instruction-budget`).

<!-- maintainer note: this overlay is intentionally thin. New durable rules go in
     AGENTS.md (§6 for hard rules) or a .claude/rules/*.md reference, never here,
     unless they are genuinely Claude-Code-only (hooks, MCP, superpowers). -->

---

## SessionStart hook

`.claude/settings.json` runs `pnpm bootstrap` on SessionStart — git state, open Issues/PRs, active spec(s), recommended next step land in `additionalContext`. No need to manually run `git log` / `gh issue list` at session start. The `pnpm bootstrap` alias (`tsx tools/agent-bootstrap.ts`) avoids `tsx`-binary PATH issues across shells.

## Auto-memory (load-on-demand by design)

The repo auto-memory lives at `~/.claude/projects/<project>/memory/`. Only the first 200 lines / 25 KB of `MEMORY.md` load at session start; topic files load on demand when you read them. **`MEMORY.md` is an index, not a store** — keep it one bullet per topic, full detail in the topic file. When a memory becomes a hard convention, promote it into `AGENTS.md` / a skill / a `.claude/rules/*.md` and leave the memory bullet as a pointer (don't duplicate the full text in both).

## Tool priority

1. **`gh` CLI** — primary for GitHub Issues, PRs, releases (JSON via `--json` is AI-friendly).
2. **MCP `mcp__plugin_github_github__*`** — only for read-tasks `gh` doesn't cover (rare).
3. **`plane-pp-cli`** — Plane work-items only, **full CRUD** under `projects issues` (`list-work-items` / `create-work-item` / `update-work-item` / `create-work-item-comment`); the top-level `work-items` tag is get+search only (looks read-only — isn't). MCP `mcp__plane-pp-mcp__*` is an optional alternative, **not** required for writes. **Not for code-level Issues.** (Binary is `plane-pp-cli`, not `pp-plane`; PowerShell PATH only — memory `reference_pp_plane_cli_readonly`.)

## Skill priorities (superpowers reminder)

`superpowers:*` skills are auto-discoverable in this harness, but the whitelist is canon **AGENTS.md §3.4** (only `superpowers:brainstorming`, only inside `author-feature-spec`; every other `superpowers:*` skill is disallowed as orchestrator) — dispatch project work per §3 via the catalog `apps/docs/content/skills/<name>/SKILL.md`.

**Orchestration is the default execution mode** — canon **AGENTS.md §6** (deliverable edits are dispatched to subagents; the default is not gated on an «оркеструй» directive, which only escalates to the full `orchestrating-coding-agents` skill / confirms scope). Detail: memory `feedback_orchestrate_by_default_feature_completion`.

## Propose Workflow (multi-agent) mode when the shape is known

`Workflow` (deterministic scripted fan-out — pipeline/parallel/adversarial-verify, up to 16 concurrent agents) is **user-opt-in**: never auto-run it — **propose** it with a rough scale/token estimate and await go. Offer it, over plain one-at-a-time orchestration, when a task's shape is **knowable upfront** and matches:

- **Batch audit/sweep** over many same-shape items (retro corpus, subsystem/instruction sweeps) — we already fan these out by hand.
- **Large impl/review wave** (≈4+ independent, non-overlapping-touch-set Issues or ready PRs).
- **find → verify pipeline** — many findings each needing independent/adversarial verification.
- **N-approach bake-off** — competing designs scored by a judge panel.

Stay on plain orchestration when each step depends on **judging the prior return**, or the discipline contour (worktree/Mode-a/merge/board) must run inline — Workflow subagents don't carry it. Detail + per-trigger evidence: memory `feedback_propose_workflow_when_shape_known`.

## Session plan (первый ответ сессии — canon AGENTS.md §3.2)

The first user-facing reply OPENS with the owner-facing **«План сессии»** block (RU, ≤6 lines, plain language — no jargon references to prior sessions the owner didn't see):

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Что делаем:** 1–3 нумерованных пункта — деливераблы сессии, не механика
> **Зачем:** одна строка — что это даёт / разблокирует

Then the §3.2 entry point (kind / artifact / skill). In a handoff-resumed session the plan states **verified** reality (after `pnpm handoff:verify`), never the handoff's own claims. Restate the block once when the owner re-directs the session or scope changes materially. Purpose: the owner reads it to catch course drift **before** work starts (memory `feedback_session_opens_with_plan`).

## Blocked-on-owner handback

Работа заблокирована ТОЛЬКО действием владельца → последняя видимая строка хода: `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`; поллер/wakeup — после неё, не вместо. Каждый вынесенный владельцу вопрос — самодостаточная plain-language строка (что / почему / что изменит ответ), без жаргонных отсылок к отчёту (memory `feedback_explicit_handback_when_owner_blocked`).

## PR-review subagent (Mode a)

`feature-dev:code-reviewer` has no Bash/`gh`. Dispatch the project agent **`ds-reviewer`** (`.claude/agents/ds-reviewer.md` — Opus, read-only + `gh`) so it can `gh pr diff` a branch not in the working tree; `general-purpose` (Opus) is the fallback if project agents are unavailable (memory `feedback_pr_review_subagent_needs_gh`).

## Subagent context economy (#534)

A subagent's final message lands in the lead's context and is re-read until session end — that, not dispatch count, is what burns the limit. Five rules:

1. **Return contract in every brief.** Every subagent brief ends with a return contract: final message = verdict / diff summary / artifact paths, **≤30 lines**; heavy content (full reports, exploration transcripts, DOM dumps) goes to a file or PR comment, never into the reply. Scaffold the whole IMPL brief (worktree preamble, edit-first budget, gates block, PR block, return contract, checklist heading) with **`pnpm dispatch:brief <issue-N>`** — it emits a ready-to-edit skeleton seeded from the Issue + worktree diff, so authoring a correct brief is cheaper than executing inline (#915).
2. **Model routing.** Mechanical fan-out (find/enumerate/collect) goes to **`ds-explorer`** (`.claude/agents/`, Sonnet, read-only); judgment work (Mode-a review, architecture) stays on Opus (`ds-reviewer` / `general-purpose`).
3. **Browser payloads are dispatched.** Interactive Playwright browsing during orchestration runs inside a subagent, not the lead — rule in `.claude/rules/dev-stand.md`.
4. **Lead-only tools are never delegated.** A tool absent from the subagent environment (DesignSync, etc.) the lead runs itself **before** dispatch — vendoring canvases into `design-source/` is the lead's first step; the subagent gets only the mechanical follow-on (README, refs, PR). Dispatching a task that dead-ends on a lead-only tool = a guaranteed block plus its bytes pumped through the lead's context anyway (session e2e357ff, ~300K).
5. **Briefs in English.** Subagent briefs are authored in English (token economy + model comprehension) even when the owner chat is Russian; RU appears only where the RU string is itself the artifact (owner quotes, UI copy). User-facing replies stay RU (memory `feedback_subagent_briefs_in_english`).
6. **Background dispatches are checkpointed; report only observed artifacts.** A `run_in_background` impl dispatch gets a lead-side liveness probe after a bounded interval — run **`pnpm dispatch:probe <N>`** (inspects `.claude/worktrees/<N>`, prints one machine-parseable line `<ALIVE|QUIET|STILL-CLEAN> #<N> age=<age> commits=<c> dirty=<d>`; a `STILL-CLEAN` verdict ≈10 min in appends `advice=kill+re-dispatch` = kill + re-dispatch with a tighter brief) instead of hand-rolled `git -C <worktree> log`/`status` — never "wait for the notification". Owner-facing status states only observed artifacts (commit / PR # / verdict); downstream steps are phrased as plan. Every impl brief carries the dispatch-brief checklist heading memory `feedback_orchestration_brief_full_lint_before_pr` (edit-first, ≤15-tool-call research budget, …) — the #728 123K zero-output burn. The checkpoint rule covers **ANY background waiter, CI pollers included**: a hand-rolled `until …` poller can die silently (53-min merge stall, session 85170286) — CI-waits are a bounded FOREGROUND poll with a hard deadline ≈ observed avg CI + ~2 min and a mandatory terminal GREEN/RED/TIMEOUT line (deterministic gate command: #836) — parse the `gh pr checks <N> --json name,state` STATE field, never a `grep` over `gh pr checks` TEXT: a job NAME like `submit-pending` contains the substring «pending», so a `\bpending\b` text-scan never resolves and only TIMEOUTs (#925 wave; prefer `pnpm merge:gate <N>` as the terminal readiness gate) — and because the **5000/hr `gh` token is SHARED across all sessions/agents**, never hand-roll `for`-loop `gh run view` polling or repeated `gh project item-list --limit 2000` dumps: use bounded gate commands (`merge:gate`; `run:wait`).

## Shell gotchas

PowerShell here-strings (`@'…'@`) corrupt commit subjects in the Bash tool (→ `@`) — use `gh --body-file` / `-F` or a real bash heredoc (memory `feedback_no_powershell_heredoc_in_bash_tool`).

---

## Reference files (auto-loaded) & on-demand pointers

`.claude/rules/*.md` **auto-load** at session start alongside this file — you already have them in context, no need to re-read:

- `.claude/rules/repo-conventions.md` — branches, commits, versioning, Issues, PRs, merge, dependency bumps.
- `.claude/rules/dev-stand.md` — dev stand, migrations, live-verify plumbing.

Pull these **on demand** when the task needs them:

- **UI construction** — `@ds/design-system`, tokens-only, adopt-before-bespoke: AGENTS.md §6 + skill `build-ui-from-design-system` + ADR-0013.
- **Engineering-readiness defaults** (Coolify, Caddy, GlitchTip, Loki/Prometheus/Tempo, Vault, Unleash, Beget DNS) — [engineering-readiness spec](./apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md).
