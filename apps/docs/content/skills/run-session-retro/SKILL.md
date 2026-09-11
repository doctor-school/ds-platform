---
title: "run-session-retro"
description: "Procedural skill (dispatch): an independent agent analyzes a session log (or a batch of logs) for deviations from agreed rules and lost context, and returns findings in a fixed schema. The analysis engine /wrap (#B1) and any historical-audit agent invoke."
name: run-session-retro
mode: dispatch
---

# run-session-retro

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** dispatch (an _independent_ agent — never the
session's own author — reads the log via the `tools/retro` extractor and returns
findings in the schema below; the caller cannot self-review).

An explicit owner request for standalone retro authorizes this independent analysis without literal `/wrap`; it does not authorize the full wrap, instruction edits or memory writes. Reading this documentation is not executing the procedure. Full wrap and application retain their own scope/approval gates.

The analysis engine for epic #247's feedback-improvement loop. Two modes:

- **single session** — the `/wrap` case (#B1): analyze the just-finished
  session's own log and feed findings into the propose → approve →
  apply-and-compact loop.
- **batch** — the historical-audit case: analyze many logs at once (the Phase-A
  audit produced [`tools/retro/samples/findings-all.json`](../../../../../tools/retro/samples/findings-all.json)
  — 84 findings across 65 interactive sessions, 2026-05-20 → 2026-06-18).

The methodology below is the one **proven** in that audit; its tooling lives in
[`tools/retro/`](../../../../../tools/retro/README.md).

---

## What a "deviation" is

A point where the agent lost settled context, departed from a useful agreed rule, or followed an overprescriptive rule that inflated work beyond the requested result. Evaluate outcome, solution necessity and process cost before rule compliance. User corrections and agent self-catches are evidence candidates, not proof by themselves. One finding = one evidenced failure.

---

## Procedure (the dispatched agent runs this)

### 1. Build the corpus with the extractor

Select the active harness and build one explicitly labelled corpus in the
gitignored `.audit-tmp`:

```bash
# single-session mode (the /wrap case):
# Claude Code
node tools/retro/extract.mjs     --session <session-id> --out-dir <work-dir>
node tools/retro/transcripts.mjs --session <session-id> --out-dir <work-dir>

# Codex rollout (CODEX_HOME/sessions; fallback ~/.codex/sessions; recursive)
node tools/retro/codex.mjs --session <session-id> --out-dir <work-dir>
# Or: --rollout <rollout.jsonl> / --portable-input <portable.json>

# batch mode (historical audit over the whole corpus):
node tools/retro/extract.mjs     --out-dir <work-dir>
node tools/retro/transcripts.mjs --out-dir <work-dir>
```

Both paths write into `<work-dir>`: `index.json` / `summary.json` (classification +
totals), `sessions/<id>.json` (per-session human-message digest),
`corrections.json` (**the gold signal**), `transcripts/<id>.md` (compact
`[U]` user / `[A]` assistant / `[T]` tool-call transcript, bulky `tool_result`
payloads dropped), `self-catches.json` (assistant self-corrections). Codex also
writes `portable/<id>.json` with schema `ds-platform-retro/v2` (v1 input accepted); never feed a
Codex rollout into the Claude parser or describe it as a Claude transcript.

Also run the active harness **token ledger** documented in `tools/retro/README.md`: Codex `pnpm retro:tokens --harness codex <session-id>` or `pnpm retro:tokens --rollout <rollout.jsonl>`; Claude retains `pnpm retro:tokens <session-id>`. Apply portable agent discipline's observed effective input/window policy, not lifetime cumulative usage or Claude constants to Codex. A context finding cites the actual ledger row and active adapter threshold. Missing/stale telemetry or an unavailable window is an evidence gap, never a zero usage or zero-deviation claim.

### 2. Isolation + exclusion rules (already enforced by the extractor — verify, don't re-derive)

- **Isolate interactive sessions** — one with ≥1 real human-typed message.
  `promptSource: sdk` runs (review / subagent automation) are `sdk` and
  **excluded** (the audit cut 197 logs to 66).
- **Real human text only** — drop `tool_result`-only turns, `isMeta`,
  `isCompactSummary`.
- **Exclude wrappers / non-typed text** — `command-*` / `local-command`
  wrappers, `Caveat:` lines, `system-reminder`, `task-notification`, `bash-*`
  blocks, `API Error` / interrupt lines, continuation banners.
- **Exclude handoff prompts** — a pasted handoff (`You are continuing`, `# Agent
bootstrap`, an early `Current task` heading) is a real message but **not** a
  correction; it must not inflate the count.

### 3. Apply the two heuristics

- **Correction** (`CORRECTION_RE` in `extract.mjs`) — a bilingual regex over
  human messages ("почему / зачем / опять / я просил …", "why / instead / should
  have / wrong / again …") flagging user pushback. A handoff is never a
  correction.
- **Self-catch** (`SELF_CATCH` in `transcripts.mjs`) — a bilingual regex over
  **assistant** text ("actually / wait / I was wrong / I should have / I forgot
  …", "на самом деле / я ошибся / забыл …").

Both are recall-first: they over-select, and analysis discards false positives.
Treat a flag as a **candidate**, read the surrounding transcript to confirm a
genuine deviation before emitting a finding.

- **UI/design sessions correct via screenshots, not words.** The correction
  channel for visual work is the **annotated screenshot** — an `image-only` turn
  no `CORRECTION_RE` can match. `extract.mjs` keeps these (flagged `imageOnly`,
  counted as a candidate) but they carry no quotable text, so reconstruct the arc
  from the **assistant's acknowledgements** ("Вы правы / принято / поправил") not
  `corrections.json` alone. A UI session showing `corrections: 1` with many
  `imageOnly` turns ran far more round-trips than the count.
- **A handed-in `--session <id>` may be the wrong log.** An SDK-launched
  review/security subagent writes its own `*.jsonl` (`promptSource: sdk`); it is
  **not** the interactive work session. If the id resolves to an `sdk`/near-empty
  log, stop corpus analysis and resolve the actual session by the task marker/branch and verified session identity, never newest mtime. Record the correction in the corpus header; do not substitute an unrelated log.

### 4. Read each candidate in context, emit findings

For every confirmed deviation, read `transcripts/<id>.md` around the correction /
self-catch, then emit one finding in the schema below. **Cite both sides** — the
user-side correction and the agent-side quote (what it did / how it owned the
miss). Map the deviation to the rule it broke; classify root cause and remedy.

Determine whether the rule itself was necessary and correctly scoped before recommending enforcement. Repetition may reveal an overprescriptive rule, conflicting instructions or lost evidence. Prefer removing/narrowing the cause or reusing existing means when sufficient; new commands/hooks/lint gates need a concrete uncovered risk and justified maintenance cost. Use existing schema `root_cause: other` for harmful rule design and `remedy_kind: instruction|skill` for deletion/narrowing. `none` is valid when no durable change is warranted.

### 5. Large corpora — balanced-batch fan-out

A big historical corpus exceeds one context window (the audit: ~2.8 MB / 65
transcripts). Fan out: split the time-sorted transcript list into N batches
**balanced by byte size** (not count — some sessions are 10–20× larger),
dispatch one reviewer-grade subagent per batch with this SKILL.md + its manifest, then
**consolidate** (de-duplicate theme recurrences, keep the strongest quote).
Single-session mode never needs fan-out.

---

## Finding schema

One JSON object per deviation; a run emits an array of them. This is the schema
[`tools/retro/samples/findings-all.json`](../../../../../tools/retro/samples/findings-all.json)
follows — both the worked reference and a regression fixture.

| Field            | Type / allowed values                                                                                                                                                                                                                            | Meaning                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `theme`          | string (stable slug, e.g. `pr-lifecycle`, `no-live-verify`, `task-hygiene`, `context-loss`, `reinvent-wheel`, `workarounds-stubs`, `no-brainstorm`, `invented-convention`, `dep-bump-unverified`, `context-budget`; `other:<slug>` for one-offs) | the recurring deviation class (maps to epic #247 Themes A–I)                                   |
| `session`        | string                                                                                                                                                                                                                                           | the session log id the evidence came from                                                      |
| `ts`             | ISO-8601 string                                                                                                                                                                                                                                  | timestamp of the deviation moment                                                              |
| `evidence_user`  | string                                                                                                                                                                                                                                           | the user-side quote — the correction / pushback (verbatim, may be RU)                          |
| `evidence_agent` | string                                                                                                                                                                                                                                           | the agent-side quote — what it did, or how it owned the miss (self-catch)                      |
| `violated_rule`  | string                                                                                                                                                                                                                                           | the agreed-rule source: `AGENTS.md §…` / `CLAUDE.md` / a `memory feedback_*` file / spec / ADR |
| `root_cause`     | `missing-rule` \| `prose-not-enforced` \| `context-bloat` \| `cross-session-loss` \| `other`                                                                                                                                                     | why the deviation happened                                                                     |
| `remedy_kind`    | `instruction` \| `memory` \| `skill` \| `command` \| `hook` \| `lint-gate` \| `none`                                                                                                                                                             | the kind of fix that would stop the recurrence                                                 |
| `remedy`         | string                                                                                                                                                                                                                                           | the concrete proposed fix                                                                      |
| `severity`       | `high` \| `med` \| `low`                                                                                                                                                                                                                         | impact / recurrence weight                                                                     |

`root_cause: other` and `remedy_kind: none` are legitimate (`none` = observed but
no durable fix warranted, e.g. a one-off env mistake). Map `root_cause` to the
structural failure modes the audit named: a rule that exists but is passive prose
→ `prose-not-enforced`; a settled fact re-litigated across turns/sessions →
`cross-session-loss`; an instruction monolith too big to honor mid-session →
`context-bloat`. A worked example of a filled-in finding is the first record of
[`samples/findings-all.json`](../../../../../tools/retro/samples/findings-all.json)
(a `pr-lifecycle` / `prose-not-enforced` / `command` miss, cited both sides).

---

## Output (mandatory format)

Return:

1. A one-line **corpus header** echoing `summary.json` — mode (single/batch),
   interactive-session count, correction count, date range.
2. The **findings array** in the schema above (valid JSON).
3. A short **consolidation note** — recurring causes, including lost context and overprescriptive rules; explain why each proposed remedy is sufficient and worth its cost.

Do **not** propose or apply instruction/memory edits here — that is the caller's
job (`/wrap` stage 2–3). This skill **only analyzes and reports**.

---

## How this is consumed

- **`/wrap` (#B1)** dispatches this as **stage 1** (single-session, independent —
  not self-review) against the just-finished log, then proposes
  instruction/memory edits (stage 2) and on approval applies them **and
  compacts** under the anti-bloat budget (`pnpm lint:instruction-budget`, #B3,
  stage 3).
- **A historical-audit agent** dispatches it in batch mode to re-measure
  recurrence across the corpus and confirm a remedy reduced a theme's frequency;
  the sample dataset is the regression baseline.

> **Cannot proceed without** — the caller must dispatch this to a fresh-context
> agent and receive the findings array in the schema above. A free-form
> narrative without the schema'd findings is not a valid return; re-dispatch.
