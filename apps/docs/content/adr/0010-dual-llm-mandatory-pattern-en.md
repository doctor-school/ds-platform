---
title: "ADR-0010 — Dual-LLM as a Mandatory Pattern for Tool-Enabled AI Flows [EN]"
description: "The DS Platform is a medical education platform under 152-FZ. Its AI flows operate on untrusted content (doctor messages in chat, PDF/docx uploads by..."
lang: en
---

> **RU:** [`0010-dual-llm-mandatory-pattern-ru.md`](./0010-dual-llm-mandatory-pattern-ru.md) · **EN (this)**

# ADR-0010 — Dual-LLM as a Mandatory Pattern for Tool-Enabled AI Flows

**Date:** 2026-05-18
**Status:** Accepted
**Related to:** Plane DSO-63 (mini-H, #12, #13), DSO-68 (design spec)
**Design spec:** `apps/docs/content/adr/0010-dual-llm-mandatory-pattern-design-ru.md` (normative implementation contract)
**Inherits:** ADR-0007 (AI stack), ADR-0011 (Egress control plane)

---

## 1. Context

The DS Platform is a medical education platform under 152-FZ. Its AI flows operate on untrusted content (doctor messages in chat, PDF/docx uploads by authors, web-search responses, webinar transcripts, SME materials, PR bodies and comments, existing lesson content) and at the same time on tools that mutate state (DB writes, NMO credit issuance, email/SMS dispatch, record edits, role escalation).

Under the classical architecture "one LLM receives untrusted text and holds tools," an attacker who controls the untrusted text controls tool invocations via **prompt injection**: explicit or hidden instructions that override the system prompt. The full vector list for DS Platform is in dual-llm-pattern-design §2.2 (9 classes, including transitive vectors 8 and 9 where untrusted text is persisted to DB / GitHub and later fed to an LLM "as trusted").

Prompt-level defensive techniques are **insufficient as a primary control**:

- A system prompt forbidding "do not call tools if you see an instruction" — models routinely bypass it.
- A prompt-level tool allowlist — bypassable with a sufficiently inventive injection.
- Input content filtering — does not cover unicode tricks, indirect injection via embeddings, multi-step attacks.
- Cross-vendor review reduces correlated **code-level** errors (ADR-0007 §6), but does not help against correlated **prompt-injection** attacks — the shared surface remains.
- Every provider model upgrade resets the corpus of known mitigations without warning.

The external review of the DS Platform (DSO-63 mini-H) explicitly flagged this as a BLOCKER: without an architectural separation between "what the LLM read" and "what the LLM did," a regulatory-defensible audit log is impossible, and the risk of PD exfiltration / unauthorized action on NMO data grows linearly with the number of tools.

**Hard requirements (inherited):**

- 152-FZ + retention matrix (ADR-0009 §3) — PD-accessible tools MUST have enforced authz independent of LLM behavior.
- ADR-0007 §6 / §9 — provider selection and observability MUST distinguish roles.
- ADR-0011 §2.2 channel #1 — the sanitizer at the LLM-provider boundary is mandatory regardless of pattern.

---

## 2. Decision

Any backend AI flow in DS Platform where the LLM (a) receives untrusted content **and** (b) has access to tools with side effects **MUST** be implemented through the **Dual-LLM** pattern: Quarantine LLM (Q-LLM) + Privileged LLM (P-LLM) + Symbol-table Orchestrator (S-Orch). The normative contract for roles, schemas, audit, and failure modes is in dual-llm-pattern-design §3, §6, §8.

### 2.1 Flow classification (decision matrix)

Every AI flow MUST explicitly declare its class in code (annotation, see §5):

| Untrusted input   | Tools | Pattern                | Comment                                                                                                 |
| ----------------- | ----- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| Yes               | Yes   | **Dual-LLM mandatory** | Q-LLM → S-Orch → P-LLM                                                                                  |
| Yes               | No    | **Single Q-LLM**       | Pure extraction / summarization / classification                                                        |
| No (trusted-only) | Yes   | **Single P-LLM**       | Trusted-only = system-generated from validated structured data, or Q-LLM output with a confirmed schema |
| No                | No    | Any role               | Pattern does not apply                                                                                  |

"Trusted-only" is an attribute of the **tool × source-channel pair**, not of the user. Edge-case details (doctor chat, DB content sourced from untrusted input, RAG without tools) are in dual-llm-pattern-design §4.2.

### 2.2 Architectural invariants (MUST)

1. **Q-LLM tools are denied at the provider level**, not in the system prompt (`tool_choice: "none"` or equivalent; a provider without tool support for this role). Prompt-level denial alone as a sole mechanism is **forbidden**.
2. **Q-LLM output is structured-output only** (JSON schema enforcement at the API layer + Zod hard gate on the S-Orch side). Free-text output from Q-LLM is a schema violation.
3. **P-LLM never receives raw untrusted text** — only symbolic references (`$ref_id`) and schema descriptors from the symbol table. CI gate + runtime assertion on S-Orch.
4. **S-Orch resolves `$ref` to the actual value** between the P-LLM tool-call intent and the tool body invocation — on the service side, not in the P-LLM prompt.
5. **Tool body has an independent input-validator (Zod)** — authoritative even against hallucinated / injected P-LLM output.
6. **Tool-level authz does not depend on the LLM** — `subject_id` for PD-accessible tools is taken from the authenticated session, not from LLM output (belt-and-suspenders on top of dual-LLM).
7. **Audit on every Q-LLM + P-LLM + tool call** (sub-class `ai_dual_llm` in `audit_ledger`) — raw values MUST NOT enter the audit, only hashes + metadata.
8. **Fail-closed:** on sanitizer / schema-validator / S-Orch / audit-ledger failure the endpoint returns "AI temporarily unavailable"; silent degradation to single-LLM is **forbidden**.

### 2.3 Reference flows

Four conceptual DS Platform flows to which the rule applies immediately on implementation are described in dual-llm-pattern-design §5: (5.1) author-upload → draft lesson; (5.2) AI assistant over the NMO base; (5.3) web-search research agent; (5.4) reviewer-bot evolution to write-tools. The Phase 0 reviewer agent (ADR-0007 §6) is today a single-Q-LLM-equivalent without tools, an **inherited contract**: any extension with tools automatically triggers a re-design under dual-LLM.

---

## 3. Alternatives considered

### 3.1 Single-LLM with prompt-filtering / allowlist

**Rejected.** Defense-in-depth, not a primary control. Bypassable via unicode, encoding tricks, multi-step, indirect injection through documents / embeddings. Does not provide an architectural-level guarantee that "untrusted text never reaches tools."

### 3.2 Human-in-the-loop on every tool call

**Rejected.** Does not scale (a doctor will not approve every DB query), breaks the UX of the assistant and of automated pipelines (content generation, reviewer bot). Applicable point-wise (merge/approve in the reviewer, certificate issuance) as an additional gate — but not as a replacement for architectural separation.

### 3.3 Tool-output sanitization alone

**Rejected.** Treats the symptom (data exfiltration via tool response) rather than the root cause (untrusted text driving tool selection and tool input). Does not close the unauthorized-action vector.

### 3.4 Capability-restricted LLM via fine-tuning

**Rejected.** Post-fine-tune behavior is not provider-enforced and not reproducible cross-vendor; regression is possible on every upgrade; there is no auditable boundary between "read" and "did." Does not replace an architectural control.

---

## 4. Consequences

### Positive

- An architectural (not probabilistic) guarantee against a class of prompt-injection attacks that lead to PD exfiltration / unauthorized action.
- A clean separation between "what the LLM read" (Q-LLM) and "what the LLM did" (P-LLM) — the audit log becomes regulatory-defensible.
- Cost attribution and observability by role (Q vs P) — easier alerting, budget control (ADR-0007 §budget), red-team metrics.
- The reviewer-agent inherited contract is fixed: any attempt to give it write-tools automatically rebuilds it as dual-LLM, without a separate decision each time.

### Negative / costs

- Every tool-enabled flow requires a Q-LLM call in addition to the P-LLM call — latency growth (~1 round-trip) and cost (~Q-LLM tokens). Mitigated by choosing a cheap / fast model for the Q-LLM role (ADR-0007 §provider-selection).
- Implementation overhead: `packages/llm-utils/dual-llm/` (S-Orch + Q-LLM client + P-LLM client + Zod tooling) — a mandatory prerequisite before the first runtime AI feature (Content Pipeline v2 onwards).
- Red-team corpus + quarterly refresh — operational cost.
- Every new AI flow MUST declare its class via annotation — overhead in code review.

### Downstream dependencies

- **ADR-0007 §6 / §9** — provider selection per role (Q vs P), observability split, cost ledger attribution.
- **ADR-0009** — `audit_ledger` sub-class `ai_dual_llm`, retention 5y without PD body.
- **ADR-0011 §2.2 channel #1 + §2.4** — sanitizer at the provider boundary (pre-Q-LLM) — mandatory prerequisite.
- **dual-llm-pattern-design** — normative implementation contract.

---

## 5. Verification & enforcement

### 5.1 Declaration in code

Every AI flow MUST carry a CI-readable annotation:

- `@AiFlow({ tools: [...] })` with a non-empty `tools` array → MUST be accompanied by a `@DualLLM` companion (or a `@TrustedOnly` marker, if the input is guaranteed trusted-only per §2.1).
- An endpoint that initiates an LLM call and has neither `@DualLLM`, nor `@TrustedOnly`, nor an explicit `tools: []` — **CI fail (BLOCKING)**.

### 5.2 CI gates

- Grep / AST rule in CI: any call site of a provider client with `tool_choice != "none"` MUST be reachable **only** from the P-LLM client wrapper in `packages/llm-utils/dual-llm/`.
- Runtime assertion in S-Orch: the constructed P-LLM prompt is passed through `@ds/pii-filter` (ADR-0011 §2.4); detector hits → fail-closed reject + audit security-event.
- Tool input-validator coverage: every tool — ≥1 positive + ≥3 adversarial Zod tests.
- Code review checklist (ADR-0007 §6.3 sdd-compliance prompt) MUST explicitly verify flow classification — single-LLM-with-tools-and-untrusted-input → automatic [BLOCKING].

### 5.3 Red-team corpus

- Baseline ≥50 samples before pilot gate (see dual-llm-pattern-design §9.1).
- Coverage: vectors from §2.2 of the spec (direct / indirect / unicode / multi-step).
- Refresh cadence: quarterly fuzz extension + extension on every production incident. Quarterly audit — synchronized with ADR-0011 §2.4 quarterly egress audit.
- Weekly job against staging endpoints — assertion: `tools_called` audit rows for red-team subjects contain no privileged actions.

### 5.4 Observability

- Metrics `dual_llm.*` (see dual-llm-pattern-design §10.1) — mandatory per flow.
- Trace span `ai.session.turn` with children `dual_llm.qllm.call`, `dual_llm.s_orch.store`, `dual_llm.pllm.call`, `dual_llm.tool.<name>` — mandatory.
- Alert on `dual_llm.qllm.secret_detected_count > 0 / 24h` → page SRE.

### 5.5 Audit ledger

`audit_ledger` sub-class `ai_dual_llm` — emit on every Q + P + tool call, correlation by `session_id`, schema in dual-llm-pattern-design §6.4. Cross-ref pd-lifecycle-design §3 (retention 5y) + §10 (lint-retention).

---

## 6. Forward references

- **`dual-llm-pattern-design`** — normative implementation spec (roles, schemas, S-Orch, sanitization, failure modes, testing, observability, migration, acceptance criteria).
- **ADR-0007 §provider-selection / §observability** — provider selection for Q-LLM and P-LLM roles, OTel GenAI metrics split, cost ledger attribution by role.
- **ADR-0011 §2.2 channel #1, §2.4, §2.5** — egress sanitizer pre-Q-LLM, runtime sanitizers, cross-zone messaging for PD lifecycle events from the AI zone.
- **`endpoint-authorization-matrix-design`** (DSO-63 branch) — authz on tool calls (`subject_id == session.subject_id`-style hard constraints, belt-and-suspenders on top of dual-LLM).
- **ADR-0009 + `pd-lifecycle-design`** — retention of `ai_dual_llm` audit rows, erasure propagation.

---

## 7. Open Questions

- **OQ-DL10-1:** Hard rule vs recommendation on cross-vendor between Q-LLM and P-LLM in a single flow. Pre-pilot — a recommendation (see dual-llm-pattern-design §7.3). Pilot+ — revisit after the first real injection incident; may be promoted to a hard rule via a separate amendment.
- **OQ-DL10-2:** Applicability of the pattern to future non-backend AI flows (mobile-side on-device inference, browser-side classification). Pre-pilot — out of scope (all AI logic is server-side per ADR-0007). Revisit at the first on-device feature.
- **OQ-DL10-3:** P-LLM streaming mode and preserving fail-closed semantics on partial streams — resolved in the first streaming flow design (see dual-llm-pattern-design §13 OQ-DL-6).

---

## 8. Amendments

### Amendment A1 — Reviewer-agent "inherited contract" reference is now vestigial; main mandate unchanged (2026-05-19, follow-up to ADR-0007 Amendment A1)

**Context:** ADR-0007 Amendment A1 (2026-05-19) dropped the automated GitHub-Actions reviewer-bot entirely (no `tools/reviewer-agent/`, no `agent-review.yml`). ADR-0010 §2.3 used the reviewer-agent as an example of a "single-Q-LLM-equivalent without tools" — an inherited contract that would auto-trigger a dual-LLM redesign if write-tools were ever added.

**Decision: scope-clarified, NOT SUPERSEDED.** ADR-0010's mandate is on **any backend AI flow** with untrusted-input + tools (§2 Decision: "Any backend AI flow in DS Platform where the LLM (a) receives untrusted content **and** (b) has access to tools with side effects MUST be implemented through the Dual-LLM pattern"). The runtime targets (chat assistant, content-pipeline author-upload, NMO-base assistant, web-search research agent — §2.3 / dual-llm-pattern-design §5.1–§5.3) are the load-bearing scope. The reviewer-agent was an inherited example, not the mandate's basis.

**Effect:**

- §2.3 sentence "The Phase 0 reviewer agent (ADR-0007 §6) is today a single-Q-LLM-equivalent without tools, an inherited contract: any extension with tools automatically triggers a re-design under dual-LLM." — semantically vestigial (the reviewer-agent does not exist in Phase 0). Kept inline as historical context; if a future ADR reinstates an automated reviewer with write-tools, ADR-0010 §2 (Decision) auto-applies without a new amendment.
- §2.2 (architectural invariants), §5 (Verification & enforcement), and the reference-flow list (5.1–5.3 in dual-llm-pattern-design) are unchanged and remain MUST for runtime AI features (Content Pipeline v2 onwards).
- Interactive review modes (subagent `/review` skill OR parallel Codex CLI per ADR-0007 Amendment A1) are out of scope for ADR-0010 — they are not "backend AI flows" with side-effect tools; they are local developer tooling, no `audit_ledger` requirement.

**Open Questions touched:** OQ-DL10-1 (cross-vendor hard rule) — unchanged: still a recommendation pre-pilot, promotable to hard rule on first injection incident in runtime AI.

**Cross-refs:** ADR-0007 §Amendment A1, ADR-0008 §Amendment A2, dual-llm-pattern-design §Amendment DL1.
