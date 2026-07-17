@AGENTS.md

# CLAUDE.md — Claude Code overlay for DS Platform

All conventions in [`AGENTS.md`](./AGENTS.md) apply (imported above); this file adds only Claude-Code-specific tooling. Detail lives in `.claude/rules/*.md` (auto-loaded) and the skill catalog (on demand). Anti-bloat budget: ≤200 lines / ≤25 KB per always-on file (`pnpm lint:instruction-budget`), and net-negative: new always-on rule text is offset by removing at least as many bytes.

---

## SessionStart hook

`.claude/settings.json` runs `pnpm bootstrap` on SessionStart — git/Issue/PR/spec state lands in `additionalContext`; no manual `git log` / `gh issue list` at start. (`pnpm bootstrap` = `tsx tools/agent-bootstrap.ts`, avoids `tsx` PATH issues.)

## Wrap cadence

`/wrap` runs on owner request or before a planned long gap — not a mandatory end-of-every-session step. The context-budget hook (110K/120K thresholds) is advisory to the operator only, never a directive to the model — the agent keeps working until the owner calls `/wrap`.

## Auto-memory (load-on-demand by design)

`~/.claude/projects/<project>/memory/`: only the first 200 lines / 25 KB of `MEMORY.md` load at start; topic files load on demand. `MEMORY.md` is an index, not a store — one bullet per topic. A memory that becomes a hard convention is promoted into `AGENTS.md` / a skill / a rules file, leaving the bullet as a pointer (never duplicate full text). Memory prose (topic files + index) is ENGLISH; RU only where the Russian string is itself the artifact (verbatim owner quotes, UI copy).

## Tool priority

