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
**Inherits:** ADR-0001 (Zitadel), ADR-0002 (NestJS + BullMQ), ADR-0003 (Postgres17 + pgvector), ADR-0004 (Next.js 15 + ESLint guards), ADR-0005 (RN+Expo), ADR-0006 (Fumadocs + Keystatic + SDD + GitHub Issues task split)

---

## 1. Context

DS Platform is a greenfield TS/Postgres platform developed in Phase 0 primarily by AI agents (Claude Code and Codex) with a minimal team (Tech Lead + non-technical product owner Product Lead, no second engineer). Documentation and task tracking are already established in ADR-0006 (SDD format, GitHub Issues, glossary-SSOT, drift detection). What is not yet established:

- **How an agent progresses through an iteration** — the cycle (READ → PLAN → RED → GREEN → REFACTOR → checklist → PR → merge), which methodologies (SDD/TDD) are hard rules vs. soft.
- **How any agent (Claude Code, Codex, future Cursor) picks up context at the start of a fresh session**, without stale-state files.
- **AI-specific drift guards** on top of the general ones in ADR-0006 §7 — what catches SDD-link violations, TDD discipline breaks, ADR non-compliance.
- **Review modes** — what review path (subagent, parallel Codex CLI session, pure human) is acceptable, and when a positive verdict permits auto-merge.
- **Prompt-caching and cost discipline** — without gateway infrastructure (premature for Phase 0).
- **Autonomy ladder** — what review path is required per PR, what conditions would trigger re-introducing automated reviewer infrastructure.
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

All harnesses follow the same orchestrated iteration cycle (see §2.4).

### 2.3 SDD + TDD as hard rules

- **SDD:** no production code without a feature spec in `apps/docs/content/specs/features/NNN-<slug>/` (3 files: requirements/design/scenarios — format from ADR-0006 §4). If there is no spec, the agent first writes one via superpowers:brainstorming.
- **TDD:** no production code without a failing test. One Vitest test per EARS requirement, naming `it('EARS-N: ...', ...)`. Playwright tests are generated from `NNN-scenarios.feature` via `playwright-bdd`.
- **Narrow exceptions** (typo / doc-only / dep-bumps / regenerated artifacts) are documented in the PR description.

Enforcement: AGENTS.md hard rules + machine-checkable CI guards (§2.6).

### 2.4 Iteration cycle — delegated to `do-feature-iteration` skill

Every implementation iteration follows an orchestrated cycle: READ relevant ADRs → verify base CI green → RED (failing test) → GREEN (minimum code) → REFACTOR → iteration-end checklist (dispatch, verdict-gated) → surface decision-debt → PR open → Mode (a) review dispatch (verdict-gated) → respond-to-review until APPROVE + green CI → iteration summary → merge via `gh pr merge <N> --auto --squash --delete-branch`. A positive Mode (a) or Mode (b) review verdict + green CI is sufficient for merge; Mode (c) reviews remain a single human decision.

The procedural source of truth is **`apps/docs/content/skills/do-feature-iteration/SKILL.md`**. The orchestration skill carries the discipline gates — checklist verdict, review verdict, decision-debt invocation — that an inline narrative checklist cannot enforce: an agent reading a narrative bullet list will skip silently, but an agent that cannot proceed without an artifact returned by a subagent cannot skip. Concretely:

- **`run-iteration-end-checklist`** runs in dispatch mode; the subagent returns a structured verdict line `VERDICT: N of 14 — <PASS | BLOCKED on #X>`. The lead agent cannot proceed past the checklist gate while the verdict is `BLOCKED`.
- **`request-mode-a-review`** runs in dispatch mode; the subagent reviewer returns a structured verdict line `VERDICT: <APPROVE | REQUEST_CHANGES>`. The lead agent cannot invoke `merge-when-green` while the latest verdict is `REQUEST_CHANGES` or absent.
- **`surface-decision-debt`** is required before `write-iteration-summary`. The skill's output may be `[]`, but the invocation itself is required.

The `superpowers:*` chain is replaced by a single allowed exception — `superpowers:brainstorming` for spec-authoring — and the discipline-skill catalog at `apps/docs/content/skills/` (procedures otherwise absorbed: TDD lives inside `do-feature-iteration`, review dispatch lives inside `request-mode-a-review`).

### 2.5 Session bootstrap — `tools/agent-bootstrap.ts`

A deterministic script that any harness runs at the start of a fresh session. Output — markdown ≤ 2 KB with a live state snapshot: git state, open Issues assigned to @me, awaiting-review PRs, ready queue, active spec(s) metadata, recommended next step, context file paths.

