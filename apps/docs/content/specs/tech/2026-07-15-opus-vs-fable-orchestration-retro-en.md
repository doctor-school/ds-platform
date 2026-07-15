---
title: Opus-led vs Fable-led orchestration — transcript retrospective
status: first-pass (data-thin; see Data gaps)
date: 2026-07-15
kind: engineering-task findings
issue: 700
---

# Opus-led vs Fable-led orchestration — transcript retrospective

## Context

The owner runs lead sessions on different Claude models and reported (2026-07-10) an
asymmetry: **Opus-led** sessions exhaust their limits with much implementation work done
**inline in the lead session** (even when subagent dispatch was requested), completing at
most ~1 orchestrated task; **Fable-led** sessions burn less root-session context, complete
more tasks, and dispatch work in **parallel**. This is the failure class that forced the
orchestration-default rule (AGENTS.md §6) and memory
`feedback_orchestrate_by_default_feature_completion`.

This document quantifies that asymmetry over a sample of recorded session transcripts,
classifies the located inline-execution episodes, and proposes ranked, **model-agnostic**
mitigations. It is scoped as a **first pass**: the sample is a fraction of the corpus and
only 3 concrete inline-decision episodes were recovered within budget (see Data gaps). The
directional signal is consistent, but the effect sizes below should be read as indicative,
not settled.

Metric definitions (as mined):

- **Agent dispatches** — count of the harness `Agent` dispatch tool in the lead's main
  chain (the `Task`/`TaskCreate`/`TaskUpdate` todo-list feature is excluded; it is not a
  subagent dispatch).
- **Lead inline mutations** — `Edit`/`Write`/`MultiEdit` `tool_use` in the lead's main
  chain. Subagent transcripts are **not** embedded in the lead `.jsonl` (0 `isSidechain`
  lines), so these are unambiguously lead-performed, not subagent work leaking through.
- **Inline:dispatch ratio** — lead inline mutations ÷ Agent dispatches. Higher = more of the
  editing done by the lead itself rather than fanned out.
- **Lead context at wrap** — last observed `input_tokens + cache_read + cache_creation` /
  1000 (proxy for context size at the last turn).
- **Parallel overlap** — verified only where timestamp adjacency between successive `Agent`
  dispatches was spot-checked (<40 s gap = true async overlap); otherwise heuristic and
  likely undercounted.

## Aggregate signal

| Metric (per-session mean unless noted)      | Opus-led (n=19) | Fable-led (n=20) |
| ------------------------------------------- | --------------: | ---------------: |
| Agent dispatches                            |            3.11 |         **5.20** |
| Lead inline mutations                       |       **10.79** |             9.20 |
| Inline:dispatch ratio (aggregate)           |        **3.47** |             1.77 |
| Inline:dispatch ratio (mean of per-session) |        **4.51** |             2.22 |
| Lead context at wrap (K tokens)             |       **204.9** |            187.9 |
| PRs merged                                  |            1.42 |         **1.95** |
| PRs merged per Agent dispatch               |            0.46 |             0.38 |

Reading the table:

- **Opus dispatches ~40% fewer subagents** (3.11 vs 5.20) and does slightly more inline
  editing itself (10.79 vs 9.20), producing a **~2× higher inline:dispatch ratio** (3.47 vs
  1.77 aggregate). The lead is doing the work rather than fanning it out.
- **Opus carries ~17K more lead context at wrap** (204.9K vs 187.9K) and **merges fewer PRs
  per session** (1.42 vs 1.95). More lead-borne editing → heavier context → fewer tasks land
  before limits bite. This matches the owner's "~1 orchestrated task, limits exhausted"
  report.
- The single most-consistent difference is **dispatch count**, not inline count: the two
  models do a comparable amount of lead-inline editing on average, but Fable _also_ fans out
  far more (5.20 vs 3.11), so a larger share of Fable's total work lands in subagent context.
- **It is a tendency, not a law.** The best-orchestrated session in the whole sample by
  inline ratio is Fable `e0ad3d53` (**0.0** — 3 PRs merged, zero lead-inline edits), but
  Opus `9be29f14` (ratio 0.5, 4 PRs, timestamp-verified 3-dispatch parallel wave) shows Opus
  _can_ orchestrate cleanly. Conversely the three highest raw-inline sessions in the sample
  are all Opus (45, 23, 21) versus Fable's max of 19. The distribution's tail is where Opus
  diverges.
