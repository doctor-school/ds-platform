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

Canon: AGENTS.md §3 + §3.4. Project work uses the catalog `apps/docs/content/skills/<name>/SKILL.md` — identify kind → cite entry point → `Read` the SKILL.md. Because `superpowers:*` skills are auto-discoverable here: **only `superpowers:brainstorming` is allowed**, and only as the step-2 vehicle inside `author-feature-spec` (the spec-authoring orchestrator), never as the orchestrator itself; it must **not** chain into `writing-plans` (the SDD triplet is the plan). Every other `superpowers:*` skill (`executing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `finishing-a-development-branch`, …) is disallowed as an orchestrator — its procedure is already absorbed by the project catalog (TDD inside `do-feature-iteration`, review dispatch inside `request-mode-a-review`).

**Orchestration is the default execution mode.** Execution work — code, edits, migrations — is dispatched to subagents **by default** (the lead supervises; recon + scope framing may stay inline); inline execution by the lead is the exception, taken only after the owner explicitly confirms it for a given task. This holds unconditionally — it is **not** gated on an «оркеструй» / "orchestrate" directive, and its absence never licenses inline execution. When such a directive _is_ present it only escalates to the full `orchestrating-coding-agents` skill and/or confirms scope. Canon: AGENTS.md §6; memory `feedback_orchestrate_by_default_feature_completion`.

## Blocked-on-owner handback

Работа заблокирована ТОЛЬКО действием владельца → последняя видимая строка хода: `⏸ ЖДУ ВАС: <одно действие>; после него продолжу автономно`; поллер/wakeup — после неё, не вместо. Каждый вынесенный владельцу вопрос — самодостаточная plain-language строка (что / почему / что изменит ответ), без жаргонных отсылок к отчёту (memory `feedback_explicit_handback_when_owner_blocked`).

## PR-review subagent (Mode a)

`feature-dev:code-reviewer` has no Bash/`gh`. Dispatch the project agent **`ds-reviewer`** (`.claude/agents/ds-reviewer.md` — Opus, read-only + `gh`) so it can `gh pr diff` a branch not in the working tree; `general-purpose` (Opus) is the fallback if project agents are unavailable (memory `feedback_pr_review_subagent_needs_gh`).

## Subagent context economy (#534)

A subagent's final message lands in the lead's context and is re-read until session end — that, not dispatch count, is what burns the limit. Five rules:

1. **Return contract in every brief.** Every subagent brief ends with a return contract: final message = verdict / diff summary / artifact paths, **≤30 lines**; heavy content (full reports, exploration transcripts, DOM dumps) goes to a file or PR comment, never into the reply.
2. **Model routing.** Mechanical fan-out (find/enumerate/collect) goes to **`ds-explorer`** (`.claude/agents/`, Sonnet, read-only); judgment work (Mode-a review, architecture) stays on Opus (`ds-reviewer` / `general-purpose`).
3. **Browser payloads are dispatched.** Interactive Playwright browsing during orchestration runs inside a subagent, not the lead — rule in `.claude/rules/dev-stand.md`.
4. **Lead-only tools are never delegated.** A tool absent from the subagent environment (DesignSync, etc.) the lead runs itself **before** dispatch — vendoring canvases into `design-source/` is the lead's first step; the subagent gets only the mechanical follow-on (README, refs, PR). Dispatching a task that dead-ends on a lead-only tool = a guaranteed block plus its bytes pumped through the lead's context anyway (session e2e357ff, ~300K).
5. **Briefs in English.** Subagent briefs are authored in English (token economy + model comprehension) even when the owner chat is Russian; RU appears only where the RU string is itself the artifact (owner quotes, UI copy). User-facing replies stay RU (memory `feedback_subagent_briefs_in_english`).

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
