# tools/retro — agent-workflow retro extractor

Session-log analysis tooling for the agent-workflow retrospective + feedback
loop (epic [#247](https://github.com/doctor-school/ds-platform/issues/247),
child [#248](https://github.com/doctor-school/ds-platform/issues/248)).
The Node entry points turn Claude Code session logs or Codex rollout artifacts
into a compact, explicitly labelled corpus that the
[`run-session-retro`](../../apps/docs/content/skills/run-session-retro/SKILL.md)
skill (and the wrap loop, #B1) consume to produce **deviation findings**.

The methodology and the finding schema are documented in the SKILL.md; this
README covers only how to run the tools.

## Scripts

| Script                   | Produces (in `<out-dir>`)                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `extract.mjs`            | `sessions/<id>.json`, `index.json`, `summary.json`, `corrections.json`                                        |
| `transcripts.mjs`        | `transcripts/<id>.md`, `self-catches.json`                                                                    |
| `codex.mjs`              | All single-session corpus files above + `portable/<id>.json` (`ds-platform-retro/v2`; accepts v1 inputs)      |
| `codex-rollout.mjs`      | Shared read-only Codex metadata and token telemetry boundary (imported by adapter and ledger)                 |
| `orchestration-mine.mjs` | `orchestration-metrics.json`, `orchestration-episodes.json`, `orchestration-summary.json`                     |
| `token-ledger.mjs`       | stdout ledger: lead + per-subagent peak ctx / turns / cache-read / est \$ + `FLAG` rows (`pnpm retro:tokens`) |

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

# Token ledger — where a session's tokens/dollars went (lead vs subagents):
pnpm retro:tokens <session-id>
pnpm retro:tokens --since 2026-08-10
pnpm retro:tokens --harness codex <session-id>
pnpm retro:tokens --harness codex --since 2026-09-06
pnpm retro:tokens --rollout <rollout.jsonl> --log-dir <sessions-root>

# Codex single-session mode (raw rollout is normalized, never treated as Claude):
node tools/retro/codex.mjs --session <session-id>
# Explicit alternatives:
node tools/retro/codex.mjs --rollout <rollout.jsonl>
node tools/retro/codex.mjs --portable-input <portable.json>

# Explicit dirs / help:
node tools/retro/extract.mjs --log-dir <dir> --out-dir <dir>
node tools/retro/extract.mjs --help
```

### Claude extractor options

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

### Codex adapter options

- `--session <id>` — recursively resolve the rollout under
  `$CODEX_HOME/sessions`, falling back to `~/.codex/sessions`.
- `--rollout <file>` — use an explicitly selected raw Codex rollout.
- `--portable-input <file>` — use a pre-normalized
  `ds-platform-retro/v1` or `ds-platform-retro/v2` record with `harness: codex`.
- `--out-dir <dir>` / `--help` — same output/help conventions as above.

The Codex transcript format is not used as a stable downstream interface:
`codex.mjs` owns that harness boundary and writes the versioned portable record.
Subagent rollouts are labelled `sdk` even when their forked history contains a
copied user turn, so the independent retro agent cannot mistake itself for the
interactive owner session.

### Portable schema evolution

New raw-rollout conversions emit **`ds-platform-retro/v2`**. Existing v1
portable inputs remain accepted and retain their version; missing v2 evidence
is never synthesized. Both versions retain the session metadata and ordered
`events` array. v2 adds parent thread/history metadata, tool `namespace`,
`callId`, `status`, `evidence`, `exitCode`, collaboration recipients/states and
`role: subagent` activity records. Downstream readers must tolerate added fields
and roles; v1-only consumers must explicitly upgrade before consuming v2.

`response_item` function/custom calls have `evidence: call` and initially
`status: requested`. A `functions.exec` program remains one tool request:
JavaScript mentioning inner tools does **not** prove they executed.
`event_msg.item_completed.item` records with `type: CommandExecution`,
`SubAgentActivity` and `CollabAgentToolCall` supply actual execution/activity
evidence. A matching call ID enriches the original call instead of counting it
twice. Command summaries preserve command, cwd, status and exit code; bulky
stdout/stderr remain in the original rollout. Mirrored UserMessage/AgentMessage
records are paired one-for-one with response-item messages so repeated owner
turns are retained without double-counting the two channels.

Owner answers from **matched** `request_user_input` tool outputs become user
events with `source: request_user_input`, `callId` and
`evidence: submitted_answers`. The supported shape is an `answers` object whose
values contain string `answers` arrays. Question text, suggested options,
unmatched outputs and pending/default receipts never become owner evidence.
Async answers additionally require `submitted: true` or an explicit
`submitted`/`answered` status. A returned `request_id` can correlate a later
explicit `request_user_input_response` envelope. That envelope is a tested
compatibility input, **not an observed universal host format**; unsupported
host answer envelopes must remain unknown or be supplied through an explicitly
provenanced portable user event. Ordinary user messages continue to work.

### Token ledger accounting

The existing positional command defaults to Claude; choose `--harness codex`
for a Codex session ID or `--rollout <file>` for a single explicit Codex file.
`--log-dir` overrides the session search root for either harness.
`CODEX_HOME` applies to both the ledger and the Codex corpus adapter.
Codex `--since` selects root logs by modification date and reports each tree;
it does not produce cross-session orchestration aggregates.

- **Claude:** streamed repeats of the same message ID retain the last usage.
  Context is input + cache creation + cache read. The historical #1374 family
  price constants are preserved as estimates, not current prices or billing.
  Unknown model families have no price. Missing counters propagate as `null`
  in analysis and `UNKNOWN` in the ledger instead of becoming zero.
- **Codex:** `event_msg.token_count.info.total_token_usage` is cumulative.
  Repeated snapshots are not summed; the final snapshot supplies session usage.
  Input already includes cached input; reasoning is a subset of output. Peak
  observed context is `last_token_usage.input_tokens`, without adding cache.
  The model context window is reported separately. `turns` counts observed
  distinct cumulative snapshots, not guaranteed complete user or model turns.
  A counter reset makes the usage total unknown. Codex cost is always unknown
  because this tool has no verified Codex price table.
- **Children:** discover recursively via
  `session_meta.source.subagent.thread_spawn.parent_thread_id`, including each
  child's usage and context. Discovery reads bounded metadata prefixes (64 KiB)
  and only loads full transcripts for the selected tree. Duplicate logs are
  deduplicated by thread ID. Records older than the child's session timestamp
  are excluded; where an inherited cumulative baseline exists, report its
  delta. Without a reliable baseline/boundary, flag the attribution ambiguity
  explicitly. Missing/archived/unavailable logs cannot be counted; the report
  names its discovery root and does not claim corpus completeness.

These are observational reports, not budget enforcement or proof of billing.
The existing 200K child / 300K lead peak flags remain advisory. Synthetic,
privacy-safe regressions cover both harnesses in
`tools/lint/guard-tests/retro-token-ledger.spec.ts` and `codex-retro.spec.ts`.

## Orchestration mining

The full-corpus miner remains **Claude-only**. A Codex single-session corpus or
token ledger is not a supported input for cross-session orchestration metrics;
do not present a partial tree as a complete multi-session measurement.

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
