---
title: DS Platform — engineering readiness (CI/tests/observability/documentation for AI-agent driven development)
date: 2026-05-12
status: Approved
authors: Tech Lead (with participation of AI-research-agent, 2026-05-12)
---

> **EN (this)** · **RU:** [`2026-05-12-engineering-readiness-design-ru.md`](./2026-05-12-engineering-readiness-design-ru.md)

# Spec: DS-platform engineering readiness for AI-agent driven development

## Context and problem

The DS-platform is developed **primarily by AI agents in autonomous mode with orchestrators**. The team (2-3 people after hiring) designs, reviews key checkpoints, and operates the system. The platform stores personal data (PD) of doctors (Federal Law 152-FZ, medical PD = protection level UZ-3), integrates with pharma partners (B2B SLA), and is deployed on Timeweb Cloud in the RF (Russian Federation) zone with Zone AI outside RF.

Without an explicit "tooling" checklist there are three risks:

1. **Compliance-blocker** at pre-pilot — without RKN notification and data subject rights endpoints the launch is illegal.
2. **Regression of agent changes** — without strong CI gates autonomous development breaks prod without a human filter.
3. **Tech debt accumulation** — without a phased approach we either build everything at once (losing pace), or nothing (impossible to retrofit later).

The brainstorm research confirmed that under AI-agent driven development the 2025-2026 standard is an extended tooling set with focus on supply chain security, OpenTelemetry GenAI, prompt-injection protection, autonomy ladder, and spec-driven workflows.

## Decision

**Mode C′ — phased readiness by user-value signals, with a Pre-pilot baseline raised above normal due to AI-agent specifics.**

9 categories × 3 phases (Pre-pilot / Pilot / Scale) + an explicit **BLOCKER list for Pre-pilot** (without which we do not onboard the first real user).

### Why C′, not A or B

- **A (minimum, grow later)** does not fit: Federal Law 152-FZ obligations (data subject rights, RKN notification, audit) are legal requirements, not nice-to-have. Skipping = compliance incident from the very first user.
- **B (everything at once)** — rejected not because of cost (AI agents nullify it), but because of **no addressee**: a public roadmap without an audience is noise; a status page without SLA commitments creates false expectations. Phases are sliced by value moments.
- **C′** — Pre-pilot baseline is higher than a typical MVP (strong CI gates, observability, audit log, autonomy ladder, RKN, dual-LLM); deferred items are those with no addressee yet (public roadmap, status page, A/B infrastructure).

### Phase definitions

| Phase         | Start signal                                       | Goal                                                                                         |
| ------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pre-pilot** | now → first real doctor in prod                    | Safely run agents in autonomous mode and accept the first user without compliance violations |
| **Pilot**     | first 1-50 doctors in closed group                 | Real users actively using the system; full observability/feedback/SLO required               |
| **Scale**     | open enrollment + pharma companies as B2B partners | Public zone, SLA commitments, compliance audit                                               |

## Pre-pilot deployment slice (DSO-63 #15, **living document**)

> **Caveat:** Living document; reviewed as business priorities / pilot feedback shift. Not an architectural freeze — operational prioritization for AI agents to avoid trying to ship "everything at once."

### In-slice (must have for pre-pilot, mandatory)

- **IdP** (selected per DSO-25 spike — Authentik / Zitadel / Keycloak).
- **NestJS API** (ADR-0002).
- **Postgres 17 + Drizzle** (ADR-0003).
- **Redis** (single-node + AOF, see ADR-0003 §8 responsibilities matrix; not for sessions or critical jobs).
- **Postgres outbox** for critical jobs (ADR-0003 Amendment A2/§A).
- **Portal Next.js app** (`app.doctor.school`).
- **Admin Next.js app** (`admin.doctor.school`).
- **Docs (Fumadocs)** — internal SSOT for the team (ADR-0006).
- **GlitchTip self-hosted** (this spec §3).
- **Loki + Grafana** (minimal: API health, error rate, latency).
- **PII scrubber baseline** + telemetry classification policy (this spec §3 + ADR-0011).
- **Backup baseline** — Timeweb primary + Beget S3 offsite + Vault keys (data-layer-design §2.4).
- **PD lifecycle endpoints** under `/me/*` (ADR-0009 §2.2).
- **Consent v1 + retention matrix** (ADR-0009).
- **Egress sanitizers + CI gates** (ADR-0011).