Sources of truth: `gh` CLI + `git` + spec frontmatter. No state file that could go stale.

Per-harness integration:

- **Claude Code:** SessionStart hook in `.claude/settings.json`, output goes into `additionalContext`.
- **Codex:** AGENTS.md "Before any task" first step — execute bootstrap.
- **Manual:** `pnpm bootstrap` alias.

Sketch and edge cases — design spec §4.

### 2.6 AI-specific CI drift guards (on top of ADR-0006 §7)

| Guard                     | What it catches                                                                                                                                                                                                                | Severity Phase 0      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| **spec-link required**    | PR labeled `feature:NNN-<slug>` not linked to its spec: no `Closes #N`, a linked Issue without a (product-theme) milestone, or the label's spec folder (`features/NNN-<slug>/`) missing. Non-feature PR (bug/chore) — skipped. | BLOCK                 |
| **TDD signal**            | implementation-only commit without a test file                                                                                                                                                                                 | WARN v1               |
| **EARS ↔ test linkage**   | EARS requirement without an `it('EARS-N: ...')` test (content-search across all `apps/**/*.test.ts`)                                                                                                                           | WARN v1 → BLOCK v2    |
| **Gherkin coverage**      | scenarios without Playwright step implementation                                                                                                                                                                               | BLOCK (via test fail) |
| **Spec status freshness** | merged PR with label `feature:*`, but spec status='Draft'                                                                                                                                                                      | WARN v1               |
| **Prior decisions cited** | new spec without an ADR-link in "Prior decisions" if category ≠ docs-only                                                                                                                                                      | WARN v1               |

Implementation in `tools/lint/spec-link-lint.ts`, `tools/lint/ears-test-lint.ts`. These guards are CI signals visible directly to the human reviewer in the PR UI: WARN-only guards appear as non-blocking checks; BLOCK guards prevent merge. Their role is "nudge the human reviewer" — they are inputs to human review, not inputs to an automated reviewer.

> **Interim semantics note (per ADR-0008 §2.6 deferred branch protection):** while ADR-0008 §2.6 branch protection is deferred until org plan upgrade or the repo is made public, `BLOCK` is read operationally as **"CI job exits red and the Tech Lead treats it as a merge-blocker by convention"** — same outcome on the single-developer happy path, no server-side guarantee.

### 2.7 14-item iteration-end checklist (dispatched via `run-iteration-end-checklist`)

Before `git push` the agent dispatches the `run-iteration-end-checklist` skill to a fresh-context subagent (§2.4). The **authoritative item list is the skill itself** — `apps/docs/content/skills/run-iteration-end-checklist/SKILL.md` — not a copy duplicated here (the catalog is authoritative; companion design §2.2). At time of writing it spans the machine gates (tests, generated-artifact drift, typecheck, lint), the docs-sync items (module README, spec `status:` frontmatter, glossary terms, ADR, `architecture/`, `operations/`), the linked-Issue summary, and three conditional gates — vertical-slice DoD (F-22), field validation + input mask, and the registry-research marker.

The subagent returns `VERDICT: N of 14 — <PASS | BLOCKED on #X>`. Failure of any item → no push; either fix or escalate.

### 2.8 Prompt-caching policy

Hard rule in AGENTS.md for all runtime LLM calls (future Content Pipeline, etc.):

- `cache_control: ephemeral` on 3 stable tier blocks (Anthropic limit = 4 breakpoints; 3 of 4 are used): (1) AGENTS.md+CLAUDE.md concat, (2) active spec 3 files concat, (3) ADRs sorted concat. One breakpoint remains free for future expansion (module READMEs, persona configs, etc.).
- **Tier 4 = volatile glossary entries**, intentionally uncached: glossary is placed **last** in the payload, **without** `cache_control` — this preserves cache hit on tiers 1–3 when glossary changes (new terms are added during development; if glossary had its own breakpoint, each change would invalidate the entire prefix).
- Also do NOT cache: user dialogue / current task instructions (volatile by definition).
- **Stable prefix order** is guaranteed by the shared `packages/llm-utils/buildContext.ts` helper.
- Goal: ≥60% cache hit rate on second+ calls in a session.

### 2.9 Cost observability — manual, per-vendor consoles

Cost tracking happens via each vendor's own console (Anthropic Console, OpenAI Platform) checked manually by the Tech Lead. No headless CI puller, no `outputs/llm-cost-ledger.csv`, no weekly auto-PR, no in-line rejection, no OTel collector — all premature for Phase 0, and the multi-month tuning loop they require competes with product-development time during the velocity-constrained pre-pilot window. Full runtime observability stack lands with the trigger-ADR for runtime AI infra (§2.11).

