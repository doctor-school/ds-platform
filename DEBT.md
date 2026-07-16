# DEBT.md — rolling debt ledger

**What belongs here:** below-threshold debt — deviations, deferrals, and cleanup items that do NOT warrant a GitHub Issue. The **significance threshold** (canon: AGENTS.md §6): a tracker Issue is filed ONLY when the debt (a) blocks / sits on the critical path of a product deliverable, (b) is user-visible or a prod risk (security/data), or (c) must be acted on before the next release. Everything below that threshold is one line here, appended in the **same commit or same PR** as the work that surfaced it.

**Owner triage cadence:** weekly and at each milestone close.

**Promotion:** when a line crosses the threshold, file an Issue via `pnpm issue:create` with exactly one `source:*` label (`source:owner` | `source:spec` | `source:retro` | `source:agent`), then check the line off with the Issue # appended.

**Line format:**

```
- [ ] YYYY-MM-DD <origin: session/PR/Issue> — <one-line debt> (promote-when: <criterion>)
```

## Ledger