### Deferred to pilot (not done pre-pilot)

- **Payload CMS** (`cms.doctor.school`). Pre-pilot content — via Keystatic + git workflow / directly in repo.
- **Promo Next.js app** as a separate application. Pre-pilot promo — part of portal or a static snippet via docs.
- **Mobile (RN + Expo)** — pre-pilot = responsive web / PWA. Native mobile — pilot trigger.
- **Centrifugo** (real-time) — unless the first pilot school runs live webinars.
- **Tempo** (distributed tracing) — after GlitchTip + Loki.
- **Unleash** (feature flags) — pre-pilot scale does not require it; config via env / DB.
- **Glossary YAML sync / Keystatic editorial UI** — pre-pilot: pure markdown in repo.
- **Cross-vendor reviewer bot** — pre-pilot: one primary LLM reviewer is enough.
- **Cost ledger automation** — pre-pilot: manual tracking.

### Triggered-by-pilot (enabled by the first pilot school's scope)

- **Webinar provider integration** (Bigbluebutton self-hosted / Контур.Толк / Mind / Trueconf) — if pilot runs live webinars.
- **NMO credit issuance flow** — if the first pilot school requires NMO credit grants.

### Why this matters

Without an explicit slice, AI agents reading ADRs read "target architecture" as "everything at once" and try to spin up Payload + Centrifugo + Tempo + Unleash alongside the base stack. Wasted work + operational load. Every ADR (0002, 0003, 0004, 0005, 0006, 0007, 0008) forward-refs here to filter its scope under pre-pilot.

## 9 categories × 3 phases

### 1. Build & Deploy

**Pre-pilot:**

- GitHub Actions CI: `lint → types → unit → integration → contract → security-scan`, mandatory green on PR
- Preview environment on every PR (ephemeral, lives while PR is open): Coolify/Dokploy/Argo-based on a dedicated `preview-vps` (sizing + cost — ADR-0012 §Decision/§Cost envelope; pool-size triggers — ADR-0012 OQ-T4).
- TLS automation: Caddy or Traefik with Let's Encrypt, auto-renewal without manual agent intervention
- Schema migration tooling: Alembic (Python) / Flyway (if different stack); no manual SQL on prod
- Expand-contract migration policy: linter blocks `DROP COLUMN` in the same migration as a release
- Feature flags: Unleash self-hosted (chosen as default; alternative — GrowthBook self-hosted if built-in A/B is needed)
- Rollback procedure: single command, verified on staging before prod release
- Container image signing: cosign + SLSA Level 2 provenance
- SBOM generation: Syft on every build

**Pilot:**

- Internal pip/npm registry mirrors on Timeweb (insurance against upstream blocks)
- Blue-green or canary deploy to prod (1 VPS → full rollout with 15-min observation)
- Auto-rollback on trigger (error-rate, latency-spike)

**Scale:**

- Multi-region deployment readiness (if pharma partners require it)
- Progressive delivery (Argo Rollouts / Flagger) with automatic promote/abort

### 2. Testing & Environments

**Pre-pilot:**

- Four environments: `local → preview (per-PR) → staging → prod`
- Test pyramid: unit / integration (testcontainers) / contract (Pact or OpenAPI-schema validation) / E2E (Playwright, 1-3 critical paths) / smoke
- Visual regression: Playwright snapshots or Lost Pixel
- Security scan: Trivy on images, Snyk/Dependabot/Renovate on dependencies, OWASP-ZAP on staging
- Synthetic test data via factories (mimesis for Russian names/diagnoses)
- **Isolated agent sandbox** — dedicated namespace (Docker network or k8s namespace) for agent experiments, isolated from dev
- **Private eval-suite** — corpus of 20-50 closed PRs with known-good diff; mandatory regression run when model/orchestrator prompt changes
- Release gate: two human checkpoints — on merge to main and on prod deploy

**Pilot:**

