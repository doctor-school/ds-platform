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

For DS Platform project work, the catalog is **`apps/docs/content/skills/<name>/SKILL.md`** — see AGENTS.md §3 (Work protocol). The lead agent identifies task kind, cites the entry point, then `Read`s the corresponding SKILL.md.

**Single allowed `superpowers:*` exception:** `superpowers:brainstorming` — only for spec-authoring (new feature-spec, new ADR, new design-spec). After brainstorming concludes, do **not** chain into `superpowers:writing-plans` — the SDD triplet (`requirements.md` / `design.md` / `scenarios.feature`) is the plan.

**All other `superpowers:*` chains are disallowed for project work**, including (non-exhaustive): `writing-plans`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch`, `using-git-worktrees`. Their procedures are absorbed by the project skill catalog (e.g., TDD lives inside `do-feature-iteration/SKILL.md`; review dispatch lives inside `request-mode-a-review/SKILL.md`). They may be referenced as implementation patterns inside SKILL.md content, but never as the orchestrator.

---

## Engineering-readiness reference

Runtime / operational tooling defaults (Coolify, Caddy, GlitchTip, Loki + Prometheus + Tempo, Vault, Unleash, Beget DNS) live in the [engineering-readiness spec][es] in `bbm`.

[es]: https://github.com/sidorovanthon/bbm/blob/main/docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-en.md

---

## Local dev environment

Compose stack for Postgres / Redis / etc. → `infra/dev-stand/` (when DSP-150 lands; not yet implemented). See the [local-dev-environment setup-design spec][lds] in `bbm`.

[lds]: https://github.com/sidorovanthon/bbm/blob/main/docs/superpowers/specs/2026-05-18-ds-platform-local-dev-environment-setup-design-en.md
