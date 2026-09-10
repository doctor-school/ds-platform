# Agent lifecycle hooks

Shared bare-Node guards serve Claude Code and Codex. `.codex/hooks.json` invokes `run-project-hook.mjs`, which supplies a Codex adapter marker, forwards exact input, preserves blocking decisions, and records bounded execution metadata. Claude settings continue to invoke the shared guards directly.

The [official Codex hooks contract](https://learn.chatgpt.com/docs/hooks) was checked on 2026-09-06: shell/unified exec becomes `Bash` with `tool_input.command`; patches become `apply_patch` with `tool_input.command`; `spawn_agent` also matches `Agent`. Freeform strings and `{patch}` are defensive adapters, not claimed observed host shapes. Codex subagent hooks share the parent `session_id`. Transcript format is explicitly unstable.

| Control            | Behavior                                                                                                                                                                                  | Limits                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Worktree isolation | Patch add/update/delete/move targets; Claude file writes; recognized literal shell writers; actual registered git roots and real ancestors/junctions; unparseable relevant mutations deny | Other programs, package scripts, aliases, arbitrary interpreters and interactive stdin are not exhaustively parsed; this is not a sandbox |
| Dispatch warning   | Per-actor lead mutation streak; separate child identity; registered arbitrary worktree roots exempt                                                                                       | Shell/program writes are outside the mutation counter                                                                                     |
| Lead budget        | Claude 120K warning /160K dispatch fence; Codex current input/effective window 70% warning /85% dispatch fence                                                                            | Missing or stale telemetry reports unavailable; only new dispatch is fenced                                                               |
| Child budget       | Claude 150K rotation /200K fence; Codex 70% checkpoint /85% fence; git and own checkpoint recovery                                                                                        | Codex transcript identity must match the child; absent child id or own transcript cannot enforce its token cap                            |
| Owner wrap         | Documentation reads are free; standalone retro needs an owner analysis request; full wrap needs owner `/wrap`                                                                             | No arbitrary command-language intent analysis; legacy Claude child exemption retained                                                     |
| Session activity   | Recent Claude and Codex logs, registered arbitrary worktree locations, bounded metadata reads                                                                                             | File activity is a conservative concurrency signal, not process liveness; scan truncation/unreadable metadata warns                       |

Codex ratios reserve 30%/15% headroom by project policy, not an OpenAI guarantee. Cached input is already included in Codex input tokens. Lifetime cumulative totals are never used. Codex ratio enforcement requires a positive effective window and a token event timestamp no older than 30 minutes; stale or absent values remain unavailable. Current Claude usage accounting is unchanged. Hooks cannot verify undocumented host identity/telemetry fields; the operator follows shared wave/rotation rules when readings are absent.

Workflow authorization accepts Claude owner text and Codex `event_msg/user_message` or `response_item` user `input_text`. Assistant/tool text, metadata, known injected-context wrappers and quoted examples are not consent. Documentation reads do not start a workflow. Explicit **«Проведи ретро этой сессии»** authorizes independent analysis only; **«Проведи /wrap для этой сессии.»** starts full wrap (a slash command may be unregistered). Neither authorizes memory writes or unapproved instruction edits. Missing/unreadable evidence denies recognized workflow execution. This bounded imperative grammar is not a semantic authorization engine: unrecognized wording needs manual scope reconciliation, never a claim that arbitrary shell code or natural language is fully guarded.

## Configuration, trust, and observed execution

Run `pnpm agent:doctor` from the checkout. It reads configuration and privacy-minimized local observations, without changing trust or settings:

- **Configured:** event matchers and commands in this checkout.
- **Trusted:** unknown unless the owner inspects the target host's `/hooks` UI. Project-layer trust and exact-definition hook trust are host-owned. Changes require review again; a local JSON file is not evidence of persisted trust.
- **Observed:** recent command executions with the current configuration/script fingerprint. Synthetic invocation can also write such logs, so these do not attest to a live host. No command arguments, prompts, transcript bodies, or tool output are recorded. Files live in gitignored `.claude/hook-observations/`, at most 1 MB per actor; diagnostics read at most 100 files and only count the last 24 hours.

Local hook coverage is host-specific. Hosted tools do not use the documented local hook path, some specialized tools can opt out, and `write_stdin` does not receive a new PreToolUse check. `functions.exec` and its nested tools must be observed in the active host before asserting enforcement or bypass. The broad child-hook registration records names even when no child budget can be measured. On 2026-09-07, current-host metadata recorded `collaborationspawn_agent` and `collaborationfollowup_task`. Registration and shared classification accept those compact names, the dotted API names `collaboration.spawn_agent` / `collaboration.followup_task`, and the existing short names; only these explicit aliases are normalized. `Agent` / `Task` retain their existing dispatch semantics. `followup_task` can start a turn on an existing child: recognized wrap requests there use the owner-wrap guard, while ordinary completion/rework remains allowed by the lead dispatch fence and does not reset the new-dispatch mutation counter. Messages (`send_message`) are not new dispatch or wrap initiation. Child-budget enforcement still needs that child's own telemetry; specialized paths and unobserved message mapping remain unverified. Recorded tool names alone do not prove guard denials.

## Safe configuration diagnostics

Select exact non-secret keys before stdout; never search all env values for words such as SSH or TRANSPORT. This PowerShell example emits presence only, so an unexpected value cannot leak either. Set `$configPath` to the intended file; choose values only after establishing that they are required and non-secret. This is a diagnostic recipe, not interception of arbitrary shell commands.

<!-- safe-env-presence-example -->

```powershell
$allowedKeys = @('DEV_SSH_HOST', 'DEV_REMOTE_DIR')
$present = @{}
foreach ($line in [IO.File]::ReadLines($configPath)) {
  if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=') {
    $key = $Matches[1]
    if ($allowedKeys -ccontains $key) { $present[$key] = $true }
  }
}
foreach ($key in $allowedKeys) {
  '{0}: present={1}' -f $key, $present.ContainsKey($key)
}
```

If a secret was emitted, do not repeat it in reports or trackers. Record the exposure without its value and assess revocation/rotation within owner authorization; private logs do not prove harmlessness. This recipe does not rotate an already exposed key.

## Safe runtime smoke

After landing, restart Codex in the **project checkout**, trust the project layer if prompted, and use `/hooks` to review/trust the updated project definitions. Then run `pnpm agent:smoke --project`. This starts a bounded fresh CLI session requesting exactly one read-only `git status --short`; it does not change hook trust, permission settings, or global config. Logs/report go to a new temp directory. A 90-second process timeout bounds the attempt. No subagent, app, stand, database, or production command is requested.

`pnpm agent:smoke --prepare` and `--run <fixture>` also support development fixtures. They copy the unchanged PreToolUse/prompt guards into a new temp git repo and omit bootstrap (which needs monorepo dependencies). They **do not prove project hook activation** and should not require an extra owner trust ceremony. Prefer the project smoke for final verification. No smoke uses a hook-trust bypass.

Observed on 2026-09-07, `codex-cli 0.153.4`: fresh **same-project** session `01a079e4-dd12-7ac2-8cf1-6634f619bbae` against main `a594592634eb181fd7834c87f50ee808e571ef6d` completed exactly one read-only `git status --short`, exit 0. Its own actor metadata (`.claude/hook-observations/73a698c8b7b2b6eb7deb300d.jsonl`, session field matched) records SessionStart/bootstrap with status `null` (invocation observed, completion unproven), UserPromptSubmit/context-budget with status 0, and Bash PreToolUse/worktree-path-guard, subagent-context-budget, and wrap-owner-only each with status 0. No denial was exercised. The broad doctor report aggregates other actors and is not evidence of this fresh session's coverage. Persisted project/exact-definition trust remains unknown in diagnostics; that does not negate these observed executions or by itself establish an owner blocker. Updated definitions still follow the host review procedure above. This smoke proves the listed read-only hook paths, not mutation rejection, dispatch fences, child telemetry, or every tool path. Neither fixture results nor synthetic regression tests prove project activation.

## Verification

```powershell
pnpm --filter @ds/api exec vitest run --root ../../tools/lint/guard-tests --config ../../tools/lint/guard-tests/vitest.config.ts codex-lifecycle codex-tool-aliases codex-capabilities codex-agent-mode lead-context-budget subagent-context-budget wrap-owner-only dispatch-guard worktree-path-guard agent-bootstrap-concurrency
pnpm lint
pnpm pr:preflight --static
```

Regression cases cover malformed mutations, rename destinations, real arbitrary git worktrees, junction escapes, negative wrap authorization, ratio boundaries/cache accounting/stale readings, child transcript ownership, and mixed-harness metadata. Alias regressions check actual registration plus invoked guard decisions and persisted dispatch state, including authorized wrap and ordinary followup/message exclusions. Changes to configured commands require a fresh host review; passing these tests does not establish trust or tool-path coverage.
