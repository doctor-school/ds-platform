# tools/retro — agent-workflow retro extractor

Session-log analysis tooling for the agent-workflow retrospective + feedback
loop (epic [#247](https://github.com/doctor-school/ds-platform/issues/247),
child [#248](https://github.com/doctor-school/ds-platform/issues/248)).
These two Node scripts turn raw Claude Code session logs into a compact,
reviewable corpus that the [`run-session-retro`](../../apps/docs/content/skills/run-session-retro/SKILL.md)
skill (and the `/wrap` command, #B1) consume to produce **deviation findings**.

The methodology and the finding schema are documented in the SKILL.md; this
README covers only how to run the tools.

## Scripts

| Script            | Produces (in `<out-dir>`)                                              |
| ----------------- | ---------------------------------------------------------------------- |
| `extract.mjs`     | `sessions/<id>.json`, `index.json`, `summary.json`, `corrections.json` |
| `transcripts.mjs` | `transcripts/<id>.md`, `self-catches.json`                             |

`extract.mjs` isolates interactive sessions (excludes `promptSource: sdk`
runs), pulls the real human-typed messages, and flags correction / pushback
messages. `transcripts.mjs` reads the `index.json` it wrote and builds a
compact per-session transcript (user text + assistant text + tool-call trace,
dropping bulky `tool_result` payloads) plus an assistant self-correction list.

Run `extract.mjs` **first** — `transcripts.mjs` depends on its `index.json`.

## Usage

```bash
# Batch mode — the whole auto-memory log corpus (the historical-audit case):
node tools/retro/extract.mjs
node tools/retro/transcripts.mjs

# Single-session mode — one log id (the /wrap case):
node tools/retro/extract.mjs     --session <session-id>
node tools/retro/transcripts.mjs --session <session-id>

# Explicit dirs / help:
node tools/retro/extract.mjs --log-dir <dir> --out-dir <dir>
node tools/retro/extract.mjs --help
```

### Options (both scripts)

- `--log-dir <dir>` — directory of `*.jsonl` session logs. **Default:** the
  auto-memory project dir `~/.claude/projects/<repo-slug>/`, derived from the
  repo-root path with separators replaced by `-` — the same convention
  `tools/lint/instruction-budget-lint.ts` uses to locate `MEMORY.md`.
- `--out-dir <dir>` — where digests are written. **Default:** `<repo>/.audit-tmp`,
  which is gitignored. (The Phase-A audit scratch lives there and is left
  untouched by these graduated tools.)
- `--session <id>` — single-session mode: process only that one log id. Omit
  for batch mode over the whole corpus.
- `--help`, `-h` — usage.

## Sample output

[`samples/findings-all.json`](./samples/findings-all.json) is the 84-finding
dataset from the Phase-A audit (2026-05-20 → 2026-06-18, 65 interactive
sessions). It is the **reference for the finding schema** (documented in the
SKILL.md) and a regression fixture — its records validate against that schema.

## Notes

- The scripts are dependency-free Node ESM (`.mjs`); no build step.
- They are read-only over the logs and idempotent over `<out-dir>`.
- The correction heuristic is bilingual (RU + EN); see `CORRECTION_RE` in
  `extract.mjs` and `SELF_CATCH` in `transcripts.mjs`.
