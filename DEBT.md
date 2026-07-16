# DEBT.md — rolling debt ledger

**What belongs here:** below-threshold debt — deviations, deferrals, and cleanup items that do NOT warrant a GitHub Issue. The **significance threshold** (canon: AGENTS.md §6): a tracker Issue is filed ONLY when the debt (a) blocks / sits on the critical path of a product deliverable, (b) is user-visible or a prod risk (security/data), or (c) must be acted on before the next release. Everything below that threshold is one line here, appended in the **same commit or same PR** as the work that surfaced it.

**Scope boundary (owner-directed, 2026-07-16):** the threshold routes debt **at surfacing time** (wrap / `surface-decision-debt` / opening Issues from a spec). It is NOT a mandate to re-grade or close already-filed Issues — re-triage of tracked Issues happens only on an explicit owner request; a drainage session **implements**, it does not prune (precedent: issue #881, 2026-07-16 comment).

**Owner triage cadence:** weekly and at each milestone close.

**Promotion:** when a line crosses the threshold, file an Issue via `pnpm issue:create` with exactly one `source:*` label (`source:owner` | `source:spec` | `source:retro` | `source:agent`), then check the line off with the Issue # appended.

**Line format:**

```
- [ ] YYYY-MM-DD <origin: session/PR/Issue> — <one-line debt> (promote-when: <criterion>)
```

## Ledger

- [ ] 2026-07-16 retro session 1c4b7478 / PR #1011 — AGENTS.md at 25,596/25,600 B (4 B headroom); the next always-on edit forces ad-hoc squeezing of canonical rules (promote-when: an AGENTS.md edit does not fit the budget, or a drainage wave picks it up — remedy: add a `<256 B remaining` WARN tier to `tools/lint/instruction-budget-lint.ts` + relocate §6 detail to `.claude/rules/`/skills)