### 2.10 Autonomy ladder

**Phase 2 (Pre-pilot target):**

- Agents write PRs for features/bugfixes/refactors.
- Three review modes are available to the reviewer, chosen per PR at the human's discretion:
  - **Mode (a)** — main-session subagent dispatch via the `request-mode-a-review` skill (verdict-gated, see §2.4).
  - **Mode (b)** — parallel Codex CLI session reviewing the PR independently.
  - **Mode (c)** — pure human review, no LLM assist.
- All three modes are interactive, session-driven, and use the human's own LLM credentials in their terminal. No API keys live in GitHub repo secrets.
- Auto-merge after a positive Mode (a) or Mode (b) verdict + green CI is permitted via the mandatory invocation `gh pr merge <N> --auto --squash --delete-branch`; Mode (c) reviews remain a single human decision.
- Write access to prod-DB prohibited.
- Direct push to main prohibited.
- Auto-chores (lint-fix, devDep bumps, doc-sync) follow the same review path as feature PRs.

**Triggers for revisiting Phase 3** (auto-merge low-risk PRs behind a feature flag) — deferred without target date. Revisit requires **all three** of:

(i) Product is in users' hands (post-Pre-pilot).
(ii) >50 PRs of review-loop data exist (interactive `/review` skill outputs logged manually, OR an automated reviewer-bot is reconsidered and built).
(iii) Tech Lead has bandwidth for the tuning loop.

Until then, Phase 2 baseline (human-driven review via modes a/b/c + lint guards + auto-merge after positive verdict) is the operating mode.

### 2.11 Deferred runtime architecture (design only, implementation on trigger)

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
- **LiteLLM admin UI** has no native OIDC — will require an nginx forward-auth proxy with Zitadel (ADR-0001 tenant). Non-trivial setup; documented in the trigger-ADR.

**Self-host honest framing (parallel to ADR-0006 §3 Keystatic/GitHub caveat):** Hetzner EU = non-RF compute. Federal Law 152-FZ is not violated because personal data (PD) is anonymized by the PII Filter **before** crossing the Zone RF → Zone AI boundary; only sanitized prompts cross the boundary. This is "self-host" in the sense of "infrastructure we control," but **not "data sovereignty"** in the strict sense (compute in EU). Trigger to revisit fallback: Hetzner blocked from RF, or regulatory requirement for AI compute-in-RF — fallback to Timeweb self-hosted with an international egress proxy.

**Pre-v2 prerequisite — dual-LLM pattern for user content:** before launching Content Pipeline v2 — a formal assessment of whether user-controlled content (briefs from co-authors, file uploads) enters the pipeline. If yes — the OWASP dual-LLM pattern (privileged + quarantined LLM) is implemented in the trigger-ADR, not deferred further.

Details — design spec §9.

---

## 3. Consequences

### Positive

- **Tech Lead's current workflow (sync Claude Code in VSC) is unchanged** — Phase 0 relies on this mode as primary. The SessionStart hook is added transparently via `.claude/settings.json`.
- **Any agent orients itself within <2 KB of context** — the bootstrap script provides a deterministic snapshot; state fragmentation between sessions is minimized.
- **SDD/TDD enforced machine-checkably** — not just rhetorical in AGENTS.md, but real CI gates catch skipped discipline.
- **Interactive review modes use the human's own LLM credentials** — no API keys in repo secrets, no headless CI invocation of paid LLM APIs in Phase 0, no months-long reviewer-bot tuning loop during the velocity-constrained pre-pilot window.
- **Phase 0 requires no runtime infrastructure** — Hetzner/LiteLLM/PII/OTel deferred with explicit triggers; no premature optimization.
- **Prompt-caching saves ~60–80% input tokens** on second+ calls in interactive sessions.
- **Codex activates opt-in** — does not block Phase 0 start; when Tech Lead is ready to parallelize — instant pickup without re-arch.
- **Vendor lock minimized** — AGENTS.md is universal, bootstrap is vendor-agnostic; any harness (Cursor, GitHub Copilot Workspace, Devin) plugs in via the same interface.

### Negative

- **AGENTS.md grows** — the AI-loop section sits on top of the ADR-0006 baseline. Long files = more prompt input to read (but cached).
- **Cross-vendor blind-spot reduction not automatic.** With no headless reviewer-bot, the property "two LLM lineages with different blind spots see every PR" requires the human to deliberately invoke Mode (b) Codex CLI on Claude-authored PRs (and vice versa). Default Mode (a) uses the same LLM lineage as the author.
- **TDD signal lint — heuristic with false positives** — an implementation file without a test file in the diff may be legitimate (e.g., refactoring existing code, test already exists). WARN-only v1; BLOCK is switched on after calibration.
- **Bootstrap depends on GitHub auth** in the working environment — if `gh` is not authenticated, fallback to git-only output (graceful, but reduced usefulness).
- **Cost visibility is manual.** Tech Lead checks Anthropic Console + OpenAI Platform directly; no repo-side ledger; drift is possible if a vendor's console is not visited for weeks.