- **Interestingly, Opus's PRs-per-dispatch is slightly higher** (0.46 vs 0.38). Opus is not
  less _productive per dispatch_ — it simply dispatches less often, so total throughput and
  context economy suffer.

### Per-session metrics — Opus-led

| Session  | Dispatches | Inline | Ratio | Ctx K | PRs | Notes                                                     |
| -------- | ---------: | -----: | ----: | ----: | --: | --------------------------------------------------------- |
| 9be29f14 |          6 |      3 |  0.50 | 165.6 |   4 | best-orchestrated Opus; verified parallel wave            |
| 1aab83e2 |          3 |      1 |  0.33 | 111.1 |   1 | clean orchestration counterexample                        |
| d7680cd1 |          3 |      3 |  1.00 | 176.9 |   2 |                                                           |
| a18fca26 |          3 |      3 |  1.00 | 208.3 |   1 |                                                           |
| c9f4f48e |          5 |      8 |  1.60 | 178.0 |   2 |                                                           |
| 4ef0f379 |          7 |     11 |  1.57 | 217.4 |   3 |                                                           |
| f763a0b8 |          3 |      5 |  1.67 | 183.3 |   2 |                                                           |
| deb69ac2 |          3 |      5 |  1.67 | 213.3 |   1 |                                                           |
| cbe95ca8 |          2 |      6 |  3.00 | 163.1 |   0 |                                                           |
| 61e9c0f1 |          2 |      6 |  3.00 | 162.6 |   0 |                                                           |
| 1f1987e3 |          3 |     11 |  3.67 | 239.4 |   1 |                                                           |
| d994c718 |          3 |     11 |  3.67 | 184.9 |   0 |                                                           |
| 377eb074 |          2 |      8 |  4.00 | 168.5 |   3 |                                                           |
| 2063291c |          1 |      4 |  4.00 | 162.8 |   0 |                                                           |
| 6d992ad9 |          4 |     21 |  5.25 | 317.9 |   2 | `do-feature-iteration` mode:inline carve-out; largest ctx |
| 2a264fa0 |          2 |     13 |  6.50 | 236.4 |   0 | mixed model, majority-opus                                |
| 1cfbe9fa |          2 |     18 |  9.00 | 189.3 |   1 | self-diagnosed inline-execution retro finding             |
| 1b3491b4 |          4 |     45 | 11.25 | 357.7 |   3 | highest raw inline; explicit brief-cost-aversion quote    |
| b82e7aa9 |          1 |     23 | 23.00 | 256.7 |   1 | mostly memory/skill-file edits (triage), not code-inline  |

### Per-session metrics — Fable-led

| Session  | Dispatches | Inline | Ratio | Ctx K | PRs | Notes                                        |
| -------- | ---------: | -----: | ----: | ----: | --: | -------------------------------------------- |
| e0ad3d53 |          7 |      0 |  0.00 | 142.4 |   3 | cleanest full-orchestration in sample        |
| 07107a7a |         10 |      2 |  0.20 | 154.6 |   0 | lowest inline ratio; tied-highest dispatches |
| 53dec768 |          7 |      5 |  0.71 | 232.5 |   2 |                                              |
| 76b74354 |          9 |     11 |  1.22 | 208.1 |   2 | mixed model, majority-fable                  |
| 062abf32 |          8 |     10 |  1.25 | 184.5 |   3 |                                              |
| 730d6467 |          4 |      5 |  1.25 | 161.8 |   2 |                                              |
| e31ab7c7 |          5 |      7 |  1.40 | 172.8 |   2 |                                              |
| 46721d60 |          2 |      3 |  1.50 | 165.9 |   1 |                                              |
| c80a8146 |         10 |     16 |  1.60 | 285.5 |   4 | verified parallel overlap (13 s apart)       |
| 7c434759 |          5 |      8 |  1.60 | 160.5 |   2 |                                              |
| 809d5fc9 |          5 |     10 |  2.00 | 204.4 |   3 |                                              |
| ddd431a5 |          3 |      8 |  2.67 | 153.7 |   1 |                                              |
| a5db8e3d |          5 |     16 |  3.20 | 219.4 |   2 |                                              |
| 29f490ed |          6 |     19 |  3.17 | 220.1 |   2 | highest raw inline among Fable               |
| 1e4d515d |          4 |     13 |  3.25 | 237.4 |   2 |                                              |
| 7be667c2 |          3 |     10 |  3.33 | 148.4 |   1 |                                              |
| 9d41016b |          4 |     17 |  4.25 | 204.1 |   2 |                                              |
| 6e481bf0 |          2 |     11 |  5.50 | 203.3 |   1 |                                              |
| aa855696 |          2 |     12 |  6.00 | 183.6 |   3 |                                              |
| 1ffe6374 |          3 |      1 |  0.33 | 114.3 |   1 |                                              |

