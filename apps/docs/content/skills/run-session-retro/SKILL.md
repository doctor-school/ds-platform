---
title: "run-session-retro"
description: "Procedural skill (dispatch): an independent agent analyzes a session log (or a batch of logs) for deviations from agreed rules and lost context, and returns findings in a fixed schema. The analysis engine /wrap (#B1) and any historical-audit agent invoke."
name: run-session-retro
mode: dispatch
---

# run-session-retro

**Kind:** procedural · **Mode:** dispatch (an _independent_ agent — never the
session's own author — reads the log via the `tools/retro` extractor and returns
findings in the schema below; the caller cannot self-review).

This skill is the analysis engine for epic #247's feedback-improvement loop. It
runs in two modes:

- **single session** — the `/wrap` case (#B1, blocked by this issue): analyze
  the just-finished session's own log and feed the findings into the propose →
  approve → apply-and-compact loop.
- **batch** — the historical-audit case: analyze many logs at once (the Phase-A
  audit that produced [`tools/retro/samples/findings-all.json`](../../../../../tools/retro/samples/findings-all.json),
  84 findings across 65 interactive sessions, 2026-05-20 → 2026-06-18).

The methodology below is the one **proven** in that Phase-A audit. The tooling
it relies on lives in [`tools/retro/`](../../../../../tools/retro/README.md).

---

## What a "deviation" is

A point where the agent **departed from an agreed rule** (AGENTS.md § / CLAUDE.md
/ a memory file / a spec / an ADR) or **lost settled context** across the
session or across sessions. The honest signal is the user **correcting the agent
mid-flight** — "why did you do X and not Y / how should it be done / how do we
avoid this next time" — plus the agent's own **self-catch** moments ("actually,
I should have…"). One finding = one deviation.

---

## Procedure (the dispatched agent runs this)

### 1. Build the corpus with the extractor

Run the two `tools/retro` scripts. The log dir defaults to the auto-memory
project dir; the out dir defaults to the gitignored `.audit-tmp`.

```bash
# single-session mode (the /wrap case):
node tools/retro/extract.mjs     --session <session-id> --out-dir <work-dir>
node tools/retro/transcripts.mjs --session <session-id> --out-dir <work-dir>

# batch mode (historical audit over the whole corpus):
node tools/retro/extract.mjs     --out-dir <work-dir>
node tools/retro/transcripts.mjs --out-dir <work-dir>
```

This writes, into `<work-dir>`:

- `index.json` / `summary.json` — session classification + corpus totals.
- `sessions/<id>.json` — per-session human-message digest.
- `corrections.json` — the corrections-only corpus (**the gold signal**).
- `transcripts/<id>.md` — compact transcript: `[U]` user text, `[A]` assistant
  text, `[T]` tool-call trace (name + one-field summary), with bulky
  `tool_result` payloads dropped.
- `self-catches.json` — assistant self-correction moments.

### 2. Isolation + exclusion rules (already enforced by the extractor — verify, don't re-derive)

- **Isolate interactive sessions.** A session is `interactive` only if it has at
  least one real human-typed message; `promptSource: sdk` runs (review /
  subagent automation) are classified `sdk` and **excluded**. In the audit this
  cut 197 logs down to 66 interactive sessions.
- **Real human text only.** Drop `tool_result`-only user turns, `isMeta`, and
  `isCompactSummary` entries.
- **Exclude wrappers and non-typed text:** `command-*` / `local-command`
  wrappers, `Caveat:` lines, `system-reminder` blocks, `task-notification`
  blocks, `bash-*` blocks, `API Error` / interrupt lines, and continuation
  banners.
- **Exclude handoff prompts.** A pasted handoff (starts with `You are
continuing`, `# Agent bootstrap`, or an early `Current task` heading) is a real
  message but **not** a correction — it must not inflate the correction count.

### 3. Apply the two heuristics

- **Correction heuristic** (`CORRECTION_RE` in `extract.mjs`) — a bilingual
  (RU + EN) regex over human messages: "почему / зачем / разве / опять / я
  просил / стоп …" and "why / instead / should have / you were supposed / wrong
  / again …". Flags user pushback. A handoff is never a correction.
- **Self-catch heuristic** (`SELF_CATCH` in `transcripts.mjs`) — a bilingual
  regex over **assistant** text: "actually, / wait, / I was wrong / my mistake /
  I should have / I forgot / I violated …" and "на самом деле / я ошибся / моя
  ошибка / забыл …". Flags the agent catching its own deviation.

Both heuristics are recall-first: they over-select, and the analysis step below
discards false positives. Treat a flagged message as a **candidate**, then read
the surrounding transcript to confirm a genuine deviation before emitting a
finding.

- **UI/design sessions correct via screenshots, not words.** The correction
  channel for visual work is the **annotated screenshot** — an `image-only` user
  turn with no text the `CORRECTION_RE` can ever match. `extract.mjs` now keeps
  these (flagged `imageOnly`, counted as a correction candidate), but they carry
  no quotable text, so reconstruct the arc from the **assistant's
  acknowledgements** ("Вы правы / принято / поправил / ноготь — это …") rather
  than from `corrections.json` text alone. A UI session showing `corrections: 1`
  with many `imageOnly` turns ran far more correction round-trips than the count.
- **A handed-in `--session <id>` may be the wrong log.** An SDK-launched
  review/security subagent writes its own `*.jsonl` (`promptSource: sdk`,
  `kind: sdk`); it is **not** the interactive work session. If the given id
  resolves to an `sdk`/near-empty log, find the real session (newest large
  interactive `*.jsonl`, e.g. the one whose branch matches the work) and analyze
  that instead — note the correction in the corpus header.

### 4. Read each candidate in context, emit findings

For every confirmed deviation, read the `transcripts/<id>.md` around the
correction / self-catch to recover what actually happened, then emit one finding
in the schema below. **Cite both sides** — the user-side quote (the correction)
and the agent-side quote (what it did / how it owned the miss). Map the
deviation to the agreed rule it broke; classify root cause and remedy.

The deeper insight the audit surfaced (record it when it applies): several
themes — registry-research, no-workarounds, verify-UI-live, RU-i18n,
actionable-errors — **were already written into instructions/memory and still
recurred**. That makes the root cause `prose-not-enforced` (a rule that lives as
passive prose and never fires at the decision point), not `missing-rule`. Prefer
a deterministic `remedy_kind` (`skill` / `command` / `hook` / `lint-gate`) over
"write more prose" for those.

### 5. Large corpora — balanced-batch fan-out

For a big historical corpus the transcripts exceed one context window (the audit:
~2.8 MB across 65 transcripts). Fan out: split the time-sorted transcript list
into N batches **balanced by byte size** (not by count — a few sessions are
10–20× larger), dispatch one Opus subagent per batch with this same SKILL.md +
its batch manifest, and **consolidate** the returned findings (de-duplicate
recurrences of the same theme, keep the strongest evidence quote). Single-session
mode never needs fan-out.

---

## Finding schema

One JSON object per deviation; a run emits an array of them. This is the schema
[`tools/retro/samples/findings-all.json`](../../../../../tools/retro/samples/findings-all.json)
follows — it is both the worked reference and a regression fixture.

| Field            | Type / allowed values                                                                                                                                                                                                          | Meaning                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `theme`          | string (stable slug, e.g. `pr-lifecycle`, `no-live-verify`, `task-hygiene`, `context-loss`, `reinvent-wheel`, `workarounds-stubs`, `no-brainstorm`, `invented-convention`, `dep-bump-unverified`; `other:<slug>` for one-offs) | the recurring deviation class (maps to epic #247 Themes A–I)                                   |
| `session`        | string                                                                                                                                                                                                                         | the session log id the evidence came from                                                      |
| `ts`             | ISO-8601 string                                                                                                                                                                                                                | timestamp of the deviation moment                                                              |
| `evidence_user`  | string                                                                                                                                                                                                                         | the user-side quote — the correction / pushback (verbatim, may be RU)                          |
| `evidence_agent` | string                                                                                                                                                                                                                         | the agent-side quote — what it did, or how it owned the miss (self-catch)                      |
| `violated_rule`  | string                                                                                                                                                                                                                         | the agreed-rule source: `AGENTS.md §…` / `CLAUDE.md` / a `memory feedback_*` file / spec / ADR |
| `root_cause`     | `missing-rule` \| `prose-not-enforced` \| `context-bloat` \| `cross-session-loss` \| `other`                                                                                                                                   | why the deviation happened                                                                     |
| `remedy_kind`    | `instruction` \| `memory` \| `skill` \| `command` \| `hook` \| `lint-gate` \| `none`                                                                                                                                           | the kind of fix that would stop the recurrence                                                 |
| `remedy`         | string                                                                                                                                                                                                                         | the concrete proposed fix                                                                      |
| `severity`       | `high` \| `med` \| `low`                                                                                                                                                                                                       | impact / recurrence weight                                                                     |

`root_cause: other` and `remedy_kind: none` are legitimate (`none` = observed but
no durable fix warranted, e.g. a one-off env mistake). Map `root_cause` to the
two structural failure modes the audit named: a rule that exists but is passive
prose → `prose-not-enforced`; a settled fact re-litigated across turns/sessions →
`cross-session-loss`; instruction monolith too big to honor mid-session →
`context-bloat`.

### Example finding

```json
{
  "theme": "pr-lifecycle",
  "session": "93ee99da-4a2d-499d-936b-e896e1d76424",
  "ts": "2026-05-20T11:30:00Z",
  "evidence_user": "На ревью агенту отправлял?",
  "evidence_agent": "Нет, не отправлял — упустил. ... я как автор-orchestrator должен был запустить Mode (a)",
  "violated_rule": "AGENTS.md §4 / §6 Discipline gates (request-mode-a-review is mandatory before merge)",
  "root_cause": "prose-not-enforced",
  "remedy_kind": "command",
  "remedy": "A /wrap or end-of-iteration command must run the request-mode-a-review dispatch as a non-skippable step before declaring the PR done, so the agent cannot reach 'PR open' and stop.",
  "severity": "high"
}
```

---

## Output (mandatory format)

Return:

1. A one-line **corpus header** echoing `summary.json` — mode (single/batch),
   interactive-session count, correction count, date range.
2. The **findings array** in the schema above (valid JSON).
3. A short **consolidation note** — themes by frequency, and which root causes
   are `prose-not-enforced` / `cross-session-loss` (the structural failures that
   no extra prose will fix).

Do **not** propose or apply instruction/memory edits here — that is the caller's
job (`/wrap` stage 2–3). This skill **only analyzes and reports**.

---

## How this is consumed

- **`/wrap` (#B1)** dispatches this skill as **stage 1** in single-session mode
  against the just-finished log, as an _independent_ agent (not self-review). It
  then proposes instruction/memory edits from the findings (stage 2), and on
  approval applies them **and compacts** under the anti-bloat budget
  (`pnpm lint:instruction-budget`, #B3) (stage 3).
- **An independent retro / historical-audit agent** dispatches it in batch mode
  to re-measure recurrence over the whole corpus and confirm a remedy actually
  reduced a theme's frequency. The sample dataset is the regression baseline.

> **Cannot proceed without** — the caller must dispatch this to a fresh-context
> agent and receive the findings array in the schema above. A free-form
> narrative without the schema'd findings is not a valid return; re-dispatch.
