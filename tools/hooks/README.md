# Agent lifecycle hooks

Shared bare-Node guards serve Claude Code and Codex. `.codex/hooks.json` invokes `run-project-hook.mjs`, which supplies a Codex adapter marker, forwards exact input, preserves blocking decisions, and records bounded execution metadata. Claude settings continue to invoke the shared guards directly.

The [official Codex hooks contract](https://learn.chatgpt.com/docs/hooks) was checked on 2026-09-06: shell/unified exec becomes `Bash` with `tool_input.command`; patches become `apply_patch` with `tool_input.command`; `spawn_agent` also matches `Agent`. Freeform strings and `{patch}` are defensive adapters, not claimed observed host shapes. Codex subagent hooks share the parent `session_id`. Transcript format is explicitly unstable.

| Control            | Behavior                                                                                                                                                                                  | Limits                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree isolation | Patch add/update/delete/move targets; Claude file writes; recognized literal shell writers; actual registered git roots and real ancestors/junctions; unparseable relevant mutations deny | Other programs, package scripts, aliases, arbitrary interpreters and interactive stdin are not exhaustively parsed; this is not a sandbox |
| Dispatch warning   | Per-actor lead mutation streak; separate child identity; registered arbitrary worktree roots exempt                                                                                       | Shell/program writes are outside the mutation counter                                                                                     |
| Lead budget        | Claude 120K warning /160K dispatch fence; Codex current input/effective window 70% warning /85% dispatch fence                                                                            | Missing or stale telemetry reports unavailable; only new dispatch is fenced                                                               |
| Child budget       | Claude 150K rotation /200K fence; Codex 70% checkpoint /85% fence; git and own checkpoint recovery                                                                                        | Codex transcript identity must match the child; absent child id or own transcript cannot enforce its token cap                            |
| Owner wrap         | Recognized wrap skill reads/dispatches require an owner `/wrap` event; missing authorization denies                                                                                       | No arbitrary command-language intent analysis; legacy Claude child exemption retained                                                     |
| Session activity   | Recent Claude and Codex logs, registered arbitrary worktree locations, bounded metadata reads                                                                                             | File activity is a conservative concurrency signal, not process liveness; scan truncation/unreadable metadata warns                       |

Codex ratios reserve 30%/15% headroom by project policy, not an OpenAI guarantee. Cached input is already included in Codex input tokens. Lifetime cumulative totals are never used. Codex ratio enforcement requires a positive effective window and a token event timestamp no older than 30 minutes; stale or absent values remain unavailable. Current Claude usage accounting is unchanged. Hooks cannot verify undocumented host identity/telemetry fields; the operator follows shared wave/rotation rules when readings are absent.

## Configuration, trust, and observed execution

Run `pnpm agent:doctor` from the checkout. It reads configuration and privacy-minimized local observations, without changing trust or settings:

- **Configured:** event matchers and commands in this checkout.
- **Trusted:** unknown unless the owner inspects the target host's `/hooks` UI. Project-layer trust and exact-definition hook trust are host-owned. Changes require review again; a local JSON file is not evidence of persisted trust.
- **Observed:** recent command executions with the current configuration/script fingerprint. Synthetic invocation can also write such logs, so these do not attest to a live host. No command arguments, prompts, transcript bodies, or tool output are recorded. Files live in gitignored `.claude/hook-observations/`, at most 1 MB per actor; diagnostics read at most 100 files and only count the last 24 hours.

Local hook coverage is host-specific. Hosted tools do not use the documented local hook path, some specialized tools can opt out, and `write_stdin` does not receive a new PreToolUse check. `functions.exec` and its nested tools must be observed in the active host before asserting enforcement or bypass. The broad child-hook registration records names even when no child budget can be measured. `followup_task` can start a turn on an existing child: recognized wrap requests there use the owner-wrap guard, while ordinary completion/rework remains allowed by the lead dispatch fence. Child-budget enforcement still needs that child's own telemetry; runtime mapping of `collaboration.followup_task` and `send_message` remains unobserved.

## Safe runtime smoke

After landing, restart Codex in the **project checkout**, trust the project layer if prompted, and use `/hooks` to review/trust the updated project definitions. Then run `pnpm agent:smoke --project`. This starts a bounded fresh CLI session requesting exactly one read-only `git status --short`; it does not change hook trust, permission settings, or global config. Logs/report go to a new temp directory. A 90-second process timeout bounds the attempt. No subagent, app, stand, database, or production command is requested.

`pnpm agent:smoke --prepare` and `--run <fixture>` also support development fixtures. They copy the unchanged PreToolUse/prompt guards into a new temp git repo and omit bootstrap (which needs monorepo dependencies). They **do not prove project hook activation** and should not require an extra owner trust ceremony. Prefer the project smoke for final verification. No smoke uses a hook-trust bypass.

Observed on 2026-09-06, `codex-cli 0.153.4`: a fresh **same-project** session `01a074e9-8b0a-7a80-9797-61c09e4ad322` against main `b5257af9` completed exactly one read-only `git status --short`, exit 0. The smoke recorded **SessionStart/bootstrap only**: no PreToolUse/tool observations or denials; stderr was empty. Project and exact-definition trust remain unknown, and mutation/dispatch guard activation is not established. The owner still needs to review/trust the updated project definitions in `/hooks`; the agent then repeats the same-project smoke in a fresh session and reports the observed coverage. A prior fresh fixture session `01a074c1-6bf0-7b42-b8a0-409f5573097f` completed its command with no hook observations. Neither fixture results nor synthetic regression tests prove project activation.

## Verification

```powershell
pnpm --filter @ds/api exec vitest run --root ../../tools/lint/guard-tests --config ../../tools/lint/guard-tests/vitest.config.ts codex-lifecycle codex-capabilities codex-agent-mode lead-context-budget subagent-context-budget wrap-owner-only dispatch-guard worktree-path-guard agent-bootstrap-concurrency
pnpm lint
pnpm pr:preflight --static
```

Regression cases cover malformed mutations, rename destinations, real arbitrary git worktrees, junction escapes, negative wrap authorization, ratio boundaries/cache accounting/stale readings, child transcript ownership, and mixed-harness metadata. Changes to configured commands require a fresh host review; passing these tests does not establish trust or tool-path coverage.