1. `gh` CLI — primary for GitHub Issues, PRs, releases (`--json`).
2. GitHub MCP (`mcp__plugin_github_github__*`) — only for read-tasks `gh` doesn't cover (rare).
3. `plane-pp-cli` — Plane work-items only, full CRUD under `projects issues` (`list-work-items` / `create-work-item` / `update-work-item` / `create-work-item-comment`); the top-level `work-items` tag is get+search only (looks read-only — isn't). Plane MCP is optional, not required for writes. Not for code-level Issues. (Binary is `plane-pp-cli`, not `pp-plane`; PowerShell PATH only.)

## Skill priorities

`superpowers:*` skills are auto-discoverable here, but the whitelist is canon AGENTS.md §3.4 — dispatch project work per §3 via the catalog. Orchestration is the default execution mode (AGENTS.md §6); an «оркеструй» directive only escalates to the `orchestrating-coding-agents` skill / confirms scope.

## Propose Workflow (multi-agent) when the shape is known

`Workflow` (deterministic scripted fan-out — pipeline/parallel/adversarial-verify, ≤16 concurrent agents) is user-opt-in: never auto-run — propose with a rough scale/token estimate and await go. Triggers (shape knowable upfront): batch audit/sweep over same-shape items; impl/review wave of ≈4+ independent, non-overlapping-touch-set Issues/PRs; find→verify pipeline — the lead CLOSES the run by diffing the synthesis row-set against the seed ledgers/inputs it handed in (verifiers check rows that exist; nothing checks completeness); N-approach bake-off with a judge panel. Stay on plain orchestration when steps depend on judging the prior return, or the discipline contour (worktree/Mode-a/merge/board) must run inline — Workflow subagents don't carry it.

## Session plan (первый ответ сессии — canon AGENTS.md §3.2)

The first user-facing reply OPENS with the owner-facing «План сессии» block (RU, ≤6 lines, plain language, no jargon references to prior sessions the owner didn't see):

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Что делаем:** 1–3 нумерованных пункта — деливераблы сессии, не механика
> **Зачем:** одна строка — что это даёт / разблокирует

Then the §3.2 entry point (kind / artifact / skill). A handoff-resumed session states verified reality (after `pnpm handoff:verify`), never the handoff's claims. Restate once if the owner re-directs or scope changes materially — it exists so the owner catches course drift before work starts.

## Blocked-on-owner handback

Работа заблокирована ТОЛЬКО действием владельца → последняя видимая строка хода: `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`; поллер/wakeup — после неё, не вместо. Каждый вынесенный владельцу вопрос — самодостаточная plain-language строка (что / почему / что изменит ответ), без жаргонных отсылок к отчёту.

## PR-review subagent (Mode a)

`feature-dev:code-reviewer` has no Bash/`gh`. Dispatch `ds-reviewer` (`.claude/agents/ds-reviewer.md` — Opus, read-only + `gh`, can `gh pr diff` a branch not in the tree); fallback `general-purpose` `model: opus` if project agents are unavailable.

## Subagent context economy

A subagent's final message lands in the lead's context and is re-read until session end — that, not dispatch count, burns the limit.

1. Return contract in every brief: final message = verdict / diff summary / artifact paths, ≤30 lines; heavy content → file or PR comment, never the reply. Scaffold IMPL briefs with `pnpm dispatch:brief <issue-N>` (skeleton seeded from the Issue + worktree diff).
2. Model routing: mechanical fan-out (find/enumerate/collect) → `ds-explorer` (Sonnet, read-only); judgment (Mode-a review, architecture, implementation, spec work) → Opus: `ds-reviewer`, or `general-purpose` with EXPLICIT `model: opus` on every dispatch. Inheriting the session model is forbidden — a Fable-led session silently spawns Fable subagents; Fable is never a subagent model.
3. Browser payloads are dispatched — interactive Playwright runs inside a subagent, not the lead (`.claude/rules/dev-stand.md`).
4. Lead-only tools are never delegated — a tool absent from the subagent environment (DesignSync, …) the lead runs itself BEFORE dispatch; the subagent gets only the mechanical follow-on. A dispatch that dead-ends on a lead-only tool is a guaranteed block.
5. Briefs in English; RU only where the RU string is itself the artifact. User-facing replies stay RU.
6. Background dispatches are checkpointed; report only observed artifacts. Probe after a bounded interval with `pnpm dispatch:probe <N>` (one line `<ALIVE|QUIET|STILL-CLEAN> #<N> age= commits= dirty=`; STILL-CLEAN ≈10 min in ⇒ kill + re-dispatch with a tighter brief) — never "wait for the notification". Owner-facing status = observed artifacts only (commit / PR # / verdict); downstream steps are phrased as plan. Every impl brief carries the dispatch-brief checklist heading (memory `feedback_orchestration_brief_full_lint_before_pr`: edit-first, ≤15-tool-call research budget, …). Applies to ANY background waiter, CI pollers included: CI-waits are a bounded FOREGROUND poll with a hard deadline ≈ observed avg CI + ~2 min and a mandatory terminal GREEN/RED/TIMEOUT line; parse the `gh pr checks <N> --json name,state` STATE field, never `grep` the text (job names can contain «pending»); prefer `pnpm merge:gate <N>` as the terminal readiness gate. The 5000/hr `gh` token is SHARED across all sessions/agents — never hand-roll `for`-loop `gh run view` polling or repeated `gh project item-list --limit 2000` dumps; use bounded gate commands (`merge:gate`, `run:wait`).

## Shell gotchas

PowerShell here-strings (`@'…'@`) corrupt commit subjects in the Bash tool (→ `@`) — use `gh --body-file` / `-F` or a real bash heredoc.

## On-demand pointers

`.claude/rules/*.md` auto-load at session start — already in context, no re-read. Pull on demand: UI construction — AGENTS.md §6 + skill `build-ui-from-design-system` + ADR-0013; engineering-readiness defaults (Coolify, Caddy, GlitchTip, Loki/Prometheus/Tempo, Vault, Unleash, Beget DNS) — [engineering-readiness spec](./apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md).