- Anonymized prod snapshot on staging (with PD stripped), weekly refresh
- Extended E2E (10-20 scenarios)
- Load testing (k6) — weekly on staging
- **Prompt-injection red-team tests** as a mandatory pipeline step (Snyk-Claude, Opsera, Promptfoo)
- 5-10 pilot doctor-testers on staging under NDA before prod release of features

**Scale:**

- Chaos engineering: quarterly game days (stuck agent, network partition, exhausted LLM budget) with blameless postmortem
- Penetration testing (external audit)

### 3. Observability + Telemetry classification & PII scrubbing policy (DSO-63 #12)

> **Pre-pilot mandatory:** telemetry classification & PII scrubbing policy is authoritative for all observability tools. See also ADR-0011 (Egress control plane) — telemetry channels inherit the shared egress policy.

**Pre-pilot:**

- Structured logging → Loki (Grafana observability stack)
- Metrics: Prometheus + Grafana, RED metrics on API endpoints
- Error tracking: **GlitchTip self-hosted (Sentry-API-compatible)** — finalized in ADR-0004 §15 and ADR-0005 §10. Sentry SaaS rejected (PD out of RF, 152-FZ violation).
- **OpenTelemetry GenAI Semantic Conventions v1.37** for all agent LLM calls (traces, spans with model/tokens/cost).
- Unified tracing pipeline (GlitchTip + Loki only pre-pilot; Tempo/Jaeger — pilot).
- **Tamper-evident audit log** — separate storage (append-only PG table with hash-chain — ADR-0003 §6; ADR-0009 §2.4 for erasure tombstoning compatibility).
- Basic dashboards: API health, error rate, latency p50/p95/p99, DB connections.

#### 3.bis Telemetry classification & PII scrubbing policy

**Data classification:**

| Class                         | Description                                                             | Where it is acceptable in telemetry |
| ----------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| Public                        | Code constants, route paths without params                              | everywhere                          |
| Internal                      | Build metadata, deployment versions, request IDs (without user binding) | everywhere                          |
| PD                            | `subject_id` (UUID), `email_hash`, `phone_hash`, role labels            | only via hashed/redacted forms      |
| Special-category PD (medical) | Diagnosis, medical history, specialty (when identifying), chart content | **never** in logs/traces/errors     |
| Secrets                       | API keys, DB passwords, tokens, KEK/DEK                                 | **never anywhere**                  |

**SDK scrubbers (mandatory pre-pilot):**

- **GlitchTip `beforeSend` hook** — strip request bodies, headers (Authorization, Cookie), URL query params matching PII regexes. Config in `apps/api/src/observability/glitchtip.ts` + frontend equivalent in `packages/observability-frontend/`.
- **OTel processor** — trace attribute allowlist. Forbid `http.request.body`, `db.statement` (if SQL can contain PD), `user.email`, `user.phone`. Whitelist approach.
- **Loki promtail processors** — drop / replace patterns in log lines before ingestion. Regex on email, phone, RU-passport-like sequences.
- **Mobile crash reports** — no attachment / screenshot support; only stack trace + sanitized metadata.

**Log schema:**

- All application logs — structured JSON.
- Field allowlist in `packages/observability/log-schema.ts`. Freeform `message` field for technical descriptions only, no PD.

**PII scanner in CI (mandatory pre-pilot):**

- `tools/pii-scanner-precommit` (pre-commit + CI gate).
- Regex for emails (`@`), phones (RU `7-9-?\\d{10}`), RF passport (4-4-2 digit groups), credit cards (Luhn).
- AST check on patterns: `console.log(*user*)`, `logger.info({ ...user })`, `Sentry.captureException(err, { extra: { user } })` → CI fail.

**Red-team tests (pre-pilot):**

- Every CI run executes `tests/red-team/pii-leakage.test.ts`:
- Register a test subject with a unique PD marker string (`zzzPII-{uuid}@test.local`).
- Drive the subject through every API endpoint + error scenario.
- Assert: the marker does not appear in GlitchTip output / Loki / Tempo / metrics endpoint / Prometheus labels / cost ledger.
- Failure → CI fail, hard gate.

