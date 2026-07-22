# DEBT.md — rolling debt ledger

**What belongs here:** below-threshold debt — deviations, deferrals, and cleanup items that do NOT warrant a GitHub Issue. The **significance threshold** (canon: AGENTS.md §6): a tracker Issue is filed ONLY when the debt (a) blocks / sits on the critical path of a product deliverable, (b) is user-visible or a prod risk (security/data), or (c) must be acted on before the next release. Everything below that threshold is one line here, appended in the **same commit or same PR** as the work that surfaced it.

**Scope boundary (owner-directed, 2026-07-16):** the threshold routes debt **at surfacing time** (wrap / `surface-decision-debt` / opening Issues from a spec). It is NOT a mandate to re-grade or close already-filed Issues — re-triage of tracked Issues happens only on an explicit owner request; a drainage session **implements**, it does not prune (precedent: issue #881, 2026-07-16 comment).

**Owner triage cadence:** weekly and at each milestone close.

**Promotion:** when a line crosses the threshold, file an Issue via `pnpm issue:create` with exactly one `source:*` label (`source:owner` | `source:spec` | `source:retro` | `source:agent`), exactly one kind label, and a `--milestone` («Platform ops & hardening» when no product theme fits), then check the line off with the Issue # appended.

**Line format:**

```
- [ ] YYYY-MM-DD <origin: session/PR/Issue> — <one-line debt> (promote-when: <criterion>)
```

## Ledger

- [ ] 2026-07-16 Issue #701 / open-ears-issues — child #1049 groups EARS-15..16 in one `kind:ears-handler` (same events read-module + `packages/schemas/` touch set, not parallelizable; open-ears-issues 3b deviation from 1:1) (promote-when: the grouped child stalls and the EARS need separate owners)
- [ ] 2026-07-16 Issue #701 / open-ears-issues — child #1051 groups EARS-17..18 in one `kind:ears-handler` (both are interaction controls over the same listing/month-view component touch set; open-ears-issues 3b deviation from 1:1) (promote-when: the grouped child stalls and the EARS need separate owners)
- [x] 2026-07-16 retro session 1c4b7478 / PR #1011 — AGENTS.md at 25,596/25,600 B (4 B headroom); the next always-on edit forces ad-hoc squeezing of canonical rules (promote-when: an AGENTS.md edit does not fit the budget, or a drainage wave picks it up — remedy: add a `<256 B remaining` WARN tier to `tools/lint/instruction-budget-lint.ts` + relocate §6 detail to `.claude/rules/`/skills) (→ #1042 — WARN tier shipped; relocation half satisfied by #1030)
- [ ] 2026-07-16 Issue #1046 / mailer failover — `bff_mailer_relay_events_total` registers in the prom-client default registry but the api exposes no /metrics scrape endpoint yet (no Prometheus server exists on the stand/prod either — engineering-readiness default, unbuilt); GlitchTip events + structured logs are the live-visible EARS-32 surface today (promote-when: the engineering-readiness Prometheus slice lands — add the exposition endpoint with it)
- [ ] 2026-07-17 spec-010 WBS (#1086) — EARS grouped away from the 1:1 default per open-ears-issues §3b: #1087 folds EARS-1,2,4,6,7 (one trigger-function+migration touch set), #1088 folds EARS-3,5 (one tx-wrapper touch set); bodies list folded ids (promote-when: a folded EARS needs independent scheduling)
- [ ] 2026-07-17 PR #1096 (#1088) — background/system writes (auth user-mirror reconcile; future jobs) carry no request context and land as source='db-direct' instead of design-§3 'system:<job-name>'; wire withAuditContext({source:'system:<job>'}) at job entry points (promote-when: a background job mutates domain tables in prod or an investigation needs job-level attribution)
- [ ] 2026-07-17 Issue #1103 primitives-shell — 15 call sites (#1103 ledger @ ed20987d) use DS primitives as shells with call-site visual-identity overrides across portal/admin (worst: app-shell-header 4, month-calendar-view 4); kept continuously visible by the `primitives-first` SHELL WARNs, drain opportunistically per surface, no dedicated Issue (§6 threshold: not user-visible defects). RAW(3) routed to #1107 (promote-when: a surface's shells are remediated as a batch or the guard flips to BLOCK)
- [ ] 2026-07-17 PR #1108 (#1103) — the `continue-on-error: true` WARN-job pattern in ci.yml (aa-contrast, instruction-budget, form-error, form-rhythm, submit-pending, interaction-states, …) keeps the WORKFLOW green but the CHECK-RUN still concludes FAILURE the moment a WARN guard emits findings, which `merge:gate` treats as blocking → would block EVERY PR's merge gate; latent today only because those guards are all zero-findings. `primitives-first` fixed here (WARN moved into the tool exit code, job de-`continue-on-error`d); sweep the rest the same way when one fires or at the ADR-0007 §2.6 severity review (promote-when: a `continue-on-error` WARN guard starts emitting findings, or the §2.6 review runs)