### Risks

- **Product Lead or a new developer writes code bypassing the SDD cycle** — social risk. Mitigation: spec-link CI guard at BLOCK level; no merge without spec.
- **Reviewer skips Mode (a)/(b) dispatch and merges on green CI alone** — bypass risk for the discipline gate. Mitigation: the `merge-when-green` skill cannot proceed without a verdict artifact from `request-mode-a-review` (see §2.4); G11 retrospective showed this gate is necessary.
- **Phase 3 activation premature** — if auto-merge of low-risk PRs is re-introduced too early, a post-merge incident may be costly. Mitigation: revisit criteria from §2.10 (post-Pre-pilot + 50+ PRs of review data + Tech Lead bandwidth) as gate.
- **`tools/agent-bootstrap.ts` depends on `gh` CLI and `simple-git`** at runtime — if absent in the CI runner, bootstrap fails. Mitigation: CI installs gh; for local dev — gh is already standard.

---

## 4. Alternatives considered (rejected or deferred)

| Alternative                                                                                 | Reason rejected/deferred                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LiteLLM Proxy in Phase 0** (Zone-AI VM immediately)                                       | Premature: dev-time agents call their APIs directly (Anthropic, OpenAI) via their own clients. Gateway is only useful for runtime AI features (Content Pipeline). Deploying a Hetzner VM now = ops overhead without value. Deferred §2.11.                                                                         |
| **Northflank / Daytona managed sandbox**                                                    | Vendor-lock + RF-availability uncertain (US/EU providers) + payment friction. Self-hosted k8s namespace on Timeweb (when needed) — proven RF path. Deferred §2.11.                                                                                                                                                 |
| **Claude Code only (no Codex)**                                                             | Vendor lock-in without diversification; Mode (b) parallel-Codex review path loses its purpose. With Codex as opt-in async — best of both.                                                                                                                                                                          |
| **Multi-agent from the start (Claude + Cursor + Codex + Devin)**                            | Overhead: 3+ configs, 3+ cost streams, 3+ sandbox specifics. Not justified for team-of-1+AI. Cursor deferred with explicit trigger.                                                                                                                                                                                |
| **Phase 1 read-only autonomy**                                                              | Too conservative: Tech Lead already works in Phase 2 mode (agents write PRs); a downgrade would be a regression.                                                                                                                                                                                                   |
| **Headless CI-driven reviewer-bot in Phase 0**                                              | Requires repo-secret credentials + months of precision/recall tuning that competes with product-development time during the pre-pilot velocity-constrained window. Interactive modes (a/b/c) under the human's own LLM credentials cover the same review property at zero CI complexity. Revisit triggers — §2.10. |
| **Plan markdown in `docs/superpowers/plans/` for every task (classic superpowers pattern)** | Duplication with GitHub Issues (ADR-0006 §9). Plan markdown is justified only for multi-step work within a single Issue. Default flow: Issue body + sub-issues = task tracking.                                                                                                                                    |
| **AGENTS.md only, no CLAUDE.md**                                                            | Loses Claude-specific MCP/skills/SessionStart hook config. Split inherited from ADR-0006.                                                                                                                                                                                                                          |
| **OWASP dual-LLM pattern (privileged LLM separated from quarantined)** for Phase 0          | Overkill: Phase 0 dev-time agents do not process untrusted user content at runtime. Trigger: runtime AI feature processing user-supplied content (Content Pipeline, support tickets) — implemented at the trigger moment via ADR-0010.                                                                             |
| **OTel GenAI semconv collector in Phase 0**                                                 | Premature without runtime AI traffic. Minimal stderr token logging is sufficient. Deferred §2.11.                                                                                                                                                                                                                  |
| **Hard cost cap with in-line rejection (Portkey-style)** in Phase 0                         | Requires gateway (LiteLLM) — preface the §2.11 trigger. Phase 0 cost discipline = manual per-vendor console checks.                                                                                                                                                                                                |
| **GitHub Copilot Workspace instead of Codex**                                               | Codex covers the same use-case (cloud async PR-opening agent) but with greater maturity in 2025–2026 and an open ecosystem. Copilot Workspace = yet another vendor lock-in to GitHub. Not blocked — can be added in parallel if there is value.                                                                    |
| **Full Spec-Driven Development per Kiro/BMAD framework**                                    | Heavier than ADR-0006 hybrid SDD pattern; overhead not justified for team-of-1+AI. Hybrid (3-file spec + GitHub Issues) — proven on DSO-25..29 cycle.                                                                                                                                                              |