**Access controls:**

- GlitchTip / Grafana / Loki — internal-only access (VPN or IdP-protected `obs.doctor.school`).
- Per-user access logged in audit_ledger.
- AI agents do NOT have access to observability tools (no need-to-know; data may contain post-scrub residue).

**Cross-reference:**

- ADR-0011 §2.2 channels #1 (AI calls), #3 (CI logs) — this policy implements sanitizer requirements.
- ADR-0009 §2.4 — audit_ledger tombstoning compatibility.

**Pilot:**

- **Formal SLO + Error Budget Policy** document with auto-freeze of releases when budget is exhausted
- **DORA metrics dashboard** — deployment frequency, lead time, MTTR, change failure rate. Track agent impact on delivery.
- Behavioral analytics: PostHog self-hosted
- Alerting: AlertManager → on-call (Mattermost/Telegram + email)
- Capacity dashboard: CPU/RAM/disk/connections, early upgrade signals

**Scale:**

- Distributed tracing at 100% traffic (vs sampling)
- Public-facing internal metrics (latency, uptime) for B2B partners

### 4. Data resilience

> **Backup topology — single source of truth: `data-layer-design §2.4`** (canonical after DSO-63 #9 — Timeweb primary + Beget S3 offsite + Vault keys on a dedicated VM + quarterly restore drill). This section only enumerates dependencies + secrets-management requirements.

**Pre-pilot:**

- **Postgres backup:** see data-layer-design §2.4 (multi-provider offsite, separation of custody, crypto-shred compatibility per ADR-0009 §2.5).
- **S3 (user uploads):** bucket versioning enabled; cross-bucket replication to Beget S3 weekly (same schema, separate provider).
- **Restore drill** — quarterly, documented in the operational runbook (DSO task under DSO-10).
- **PITR drill** — separate procedure (restore to an arbitrary point in time), not just full-restore. Same runbook.
- **Secrets management:** Vault on a dedicated VM (also holds per-subject DEK for PD encryption per ADR-0009 §5); Phase 0 acceptable — Vault-light (sealed master-key in systemd credential); Phase 1+ → full Vault.
- pgroll or equivalent for automating expand-contract schema changes.

**Pilot:**

- DR runbook: explicit RTO (4 hours) and RPO (1 hour) with testing
- Read replica PG for analytics (separate OLTP from reporting)
- Secrets rotation procedure (documented, quarterly)

**Scale:**

- Multi-region replication
- Dynamic short-lived credentials via Vault transit (instead of static `.env`)

### 5. Security & Compliance

> **Changed 2026-05-18 (DSO-63 #7, #8, #5+#6):** 187-FZ removed (DS Platform is not CII); УЗ-3 fixed as an architectural assumption; PD lifecycle + consent — in **ADR-0009**; Edge & comms providers registry — below in §5.bis.

**Architectural assumption — УЗ-3:** the DS Platform architecture is designed for УЗ-3 (ИСПДн with special-category PD — medical). Formal ISPDn classification per ФСТЭК-21 + RKN notification of PD processing — parallel legal track (DSO-X2), **hard launch gate before pre-pilot** (does not block development). 187-FZ is N/A — DS Platform is not a CII subject (DSO-63 #7 — Doctor.School is a long-running private B2B business, not a state institution / telecom operator / bank).

**Pre-pilot (several BLOCKERs — see separate section):**

- WAF / rate limiting: **Qrator vs EdgeCenter** — decided in §5.bis Edge & comms providers registry (architectural sub-question: inline managed proxy + anti-DDoS vs CDN-with-WAF). NOT Cloudflare — blocked in RF.
- Email deliverability: SPF, DKIM, DMARC for `doctor.school` (DNS records in Beget); SMTP via the provider chosen in §5.bis.
- **152-FZ data subject rights**: API endpoints `/me/data-export` + `/me/erasure-request` — **closed by ADR-0009 §2.2** (Pre-pilot mandatory).
- **Privacy policy, public offer agreement, cookie consent UI** — static on site + JS banner; consent capture via `/me/consent/accept` (ADR-0009 §2.1, per-purpose versioning).
- **RKN notification** of PD processing — DSO-X2 (legal track), launch gate.
- TLS headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options). CSP profile-per-zone — ADR-0001 Amendment A1.2.
- **Dual-LLM pattern** for UGC — pre-pilot BLOCKER. Closed by **ADR-0010 (dual-LLM mandatory pattern)** + design spec **`2026-05-18-ds-platform-dual-llm-pattern-design`**. Quarantined LLM → symbolic references → privileged LLM. ADR-0011 channel #4 (reviewer agent prompts) — related controls.
- **Endpoint authorization matrix as a CI gate** — pre-pilot BLOCKER. Closed by **`2026-05-18-ds-platform-endpoint-authorization-matrix-design`** (CI gate `tools/lint-endpoint-authz` — fails on missing metadata).
- **Worker readiness (BullMQ queue contract)** — pre-pilot BLOCKER. Closed by **`2026-05-18-ds-platform-bullmq-queue-contract-design`** (queue names, retry/DLQ/idempotency, critical vs non-critical, queue→worker mapping).
- **Egress sanitizers + CI gates** — closed by ADR-0011 + telemetry policy above in §3.bis.
- Separate API tokens: agent vs user vs CI, least privilege.
- No agent write access to prod DB and main branch directly; EVERYTHING via PR.
- Dependency security scan on every PR (part of category 1).

**Pilot:**

- **УЗ-3 152-FZ compliance certificate** for medical PD (formal procedure, requires an auditor) — formal confirmation of the architectural assumption.
- **Prompt injection scan** on PR/issue body (Snyk-Claude or Opsera embedding-similarity).
- Secrets rotation — automate critical ones (DB passwords, third-party API keys).
- WAF rules configured and tuned against real traffic.
- Bug bounty (internal, for the team) or partnership with security researchers.

**Scale:**

- Dynamic short-lived credentials (Vault transit).
- External penetration test (quarterly).
- SOC 2 / ISO 27001 (if pharma partners require).
- Compliance documentation: Personal Data Processing Policy (consent_versions per ADR-0009), agreements with sub-processors (Timeweb, Beget, SMS gateway, email provider — registry in §5.bis).

#### 5.bis Edge & comms providers registry (DSO-63 #8)

A registry of external processors with DPA status, fallback chain, and category. Updated as providers are selected. Every entry feeds the Privacy Notice + RKN notification (DSO-X2).

| Category                        | Primary                                                                    | Fallback                                                                 | DPA status                                      | Notes                                                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DNS**                         | Beget                                                                      | —                                                                        | n/a (no PD at the DNS layer)                    | Already selected. See [[reference_beget_dns]].                                                                                                                           |
| **CAPTCHA**                     | Yandex SmartCaptcha                                                        | —                                                                        | DPA signed                                      | Already selected. RF-accessible.                                                                                                                                         |
| **CDN**                         | Timeweb CDN                                                                | EdgeCenter CDN                                                           | DPA with Timeweb (signed) / EdgeCenter (needed) | Default Timeweb — the stack already lives there.                                                                                                                         |
| **WAF**                         | **Qrator vs EdgeCenter — TBD** (sub-decision pre-pilot)                    | ModSecurity / Coraza at nginx (fallback at start if managed unavailable) | Signed with the chosen provider                 | Architectural sub-question: Qrator — managed inline proxy + anti-DDoS; EdgeCenter — CDN with WAF. Affects where edge rate-limiting lives (on the WAF vs in the backend). |
| **SMS**                         | TBD (SMS.ru / SMSC.ru / MTT / BeelineBusiness — interchangeable)           | TBD (second in the list)                                                 | Signed per provider                             | Choice is an implementation moment. All are RF, all 152-FZ-compliant by default. Circuit-breaker pattern in identity-auth-rbac-design §5.                                |
| **Email transactional**         | TBD (Unisender / SendPulse / Mailganer / Selectel mail / SMTP via Timeweb) | TBD                                                                      | Signed per provider                             | Choice is an implementation moment. Bounce handling in the backend. SPF/DKIM/DMARC on Beget DNS.                                                                         |
| **Email bulk / marketing**      | Unisender (RF, the existing Doctor.School habit)                           | TBD                                                                      | Signed                                          | Marketing only; transactional ≠ marketing.                                                                                                                               |
| **Push notifications (web)**    | self-hosted Web Push (VAPID)                                               | n/a                                                                      | —                                               | Pre-pilot deferred (mobile = PWA).                                                                                                                                       |
| **Push notifications (mobile)** | TBD — pilot trigger                                                        | TBD                                                                      | —                                               | Enabled with native mobile (see ADR-0005 mobile phasing).                                                                                                                |
| **Webinar / video**             | TBD — pilot trigger (if live webinars are needed)                          | —                                                                        | Signed                                          | Bigbluebutton self-hosted / Контур.Толк / Mind / Trueconf shortlist. See DSO-X6 conditional placeholder.                                                                 |

**Launch gate before pre-pilot:**

- All required categories (DNS, CAPTCHA, CDN, WAF, SMS primary, Email transactional primary) — provider selected + DPA signed + present in Privacy Notice + present in the RKN notification (DSO-X2).
- Optional categories (push, webinar) — open; do not block onboarding the first doctor.

### 6. User feedback & roadmap

**Pre-pilot:**

- Internal channel for manual feedback (Mattermost channel #feedback)
- Internal changelog (for the team and pilot testers)

**Pilot:**

- In-app feedback widget: Marker.io self-hosted or custom-built (skip button + text field + auto-screenshot)
- Behavioral analytics: PostHog self-hosted (enabled in this phase, not Pre-pilot — no value without users)
- 1st-line incident response runbook
- Onboarding success metrics dashboard (% completing onboarding, drop-off by step)

**Scale:**

- Public roadmap: Canny self-hosted or GitHub Discussions with templates
- Public status page: Instatus, Gatus self-hosted, or custom-built (minimum — `status.doctor.school` with SLA metrics for 30 days)
- Public changelog
- A/B infrastructure (via Unleash + analytical attribution in PostHog)
- SLA agreements with pharma partners

### 7. Agent operations

**Pre-pilot:**

- **Autonomy ladder document** — explicit registry: Phase 1 = read-only / Phase 2 = PR without merge / Phase 3 = merge with mandatory human review / Phase 4 = end-to-end autonomy. Who approves transitions and by what criteria.
- **Global agent kill switch** — a single config flag (or env-var, or Unleash feature flag) that stops ALL agents at once. Used in case of anomaly.
- **Agent action provenance** — every agent commit is signed + contains in metadata: `agent-id`, `model-version`, `prompt-hash`, `spec-id` (reference to ADR/spec). Git trailers + commit signing is sufficient.
- **LLM cost dashboard** — token spend by project/agent/task (Portkey, Bifrost, or custom middleware)
- **Per-project / per-agent LLM budget cap** with inline rejection (request refused when limit exceeded)
- **Prompt caching enforcement** — system prompts and spec documents are cached (Anthropic prompt caching API), hit-rate monitored
- **"AI PRs face stricter checks" policy** — separate requirements for AI PRs: higher coverage, mandatory security scan, blocking human review even for small changes
- **Guardrails** — list of prohibited operations (`DROP DATABASE`, force-push to main, `rm -rf` on prod instance, deleting backups) — enforced via wrapper scripts + IAM policies
- **Human-in-the-loop checkpoints** — mandatory approval on: (1) merge to main, (2) prod deploy

**Pilot:**

- **SDD-loop as first-class** — spec → ADR → plan → tasks as a mandatory chain; CI validation that code references spec-id
- **Dedicated "agent CI" pipeline** — eval-suite on private corpus + prompt-injection regression + cost regression (warning if new prompt costs 30%+ more than previous)
- Agent action audit log — separate from regular audit log, with 12+ months retention

**Scale:**

- **Adaptive autonomy** — automatic Phase promotion per task-type based on agent success rate / MTTR metrics; demotion on regression
- Multi-agent coordination patterns (if multiple orchestrators run in parallel)

### 8. Spec & ADR governance

**Pre-pilot:**

- ADR format (Markdown, template in repo): context / decision / consequences / alternatives
- ADR catalog in repo (`apps/docs/content/adr/`) + index
- Spec format (`apps/docs/content/specs/`)
- Mandatory: new feature = spec before code, architecture change = ADR
- Spec/ADR — read context for agents via MCP or direct repo read

**Pilot:**

- CI validation: code references spec-id in PR description or commit trailer; PR without reference = warning
- ADR graph — visualization of dependencies between ADRs (manual or automated via parser)
- Spec deprecation lifecycle — how to mark an outdated spec

**Scale:**

- Executable specs (Gherkin / contract tests generated from spec)
- Machine-validatable specs (JSON Schema / OpenAPI fragments in spec document)
- Automatic spec revalidation on code change (if spec references functions — verify they exist)

### 9. Documentation

**Pre-pilot:**

- **README discipline** per repository/service: what it is, how to run, how to deploy, owner, links to spec/ADR
- **API docs**: auto-generate OpenAPI from code (FastAPI/NestJS/etc.) → **Scalar** (default) or Redoc → publish at `api.doctor.school/docs` (auth-gated at Pre-pilot/Pilot)
- ADR catalog: source in repo (`docs/adr/`), index mirror in Outline
- Architecture diagrams as code (Mermaid/PlantUML/Structurizr) in repo, rendered in Outline
- **Runbooks** in repo (source) + mirror in Outline for on-call: incident response, restore-from-backup, secret rotation, DSR handling
- Technical changelog: auto-generated from conventional commits, published (Scalar page or `developer.doctor.school`)
- Base Outline structure: `Technical / User / Process / ADRs`
- **Doc freshness checks** in CI: broken links, links to non-existent files (agents read docs as context — stale docs = hallucinations)

**Pilot:**

- User-facing guides in Outline:
- Doctor guide (onboarding, taking a course, receiving NMO (Continuing Medical Education) certificate)
- CMS admin guide (DS content manager)
- FAQ by user segment
- In-app onboarding flows (linking out to Outline guides)
- Process docs: "How to contribute" (including AI agent), release runbook, incident response

**Scale:**

- Partner docs (pharma campaigns, analytics, leads) in Outline
- Video tutorials (hosted via Vimeo Pro / custom player on S3+CDN)
- Public API docs at `developer.doctor.school` (if entering public API)
- Multilang (en-US if needed for international partners)

## BLOCKERs for Pre-pilot

Without these items **we do not onboard the first real doctor to prod**:

### Compliance (legal)

1. **RKN notification** of PD processing submitted and accepted (DSO-X2 legal track).
2. **ИСПДн classification per ФСТЭК-21** — formal act with УЗ-3 (DSO-X2). 187-FZ N/A (not CII).
3. **Privacy policy + public offer agreement + per-purpose consent** published; capture via `/me/consent/accept` per-version (ADR-0009 §2.1).
4. **152-FZ data subject rights endpoints**: data export, data deletion — operational (ADR-0009 §2.2 — Pre-pilot mandatory).
5. **Retention matrix** published in `packages/db/schema/pd/retention.ts` + CI-validated (ADR-0009 §2.6).
6. **Cookie consent UI** on all public pages.
7. **Edge & comms providers — all required categories** (DNS, CAPTCHA, CDN, WAF, SMS primary, Email primary) — provider selected + DPA signed (see §5.bis).

### Security

8. **Dual-LLM pattern** for all UGC (issues, support, uploaded files) — reference impl in ai-stack-design §6 (DSO-X5).
9. **Egress sanitizers + CI gates** (PII scanner, audit-egress-channels) — ADR-0011 §2.4.
10. **Separate API tokens** agent/user/CI with least privilege; no agent write to prod-DB or main-branch.
11. **TLS + security headers** configured (HSTS, CSP profile-per-zone per ADR-0001 A1.2).
12. **Email deliverability** (SPF/DKIM/DMARC) configured for doctor.school.
13. **Host-only `__Host-` cookie per app + OIDC silent re-auth** (ADR-0001 §6 + Amendment A2) — no shared cross-subdomain cookies.

### Operational

14. **Canonical backup topology** — Timeweb primary + Beget S3 offsite + Vault keys on a dedicated VM (data-layer-design §2.4).
15. **Restore drill** documented in the operational runbook (DSO-10) + tested end-to-end once before pre-pilot.
16. **Per-subject crypto-shred** operational (ADR-0009 §5) — erasure compatible with the 30-day 152-FZ SLA.
17. **Redis ops baseline** — AOF + daily RDB backup + per-namespace eviction policy + alerting (ADR-0003 Amendment A2/§A).
18. **Global agent kill switch** is operational.
19. **Autonomy ladder document** written; current agent level recorded.

### Observability

20. **Tamper-evident audit log** operational, covering: changes to doctor data, agent actions, admin operations (ADR-0003 §6 + ADR-0009 §2.4 tombstoning).
21. **Telemetry classification & PII scrubbing policy** — in place (this spec §3.bis). PII scanner CI gate + red-team tests operational.
22. **Error tracking** (GlitchTip self-hosted) connected to all services, with the `beforeSend` scrubber.
23. **OpenTelemetry GenAI tracing** enabled for all LLM calls + attribute allowlist + per-call audit (ADR-0011 channel #1).

## Tooling decisions (default stack)

Fixed specific tools (can be changed via ADR with rationale):

| Layer              | Default                                                                    | Alternative                             |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| CI/CD              | GitHub Actions                                                             | Forgejo Actions (self-hosted) if needed |
| Preview env        | Coolify self-hosted on Timeweb                                             | Dokploy, Argo Rollouts                  |
| Container signing  | cosign + Syft (SBOM)                                                       | —                                       |
| Logs               | Loki                                                                       | self-hosted ELK if needed               |
| Metrics            | Prometheus + Grafana                                                       | VictoriaMetrics                         |
| Error tracking     | GlitchTip self-hosted (fixed by ADR-0004 §15 / ADR-0005 §10)               | — (Sentry SaaS rejected: PD out of RF)  |
| Tracing            | Tempo (Grafana stack)                                                      | Jaeger                                  |
| Audit log storage  | append-only PG table with hash-chain                                       | S3 WORM bucket                          |
| Secrets            | Vault self-hosted                                                          | Doppler, Bitwarden self-hosted          |
| Feature flags      | Unleash self-hosted                                                        | GrowthBook self-hosted                  |
| Migration tool     | Alembic (PG) + pgroll for expand-contract                                  | Flyway                                  |
| E2E                | Playwright                                                                 | —                                       |
| Load testing       | k6                                                                         | Artillery                               |
| WAF/DDoS           | Qrator or EdgeCenter                                                       | ModSecurity/Coraza on nginx (start)     |
| CDN                | Timeweb CDN (default), Selectel CDN, EdgeCenter                            | —                                       |
| DNS                | **Beget** (current registrar and DNS provider for all DS Platform domains) | —                                       |
| Email SMTP         | Resend (via own domain) or Selectel mail                                   | —                                       |
| API docs renderer  | **Scalar**                                                                 | Redoc                                   |
| Prose docs / wiki  | Outline self-hosted                                                        | —                                       |
| User analytics     | PostHog self-hosted (at Pilot)                                             | —                                       |
| Public status page | Gatus self-hosted (at Scale)                                               | Instatus                                |
| Public roadmap     | Canny self-hosted (at Scale)                                               | GitHub Discussions                      |
| LLM cost gateway   | Portkey or Bifrost                                                         | custom middleware                       |

## What this spec does NOT cover

- **Specific VPS T-shirt sizes** for each component — that is in plan #2 (Plane prod-migration) and in subsequent plans for the DS-platform
- **Legal model for 152-FZ notification and UZ-3 certification** — a separate task for Product Lead + lawyers, not infra
- **DS-platform architecture itself** (modules, services, data) — in the platform PRD and dedicated specs
- **Zone AI architecture** — a separate spec when the first AI worker reaches production
- **Specific agent-orchestrator design** — a separate spec

## Sources

- Brainstorm session 2026-05-12 with Tech Lead
- AI-research-agent (general-purpose), research of 2025-2026 standards
- Tenancy decision (2026-05-12)
- Infra cost research (2026-05-07)
- DS Platform PRD
