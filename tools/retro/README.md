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

| Script                   | Produces (in `<out-dir>`)                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `extract.mjs`            | `sessions/<id>.json`, `index.json`, `summary.json`, `corrections.json`                    |
| `transcripts.mjs`        | `transcripts/<id>.md`, `self-catches.json`                                                |
| `orchestration-mine.mjs` | `orchestration-metrics.json`, `orchestration-episodes.json`, `orchestration-summary.json` |

`extract.mjs` isolates interactive sessions (excludes `promptSource: sdk`
runs), pulls the real human input, and flags correction / pushback messages.
Human input is read from **two** channels: typed user turns, and
**`AskUserQuestion` answers** — the user's free-text "Other" answers and the
notes they attach to a selection (`source: "askuserquestion"` on the digest
message). Those answers live in a `tool_result` envelope the typed-message path
skips, yet a decision/collision session's decisive correction often lands
exactly there, so scanning only typed turns under-counts corrections (the #345
miss: `corrections: 0` for a session whose defining moment was an AUQ answer).
The question text is the assistant's and is never scanned. `transcripts.mjs`
reads the `index.json` it wrote and builds a
compact per-session transcript (user text + assistant text + tool-call trace,
dropping bulky `tool_result` payloads) plus an assistant self-correction list.

`orchestration-mine.mjs` (#916) is the orchestration-metrics miner: it consumes
the `index.json` `extract.mjs` wrote and, over the **whole** interactive corpus,
derives per-session orchestration metrics — `Agent`/`Task` **dispatches**, lead
inline `Edit`/`Write` **mutations**, the deliverable-only **inline:dispatch
ratio**, **context-at-wrap** tokens, and **PRs touched** — auto-classifies every
inline-decision episode into one of five documented causes, and detects
**parallel overlap** from session timestamps. It is FULL-CORPUS only (no
`--session` mode) and refuses a single-session `index.json` so a corpus-wide
number is never computed off a partial run. See _Orchestration mining_ below.

Run `extract.mjs` **first** — `transcripts.mjs` and `orchestration-mine.mjs`
both depend on its `index.json`.

## Usage

```bash
# Batch mode — the whole auto-memory log corpus (the historical-audit case):
node tools/retro/extract.mjs
node tools/retro/transcripts.mjs

# Orchestration metrics — full corpus (after a BATCH extract.mjs run):
node tools/retro/orchestration-mine.mjs

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
  for batch mode over the whole corpus. (`orchestration-mine.mjs` has **no**
  `--session` mode — it is full-corpus only.)
- `--help`, `-h` — usage.

## Orchestration mining

`orchestration-mine.mjs` (#916) widens the #700 first-pass orchestration retro
(which sampled only 50 of ~361 sessions, hand-recovered 3 inline episodes, and
verified parallel overlap for 4 sessions) into a defensible, reproducible
measurement over the whole corpus.

**Per-session metrics** (`orchestration-metrics.json`, one row per interactive
lead session):

- `dispatches` — `Agent`/`Task` tool-calls (subagent hand-offs).
- `inline` — all lead-context `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls.
- `deliverableInline` — the subset that edit a **repo source** file. A brief
  written to the scratchpad or a memory file (both **outside** the repo) is
  orchestration bookkeeping, not a dispatchable deliverable — ~79% of raw inline
  mutations in the corpus are exactly these, so counting them all (as #700 did)
  inflates the inline:dispatch signal. The deliverable subset is the honest one.
- `ratio` — `deliverableInline ÷ dispatches` (null when zero dispatches).
- `contextAtWrap` — the last assistant message's `input + cache_read +
cache_creation` tokens (proxy for context size at wrap).
- `prs` — PR numbers touched, mined from adjacent `gh pr <verb> <N>` calls and
  `/pull/<N>` URLs (bare `#N` is skipped — it collides with Issue numbers).
- `parallelOverlap` — ids of sessions whose `[firstTs,lastTs]` interval
  intersects this one's (timestamp-based, replacing #700's same-message
  heuristic).

**Inline-decision episodes** (`orchestration-episodes.json`): the reasoning text
immediately preceding each inline `Edit`/`Write` **run** (consecutive edits
separated only by tool-results collapse into one episode), bucketed into exactly
five causes, most-specific first: `sanctioned-carve-out` (a scratch/memory/tmp
target, or a reasoning citation of an allowed inline path) → `dispatch-abandoned`
(a dispatch was attempted and failed / overloaded / timed out) →
`brief-cost-aversion` (inline because a brief "isn't worth it") →
`retrieved-but-rationalized` (the dispatch rule is named, then argued away) →
`rule-not-retrieved` (the residual default: a deliverable edited inline with no
trace of the rule). The lexicons are bilingual (RU+EN), precision-tuned, and
exported behind the entry-point guard, unit-covered in
`tools/lint/guard-tests/retro-orchestration-mine.spec.ts`.

**Corpus health** (`orchestration-summary.json` → `corpusHealth`, echoed as a
run-output line): `{ totalLogFiles, mined, skippedCorrupt }` — the miner scans
every `*.jsonl` in the log dir and counts the **NUL-corrupt / unparseable** files
(non-empty on disk yet zero parseable JSONL records — an FS-corruption incident)
it skips, so the mined `N` is always reported against the true denominator rather
than reading as "N of a healthy corpus" when a chunk of it is destroyed.

## Sample output

[`samples/findings-all.json`](./samples/findings-all.json) is the 84-finding
dataset from the Phase-A audit (2026-05-20 → 2026-06-18, 65 interactive
sessions). It is the **reference for the finding schema** (documented in the
SKILL.md) and a regression fixture — its records validate against that schema.

[`samples/orchestration-sample.json`](./samples/orchestration-sample.json) is a
**trimmed** regression fixture for `orchestration-mine.mjs` — the full-corpus
`orchestration-summary.json` plus a representative slice of metric rows and
classified episodes (quotes truncated to 120 chars, overlap lists to 3 ids). It
is a representative slice, **not** the full corpus dump: raw transcript content
stays out of the repo (CLAUDE.md #534). Regenerate the underlying artifacts with
a batch `extract.mjs` run followed by `orchestration-mine.mjs`.

## Notes

- The scripts are dependency-free Node ESM (`.mjs`); no build step.
- They are read-only over the logs and idempotent over `<out-dir>`.
- The correction heuristic is bilingual (RU + EN); see `CORRECTION_RE` in
  `extract.mjs` and `SELF_CATCH` in `transcripts.mjs`. Both lexicons are tuned
  for precision over recall — add a token only when it catches real pushback in
  the live corpus with no benign false positives (the #362 audit rejected bare
  «давай …», «лучше», «слишком», «исправл» on exactly those grounds). A stem that
  would otherwise flood mid-word is Cyrillic-anchored with a lookbehind, not `\b`
  (ASCII-only under JS regex without the `u` flag): `исключ…` (#362) and
  `(?<![а-яё])пуст…` (#492, the empty-inbox delivery-failure predicate) both do
  this. Where a corrective form is lexically identical to benign technical talk
  («пустой массив» vs «ящик пустой») and the benign form is absent from the live
  corpus, the residual collision is an accepted recall-over-precision tradeoff —
  `CORRECTION_RE` is a recall net a retro agent reviews, and its false negative
  (an owner delivery-refutation silently dropped from the multi-session corpus)
  costs more than a rare false positive. Both regexes are exported behind an
  entry-point guard and unit-covered in
  `tools/lint/guard-tests/retro-extract.spec.ts`.
