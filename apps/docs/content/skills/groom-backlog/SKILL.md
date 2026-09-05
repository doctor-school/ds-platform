---
title: "groom-backlog"
description: "Grooming skill (inline): run pnpm backlog:triage, drain the stalled tail, judge orphans/likely-done/duplicates/wait-for-reuse, then walk the owner through release rotation one question per message and propose a parallel wave — no implementation, no estimates, no auto-closing."
name: groom-backlog
mode: inline
---

# groom-backlog

**Kind:** grooming · **Mode:** inline (the lead agent runs this procedure itself; it dispatches subagents only at the steps marked **dispatch**).

The split is deliberate: `pnpm backlog:triage` (`tools/backlog-triage.ts`) owns the **deterministic** checks — what is takeable, what is waiting on a block being built in the other track, what is orphaned, stalled, likely already done, and how the release milestones are rotating. This skill owns the **judgment and the owner dialogue** on top of that output. Never hand the owner raw script output as a groom; never re-derive by hand what the script already computes.

## Trigger

Owner phrases: «сделай груминг», «триаж бэклога», «что брать дальше», «что можно параллельно». Also the `run-task-lifecycle` §7 item 4 groom step when the next pick is presented to the owner rather than silently taken.

## Step 1 — Run the triage

```
pnpm backlog:triage            # add --stalled-days <n> to widen/narrow the stale-claim window (default 3)
```

The script **refuses to run on a stale `main`** — fetch/pull first. Read the whole report before speaking: `## Takeable`, `## Wait for reuse`, `## In flight elsewhere`, `## Blocked`, `## Mega-blockers`, `## Orphans`, `## Stalled`, `## Likely done`, `## Release rotation`, `## Field hygiene`, `## Warnings`. Every grooming section is grouped by `### track:academy` / `### track:doctor` / `### track:platform`; an empty section prints a single `none`. A row in `## Warnings` means a fetch degraded — say so instead of treating the section as empty.

## Step 2 — Drain `## Stalled` FIRST (before any new pick)

Nothing new is picked while the tail is dirty. Per row token:

- **READY-TO-LAND** — a head-pinned Mode (a) APPROVE with all checks green, still unmerged. Dispatch **`ds-lander`** with the PR number (`pnpm pr:land <N>` from the MAIN tree). This is the highest-value work in the whole report.
- **MERGED-BUT-OPEN** — the PR merged with `Closes #N` but #N is still open. Confirm the merged PR actually delivered the Issue's acceptance criteria, then close the Issue with a `state_reason` and set board Status = Done. Never close on the token alone.
- **STALE-CLAIM** — a claim/worktree signal older than `--stalled-days` with no open PR. Either recover a stop-state (checkpoint/handoff exists → re-dispatch a FRESH agent from it) or release the claim with a comment saying what remains. Silence is not an option.

## Step 3 — Judge the surfaced-work sections

These are candidate lists, not verdicts. Each row needs a human-level decision, and anything that turns into an owner fork goes to Step 4's one-question-per-message rule.

- **`## Orphans`** (`no-blocker` / `no-parent` / `off-head (<milestone>)`) — attach to its epic as a native sub-issue, wire a `blocked_by` edge **with a written rationale**, or ask the owner. `blocked_by` means a **technical** dependency only — never «this matters less», which is milestone/order, not a blocker edge.
- **`## Likely done`** — an open Issue a merged PR claims to have **delivered**: it closes it (`Closes/Fixes/Resolves #N`) or carries it as the Conventional-Commit scope of its title (`type(N):`). A bare `#N` mention is not delivery evidence and never appears here. Verify against the merged PR's diff (not its title) that the acceptance criteria are met, then close with `state_reason`; otherwise leave it open and say what is missing. Never auto-close from this section. The section prints its horizon (the last N merged PRs) — an Issue closed by an older PR is outside what was looked at.
- **Duplicates** — **dispatch** `ds-explorer` (Sonnet, read-only) over open Issue titles + their spec paths to return candidate duplicate pairs. The lead judges the pairs; the explorer never closes anything.
- **`## Wait for reuse`** — Issue A waits on a block being built by Issue B in the other track. Open the matched `Canonical location` path the script printed and confirm it is genuinely the **same** capability (`apps/docs/content/specs/product/two-site-ia/capability-ownership.md` is the registry). If it is: A waits and gets a `blocked_by` edge on B with the rationale, and A stays out of the wave. A block being built in one track is **never** started in parallel in the other — wait and reuse (AGENTS.md §6 cross-front reuse).

## Step 4 — Release rotation, with the owner, interactively

Grooming is a **conversation**, not a delivered document. Rules, all binding:

- **One question per message**, in chat, RU: the entity in plain language · why it is being asked · 2–3 options + your recommendation. Record the owner's answer verbatim into the artifact, then ask the next one. A list of ≥2 questions or a «осталось N вопросов» counter is a violation.
- **Two orders, one per product** — Витрина врача and Академия get separate priority orders, never one merged list.
- **Above both, a cross-cutting «блокеры входа» list** — auth codes, registration, first-broadcast access. Entry blockers outrank any catalog or content feature, and they run **parallel** to the two track orders rather than gating them.
- **Estimates are the owner's.** Propose a duration only as a question; write down only numbers the owner said. Never author an estimate.
- **No implementation mid-groom.** Nothing is built until the owner signs off on the order.
- **«Позже» is a queue, not an archive.** Every grooming ends with the explicit question «что поднимаем из Позже» — the `POZHE: <n>` counters per track are the input.
- **Queue-head rule.** Only the track's queue head goes `In Progress` (#1855 guard); litmus «блокирует ли это регистрацию врача и просмотр ближайшего эфира?». `EMPTY-NEXT` on the milestone after the head is an owner question (fill it or re-order), `ALL-CLOSED-STILL-OPEN` is a close-the-milestone action.
- A handoff's «Next» is a **proposal**, not a priority — it is re-asked here, never assumed.

## Step 5 — Propose the parallel wave

**Dispatch** `ds-explorer` (Sonnet, read-only) to map the nearest-release candidates to their probable touch sets — the `feature:NNN` spec directory, the named surfaces in the acceptance criteria, and the `Reuse:` paths. Then propose a wave of **≤4–5 Issues with non-overlapping touch sets**, each at or behind its track's queue head, plus an explicit list of which candidates **wait** and why (overlap, wait-for-reuse, unanswered owner fork). Overlapping touch sets are serialised, not parallelised.

## Step 6 — Recommendation

Close in chat, RU, ≤10 lines: what to take **now** (per track), what waits and why, and what the owner still has to decide. Ownership is explicit — what depends on us vs. what depends on the owner.

## What this skill is NOT

- **Not implementation.** No code, no branches, no PRs during a groom.
- **Not auto-closing.** `## Likely done` and `MERGED-BUT-OPEN` are candidates verified against a diff, never closed on a token.
- **Not estimation.** The agent never authors durations.
- **Not board schema work.** New board fields/columns are owner-only (memory `feedback_no_new_board_fields_without_owner`).
- **Not a document.** A finished priority document instead of a live one-question-at-a-time dialogue is the failure mode this skill exists to prevent.

## Output

- `## Stalled` drained (landed / closed / recovered), stated row by row.
- Orphans attached or wired; likely-done verified and closed or explained; duplicates named; wait-for-reuse edges written.
- Two per-track priority orders + an entry-blocker list, in the owner's own words, with the «Позже» lift answered.
- A proposed wave of ≤4–5 non-overlapping Issues, and the ≤10-line recommendation.
