@AGENTS.md

# CLAUDE.md — Claude Code bindings

Read [portable agent discipline](apps/docs/content/agent-discipline.md) at entry/after compaction. All shared rules live there and in AGENTS.md; Codex does not import this overlay.

## Runtime and context

`.claude/settings.json` supplies `pnpm bootstrap` via SessionStart `additionalContext`; it is a derived snapshot, not board ground truth. Hook diagnostics live in `tools/hooks/README.md`.

`/wrap` is owner-entered only. Claude `context-budget` advisory and `lead-context-budget` dispatch tiers are 120K/160K. The owner-only `.claude/lead-budget-override` is removed by wrap. Child hooks request ROTATE at 150K and deny non-git tools at 200K; rotate before rework when the actual lagging notification usage reaches 120K. These constants are Claude-specific; Codex uses observed effective input/window bands in portable discipline.

## Dispatch

Claude judgment/implementation: `ds-implementer` / `ds-reviewer` with Opus; scout/closeout: `ds-explorer` / `ds-lander` with Sonnet. A general-purpose fallback receives the same contract and supported model. Review requires shell/gh access; never assume `feature-dev:code-reviewer` has it.

`Workflow` fan-out is owner-opt-in after a bounded shape/cost proposal. Reconcile synthesis against every seed; use ordinary orchestration when adaptive work or lifecycle gates require it. Vendor packs remain disabled.

## Auto-memory

Claude uses `~/.claude/projects/<project>/memory/`: MEMORY.md is an English index (first 200 lines /25 KB loaded), topics on demand; RU only for verbatim artifacts. Promote hard rules to the repo. Apply active memory permissions and the approved wrap subset; never route Codex memory here.
