---
title: "ADR-0007 — AI Stack for DS Platform: Phase 0 methodology + deferred runtime [EN]"
description: "DS Platform is a greenfield TS/Postgres platform developed in Phase 0 primarily by AI agents (Claude Code and Codex) with a minimal team (Tech Lead +..."
lang: en
---

> **EN (this)** · **RU:** [`0007-ai-stack-ru.md`](./0007-ai-stack-ru.md)

# ADR-0007 — AI Stack for DS Platform: Phase 0 methodology + deferred runtime

**Date:** 2026-05-15
**Status:** Accepted
**Related to:** Plane DSO-30 (`fce557aa-4cfd-4466-b487-5ba165501a1f`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0007-ai-stack-design-en.md`
**Inherits:** ADR-0001 (Authentik/Zitadel), ADR-0002 (NestJS + BullMQ), ADR-0003 (Postgres17 + pgvector), ADR-0004 (Next.js 15 + ESLint guards), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs + Keystatic + SDD + GitHub Issues task split)

---

## 1. Context

DS Platform is a greenfield TS/Postgres platform developed in Phase 0 primarily by AI agents (Claude Code and Codex) with a minimal team (Tech Lead + non-technical product owner Product Lead, no second engineer). Documentation and task tracking are already established in ADR-0006 (SDD format, GitHub Issues, glossary-SSOT, drift detection). What is not yet established:

- **How an agent progresses through an iteration** — the cycle (READ → PLAN → RED → GREEN → REFACTOR → checklist → PR → merge), which methodologies (SDD/TDD) are hard rules vs. soft.
- **How any agent (Claude Code, Codex, future Cursor) picks up context at the start of a fresh session**, without stale-state files.
- **AI-specific drift guards** on top of the general ones in ADR-0006 §7 — what catches SDD-link violations, TDD discipline breaks, ADR non-compliance.
- **Cross-vendor PR review** — independent agent review of another vendor's PRs as a mandatory gate before human merge.
- **Prompt-caching and cost discipline** — without gateway infrastructure (premature for Phase 0).
- **Autonomy ladder** — which tasks an agent can close independently (with human-merge), which it cannot, and what conditions trigger a phase upgrade.
- **Runtime AI infrastructure** (LLM gateway, PD filter, Zone-AI VM, OTel GenAI collector) — needed for Content Pipeline v2/v3 and AI recommendations v3 (PRD §24, §15), but not for Phase 0 dev-time work. Must be designed **now** (with explicit trigger points) and **implemented later** (separate ADR on trigger).

Hard requirements:

- AI-friendliness: AI reads documentation from the repo directly, without MCP-fetch proxies (inherited from ADR-0006).
- Self-hosted runtime stack (Federal Law 152-FZ; see ADR-0006 §1).
- Mainstream coding-agent ecosystem (Claude Code + Codex cover ≥95% market share of AI coding assistants in 2026).
- [[feedback_docs_as_ssot]]: PR updates documentation; docs do not contradict code by construction.
- [[feedback_tech_stack_criteria_no_team_skill]]: intrinsic criteria, no bias arguments from prototypes/habits.

---

## 2. Decision

### 2.1 Scope ADR-0007 — "Option 2: dev-time + minimum runtime foundation"

This ADR establishes:

- **Phase 0 dev-time AI-loop methodology** (full implementation in Phase 0).
- **Deferred runtime architecture** (design + trigger conditions only; implementation via a separate ADR on trigger).

Does not establish:

- Specific runtime LLM/TTS/video/image providers — these are product decisions, delegated to the trigger moment.
- Vector DB engine choice beyond the pgvector default from ADR-0003 — trigger for Qdrant is a separate ADR.

### 2.2 Coding agent harnesses Pre-pilot

- **Primary: Claude Code** (sync, terminal-attached in VSC). Tech Lead's current working mode; retained unchanged.
- **Opt-in async: Codex (cloud)** — activated by Tech Lead's decision to launch the first parallel task. AGENTS.md is already Codex-compatible (universal constitution from ADR-0006).
- **Deferred: Cursor.** Trigger: hiring of a second engineer with inline-AI workflow preference.

All harnesses follow the same 8-step iteration cycle (see §2.4).

### 2.3 SDD + TDD as hard rules

- **SDD:** no production code without a feature spec in `apps/docs/content/specs/features/NNN-<slug>/` (3 files: requirements/design/scenarios — format from ADR-0006 §4). If there is no spec, the agent first writes one via superpowers:brainstorming.
- **TDD:** no production code without a failing test. One Vitest test per EARS requirement, naming `it('EARS-N.M: ...', ...)`. Playwright tests are generated from `scenarios.feature` via `playwright-bdd`.
- **Narrow exceptions** (typo / doc-only / dep-bumps / regenerated artifacts) are documented in the PR description.

Enforcement: AGENTS.md hard rules + machine-checkable CI guards (§2.6).

### 2.4 8-step iteration cycle

```
1. READ        — run agent-bootstrap; load AGENTS.md, spec, ADRs, glossary, gh issue
2. PLAN        — create parent Issue + sub-issues per EARS (gh issue create with milestone NNN-<slug>); or resume open Issue
3. RED         — write failing tests first (TDD)
4. GREEN       — minimum code to pass
5. REFACTOR    — clean up, keep green
6. CHECKLIST   — 9-item iteration-end checklist (§2.7)
7. PR OPEN     — title with [#N], body with Closes #N; CI gates trip
8. HUMAN-MERGE — Tech Lead reads diff + reviewer-bot comments; merge → Issue closes
```

### 2.5 Session bootstrap — `tools/agent-bootstrap.ts`

A deterministic script that any harness runs at the start of a fresh session. Output — markdown ≤ 2 KB with a live state snapshot: git state, open Issues assigned to @me, awaiting-review PRs, ready queue, active spec(s) metadata, recommended next step, context file paths.

Sources of truth: `gh` CLI + `git` + spec frontmatter. No state file that could go stale.

Per-harness integration:

- **Claude Code:** SessionStart hook in `.claude/settings.json`, output goes into `additionalContext`.
- **Codex:** AGENTS.md "Before any task" first step — execute bootstrap.
- **Manual:** `pnpm bootstrap` alias.

Sketch and edge cases — design spec §4.

### 2.6 AI-specific CI drift guards (on top of ADR-0006 §7)

| Guard                           | What it catches                                                                                                                                                   | Severity Phase 0              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **spec-link required**          | PR with label `feature:*` without `Closes #N` on an Issue with a matching milestone and spec folder. Non-feature PR (bug/chore) — skipped.                        | BLOCK                         |
| **TDD signal**                  | implementation-only commit without a test file                                                                                                                    | WARN v1                       |
| **cross-vendor review visited** | merge without passing GH status check `agent-review` (workflow exit 0; reviewer-bot always posts either a review comment or a `[REVIEWER-UNAVAILABLE]` fallback). | BLOCK (status check required) |
| **EARS ↔ test linkage**         | EARS requirement without an `it('EARS-N.M: ...')` test (content-search across all `apps/**/*.test.ts`)                                                            | WARN v1 → BLOCK v2            |
| **Gherkin coverage**            | scenarios without Playwright step implementation                                                                                                                  | BLOCK (via test fail)         |
| **Spec status freshness**       | merged PR with label `feature:*`, but spec status='Draft'                                                                                                         | WARN v1                       |
| **Prior decisions cited**       | new spec without an ADR-link in "Prior decisions" if category ≠ docs-only                                                                                         | WARN v1                       |

Implementation in `tools/lint/spec-link-lint.ts`, `tools/lint/ears-test-lint.ts`. Branch protection rule requires passing status check `agent-review` (not an approving review from a bot account) — this ensures the reviewer-agent run _occurred_, while human approval remains a separate branch protection requirement.

### 2.7 9-item iteration-end checklist (AGENTS.md hard rule)

Before `git push` the agent verifies:

1. Tests green (unit + e2e)
2. Generated artifacts up-to-date (`pnpm generate:all && git diff --exit-code`)
3. TypeScript compiles
4. Lint clean
5. Module README updated if exports changed
6. Spec `status:` frontmatter updated
7. New glossary terms added if domain vocabulary grew
8. ADR created if an architectural decision was made
9. Linked Issue received a summary comment (file paths, decisions, what remains)

Failure of any item → no push; either fix or escalate.

### 2.8 Cross-vendor reviewer-agent

GH Action `agent-review.yml` on PR open/synchronize:

- Determines the opposing vendor (if PR is from Claude → reviewer = GPT-5-equivalent, and vice versa)
- Loads context via `packages/llm-utils/buildContext.ts` (stable prefix for prompt-cache)
- Two-pass review: (a) general code review, (b) ADR/SDD compliance
- Posts review comments via `gh pr review --comment` (NOT approval — human gate is preserved)
- Markers `[BLOCKING] / [NIT] / [SUGGESTION]` for prioritization

Branch protection rule requires reviewer-bot review (or explicit `[OK-TO-MERGE]` marker) before merge. Approval remains with the human.

Cost estimate: ~$0.15/day at 5 PRs/day with 70% prompt-cache hit rate.

### 2.9 Prompt-caching policy

Hard rule in AGENTS.md for all runtime LLM calls (reviewer-bot, future Content Pipeline, etc.):

- `cache_control: ephemeral` on 3 stable tier blocks (Anthropic limit = 4 breakpoints; 3 of 4 are used): (1) AGENTS.md+CLAUDE.md concat, (2) active spec 3 files concat, (3) ADRs sorted concat. One breakpoint remains free for future expansion (module READMEs, persona configs, etc.).
- **Tier 4 = volatile glossary entries**, intentionally uncached: glossary is placed **last** in the payload, **without** `cache_control` — this preserves cache hit on tiers 1–3 when glossary changes (new terms are added during development; if glossary had its own breakpoint, each change would invalidate the entire prefix).
- Also do NOT cache: user dialogue / current task instructions (volatile by definition).
- **Stable prefix order** is guaranteed by the shared `packages/llm-utils/buildContext.ts` helper.
- Goal: ≥60% cache hit rate on second+ calls in a session.

### 2.10 Cost observability — Phase 0 without gateway

`tools/cost-ledger-sync.ts` runs weekly via GH Actions cron:

1. Pull usage from Anthropic Admin API + OpenAI Admin API
2. Append rows to `outputs/llm-cost-ledger.csv` (date, vendor, project, tokens, cost_usd)
3. Open GitHub Issue with label `cost-alert` if weekly cost > soft cap (default $50)
4. **Auto-PR** with updated CSV (not a direct push to main — consistent with §2.11 ban on direct push). Tech Lead merges the PR at the next session.
5. On empty rows from both pullers — explicit `process.exit(2)` so the GH Actions step shows red and Tech Lead notices the downtime (rather than a silent no-op for weeks).

No LiteLLM, no in-line rejection, no OTel collector — premature for Phase 0. Soft cap alert via Issue + human discretion is sufficient. Full observability stack — §3.

### 2.11 Autonomy ladder

**Phase 2 (Pre-pilot target):**

- Agents write PRs for features/bugfixes/refactors
- Human-merge gate is mandatory (branch protection)
- Cross-vendor reviewer-bot is mandatory (branch protection)
- Auto-merge prohibited
- Write access to prod-DB prohibited
- Direct push to main prohibited
- Auto-chores (lint-fix, devDep bumps, doc-sync) allowed via bot-PR with label `chore:auto` — still through cross-vendor review + human merge

**Triggers for Phase 3** (auto-merge low-risk PR behind feature flag):

- ≥50 successful agent-PRs without post-merge incident
- Reviewer-bot precision ≥70%, recall ≥50% — measured by formal protocol (see spec §8.2: TP/FP/FN definitions, Tech Lead as evaluator, CSV tracking, sample 20+ PRs with findings)
- Documented low-risk criteria in a separate ADR
- Kill switch tested

**Kill switch:** `.github/agents-config.json` `{ "agents_enabled": false, "cross_vendor_review_required": true }` — Action `agent-review.yml` skips itself; changed via a regular PR + human merge (cannot self-destruct). The `auto_merge_enabled` field is absent in Phase 2 (auto-merge disabled by design); it will be added in the Phase 3 ADR.

### 2.12 Deferred runtime architecture (design only, implementation on trigger)

These components are **designed now** (see design spec §9), **implemented on triggers** via separate ADRs:

| Component                                    | Trigger                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| **LiteLLM Proxy + Zone-AI VM** (Hetzner EU)  | First runtime AI feature deploy (Content Pipeline v2 LLM draft)                       |
| **PD filter** (regex v1, NER v2)             | Same trigger                                                                          |
| **OTel GenAI collector** (gen_ai.\* semconv) | Same trigger; in Phase 0 — minimal stderr token logging                               |
| **Vector DB Qdrant** (replacing pgvector)    | Mobile v3 AI recommendations p95 query >100ms or vector workload interferes with OLTP |
| **Self-hosted GHA runner on Timeweb**        | DSO-31 setup (general CI), not AI-specific                                            |
| **Sandbox / experimentation environment**    | Team ≥3 engineers with parallel agent-PRs, or regular need to debug gateway           |
| **Codex cloud async activation**             | Tech Lead decides to launch the first async task (opt-in self-serve)                  |

Runtime gateway architecture:

- **Two LiteLLM Proxy instances** (MIT, OpenAI-compatible, virtual keys + budgets + prompt-cache passthrough): instance A in Hetzner EU for Anthropic+OpenAI (foreign endpoints require EU egress); instance B in Zone RF (Timeweb) for YandexGPT (RF-only API, must not hop to EU). Both share one Postgres state (replication for unified budgets/keys).
- **mTLS RF → Zone AI** for outbound to instance A; instance B is fully inside Zone RF.
- **PII Filter applied unconditionally** to both routes — even YandexGPT inside the Russian Federation (RF) (Federal Law 152-FZ requires anonymization when sending to any third party).
- **LiteLLM admin UI** has no native OIDC — will require an nginx forward-auth proxy with Authentik/Zitadel (ADR-0001 tenant). Non-trivial setup; documented in the trigger-ADR.

**Self-host honest framing (parallel to ADR-0006 §3 Keystatic/GitHub caveat):** Hetzner EU = non-RF compute. Federal Law 152-FZ is not violated because personal data (PD) is anonymized by the PII Filter **before** crossing the Zone RF → Zone AI boundary; only sanitized prompts cross the boundary. This is "self-host" in the sense of "infrastructure we control," but **not "data sovereignty"** in the strict sense (compute in EU). Trigger to revisit fallback: Hetzner blocked from RF, or regulatory requirement for AI compute-in-RF — fallback to Timeweb self-hosted with an international egress proxy.

**Pre-v2 prerequisite — dual-LLM pattern for user content:** before launching Content Pipeline v2 — a formal assessment of whether user-controlled content (briefs from co-authors, file uploads) enters the pipeline. If yes — the OWASP dual-LLM pattern (privileged + quarantined LLM) is implemented in the trigger-ADR, not deferred further.

Details — design spec §9.

---

## 3. Consequences

### Positive

- **Tech Lead's current workflow (sync Claude Code in VSC) is unchanged** — Phase 0 relies on this mode as primary. The SessionStart hook is added transparently via `.claude/settings.json`.
- **Any agent orients itself within <2 KB of context** — the bootstrap script provides a deterministic snapshot; state fragmentation between sessions is minimized.
- **SDD/TDD enforced machine-checkably** — not just rhetorical in AGENTS.md, but real CI gates catch skipped discipline.
- **Cross-vendor review reduces correlated code-level errors** — two different LLM lineages have different blind spots for bugs/security/edge cases. **Caveat:** the ADR/SDD compliance pass feeds both models the same ADR text, so correlated misinterpretation of ADR wording is not eliminated — the human merge gate remains the primary safeguard for architectural decisions (see spec §6.6).
- **Phase 0 requires no runtime infrastructure** — Hetzner/LiteLLM/PII/OTel deferred with explicit triggers; no premature optimization.
- **Prompt-caching saves ~60–80% input tokens** on second+ calls; cost discipline soft cap + weekly review is sufficient for Pre-pilot scale.
- **Codex activates opt-in** — does not block Phase 0 start; when Tech Lead is ready to parallelize — instant pickup without re-arch.
- **Vendor lock minimized** — AGENTS.md is universal, bootstrap is vendor-agnostic; any harness (Cursor, GitHub Copilot Workspace, Devin) plugs in via the same interface.

### Negative

- **AGENTS.md grows** — DSO-30 adds an AI-loop section ~80 lines on top of the ADR-0006 baseline. Long files = more prompt input to read (but cached).
- **`buildContext.ts` helper — one more thing to maintain** — mandatory entry point for all runtime LLM clients (reviewer-bot, future Content Pipeline). Changing order = cache invalidation.
- **Reviewer-bot vendor detection — explicit label** `author:claude` / `author:codex` is set by the author-agent at PR open (part of AGENTS.md PR template). Default when label is absent = OpenAI as reviewer (Claude is the primary harness in Phase 0, so fallback to non-Claude). Originally a heuristic on commit-message grep was planned, but in the default case that heuristic always chose Anthropic — violating the cross-vendor property for most PRs. Explicit label resolves this.
- **Branch protection rule on reviewer-bot** means that if the bot API is down, merge is blocked. Mitigation: kill switch + `[OK-TO-MERGE]` marker for emergency bypass.
- **TDD signal lint — heuristic with false positives** — an implementation file without a test file in the diff may be legitimate (e.g., refactoring existing code, test already exists). WARN-only v1; BLOCK is switched on after calibration.
- **Bootstrap depends on GitHub auth** in the working environment — if `gh` is not authenticated, fallback to git-only output (graceful, but reduced usefulness).
- **Cost-ledger requires Admin API keys** — separate from main API keys; must be configured in Anthropic Console and OpenAI org settings.

### Risks

- **Anthropic / OpenAI usage API shape changes** — Admin endpoints are less stable than chat completions. Mitigation: `cost-ledger-sync.ts` encapsulates pull logic; a breaking change is a targeted fix that doesn't affect the rest of the infrastructure.
- **OpenAI API availability from Hetzner EU** — reverse-sanctions changes (block on EU IPs from OpenAI, or Hetzner.com blocked from RF) would deprive the cross-vendor reviewer of one of its two vendors. Mitigation: kill switch disables the required status check, temporarily human-only review; parallel reviewer configuration with Mistral / Gemini (via LiteLLM routing, requires trigger-ADR runtime infra deployed) as fallback. For Phase 0, no explicit fallback required (cross-vendor review is desirable but does not block basic development during isolated downtime).
- **Reviewer-bot generates noise** — if precision is too low, Tech Lead stops reading review comments. Mitigation: precision/recall metric on a sample of 20+ PRs in Phase 1; if <50% — revisit prompts or switch vendor.
- **Product Lead or a new developer writes code bypassing the SDD cycle** — social risk. Mitigation: spec-link CI guard at BLOCK level; no merge without spec.
- **Phase 3 activation premature** — if auto-merge is enabled too early, a post-merge incident may be costly. Mitigation: criteria from §2.11 (50+ PRs, 70%+ precision, documented low-risk classes) as gate.
- **Prompt-cache invalidation** when a new ADR / spec is added — Anthropic cache TTL 5 minutes; OpenAI prefix must be byte-identical. `buildContext.ts` sorting ADRs by number ensures determinism; a new ADR starts a new cache (acceptable).
- **`tools/agent-bootstrap.ts` depends on `gh` CLI and `simple-git`** at runtime — if absent in the CI runner, bootstrap fails. Mitigation: CI installs gh; for local dev — gh is already standard.

---

## 4. Alternatives considered (rejected or deferred)

| Alternative                                                                                 | Reason rejected/deferred                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LiteLLM Proxy in Phase 0** (Zone-AI VM immediately)                                       | Premature: dev-time agents call their APIs directly (Anthropic, OpenAI) via their own clients. Gateway is only useful for runtime AI features (Content Pipeline). Deploying a Hetzner VM now = ops overhead without value. Deferred §2.12.      |
| **Northflank / Daytona managed sandbox**                                                    | Vendor-lock + RF-availability uncertain (US/EU providers) + payment friction. Self-hosted k8s namespace on Timeweb (when needed) — proven RF path. Deferred §2.12.                                                                              |
| **Claude Code only (no Codex)**                                                             | Vendor lock-in without diversification; cross-vendor review pattern loses its purpose. With Codex as opt-in async — best of both.                                                                                                               |
| **Multi-agent from the start (Claude + Cursor + Codex + Devin)**                            | Overhead: 3+ configs, 3+ cost streams, 3+ sandbox specifics. Not justified for team-of-1+AI. Cursor deferred with explicit trigger.                                                                                                             |
| **Phase 1 read-only autonomy**                                                              | Too conservative: Tech Lead already works in Phase 2 mode (agents write PRs); a downgrade would be a regression.                                                                                                                                |
| **Phase 3 auto-merge immediately**                                                          | Premature: no baseline for measuring reviewer precision; risk-reward not justified for Pre-pilot. Trigger criteria established.                                                                                                                 |
| **Plan markdown in `docs/superpowers/plans/` for every task (classic superpowers pattern)** | Duplication with GitHub Issues (ADR-0006 §9). Plan markdown is justified only for multi-step work within a single Issue. Default flow: Issue body + sub-issues = task tracking.                                                                 |
| **AGENTS.md only, no CLAUDE.md**                                                            | Loses Claude-specific MCP/skills/SessionStart hook config. Split inherited from ADR-0006.                                                                                                                                                       |
| **Self-written reviewer agent without LLM (rule-based linter only)**                        | Does not catch logical bugs, edge cases, security context-aware issues. LLM-reviewer catches a class of errors that a linter cannot (by design).                                                                                                |
| **OWASP dual-LLM pattern (privileged LLM separated from quarantined)** for Phase 0          | Overkill: Phase 0 dev-time agents do not process untrusted user content at runtime. Trigger: runtime AI feature processing user-supplied content (Content Pipeline, support tickets) — implemented at 9.1 trigger moment.                       |
| **OTel GenAI semconv collector in Phase 0**                                                 | Premature without runtime AI traffic. Minimal stderr token logging is sufficient. Deferred §2.12.                                                                                                                                               |
| **Hard cost cap with in-line rejection (Portkey-style)** in Phase 0                         | Requires gateway (LiteLLM) — preface §9.1 trigger. Phase 0 soft cap + Issue alert is reasonable.                                                                                                                                                |
| **GitHub Copilot Workspace instead of Codex**                                               | Codex covers the same use-case (cloud async PR-opening agent) but with greater maturity in 2025–2026 and an open ecosystem. Copilot Workspace = yet another vendor lock-in to GitHub. Not blocked — can be added in parallel if there is value. |
| **Full Spec-Driven Development per Kiro/BMAD framework**                                    | Heavier than ADR-0006 hybrid SDD pattern; overhead not justified for team-of-1+AI. Hybrid (3-file spec + GitHub Issues) — proven on DSO-25..29 cycle.                                                                                           |

---

## 5. Open questions (deferred)

| ID      | Q                                                                                               | Where resolved                                                                                          |
| ------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OQ-AI1  | Actual shape of Anthropic Admin API usage endpoint                                              | At impl of cost-ledger-sync.ts (DSO-31+ step 11)                                                        |
| OQ-AI2  | Reviewer-bot precision baseline on sample 20+ PRs                                               | Phase 1 after 20 PRs closed                                                                             |
| OQ-AI3  | TDD signal lint false-positive rate in practice                                                 | Phase 1 after 10 PRs in Vitest scope                                                                    |
| OQ-AI4  | Phase 3 low-risk criteria — specific allowlist                                                  | Separate ADR when 50+ PR threshold is reached                                                           |
| OQ-AI5  | Vendor detection — explicit label vs commit-message grep                                        | v2 enhancement; explicit label at PR creation                                                           |
| OQ-AI6  | Codex GitHub App config specifics                                                               | When Tech Lead activates Codex                                                                          |
| OQ-AI7  | Deep dual-LLM pattern for untrusted-content AI features                                         | At 9.1 trigger; depends on first runtime AI feature (Content Pipeline)                                  |
| OQ-AI8  | Glossary auto-population from reviewer-bot                                                      | Phase 1 enhancement if manual coverage is insufficient                                                  |
| OQ-AI9  | OTel GenAI collector deployment topology — single or HA                                         | At 9.1 trigger                                                                                          |
| OQ-AI10 | PII-filter NER (spaCy Russian) trigger threshold                                                | After measurement on synthetic corpus at 9.1 trigger                                                    |
| OQ-AI11 | Output-direction PD filter (LLM-hallucinated PII) — v3 expansion                                | Trigger: first AI-generated content published to an external recipient without human pre-publish review |
| OQ-AI12 | LiteLLM admin UI OIDC integration (via nginx forward-auth) — detailed design                    | In trigger-ADR 9.1                                                                                      |
| OQ-AI13 | Fallback reviewer vendor (Mistral / Gemini) when OpenAI EU unavailable — pre-config via LiteLLM | Trigger: first sustained downtime of OpenAI or Hetzner EU                                               |

---

## 6. Related ADRs / Delegated

**Inherited from:**

- ADR-0001 — Authentik/Zitadel: future runtime LLM gateway admin (§2.12) protected by the same OIDC tenant
- ADR-0002 §6 — BullMQ as async queue for AI jobs (§2.12 trigger)
- ADR-0003 §7 — pgvector default vector DB; trigger for Qdrant — separate ADR
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule included by reviewer-bot in SDD-compliance pass
- ADR-0005 — mobile AI recommendations v3 will go through the runtime LLM gateway
- ADR-0006 §7 — drift detection extended with 7 AI-specific guards
- ADR-0006 §4 — 3-file feature-spec format inherited (formerly mis-cited as §8 = Diagrams; fixed DSO-61)
- ADR-0006 §9 — GitHub Issues task tracker + milestone convention inherited
- ADR-0006 §5 / spec §9 — AGENTS.md / CLAUDE.md split inherited + extended with AI-loop section (see spec §10.1, §10.2 of this ADR — §10.2 is explicitly marked as additive over baseline)

**See also (forward references):**

- **ADR-0010** — dual-LLM mandatory pattern for any runtime AI flow with tool use or untrusted user content (Quarantined LLM ↔ Privileged LLM split, symbolic references).
- **`2026-05-18-ds-platform-dual-llm-pattern-design`** — implementation design spec for dual-LLM: contracts, threat model, integration with egress proxy and audit classes.

**Delegated to other tasks:**

- **DSO-31 (Repo strategy / Engineering readiness):** implementation of `tools/agent-bootstrap.ts`, `packages/llm-utils/`, `tools/reviewer-agent/`, `.github/workflows/{agent-review,cost-ledger}.yml`, AGENTS.md / CLAUDE.md updates, branch protection rules, `.github/agents-config.json` kill switch. Full migration plan — design spec §11.
- **Future ADR-NNNN (runtime AI infra):** LiteLLM Proxy + Zone-AI VM (Hetzner EU) + PD filter + OTel GenAI collector. Trigger: first runtime AI feature deploy (Content Pipeline v2 LLM draft).
- **Future ADR-NNNN (Phase 3 autonomy):** auto-merge low-risk PR behind feature flag. Trigger: 50+ PRs + reviewer-bot 70%+ precision + low-risk criteria documented.
- **Future ADR-NNNN (Qdrant migration):** vector DB scaling beyond pgvector. Trigger: mobile v3 AI recommendations p95 >100ms.

**Affects (downstream):**

- **DSO-31** — structure of `tools/`, `packages/llm-utils/`, `.github/workflows/`, AGENTS.md / CLAUDE.md baseline.
- **All feature specs DS Platform** — must pass through the 8-step cycle and 9-item checklist.
- **Content Pipeline v2 implementation** — will be the first triggering event for the runtime LLM gateway ADR.

---

## 7. Amendments

### Amendment A1 — Drop automated reviewer-bot + cost-ledger automation (2026-05-19)

**Context:** ADR-0007 §2.8 (cross-vendor reviewer-bot), §2.10 (cost-ledger weekly cron + auto-PR) and the Phase 2/3 autonomy ladder in §2.11 were all built around the assumption of headless CI-driven LLM calls — GitHub Actions invoking Anthropic/OpenAI APIs with credentials living in repo secrets. Two practical concerns surfaced before Phase A engineering started building this layer:

1. **Tuning loop cost.** The Tech Lead has prior experience with multi-month tuning loops on CI-driven LLM automation (precision/recall calibration, prompt drift on context changes, vendor API shape changes). That loop competes with product-development time during the most velocity-constrained window (pre-pilot).
2. **Product velocity is the priority constraint** until pre-pilot ships. Automation that requires a months-long tuning loop to be useful is a poor investment before there is product to observe.

A pragmatic alternative exists: keep humans + interactive sessions in the review loop. LLM assistance during review is retained, but moved from CI to the human's own terminal — under the human's credentials, on the human's clock.

**Decision (amendment):**

**A1.1 — Automated reviewer-bot dropped.** `tools/reviewer-agent/`, `.github/workflows/agent-review.yml`, and the `cross_vendor_review_required` flag in `.github/agents-config.json` are **not implemented in Phase 0**. ADR-0007 §2.8 ("Cross-vendor reviewer-agent") is marked **SUPERSEDED** by this amendment.

**A1.2 — Automated cost-ledger dropped.** `tools/cost-ledger-sync.ts`, `.github/workflows/cost-ledger.yml`, and the weekly auto-PR pattern are **not implemented in Phase 0**. ADR-0007 §2.10 ("Cost observability — Phase 0 without gateway") is marked **SUPERSEDED**. Cost tracking now happens via each vendor's own console (Anthropic Console, OpenAI Platform) checked manually by the Tech Lead. Out of repo scope.

**A1.3 — Replacement model: interactive-only LLM-assisted review.** Three review modes are available to the human reviewer, chosen per PR at the human's discretion:

- **Mode (a) — main-session subagent dispatch.** The human's primary Claude Code terminal session dispatches a subagent with a `/review` skill against the current branch/PR before opening it for merge.
- **Mode (b) — parallel Codex CLI session.** The human runs a parallel Codex CLI session in another terminal and asks Codex to review the PR.
- **Mode (c) — pure human review.** No LLM assist.

All three modes are **interactive**, session-driven, and use **the human's own LLM credentials** in their terminal. No API keys live in GitHub repo secrets. No headless CI invocation of LLM APIs in Phase 0.

**A1.4 — 8-step iteration cycle (ADR-0007 §2.4) updated.** Step 7 (PR open) unchanged. Step 8 was "HUMAN-MERGE — Tech Lead reads diff + reviewer-bot comments; merge → Issue closes"; it is now:

> **8. HUMAN-MERGE** — Human dispatches review in mode (a), (b), or (c) before merge; merge is a single human decision based on CI status checks + (optional) LLM-assist output + human reading of the diff.

**A1.5 — Lint guards in ADR-0007 §2.6 retained.** The five guards (`spec-link`, `ears-test`, `tdd-signal`, `spec-status-fresh`, `prior-decisions`) remain in the CI pipeline at their original severities (BLOCK or WARN per the §2.6 table). Their purpose **shifts**: originally framed as inputs feeding the reviewer-bot's compliance pass, they now serve as **CI signals visible directly to the human reviewer** in the PR UI. WARN-only guards appear as non-blocking checks; BLOCK guards prevent merge. Their role becomes "nudge the human" rather than "feed the bot."

**A1.6 — `.github/agents-config.json` kept as-is for now.** The `agents_enabled: true` field becomes vestigial (no automated agent reads it in the Phase 0 review loop). Removal or repurposing as a kill switch for the interactive `/review` skill tooling is deferred to a future amendment once that tooling is formalised.

**A1.7 — Phase 2 autonomy / Phase 3 auto-merge deferred indefinitely.** ADR-0007 §2.11 milestones (auto-merge low-risk PRs behind feature flag, 50+ PR baseline, reviewer-bot precision/recall calibration) are **deferred without target date**. Revisit trigger: post-Pre-pilot, **all three** of:
(i) product is in users' hands,
(ii) >50 PRs of review-loop data exist (interactive `/review` skill outputs logged manually, OR a future automated reviewer-bot is reconsidered and built),
(iii) Tech Lead has bandwidth for the tuning loop.

Until then, Phase 2 baseline = human-merge gate + lint guards + interactive review (mode a/b/c). Phase 3 = not on the roadmap.

**Consequences:**

- **Branch protection simplified** — required status checks list drops `agent-review`. See ADR-0008 Amendment A2 for the §2.6 edit.
- **Plane sub-issues cancelled** — DSP-172 (reviewer-agent scaffolding), DSP-173 (workflow YAML), DSP-177 (cost-ledger script), DSP-184 (cost-ledger workflow) — the G4 + G6 groups in the Phase A orchestration plan. Cancellation is separate Plane work tracked under DSP-160.
- **AI-stack design spec amendments** — §6, §7 (cost observability subsection), §10 (CLAUDE.md overlay review tooling section) prepended with SUPERSEDED callouts; §11 migration plan Steps 5/6/10 marked cancelled. See spec Amendment SD1.
- **`.github/agents-config.json` shipped in G3 (commit `7c72d6a` in `doctor-school/ds-platform`)** stays in tree but its enforcement semantics are vestigial until interactive-review tooling adopts a kill switch.
- **Cost visibility manual.** Tech Lead checks Anthropic Console + OpenAI Platform directly; no repo-side ledger.
- **Cross-vendor blind-spot reduction lost.** ADR-0007 §3 Positive item "Cross-vendor review reduces correlated code-level errors" is no longer in effect. Mitigation: human reviewer can opt for mode (b) Codex CLI when reviewing a Claude-authored PR (and vice versa) — same property, manual cadence.

**Why now (timing):** G4 (reviewer-bot) was the next group in the Phase A orchestration plan. Building it would have been ~2–3 sessions of work plus an ongoing tuning loop. Dropping it now saves weeks of meta-work during the velocity-constrained pre-pilot window. The lint-guard work in G5 is unaffected — those CI checks remain useful regardless of who/what consumes them.

**Open follow-up:**

- **OQ-A1** — Revisit trigger for re-introducing automated review: concrete metric for "tuning ROI proven" (e.g., catch-rate on a labelled sample of past PRs that beats N hours/week of human review time saved).
- **OQ-A2** — `.github/agents-config.json`: remove entirely, or keep as interactive-tooling kill switch? Defer until the interactive `/review` skill is formalised and may want a kill switch.

**Affects (downstream):**

- **ADR-0008** §2.6 — see Amendment A2 in ADR-0008.
- **AI-stack design spec** (`0007-ai-stack-design-en.md`) — §6 (reviewer-bot architecture), §7 (cost observability subsection), §10 (CLAUDE.md overlay review tooling), §11 Migration plan Steps 5/6/10 — all SUPERSEDED per spec Amendment SD1.
- **Plane workspace `doctor-school`** — 4 sub-issues cancelled (DSP-172, DSP-173, DSP-177, DSP-184); 2 sub-issues description-updated (DSP-180 Step 13, DSP-189 Step 21).