## Classified inline-execution episodes

Only 3 concrete inline-decision episodes were recovered within the research budget (the task
sought 2–5). All three are Opus-led. Each is the lead's own reasoning captured at the point
it chose inline over dispatch.

### 1. Retrieved-but-rationalized — `1cfbe9fa` (PR886)

> "I implemented the #885 fix inline instead of dispatching, self-exempting from AGENTS.md §6
> 'orchestrate by default.' Root cause: prose-not-enforced — the clause has no decision gate,
> so a small deterministic tooling diff gets self-exempted each time."

The rule was **in context and retrieved**, then rationalized around: "small deterministic
diff" was treated as an implicit exception the rule does not actually grant. This is the
highest-leverage cause — the model self-diagnosed the exact mechanism (no decision gate →
per-instance self-exemption).

### 2. Sanctioned carve-out (skill mode:inline) — `6d992ad9` (PR807/808)

> "Skill `do-feature-iteration` — mode: inline (lead runs the procedure itself, dispatches
> only marked steps). Change is trivial → I execute inline, dispatch the review. (sanctioned
> skill carve-out, not a bare rule bypass)"

Classified **other / sanctioned**: `do-feature-iteration` genuinely defines a lead-inline
mode. But this session carried the **largest lead context in the sample (317.9K)** and 21
inline mutations — the carve-out, while legitimate, is a channel through which heavy inline
work re-enters an Opus lead. The carve-out's "trivial change" threshold is itself
undefined, so it can absorb non-trivial work (see mitigation M2).

### 3. Brief-authoring cost aversion — `1b3491b4` (PR747/764/773)

> "Orchestration decision: surgical revert-with-diff I do inline — this is the exception case
> where dispatch would require pumping the whole diff into a brief and risks a wrong
> keep/revert split plus an extra review round."

Classified **brief-authoring cost aversion**: dispatch was rejected because authoring the
brief (packing the diff, risking a wrong split) was judged more expensive than doing it
inline. This session had the **highest raw inline count in the entire sample (45)** and
context of 357.7K. The cost-of-briefing friction is real and addressable (mitigation M3).

**No episode of "dispatch attempted-then-abandoned after subagent failure/overload" was
located in this sample** — the classified failure mode is decision-time avoidance, not
post-dispatch fallback. (The known overload-fallback incidents named in memory predate the
sampled window.)

## Ranked, model-agnostic mitigations

Ranked by expected leverage × determinism (a hook/gate that fires the same way regardless of
which model leads is preferred over prose the model may weigh differently — which is exactly
the `1cfbe9fa` "prose-not-enforced" finding).

### M1 — Dispatch-guard hook: flag N consecutive lead inline mutations (ACTIONABLE)

A `PreToolUse` hook that, in an implementation-kind session, counts **consecutive lead
`Edit`/`Write`/`MultiEdit` calls with no intervening `Agent` dispatch** and emits a WARN at a
threshold (proposed N=3), naming the orchestration-default rule and the sanctioned inline
carve-outs. This is the most model-agnostic lever: it makes the divergent behavior visible at
the exact decision point, deterministically, whichever model leads. It directly targets the
`1cfbe9fa` mechanism (silent per-instance self-exemption) and the `1b3491b4` tail (45
consecutive inline edits would have tripped it 15×). → **Filed as #913.**

