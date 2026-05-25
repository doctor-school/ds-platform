---
title: "ADR-0011 — Egress Control Plane [EN]"
description: '> Note: ADR-0010 is intentionally skipped in the numbering — reserved for a future "RF edge & comms providers" ADR if a separate document is needed...'
lang: en
---

> **RU:** [`0011-egress-control-plane-ru.md`](./0011-egress-control-plane-ru.md) · **EN (this)**

# ADR-0011 — Egress Control Plane

**Date:** 2026-05-18
**Status:** Accepted
**Related to:** Plane DSO-63 (cross-cutting finding #13), milestone DSO-24
**Design spec:** sections in `engineering-readiness §3` (telemetry classification — DSO-63 #12) + `ai-stack-design §6` (sanitizer pattern)
**Inherits:** ADR-0007 (AI zone), ADR-0008 (GitHub external dependency), ADR-0009 (PD lifecycle — erasure propagation)

> **Note:** ADR-0010 is intentionally skipped in the numbering — reserved for a future "RF edge & comms providers" ADR if a separate document is needed in Phase 1 (the current DSO-63 #8 resolution is design-spec-level, see engineering-readiness §5).

---

## 1. Context

The external review of the DS Platform architecture (DSO-63) found that egress of PD / secrets from the RF zone is possible not only through the main AI channel (Anthropic / OpenAI), but through **many disparate channels**: GitHub issues / PR bodies, reviewer agent prompts, cost ledgers, dependency registries, screenshots in crash reports, support tools, analytics events, prompt-eval corpora.

> "The same problem appears in many places, not only runtime AI: GitHub issues, PR bodies, reviewer agents, logs, traces, crash reports, cost ledgers, screenshots, support tickets, analytics events, and prompt-eval corpora. The architecture needs one shared egress policy that all ADRs inherit." — Claude review, cross-cutting concern.

The current architecture **correctly** isolates the AI zone from the RF zone (ADR-0007) but does not cover "soft" egress channels. Without a single policy, AI agents working on different modules do not have consistent rules for "what can be sent outside."

In parallel, ADR-0009 introduced cross-zone erasure propagation (PD lifecycle → AI-zone subscriber deletes embeddings). This requires a **formal contract** for cross-zone messaging: which events are allowed, what may be in them, who audits them.

**Hard requirements:**

- 152-FZ: PD does not leave RF territory except under exceptions (art. 12) — we have no exceptions, so **PD never crosses the RF border**.
- УЗ-3 (assumption per DSO-63 #7): control of cross-border transfers.
- ADR-0007: AI zone is outside-RF with a PII filter; this ADR extends it: the PII filter applies to **all** outbound channels, not only runtime AI.
- [[feedback_rf_blocked_services]]: outbound dependencies on Cloudflare and other RF-blocked services are forbidden.
- [[feedback_docs_as_ssot]]: the approved channels list lives in code / CI config, not only in Notion.

---

## 2. Decision

### 2.1 Principles

1. **PD / secrets do not leave the RF zone**, except via explicitly approved channels from §2.2.
2. **Default deny:** a new external API / SaaS / outbound channel is a separate decision (mini-ADR or amendment to this ADR). Not "agent decides ad hoc."
3. **Every approved channel has three guarantees:**

- **Sanitizer** (what may be sent right now) — implementation in code, not on trust.
- **Audit** (per-call log: what was sent, where, sanitization status).
- **Opt-out / kill switch** (fast channel disable).

4. **Cross-zone messaging** (RF ↔ AI) — formal outbox/inbox contract with explicit schema per event type.
5. **Cross-domain monitoring:** quarterly audit of egress channels; red-team tests against every channel at least once per quarter.

### 2.2 Approved egress channels

Table of approved channels for egress outside the RF zone or beyond the main backend perimeter. Each channel has its own enforcement configuration.

|   # | Channel                                               | Purpose                                                              | Allowed                                                                                                                  | Sanitizer                                                                                             | Audit                                                                                                                                 | Owner                |
| --: | ----------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
|   1 | **Anthropic / OpenAI API** (RF→AI zone runtime)       | LLM completions for AI features (recommendations, content gen v2/v3) | Sanitized prompts only (PII filter from ADR-0007 §6). No raw subject_id / PD fields in prompt body.                      | `@ds/pii-filter` pre-call. Reject if patterns match.                                                  | Per-call log: model, tokens_in/out, sanitization_status, cost_estimate, request_id. Stored in `audit_ledger` (sub-class `ai_egress`). | AI lead              |
|   2 | **GitHub** (repo, issues, PRs, commits)               | Source code + spec docs + tracking. ADR-0008 sole hub.               | Code, docs, ADR/spec text. **No real PD fixtures, no production-data dumps, no prod secrets.**                           | git pre-commit hook `tools/pii-scanner-precommit` (regex + structured AST). Fail → blocks the commit. | Quarterly git history audit (audit job). Per-PR — reviewer-agent checks diff.                                                         | Tech Lead / All devs |
|   3 | **GitHub Actions runs** (CI logs, artifacts)          | Build / test / deploy automation.                                    | Build outputs only. No runtime PD in logs (CI has no business reading prod DB; integration tests — synthetic data only). | Log scrubber post-job (drop env-secrets, regex PII). Artifact retention 30d.                          | CI log access audit (admin-only after 30d).                                                                                           | DevOps               |
|   6 | **Dependency registries** (npm, pip, crates.io, EXPO) | Pulling dependencies at build time.                                  | Outbound code + manifest only. **Never** publish anything from private code to public registries.                        | `npm publish` blocked on private packages; CODEOWNERS + 2-person approval for public releases.        | Release log (per publication).                                                                                                        | DevOps               |
|   7 | **RF Edge providers** (SMS, email — DSO-63 #8)        | Auth flows, magic links, transactional notifications.                | Subject phone/email + content (transactional text); **not AI-zone derived**. RF-located processors only.                 | Pre-call validation: provider listed in registry §8, subject consent active.                          | Per-message audit row (recipient hash, channel, provider, status). 152-FZ DPA.                                                        | Backend / Marketing  |
|   8 | **Outbox events RF→AI zone** (cross-zone messaging)   | PD lifecycle propagation (erasure), content updates for embeddings.  | **Pseudonymous references** (sha256(subject_id) with pepper). Event payload sanitized per schema.                        | Schema validation (Zod) on emit; AI-zone subscriber rejects payloads not conforming to schema.        | Both-sides log: outbox emit + inbox consume + ack. Audit per event.                                                                   | AI lead / Backend    |
|   9 | **Ack events AI→RF zone**                             | Acknowledgement of erasure propagation, embedding rebuild status.    | Metadata only: event_id, status, processed_at. **No** AI-zone-internal data.                                             | Schema validation on both sides.                                                                      | Audit per ack.                                                                                                                        | AI lead / Backend    |

Forward reference for channel #1 (AI provider egress): any runtime LLM flow with tool use or untrusted user content MUST follow the **dual-LLM mandatory pattern** — Quarantined LLM ↔ Privileged LLM split, symbolic references. See **ADR-0010** plus design spec **`2026-05-18-ds-platform-dual-llm-pattern-design`**. `@ds/pii-filter` remains the first defensive layer; dual-LLM is the second (preventing prompt-injection escalation into actions).

### 2.3 Denied channels (until separate decision)

| Channel                                                | Why denied                                                                                                       | Reconsideration condition                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **External telemetry SaaS** (Sentry SaaS, Datadog, …)  | Outside-RF; stack traces contain PD. GlitchTip self-hosted covers the need.                                      | If GlitchTip is insufficient — separate ADR.                                                  |
| **External analytics SaaS** (GA, Mixpanel, Amplitude)  | Outside-RF; events carry user behavior data. Self-hosted Plausible / Umami / Matomo are acceptable alternatives. | Self-hosted is available; external — separate ADR.                                            |
| **External CDN / WAF** (Cloudflare and any RF-blocked) | [[feedback_rf_blocked_services]]                                                                                 | Never (permanent deny).                                                                       |
| **Public LLM playgrounds / chat UIs** for debugging    | Sanitization cannot be guaranteed.                                                                               | Never; debugging only via approved channel #1.                                                |
| **Screenshots in crash reports** (mobile / web)        | Impossible to guarantee no PD in the UI screenshot.                                                              | GlitchTip configured without attachment support; mobile crash reports without UI screenshots. |

### 2.4 Enforcement

**CI gates** (blocking on PR):

- `tools/pii-scanner-precommit` — regex + AST on staged code. Runs locally (pre-commit) and in CI.
- `tools/audit-egress-channels` — verifies that every outbound HTTP call in code targets an allowlisted endpoint (regex match on base URL). A new external endpoint → CI fail → requires ADR update.
- `drizzle-kit check` + `lint-retention` (see ADR-0009 §10) — ensures PD fields are correctly classified for erasure propagation.

**Runtime sanitizers** (loaded at startup):

- `@ds/pii-filter` (sanitizer for AI-zone calls).
- GlitchTip `beforeSend` hook.
- OTel processor (trace attribute allowlist).
- Loki promtail processors.

**Quarterly audit:**

- Review git history for violations of the approved channel list.
- Review egress logs (audit_ledger sub-class `ai_egress`) for anomalies.
- Re-run red-team tests against every approved channel.

**Kill switch:**

- Per-channel feature flag in `.github/agents-config.json` (ADR-0007 §2.11) for channel #1 (AI-related). For channels #2, #6, #7, #8, #9 — environment-level disable via config.

### 2.5 Cross-zone messaging contract

See **ADR-0009 §2.7 + design spec §8** for PD lifecycle. Common principles:

- **Schema-first:** every event type has an explicit JSON schema (Zod) with allowed fields.
- **Pseudonymization:** subject identifiers — hashed with pepper, not raw.
- **Idempotency:** `event_id`, consumer-side dedup.
- **At-least-once:** outbox pattern (Postgres → RF-zone publisher → AI-zone subscriber).
- **Ack required:** consumer emits an ack event, producer marks the outbox row as confirmed.
- **Audit:** both zones log emit + consume + ack.

---

## 3. Alternatives considered

### 3.1 Per-ADR egress rules (distributed approach)

**Rejected.** Spreading the rules across ADR-0007 (AI), ADR-0008 (GitHub), ADR-0006 (docs/SSOT) leads to inconsistent enforcement. An AI agent adding a new external API does not know which rules to check. A cross-cutting policy is the only workable format.

### 3.2 "Just don't send PD" (no formal enforcement)

**Rejected.** AI agents routinely add `console.log(user)` or `Sentry.captureException(err, { extra: { user } })` — that is the norm outside compliance-bound systems. Without CI enforcement the rule does not hold.

### 3.3 Full air-gap of the RF zone

**Rejected.** Full air-gap makes AI-agent driven development impossible (GitHub, AI providers — all outside-RF). We accept the compromise: PD does not leave the RF zone, but dev tooling may.

### 3.4 Service mesh + L7 egress proxy

**Deferred.** Istio / Linkerd / Cilium egress gateways are more powerful than application-level sanitizers, but they require Kubernetes (absent pre-pilot, see tenancy design). Re-evaluate if we move to k8s in Phase 1+.

---

## 4. Consequences

### Positive

- One archetype document for AI agents / engineers / compliance: "what can / cannot be sent outside."
- CI gates turn policy into enforced reality, not "trust the dev."
- Cross-zone messaging contract — now architecturally defined, not ad-hoc.
- Quarterly audit + red-team — provides a regulatory-defensible answer to "how do you prevent leakage."
- Engineering-readiness BLOCKER "dual-LLM PII filter" (see DSO-63 mini-H) now has architectural footing.

### Negative / costs

- `@ds/pii-filter` + sanitizer tooling — implementation cost ≈ 1 week backend + 1 week CI tooling.
- Quarterly audit job — operational cost (4 hours / quarter).
- Every new external endpoint requires an amendment to this ADR (overhead, but by design).

### Downstream dependencies

- **ADR-0009 §2.7 (cross-zone erasure)** — uses the concrete event type from §2.5 of this ADR.
- **ai-stack-design §6** — must reference §2.2 channel #1.
- **engineering-readiness §3** — telemetry policy (#12) embeds sanitizers from §2.4 of this ADR.
- **repo-strategy-design** — GitHub vendor risk note (DSO-63 #14) references §2.2 channel #2.

---

## 5. Deferred / Open Questions

- **OQ-EG-1:** PII filter implementation: regex-based vs ML-based (entity recognition). Pre-pilot — regex (deterministic, simple, fast). Pilot+ — ML may be required for complex cases (free-text input). **Resolution:** regex pre-pilot, evaluate ML at pilot kick-off.
- **OQ-EG-2:** The cost ledger accumulates aggregate token counts. Statistical attacks could reveal who uses AI. **Resolution:** for pre-pilot — accept the risk; the ledger audience is internal. For scale — add noise injection.
- **OQ-EG-3:** Cross-zone messaging — does it need a separate security perimeter (VPN, mTLS, dedicated VPS)? **Resolution:** mTLS pre-pilot (cheap, standard); dedicated VPN — pilot+ if volume grows significantly.

---

## 6. Cross-references

- **Plane:** DSO-63 finding #13 (parent), #12 (telemetry), #5/#6 (PD lifecycle).
- **ADR:** ADR-0007 (AI zone), ADR-0008 (GitHub), ADR-0009 (PD lifecycle, erasure propagation).
- **Specs:** `ai-stack-design §6` (sanitizer pattern), `engineering-readiness §3` (telemetry classification, §5 dual-LLM blocker).
- **Source:** `outputs/2026-05-18-ds-platform-external-validation-findings.md`.
- **Memory:** [[feedback_rf_blocked_services]], [[feedback_docs_as_ssot]].
