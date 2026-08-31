@AGENTS.md

# CLAUDE.md — Claude Code overlay for DS Platform

All conventions in [`AGENTS.md`](./AGENTS.md) apply (imported above); this file adds only Claude-Code-specific tooling. Detail lives in `.claude/rules/*.md` (per the AGENTS.md §0 index) and the skill catalog. Anti-bloat budget (`pnpm lint:instruction-budget`): ≤200 lines / ≤25 KB per always-on file AND ≤30 KB across the always-on set; net-negative — new always-on rule text is offset by removing at least as many bytes.

---

## SessionStart hook

`.claude/settings.json` runs `pnpm bootstrap` on SessionStart — git/Issue/PR/spec state lands in `additionalContext`; no manual `git log` / `gh issue list` at start. (`pnpm bootstrap` = `tsx tools/agent-bootstrap.ts`, avoids `tsx` PATH issues.)

## Wrap cadence

`/wrap` runs on owner request or before a planned long gap — not a mandatory end-of-every-session step. The context-budget hook (200K/250K) is advisory to the operator, never a directive to the model — work continues until the owner calls `/wrap`.

## Auto-memory (load-on-demand by design)

`~/.claude/projects/<project>/memory/`: only the first 200 lines / 25 KB of `MEMORY.md` load at start; topic files load on demand. `MEMORY.md` is an index, not a store — one bullet per topic. A memory that becomes a hard convention is promoted into `AGENTS.md` / a skill / a rules file, leaving the bullet as a pointer (never duplicate full text). Memory prose (topic files + index) is ENGLISH; RU only where the Russian string is itself the artifact (verbatim owner quotes, UI copy).

## Tool priority

1. `gh` CLI — primary for GitHub Issues, PRs, releases (`--json`).
2. GitHub MCP (`mcp__plugin_github_github__*`) — only for read-tasks `gh` doesn't cover (rare).
3. `plane-pp-cli` — Plane work-items only, full CRUD under `projects issues` (`list-work-items` / `create-work-item` / `update-work-item` / `create-work-item-comment`); the top-level `work-items` tag is get+search only (looks read-only — isn't). Plane MCP is optional, not required for writes. Not for code-level Issues. (Binary is `plane-pp-cli`, not `pp-plane`; PowerShell PATH only.)

## Skill priorities

`superpowers:*` skills are auto-discoverable here, but the whitelist is canon AGENTS.md §3.4 — dispatch project work per §3 via the catalog. Orchestration is the default execution mode (AGENTS.md §6); an «оркеструй» directive only escalates to the `orchestrating-coding-agents` skill / confirms scope.

## Propose Workflow (multi-agent) when the shape is known

`Workflow` (deterministic scripted fan-out, ≤16 concurrent agents) is user-opt-in: never auto-run — propose with a rough scale/token estimate and await go. Triggers, all shape-knowable upfront: same-shape batch audit/sweep; an impl/review wave of ≈4+ independent, non-overlapping-touch-set Issues/PRs; a find→verify pipeline; an N-approach bake-off with a judge panel. The lead CLOSES a run by diffing the synthesis row-set against the seed ledgers it handed in — verifiers check rows that exist, nothing checks completeness. Stay on plain orchestration when a step depends on judging the prior return, or the discipline contour (worktree/Mode-a/merge/board) must run inline — Workflow subagents don't carry it.

## Session plan (первый ответ сессии — canon AGENTS.md §3.2)

The first user-facing reply OPENS with the «План сессии» block (RU, ≤6 lines, plain language, no jargon from prior sessions the owner didn't see):

> **План сессии**
> **Тип:** продуктовая | техническая | процессная
> **Трек:** академия | витрина | платформа — из `track:*` активного Issue
> **Что делаем:** 1–3 нумерованных пункта — деливераблы сессии, не механика
> **Зачем:** одна строка — что это даёт / разблокирует

Then the §3.2 entry point (kind / artifact / skill). A handoff-resumed session states verified reality (after `pnpm handoff:verify`), never the handoff's claims. Restate once if the owner re-directs or scope changes materially — so the owner catches course drift before work starts.

## Blocked-on-owner handback

Работа заблокирована ТОЛЬКО действием владельца → последняя видимая строка хода: `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`; поллер/wakeup — после неё, не вместо. Развилки — ИНТЕРАКТИВНО (owner 2026-08-24): ОДНА на сообщение (сущность простым RU · почему · 2–3 варианта + рекомендация), дословный ответ → в артефакт, затем следующая; список ≥2 или счётчик «осталось N» — нарушение.

## PR-review subagent (Mode a)

`feature-dev:code-reviewer` has no Bash/`gh` — dispatch `ds-reviewer` (Opus, read-only + `gh`, diffs a branch not in the tree); fallback `general-purpose` `model: opus` when project agents are unavailable.

## Subagent context economy

A subagent's final message lands in the lead's context and is re-read until session end — that, not dispatch count, burns the limit.

1. Return contract in every brief: final message = verdict / diff summary / artifact paths, ≤30 lines, heavy content → file or PR comment. Scaffold IMPL briefs with `pnpm dispatch:brief <issue-N>`.
2. Model routing: mechanical fan-out → `ds-explorer` (Sonnet, read-only); judgment (review, architecture, implementation, spec work) → Opus (`ds-implementer` / `ds-reviewer` / `general-purpose` with EXPLICIT `model: opus` on every dispatch) — inheriting the session model is forbidden, and Fable is never a subagent model.
3. Browser payloads are dispatched — interactive Playwright runs inside a subagent, not the lead (`.claude/rules/dev-stand.md`).
4. Lead-only tools are never delegated: a tool absent from the subagent environment (DesignSync, …) the lead runs itself BEFORE dispatch, handing the subagent only the mechanical follow-on — dead-ending there is a guaranteed block.
5. Briefs in English; RU only where the RU string is itself the artifact. User-facing replies stay RU.
6. Background dispatches are checkpointed and probed with `pnpm dispatch:probe <N>` (STILL-CLEAN ≈10 min in ⇒ kill + re-dispatch on a tighter brief), never by "waiting for the notification"; owner-facing status names observed artifacts only (commit / PR # / verdict), downstream steps are phrased as plan, and every impl brief carries the dispatch-brief checklist heading (memory `feedback_orchestration_brief_full_lint_before_pr`). Any wait on CI or a workflow run follows the shared-token poller rules in skill `merge-when-green` Step 1.
7. Context budget hook: subagent ≥150K → ROTATE (checkpoint + fresh dispatch), ≥200K → tools denied except git/checkpoint; dispatch impl via `ds-implementer` (Opus, maxTurns 120).

## On-demand pointers

`.claude/rules/*.md` do NOT auto-load — `Read` the file the AGENTS.md §0 index names before the gated action. Pull on demand: UI construction — AGENTS.md §6 + skill `build-ui-from-design-system` + ADR-0013; engineering-readiness defaults (Coolify, Caddy, GlitchTip, Loki/Prometheus/Tempo, Vault, Unleash, Beget DNS) — [engineering-readiness spec](./apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md).
