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

Canon: **AGENTS.md §6 (Trackers) + §8**. Code-level tasks → GitHub Issues here (`gh issue ...`); strategic / cross-team milestones → Plane workspace `doctor-school`. **Do not invoke `pp-plane` for code tasks** — duplicate sources of truth break AI reasoning; `pp-plane` is for cross-tracker references only (e.g., linking a Plane DSO-XXX milestone from an ADR or commit message).

---

## Skill priorities

Canon: **AGENTS.md §3 (Work protocol) + §3.4 superpowers whitelist**. Project work uses the catalog `apps/docs/content/skills/<name>/SKILL.md` — identify task kind → cite entry point → `Read` the SKILL.md.

**Claude-Code-specific reminder** (because these `superpowers:*` skills are auto-discoverable here): `superpowers:brainstorming` is the only one allowed, for spec-authoring only, and must **not** chain into `writing-plans` (the SDD triplet is the plan). Every other `superpowers:*` skill — `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch`, `using-git-worktrees`, … — is disallowed as an orchestrator; their procedures are absorbed by the project catalog (TDD inside `do-feature-iteration`, review dispatch inside `request-mode-a-review`). Full rule: AGENTS.md §3.4.

---

## Engineering-readiness reference

Runtime / operational tooling defaults (Coolify, Caddy, GlitchTip, Loki + Prometheus + Tempo, Vault, Unleash, Beget DNS) live in the [engineering-readiness spec][es].

[es]: ./apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md

---

## Local dev environment

Compose stack for Postgres / Redis / etc. → `infra/dev-stand/`. See the [local-dev-environment setup-design spec][lds].

[lds]: ./apps/docs/content/specs/tech/2026-05-18-local-dev-environment-setup-design-en.md

---

## UI verification (mandatory)

Any feature that can be checked in the UI MUST be verified in the **actual running UI** before it is called done: bring up the dev-stand (`infra/dev-stand/`, TrueNAS not 24/7), run api + portal locally, and drive the journey in a browser (Playwright MCP). `typecheck` + `build` + `lint` + Mode-a review are necessary but **not** sufficient — they never prove the rendered result, and live-gated E2E that does not run in CI is not a substitute. Keep the stand up by default during UI work — it is also what your own Playwright testing needs. A user-facing dev placeholder (e.g. a "set this env var" note shown to end users) is a banned stub, not an affordance — render the real thing or nothing.
