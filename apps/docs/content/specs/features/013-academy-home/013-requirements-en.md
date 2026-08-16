---
title: "013 — Public Academy home and durable partner-lead capture"
description: "Production requirements for the owner-curated Academy home at /, real navigation and login, and consented idempotent lead capture persisted before durable asynchronous Mattermost delivery."
slug: 013-academy-home-requirements
product: ./013-product.md
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1307
issues:
  - 1307
prior_decisions:
  - "ADR-0014: PRD-to-EARS traceability and owner-approved Stage A source"
  - "ADR-0013: @ds/design-system token and component source of truth"
  - "ADR-0006 §4: bilingual product requirements, flat EARS numbering, SDD triplet"
  - "ADR-0004: Next.js portal user-facing surface"
  - "ADR-0002: NestJS, Zod schema SSOT, URI-versioned REST, endpoint authorization"
  - "ADR-0003: Postgres retained-row lifecycle, transactional outbox, BullMQ delivery"
  - "ADR-0009: immutable consent evidence, retention, erasure, and PD lifecycle"
  - "ADR-0011: allowlisted fail-closed egress from the RF PD perimeter"
  - "ADR-0012: production service topology for the notifications worker"
lang: en
---

> **EN (this)** · **RU:** [`013-requirements-ru.md`](./013-requirements-ru.md) · PRD source: [`013-product.md`](./013-product.md), US-1…US-12.

# 013 — Public Academy home and durable partner-lead capture

## Outcomes

- Public `/` is the Academy front door, rendered in the exact owner-approved composition and Russian content pinned by the PRD, with no redirect to `/webinars` and no dynamic CMS/taxonomy dependency.
- Every visible control is production-real: desktop navigation, mobile menu, theme, login, canonical content links, CTAs, privacy link, direct contacts, form states, and footer links.
- A valid partner request becomes a retained database lead with immutable, server-stamped consent evidence before the visitor sees success; Mattermost is durable asynchronous delivery, not the record of truth.
- Retries caused by browser/network ambiguity or worker delivery never duplicate or lose a lead, and no rejection, log, metric, outbox payload, or API response exposes personal data.
- The whole journey is verified in a real browser at desktop/mobile × light/dark, including reject/accept, ambiguous retry, notification outage, interaction states, and axe.

## Scope

**In:**

- The public Next.js portal route `/`, with the exact section order, copy, two canonical rows, six expert portraits, project/partner/format fixtures, footer, and assets pinned in the PRD to `apps/academy-demo` commit `7330e4d8a99bdeca73285e2b4eabf09d7021788c`.
- Real header/footer navigation, working mobile menu and theme control, existing login flow, and the no-saved-destination post-login default `/webinars`.
- A real accessible partner form: required name; optional company; required email-or-Telegram; optional role select; required consent; loading, actionable validation/error, and success states.
- Public `POST /v1/academy/leads`, typed request/response schemas, dedicated public-endpoint protections, idempotency, retained lead/consent persistence, audit context, and PD masking.
- The first production `job_outbox` producer/drainer and `notifications-worker` process for critical Academy-lead delivery via BullMQ and the dedicated Mattermost webhook.
- Deployment schema/preflight for `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL`, restricted to the notifications worker.

**Out:**

- Dynamic CMS/taxonomy content, automatic event selection/reordering, or home editorial admin; the first release is owner-curated.
- `/projects` and `/experts` catalog/detail delivery; the home navigation uses the real on-page sections until those features ship.
- Event destination behavior, webinar registration/room/recording changes, CRM stages, lead assignment/admin UI, confirmation email, and marketing automation.
- Editing the privacy-policy document at `https://doctor.school/index/privacy-pay`; 013 reads its immutable active version for evidence.
- Opening child Issues, a PR, or any implementation as part of this spec-authoring pass.

## Constraints

