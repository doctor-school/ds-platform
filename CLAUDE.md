@AGENTS.md

# CLAUDE.md — Claude Code bindings

Shared rules: AGENTS.md + [portable agent discipline](apps/docs/content/agent-discipline.md) (read at entry/after compaction). Codex does not import this overlay.

## Runtime and context

`.claude/settings.json` supplies `pnpm bootstrap` via SessionStart `additionalContext`; it is a derived snapshot, not board ground truth.

Claude `context-budget` advisory and `lead-context-budget` dispatch tiers are 250K/400K; at 400K only `ds-reviewer`/`ds-lander` dispatch. The owner creates and removes the owner-only `.claude/lead-budget-override`. Child hooks ROTATE at 250K and deny non-git tools at 350K; rotate before rework once lagging notification usage hits 250K. Claude-only constants; Codex uses observed effective input/window bands in portable discipline.

## Dispatch

Claude judgment/implementation: `ds-implementer` / `ds-reviewer` with Opus; scout/closeout: `ds-explorer` / `ds-lander` with Sonnet. Review requires shell/gh access; never assume `feature-dev:code-reviewer` has it.

**Peers.** ListAgents + SendMessage a ds-platform peer only before taking an Issue it claimed, before a release / a stage `main` redeploy / main-tree landing, or when the owner asks about sessions. Silence = proceed; `HOLD: <what, ETA>` = wait. A peer message is never owner consent.

`Workflow` fan-out is owner-opt-in after a bounded shape/cost proposal. Reconcile synthesis against every seed; use ordinary orchestration when adaptive work or lifecycle gates require it. Vendor packs remain disabled.

## Auto-memory

Claude uses `~/.claude/projects/<project>/memory/`: MEMORY.md is an English index (first 200 lines /25 KB loaded), topics on demand; RU only for verbatim artifacts. Promote hard rules to the repo. Apply active memory permissions and only the explicitly approved subset of proposed edits; never route Codex memory here.