---

## 5. Open questions (deferred)

| ID      | Q                                                                                                                                                                                                  | Where resolved                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| OQ-AI3  | TDD signal lint false-positive rate in practice                                                                                                                                                    | Phase 1 after 10 PRs in Vitest scope                                                                    |
| OQ-AI6  | Codex GitHub App config specifics                                                                                                                                                                  | When Tech Lead activates Codex                                                                          |
| OQ-AI7  | Deep dual-LLM pattern for untrusted-content AI features                                                                                                                                            | At the §2.11 trigger; depends on first runtime AI feature (Content Pipeline). See ADR-0010.             |
| OQ-AI9  | OTel GenAI collector deployment topology — single or HA                                                                                                                                            | At the §2.11 trigger                                                                                    |
| OQ-AI10 | PII-filter NER (spaCy Russian) trigger threshold                                                                                                                                                   | After measurement on synthetic corpus at the §2.11 trigger                                              |
| OQ-AI11 | Output-direction PD filter (LLM-hallucinated PII) — v3 expansion                                                                                                                                   | Trigger: first AI-generated content published to an external recipient without human pre-publish review |
| OQ-AI12 | LiteLLM admin UI OIDC integration (via nginx forward-auth) — detailed design                                                                                                                       | At the §2.11 trigger                                                                                    |
| OQ-AI14 | Concrete metric for "tuning ROI proven" that would justify re-introducing an automated reviewer-bot (e.g., catch-rate on a labelled sample of past PRs vs N hours/week of human review time saved) | Post-Pre-pilot, when revisit criteria in §2.10 fire                                                     |

---

## 6. Related ADRs / Delegated

**Inherited from:**

- ADR-0001 — Zitadel: future runtime LLM gateway admin (§2.11) protected by the same OIDC tenant
- ADR-0002 §6 — BullMQ as async queue for AI jobs (§2.11 trigger)
- ADR-0003 §7 — pgvector default vector DB; trigger for Qdrant — separate ADR
- ADR-0004 §13 — ESLint `no-vercel-only-api` rule surfaced as a CI guard for the human reviewer (§2.6)
- ADR-0005 — mobile AI recommendations v3 will go through the runtime LLM gateway
- ADR-0006 §7 — drift detection extended with the AI-specific guards in §2.6
- ADR-0006 §4 — 3-file feature-spec format inherited
- ADR-0006 §9 — GitHub Issues task tracker + milestone convention inherited
- ADR-0006 §5 / spec §9 — AGENTS.md / CLAUDE.md split inherited + extended with the AI-loop section

**See also (forward references):**

- **ADR-0010** — dual-LLM mandatory pattern for any runtime AI flow with tool use or untrusted user content (Quarantined LLM ↔ Privileged LLM split, symbolic references).
- **`2026-05-18-ds-platform-dual-llm-pattern-design`** — implementation design spec for dual-LLM: contracts, threat model, integration with egress proxy and audit classes.

**Delegated to other tasks:**

- **DSO-31 (Repo strategy / Engineering readiness):** implementation of `tools/agent-bootstrap.ts`, lint guards under `tools/lint/`, AGENTS.md / CLAUDE.md updates, branch protection rules. Full migration plan — design spec §11.
- **Future ADR-NNNN (runtime AI infra):** LiteLLM Proxy + Zone-AI VM (Hetzner EU) + PD filter + OTel GenAI collector. Trigger: first runtime AI feature deploy (Content Pipeline v2 LLM draft).
- **Future ADR-NNNN (Phase 3 autonomy):** auto-merge of low-risk PRs behind a feature flag. Trigger per §2.10: post-Pre-pilot + 50+ PRs of review-loop data + Tech Lead bandwidth.
- **Future ADR-NNNN (Qdrant migration):** vector DB scaling beyond pgvector. Trigger: mobile v3 AI recommendations p95 >100ms.

**Affects (downstream):**

- **DSO-31** — structure of `tools/`, `.github/workflows/` (lint guards only), AGENTS.md / CLAUDE.md baseline.
- **All feature specs DS Platform** — must pass through the orchestrated iteration cycle (§2.4) with verdict-gated checklist and review.
- **Content Pipeline v2 implementation** — will be the first triggering event for the runtime LLM gateway ADR.