- **Exact content and DS-only UI.** The PRD and pinned source commit are the fidelity contract. All UI uses `@ds/design-system` tokens/primitives; no substitute copy, portrait, metric, control, arbitrary Tailwind value, disabled demo affordance, or invented block is permitted.
- **Public endpoint classification.** `POST /v1/academy/leads` is `@Public`, has a dedicated `@RateLimited` scope, `@BotProtected("academy-lead")`, and high-stakes/audited `@Authz`. It requires `Idempotency-Key`; its response contains no submitted PD.
- **Atomic acceptance.** One `withRequestAuditContext` database transaction creates the retained `academy_leads` row, immutable lead-consent evidence, durable `job_outbox` row with payload `{leadId}` only, and the completed idempotency record. Commit precedes the accepted API response and success UI.
- **Server-owned consent proof.** The server stamps the exact policy URL, immutable active version tag, normalized content snapshot or its durable reference plus SHA-256, and database-clock `acceptedAt`. Client-supplied evidence fields are ignored. The existing user-FK-bound `consent_records` table is not reused unchanged for a guest lead.
- **Retained rows.** Before migration, lead/evidence/outbox policy is added to the code retention matrix. Application rows are never physically deleted/cascade-deleted as ordinary lifecycle behavior; status/`deletedAt`, append-only evidence, value erasure, tombstone, and crypto-shred apply as classified by ADR-0003/0009.
- **No PD in operational surfaces.** Lead tables are registered in audit PD masking. Names, company, contact, webhook URL, and message payload never appear in logs, errors, metrics, traces, or outbox JSON.
- **Durable notification.** Postgres outbox is authoritative across Redis outages/restarts. BullMQ job id equals outbox id; delivery is at-least-once and the consumer is idempotent. Expired claims are reclaimed; retries use exponential backoff with jitter; exhausted rows remain retained, alerted, and replayable.
- **Secret and egress boundary.** Only `notifications-worker` receives `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL`; no fallback to `MATTERMOST_WEBHOOK_URL`, no `NEXT_PUBLIC_*` exposure, and no secret logging. ADR-0011 requires a verified RF-resident/approved PD-perimeter destination and explicit allowlist; otherwise sending fails closed while the lead remains pending.

## Prior decisions

- **ADR-0014 §1–2** — the PRD is the source of outcomes and stable `US-N`; every EARS clause backlinks with `realizes:`.
- **ADR-0013** — code-owned design tokens/components and the owner-approved source define UI fidelity; live Stage B remains mandatory.
- **ADR-0006 §4** — bilingual product requirements, flat EARS ids, design and scenarios EN-only.
- **ADR-0004** — the public surface belongs to the Next.js portal and preserves the existing authentication integration.
- **ADR-0002** — NestJS + Zod REST contract, `/v1` URI versioning, explicit endpoint authz, Vitest/supertest.
- **ADR-0003** — Postgres/Drizzle, retained application rows, transactionally durable outbox, BullMQ delivery semantics.
- **ADR-0009** — immutable versioned consent evidence, PD retention/erasure policy, and code-owned retention matrix.
- **ADR-0011** — external PD egress is allowlisted, audited, minimal, and fail-closed.
- **ADR-0012** — the notifications worker is an independently deployed process with least-privilege configuration.

## Event Model

### Commands

- `SubmitAcademyLead(canonicalPayload, idempotencyKey)` — validate, protect, stamp consent, and atomically accept one lead.
- `DrainLeadNotificationOutbox(outboxId)` — claim a retained ready row and enqueue BullMQ with `jobId = outboxId`.
- `DeliverAcademyLeadNotification(outboxId)` — load the minimum lead fields by `leadId`, verify egress, post to the private Academy-leads channel, and acknowledge delivery.
- `ReplayExhaustedLeadNotification(outboxId)` — authorized operational replay of a retained exhausted row without creating another lead.

### Events

| Event                                   | Minimum payload                                               | Meaning                                                               |
| --------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| `AcademyLeadAccepted`                   | `leadId`, `outboxId`, `acceptedAt`                            | The transaction committed and the visitor may see success.            |
| `AcademyLeadNotificationQueued`         | `outboxId`, `attempt`                                         | A BullMQ job was idempotently made available.                         |
| `AcademyLeadNotificationDelivered`      | `leadId`, `outboxId`, provider receipt metadata without PD    | The private destination acknowledged the message.                     |
| `AcademyLeadNotificationRetryScheduled` | `outboxId`, `attempt`, `nextAttemptAt`, classified error code | A transient/ambiguous failure remains pending.                        |
| `AcademyLeadNotificationExhausted`      | `outboxId`, `attempt`, classified error code                  | Automatic attempts ended; the retained row is alerted and replayable. |

### Read models

- `AcademyHomeContent` — immutable owner-curated composition/assets from the PRD source pin.
- `AcademyLeadAcceptedResponse` — opaque `submissionId`, accepted status, and no name/company/contact/consent/webhook fields.
- `AcademyLeadDeliveryStatus` — restricted operational view keyed by stable lead/outbox ids, state, attempts, and timestamps; no webhook secret and no unnecessary PD.
- `ActiveLeadPolicyVersion` — immutable version tag, exact URL, normalized content snapshot/reference, SHA-256, effective interval.