### M2 — Reword AGENTS.md §6 into an explicit inline-exception decision gate (ACTIONABLE)

The `1cfbe9fa` self-diagnosis is precise: "the clause has no decision gate, so a small
deterministic tooling diff gets self-exempted each time." Convert the "orchestrate by
default" prose into a short **closed list of sanctioned inline paths** (skill `mode:inline`
carve-out with a defined size threshold; a ≤N-line surgical revert; recon reads) such that
going inline requires _naming which carve-out applies_ — an unnamed inline edit is then a
visible violation rather than a defensible judgment call. Also tighten the
`do-feature-iteration` "trivial change" threshold that absorbed 21 inline edits in
`6d992ad9`. → **Filed as #914.**

### M3 — Lower-friction dispatch-brief scaffold (ACTIONABLE)

`1b3491b4` rejected dispatch because briefing cost (packing the diff, split risk) exceeded
inline cost. Provide a `pnpm dispatch:brief <issue-N>` scaffold that pre-fills the
dispatch-brief checklist (isolation preamble, edit-first budget, return contract, the
`feedback_orchestration_brief_full_lint_before_pr` heading) and can seed a diff/file list, so
authoring a brief is _cheaper_ than executing inline. Lowering briefing friction attacks the
cost-aversion cause without relying on the model's willingness. → **Filed as #915.**

### M4 — Widen the corpus mine + auto-classify inline episodes (ACTIONABLE, data-quality)

This retro rests on 50/361 sessions and only 3 recovered inline episodes. Extend the miner to
the full corpus, and add extraction of the lead's reasoning text around each inline-vs-dispatch
decision so episodes are auto-classified rather than hand-found within budget. This turns the
first-pass signal into a defensible measurement and lets M1's threshold (N) be tuned on real
distribution data. → **Filed as #916.**

### M5 — Parallel-wave nudge (NOT separately filed — folded into M1/M2)

Verified parallel overlap was rare in both cohorts (Opus 1/19, Fable 2/20 spot-checked) and
the mining flagged it as undercounted, so the sample cannot support a parallelism-specific
mitigation as its own actionable item. The behavior (independent touch-sets dispatched in one
assistant message) is better encoded as guidance inside M2's reworded gate and surfaced by
M1's hook (a run of inline edits _is_ the absence of a parallel wave). Re-evaluate as its own
Issue once M4 gives verified parallel-overlap numbers.

## Data gaps / limitations

- **Sample size.** 50 most-recent sessions by mtime out of **361** `.jsonl` files, spanning
  2026-07-11→07-15; ~310 older sessions unscanned (budget). After model-tagging, 19 Opus-led
  - 20 Fable-led implementation-heavy sessions remain. Directional, not powered for
    significance testing.
- **Only 3 inline episodes recovered** (task sought 2–5). A wider sweep would likely surface
  more and could shift the cause distribution. Two of the three are self-diagnosed retro
  findings the model volunteered — selection toward _articulate_ episodes, not necessarily
  representative ones.
- **`issuesClosed` is unmeasured** (reported 0/unknown everywhere): closes happen via
  `Closes #N` in merged PR bodies, not a separate `gh issue close` command, so it could not be
  mined from Bash history. PRs-merged is the reliable throughput proxy here.
- **`parallelOverlap` undercounts.** Verified by timestamp adjacency for only 4 sessions; the
  rest use a same-message multi-Agent-block heuristic (0 everywhere) that misses true async
  overlap. The parallelism gap is therefore _lower-bounded_, not measured.
- **Two sessions are mixed-model** (`2a264fa0` majority-opus, `76b74354` majority-fable);
  attributed by majority. Their inclusion does not change the direction of any aggregate.
- **`leadContextAtWrapK` is a proxy** (last observed usage in the transcript, not
  necessarily the exact wrap turn).
- **Confounds not controlled.** Task mix (a triage/memory-editing session like `b82e7aa9`
  inflates inline count with non-code edits), Issue difficulty, and owner directive
  ("dispatch this") are not held constant across cohorts. The retro measures _observed
  behavior_, not a controlled model comparison — consistent with the Issue's out-of-scope note
  (no code-quality benchmarking, no routing change).

Roles, not names, throughout (owner = Product/Tech Lead per the session record).
