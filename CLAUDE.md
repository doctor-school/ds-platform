# CLAUDE.md — Claude Code overlay for DS Platform

All conventions in [`AGENTS.md`](./AGENTS.md) apply. This file extends with Claude Code-specific tooling.

---

## SessionStart hook

The `.claude/settings.json` SessionStart hook runs `pnpm bootstrap` automatically. Output appears in `additionalContext` for every fresh session — git state, open Issues/PRs, active spec(s), and a recommended next step.

No need to manually run `git log` or `gh issue list` at session start — bootstrap provides the live snapshot.

The `pnpm bootstrap` alias (defined in root `package.json` as `tsx tools/agent-bootstrap.ts`) avoids PATH-resolution issues with the `tsx` binary in different shell contexts.

---

## Tool priority

1. **`gh` CLI** — primary for GitHub Issues, PRs, releases. JSON output (`gh ... --json ...`) is AI-friendly.
2. **MCP `mcp__plugin_github_github__*`** — only for read-tasks that `gh` doesn't cover (rare).
3. **`pp-plane` CLI** — for cross-tracker references only (e.g., linking a Plane DSO-XXX milestone from an ADR or commit message). **Not for code-level Issues.**

---

## Plane vs GitHub Issues split (ADR-0006 §9)

- **DS Platform code-level tasks** → GitHub Issues in this repo (`gh issue ...`)
- **BBM strategic / cross-team milestones** → Plane workspace `doctor-school` (projects DSP / DSC / DSM / DSO)

**Do not invoke `pp-plane` CLI for code tasks** — duplicate sources of truth break AI reasoning. The BBM repo (`bbm/CLAUDE.md`) has the opposite default ("pp-plane first") because its scope is strategic-only.

---

## Skill priorities

For DS Platform feature work, invoke these `superpowers:*` skills (and the built-in `/review` skill where noted). Listed in approximate order of when they appear in the 8-step cycle:

- `superpowers:brainstorming` — required before any creative work (new feature spec, ADR, design decision)
- `superpowers:writing-plans` — when a spec / ADR is ready and you have a multi-step implementation
- `superpowers:using-git-worktrees` — for feature isolation from the current workspace
- `superpowers:test-driven-development` — before writing any production code (Step 3 RED)
- `superpowers:systematic-debugging` — before proposing any bug fix
- `superpowers:executing-plans` — for executing a written implementation plan in a separate session
- `superpowers:subagent-driven-development` — for orchestrating implementation across subagents
- `superpowers:dispatching-parallel-agents` — for ≥2 independent tasks
- `superpowers:verification-before-completion` — before claiming work done / before merge
- `superpowers:requesting-code-review` — at PR open (mode (a) review dispatch — see AGENTS.md §4)
- `superpowers:receiving-code-review` — when review feedback arrives
- `superpowers:finishing-a-development-branch` — at branch completion

---

## Engineering-readiness reference

Runtime / operational tooling defaults (Coolify, Caddy, GlitchTip, Loki + Prometheus + Tempo, Vault, Unleash, Beget DNS) live in the [engineering-readiness spec][es] in `bbm`.

[es]: https://github.com/sidorovanthon/bbm/blob/main/docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-en.md

---

## Local dev environment

Compose stack for Postgres / Redis / etc. → `infra/dev-stand/` (when DSP-150 lands; not yet implemented). See the [local-dev-environment setup-design spec][lds] in `bbm`.

[lds]: https://github.com/sidorovanthon/bbm/blob/main/docs/superpowers/specs/2026-05-18-ds-platform-local-dev-environment-setup-design-en.md