### Policies

- **Lead validation:** name and contact are required; contact is a valid email or Telegram username; company and role are optional; consent must be true.
- **Idempotency:** same key + same canonical payload returns the original accepted response and creates no new lead/outbox/message; same key + different canonical payload returns conflict.
- **Acceptance:** database commit is the success boundary. Mattermost delivery never blocks or reverses an accepted response.
- **Notification:** minimum necessary fields only, a stable non-PD lead id for duplicate recognition after ambiguous timeouts, private authorized Academy-leads channel only.
- **Egress:** unverified residency/perimeter or missing allowlist/secret keeps the outbox pending/exhausted and emits a PD-free operational alert; it never sends elsewhere.

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more stable PRD stories.

- **EARS-1** _(realizes: US-1, US-5, US-12)_ — When any visitor requests `/`, the system shall render the public Academy home without authentication or redirect, in the exact order **hero → What → People (Project first, then six experts) → Events → Why → Projects → partner value → formats → real lead form → footer**, with the single full-width partner hero and exact owner-approved Russian copy.
- **EARS-2** _(realizes: US-1, US-5, US-12)_ — The Academy home shall use only the assets and curated fixtures pinned in `013-product.md` to commit `7330e4d8a99bdeca73285e2b4eabf09d7021788c`, including `14 партнёров · прозрачная модель`, and shall contain no dynamic CMS/taxonomy feed, substituted copy/portrait, disabled demo affordance, or false project metrics.
- **EARS-3** _(realizes: US-2, US-4, US-12)_ — The People section shall render the `Кто стоит за брендом` Project block before exactly six expert cards with their exact names, credentials, and supplied portraits; the Project block and Events shall render the same two canonical rows in the same order, including the exact B2B href `https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd`.
- **EARS-4** _(realizes: US-3, US-10)_ — When a visitor activates header/footer navigation, the mobile menu, logo, theme, login, a content row, direct contact, privacy link, or CTA, the system shall execute its real documented destination/behavior; successful login with no stronger saved destination shall resolve directly to `/webinars`, while an explicit `/` request remains on the public home.
- **EARS-5** _(realizes: US-11, US-12)_ — The system shall render the complete DS-only surface and visible hover/active/focus/loading/error/success states at desktop and mobile breakpoints in light and dark themes, keyboard-operable and free of axe WCAG 2 A/AA violations.
- **EARS-6** _(realizes: US-6)_ — When the visitor attempts the lead form with missing/invalid name or email-or-Telegram contact, or without consent, the browser shall make no lead request or write, preserve other valid input, focus/associate an actionable field error, and with valid input shall reuse one generated `Idempotency-Key` through loading and transport retries.
- **EARS-7** _(realizes: US-6, US-9)_ — When any caller sends `POST /v1/academy/leads`, the API shall enforce `@Public`, dedicated `@RateLimited`, `@BotProtected("academy-lead")`, high-stakes/audited `@Authz`, schema validation, and required `Idempotency-Key`; 429, bot, validation, conflict, and accepted responses shall be generic/actionable as appropriate and echo no PD.
- **EARS-8** _(realizes: US-7, US-8, US-9)_ — When a protected, valid, novel submission is accepted, one `withRequestAuditContext` transaction shall create one retained `academy_leads` row, its immutable restrictively-linked consent evidence, one retained `job_outbox` row containing only `{leadId}`, and the completed idempotency record; only after commit shall the API return accepted and the browser show `Заявка отправлена`.
- **EARS-9** _(realizes: US-6, US-9)_ — When EARS-8 records consent, the server shall stamp the exact policy URL `https://doctor.school/index/privacy-pay`, immutable active version tag, normalized content snapshot/reference and SHA-256, and database-clock `acceptedAt`; it shall not trust a client evidence tuple or reuse the existing guest-incompatible user-FK `consent_records` model unchanged.
- **EARS-10** _(realizes: US-7, US-9)_ — When `POST /v1/academy/leads` receives the same `Idempotency-Key` and same canonical payload again, the system shall return the identical accepted result without another lead, consent row, outbox row, or notification; the same key with a different canonical payload shall return conflict without a write.
- **EARS-11** _(realizes: US-8, US-9)_ — After a lead transaction commits, the durable Postgres outbox drainer shall survive Redis/process restarts, reclaim expired claims, and enqueue an at-least-once BullMQ job with `jobId = outboxId`; the idempotent notifications worker shall acknowledge and complete the retained outbox only after a delivery acknowledgement.
- **EARS-12** _(realizes: US-8, US-9)_ — When the notifications worker delivers a lead, it shall alone read `ACADEMY_LEADS_MATTERMOST_WEBHOOK_URL`, never fall back to `MATTERMOST_WEBHOOK_URL` or expose it as `NEXT_PUBLIC_*`, load by `{leadId}`, and send only the minimum necessary fields plus a stable lead id to the private authorized Academy-leads channel without logging secret or payload.
- **EARS-13** _(realizes: US-8)_ — If Mattermost returns a transient error or an ambiguous timeout, the delivery shall remain pending and retry with exponential backoff plus jitter; exhausted attempts shall remain retained, alerted, inspectable, and replayable, never discarded, and duplicate recognition shall use the stable lead id.
- **EARS-14** _(realizes: US-8, US-9)_ — While the configured Mattermost destination is not verified RF-resident/inside the approved PD perimeter and explicitly allowlisted under ADR-0011, the worker shall fail closed without sending, retain the lead/outbox for retry or authorized replay, and emit only a PD-free operational signal.
- **EARS-15** _(realizes: US-9)_ — The system shall register lead/evidence/outbox lifecycle in the code retention matrix before migration, retain application-owned rows without physical delete/cascade, apply classified status/`deletedAt`/append-only/value-erasure/tombstone/crypto-shred semantics, add lead data to audit PD masking, and exclude name, company, contact, webhook URL, and message payload from logs/errors/metrics/traces.
- **EARS-16** _(realizes: US-1, US-2, US-3, US-6, US-7, US-8, US-10, US-11, US-12)_ — Before Feature 013 is accepted, browser E2E shall prove exact content/order/navigation/menu/login/canonical links, invalid-form no-request, valid acceptance, ambiguous network retry with no duplicate, notification outage/fail-closed success-after-persistence, both breakpoints × both themes, axe, and visible hover/active/focus/loading/error/success states.

## Invariants

1. `/` is public home; default post-login destination is `/webinars`.
2. The PRD source pin is the content/composition SoT; both canonical row instances are identical.
3. One idempotency key identifies at most one canonical payload and one accepted lead transaction.
4. Accepted means lead + consent evidence + outbox + idempotency record committed atomically.
5. Consent evidence is server-stamped, immutable, and restrictively tied to the retained lead.
6. Outbox payload is `{leadId}` only; PD and webhook secrets never enter it or operational telemetry.
7. Postgres is durable truth; Redis/BullMQ and Mattermost are delivery mechanisms.
8. Delivery is at-least-once and consumer-idempotent; failures remain retained and replayable.
9. Egress without verified RF/approved-perimeter allowlisting is fail-closed.
10. No application-owned lead/evidence/outbox row is physically deleted as ordinary lifecycle behavior.

## Verification

| EARS  | Layer                            | Required evidence                                                                                                                                                            |
| ----- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–5   | Portal Playwright                | Exact order/copy/assets, six portraits, duplicate canonical rows/hrefs, all real controls, login default, desktop/mobile × light/dark, interaction states, screenshots, axe. |
| 6     | Portal Playwright + client unit  | Invalid input/consent produces no request; input retained; valid submit creates/reuses one key.                                                                              |
| 7, 10 | API Vitest e2e + unit            | Decorator/authz matrix, validation, 429/bot response, same-key replay, different-payload conflict, PD-free bodies.                                                           |
| 8–9   | API/Postgres integration         | One transaction and rollback tests; restrictive FK; DB-clock immutable policy evidence; commit precedes 202; no guest `consent_records` reuse.                               |
| 11–14 | Worker/outbox/BullMQ integration | Redis/restart recovery, expired claim reclaim, job-id dedupe, ack boundary, ambiguous timeout retry, exhaustion/replay, secret isolation, ADR-0011 fail-closed.              |
| 15    | Migration/lint/security tests    | Retention-matrix entry, no cascade/delete lifecycle, audit masking, log/error/metric/trace redaction.                                                                        |
| 16    | End-to-end Playwright            | Reject → accept → success, ambiguous retry/no duplicate, outage/fail-closed success after persistence, login route, visual/a11y matrix.                                      |

Production tests use `it('EARS-N: …')`; Gherkin tags map directly to the same flat ids.
