---
title: "025 — Attention points engine: accrual, spend and gating"
description: "Requirements for the one attention-points ledger a doctor holds across the doctor storefront, the Academy and the mobile app: the person account and its three denominations (Pul, Bre, Con), the immutable double-entry postings that each carry a rule version and a unique event id, the accrual rules with their defaults and the (doctor, content item, action) dedupe, the reserve on sign-up / debit on confirmed attendance / release on cancel, no-show or event cancel, the per-event advance flag with its 150 Pul obligation cap netted from future earnings, the referral award and its monthly cap, the consented monthly leaderboard read model, the admin API for rules, prices and gating modes, compensating corrections, attention aggregates for 036 and the frozen account on erasure. Backend-only: every surface belongs to a consumer."
slug: 025-attention-points-engine
status: Draft
surface: backend-only
tracker: https://github.com/doctor-school/ds-platform/milestone/23
prior_decisions:
  - "ADR-0016 — Core domain model (§6 points and money are one append-only ledger family; design §2.11 ledger account, §2.12 posting; §7 consents under the PD lifecycle)"
  - "ADR-0003 — Data layer (§2.7 / §3 append-only ledger: unique `event_id` dedupe, a DB trigger refusing UPDATE/DELETE, monthly partitions — the shipped `audit_ledger` is the template)"
  - ADR-0001 — Identity / Auth / RBAC (the admin API is RBAC-guarded; the doctor reads only their own account)
  - ADR-0002 — Backend core stack (NestJS + nestjs-zod; REST/OpenAPI under `/v1`; RFC 7807 Problem Details)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS numbering)
  - ADR-0009 — Per-purpose consent versioning (the leaderboard-dissemination purpose is one more versioned purpose)
  - ADR-0014 — Product-design delivery lifecycle (§2 PRD → EARS `realizes:` trace)
lang: en
---

> **EN (this)** · **RU:** [`025-requirements-ru.md`](./025-requirements-ru.md)
>
> PRD source: [`025-product.md`](./025-product.md) (US-1…US-15). Design: [`025-design.md`](./025-design.md) · Scenarios: [`025-scenarios.feature`](./025-scenarios.feature). Research record: [attention points — legacy and research recon](../../product/attention-points/legacy-recon.md). Owner decisions: Issue [#1794](https://github.com/doctor-school/ds-platform/issues/1794) «Discovery decisions (owner, 2026-11-06)». Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md), **wave 2**. 025 has no `blocked_by`; 020, 022 and 024 depend on it. The engine puts no screen in front of anyone, so `surface: backend-only`.

# 025 — Attention points engine (Requirements)

## Outcomes

- Every doctor has **exactly one attention-points account** that the doctor storefront, the Academy and the mobile app all read and post to through one API; the same balance is true everywhere by construction, never by synchronisation.
- The account carries three **denominations**: **Pul** (the only spendable one, never exchangeable to money), **Bre** (reputation) and **Con** (awareness, only grows). The fixed weight 1 Con = 2 Bre is used only by the leaderboard and attention reporting.
- Every movement is an **immutable double-entry posting**; a balance is a fold over postings; a correction is a compensating posting; every posting names the **rule and rule version** that produced it, so experiments stay comparable and sponsor reports stay reconcilable after re-tuning.
- Every accrual amount, price, cap, threshold and formula is a **configurable, versioned parameter with a default**, changed through the admin API without a release.
- The same (doctor, content item, action) is **accrued at most once**, whichever storefront or device reported it, including the mobile app's offline sync; mistakes never remove points.
- Pul is **reserved on sign-up** for a priced event, **debited only on confirmed attendance**, and **released** on a cancel, a no-show or an event cancelled by the platform — so there is no negative balance and no refund procedure.
- The **advance** is a per-event flag, identical for every doctor; an arrival link records the source only. An advance is an obligation netted from future Pul earnings, capped at 150 Pul per person, never a negative balance and never a block on open content.
- A consented, monthly, per-specialty **leaderboard read model** ranks 2·Con + Bre earned in the calendar month; the Pul balance never ranks.
- Feature **036** receives **attention aggregates** per project and output built from postings with their rule versions, with no per-doctor rows.

## Scope

**In:**

- The **ledger**: person accounts and the system accounts double entry needs (ADR-0016 design §2.11), postings (§2.12) with the denomination, the unique `event_id`, the dedupe key and the rule version; the immutability trigger and monthly partitions of ADR-0003 §3, mirroring the shipped `audit_ledger`.
- The **accrual engine**: consuming the accrual-source domain facts listed in the Event Model, evaluating the active rule version, writing postings and emitting `PointsCredited`.
- The **rule book**: versioned accrual rules, event prices and gating modes, the advance cap, the referral cap, the presence share, the concurrent-reserve limit and the leaderboard formula, each with the PRD default.
- The **spend side**: the gating decision, reserve / debit / release, the advance and its obligation, settlement from future earnings.
- The **read side** over the API: the doctor's own balances and history, the gating decision for one doctor and one event, the monthly leaderboard read model, the attention aggregates for 036.
- The **admin API** for rules, prices and gating modes and for compensating corrections, each change audited.
- The **erasure seam**: closing and freezing a person account.

**Out (each with its owner):**

- **Every screen.** The event page's price line, advance progress, threshold hint and the money statement «бесплатно для врача» decoupled from `pulCost` — feature **020**, aligned in [#3801](https://github.com/doctor-school/ds-platform/issues/3801); the registration promise and the credit on the success state — feature **021**, aligned in [#3801](https://github.com/doctor-school/ds-platform/issues/3801); the account's three balances, open advance and posting history — feature **022**, Issue [#1791](https://github.com/doctor-school/ds-platform/issues/1791); the consent-gated specialty leaderboard block and the consent toggle — feature **018**, Issue [#1495](https://github.com/doctor-school/ds-platform/issues/1495); the learning screens — feature **024**; the mobile app — its own track (functional map, owner decision 2026-08-22), consuming this API.
- **The admin screens** for rules, prices, gating modes and corrections. 025 ships the admin **API** only; the admin UI is deferred to a follow-up Issue the lead opens with the EARS set (`open-ears-issues`), which owns the `apps/admin` surface and its browser verification.
- **The waiting list** on limited-seat events — event registration (**020** / **005**); 025 only refuses a reserve beyond the concurrent-reserve limit (EARS-21).
- **Attendance confirmation itself** — the presence beats and the attendance fact are the room's and the event registration's; 025 consumes the confirmed-attendance fact and owns only the presence share parameter it is computed against (EARS-9).
- **Phone verification and profile verification** — the account's (feature **022**, over **003**); 025 consumes the facts.
- **Money** — sponsor billing, invoices, the money side of attention aggregates and named sponsor reports under a separate art. 9 consent — feature **036**.
- **Next-wave sinks**, Pul for partner or promotional content, an advertising coefficient, admin anomaly analytics — not at launch (PRD Out of scope).

## Constraints

- **One ledger family.** No balance column anywhere, no second ledger, no per-storefront account; the money unit of the same family is 036's and is not written here.
- **Postings are immutable.** No UPDATE or DELETE reaches a posting row — enforced in the database, not only in code; a correction is a new posting that names the one it reverses.
- **Every number is a parameter.** No accrual amount, price, cap, share or weight is a literal in code; each is read from the active rule version and stamped on the posting it produces.
- **Rules depend only on attention.** No rule input reads an arrival source, a sponsor, a prescription, a sale or a per-doctor sponsor-funded value (323-FZ art. 74, AIPM — PRD Compliance guardrails); the arrival source is recorded on the posting as attribution only.
- **Pul is never money.** No API field, problem detail or admin text expresses a Pul amount in money, calls a Pul price «бесплатно», or names points «баллы» in the НМО sense; no field derives a «free» statement from a zero Pul cost.
- **Lessons never cost Pul** and events never accrue Pul; an НМО-accredited event is always open.
- **No legacy points concept.** Nothing migrates into the ledger from the old platform.
- **Server-side evidence only.** Lesson and module credit is accrued only on 024's computed completion facts, event credit only on the server-side attendance fact; a client-asserted completion is never an accrual source.

## Prior decisions

- **ADR-0016 §6 + design §2.11–§2.12:** one append-only ledger family; ledger accounts per subject (`person` · `project_fund` · `organisation` · `system`) with unit `attention_points` | `money`; immutable double-entry postings carrying project, output, `rule_id` / `rule_version`, the attribution subject (organisation, member) and `reverses_posting_id`; a balance is a fold; on erasure the account is closed and frozen and postings are never rewritten.
- **ADR-0003 §2.7 / §3:** append-only with a unique `event_id`, a trigger refusing UPDATE/DELETE, and monthly partitions — `audit_ledger` (`packages/db/src/schema/audit-ledger.ts`) is the shipped template.
- **Reconciliation recorded here (no ADR edit in this PR).** ADR-0003 describes a single ledger table keyed by a unique `event_id`; ADR-0016 §2.12 describes accounts plus postings with no `event_id`. 025 keeps ADR-0016's two-table shape and gives **every posting a unique `event_id`** (the idempotency key of the fact that produced it) — both constraints hold. ADR-0016's unit enum stays `attention_points` | `money`; the three PRD units are a **`denomination`** (`pul` · `bre` · `con`) on a posting whose unit is `attention_points`, so one person keeps **one** attention-points account (§2.11) rather than three. Both are declared increments of the ADR-0016 design table, to be folded into it by a `do-adr-revision` when the ledger ships.
- **ADR-0009:** the leaderboard-dissemination consent (152-FZ art. 10.1) is one more versioned per-purpose record in `consent_records`; 025 invents no consent store.
- **ADR-0001:** the doctor reads only their own account; the admin API requires an admin role; consumers post facts service-to-service, never with a doctor's token on another doctor's account.
- **Owner, 2026-11-06 (Issue #1794):** the advance is a per-event flag for every doctor; every accrual is a configurable parameter and every posting records its rule version; no legacy points concept.

## Event Model

### Commands

- `AccrueFromFact({ eventId, personId, action, contentRef?, projectId?, occurredAt, attribution? })` — internal; issued by the policy that consumes an accrual-source fact. Idempotent on `eventId` and on the dedupe key.
- `ReserveForSignUp({ personId, eventRef, registrationId })` — internal; issued on 020's `RegistrationCreated` for an event with a Pul price. May be refused (`points-threshold-short`, `points-reserve-limit`).
- `SettleReserve({ registrationId })` — internal; on confirmed attendance.
- `ReleaseReserve({ registrationId, reason: 'doctor-cancel' | 'event-cancel' | 'event-reschedule' | 'no-show' })` — internal.
- `PublishRuleVersion({ ruleId, parameters, effectiveFrom? })` — admin API `POST /v1/admin/points/rules/:ruleId/versions`.
- `SetContentGating({ contentRef, mode: 'open' | 'advance' | 'threshold', pulCost, limitedSeats })` — admin API `PUT /v1/admin/points/gating/:contentRef`.
- `PostCorrection({ reversesPostingId, reason })` / `PostManualAdjustment({ personId, denomination, amount, reason })` — admin API `POST /v1/admin/points/corrections`.
- `CloseAccount({ personId, cause: 'erasure' | 'consent-refusal' })` — internal; issued by the personal-data lifecycle (037 / ADR-0009 erasure procedure).

### Events

025 consumes (accrual sources and spend triggers):

| Consumed fact                                                     | Owner         | Effect                                           |
| ----------------------------------------------------------------- | ------------- | ------------------------------------------------ |
| `DoctorRegistered { accountId }` + `PhoneVerified { accountId }`  | 021 / 022·003 | registration grant once both hold (EARS-5)       |
| `ProfileVerified { accountId }`                                   | 022           | profile grant (EARS-6)                           |
| `LessonCompleted { accountId, lessonId, mode }`                   | 024           | lesson accrual (EARS-7)                          |
| `ModuleCompleted { accountId, moduleId, mode }`                   | 024           | module accrual (EARS-8)                          |
| `AttendanceConfirmed { registrationId, presenceShare }`           | 020 / room    | debit the reserve + participation award (EARS-9) |
| `QuestionAsked` · `EventRated` · `InteractiveAnswered`            | room / 020    | capped engagement award (EARS-10)                |
| `RegistrationCreated` · `RegistrationCancelled`                   | 020 / 005     | reserve (EARS-14–16) / release (EARS-18)         |
| `EventCancelled` · `EventRescheduled` · `EventEnded`              | events domain | release, or no-show release (EARS-18)            |
| `ConsentGranted` / `ConsentRevoked` (`leaderboard-dissemination`) | 018 / 037     | leaderboard row in / out (EARS-24)               |

025 emits:

| Emitted event                                                                   | Consumer                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `PointsCredited { personId, eventId, postings: { denomination, amount }[] }`    | 021 (the only source of a credited amount), 022, mobile |
| `ReserveCreated` / `ReserveSettled` / `ReserveReleased { registrationId, ... }` | 020, 022                                                |
| `AdvanceOpened` / `AdvanceSettled { personId, remaining }`                      | 020, 022                                                |
| `RuleVersionPublished { ruleId, version }`                                      | admin audit, 036                                        |

### Read models

- `PointsAccount { personId, pul: { available, reserved }, bre, con, advance: { open: number, remaining: number }, status: 'open' | 'closed' }` — `GET /v1/me/points`; a fold over postings, never a stored column (a cache, if ever added, is derived and rebuildable).
- `PostingHistory { items: { postingId, occurredAt, denomination, amount, action, contentRef?, ruleId, ruleVersion, reversesPostingId? }[], nextCursor }` — `GET /v1/me/points/postings`.
- `GatingDecision { contentRef, mode, pulCost, decision: 'open' | 'reserve' | 'reserve-with-advance' | 'short', reservedFromBalance, coveredByAdvance, shortfall, earnHint?: { lessonsNeeded } }` — `GET /v1/me/points/gating/:contentRef`.
- `MonthlyLeaderboard { specialtyCode, month, top: Row[10], own?: { rank, score, neighbours: Row[] } }` with `Row { rank, displayName, city?, photoRef?, score }` — `GET /v1/points/leaderboard/:specialtyCode?month=YYYY-MM`.
- `AttentionAggregate { projectId, outputType?, outputId?, month, denomination, ruleId, ruleVersion, amount, persons }` — `GET /v1/admin/points/aggregates` (service/admin scope, consumed by 036).

### Policies

- An accrual-source fact becomes postings only through the active rule version at the fact's `occurredAt`; a re-tuned rule never rewrites past postings.
- A posting that would take a person's available Pul below zero is refused; reserves and advances, not debts, cover a price.
- The arrival source is written to the posting's attribution fields and read by no rule.
- A closed account accepts no new posting.

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause carries `realizes: US-N` against [`025-product.md`](./025-product.md) and is tagged in [`025-scenarios.feature`](./025-scenarios.feature). Defaults in brackets are rule-version parameters (EARS-25), never literals.

- **EARS-1** _(realizes: US-1, US-15)_ — When the engine first needs a person's attention-points account (the first accrual fact or the first read for that person), the system shall open **exactly one** ledger account with `subject_kind = person`, `unit = attention_points` for that person, unique on (`subject_id`, `unit`), and every storefront, the Academy, the mobile app and every consumer feature shall resolve that same account through the one API; no per-storefront or per-device account shall exist.
- **EARS-2** _(realizes: US-1, US-15)_ — When a signed-in doctor requests `GET /v1/me/points`, the system shall return the `PointsAccount` read model computed as a **fold over postings** — Pul available and reserved, Bre, Con, and the open advance with its remaining obligation — with no mutable balance column read or written anywhere, and the same request from any client shall return the same values; a request for another person's account shall be refused (403).
- **EARS-3** _(realizes: US-2, US-3, US-12, US-15)_ — When an accrual-source fact listed in the Event Model is accepted, the system shall evaluate the rule version **active at the fact's `occurredAt`** for that action and write one immutable double-entry posting per non-zero denomination (from the system issuance account to the person account) carrying the fact's unique `event_id`, the dedupe key, the denomination, the `rule_id` and `rule_version`, the project and output when the fact names them, the attribution subject when one is recorded, `occurred_at` and `recorded_at`, all in one transaction, and shall then emit `PointsCredited` — the only event from which a consumer may state a credited amount.
- **EARS-4** _(realizes: US-4, US-1)_ — When an accrual-source fact arrives whose `event_id` or whose dedupe key **(person, content item, action)** already has a posting — whether it came from another storefront, the Academy, a retry, or the mobile app's offline sync — the system shall write **no** posting and shall answer with the original outcome (`duplicate`, referencing the existing postings), so a replayed or concurrent fact never accrues twice; the uniqueness shall be enforced by database constraints, not only by a read-before-write.
- **EARS-5** _(realizes: US-2)_ — When a registered doctor's phone becomes verified (both `DoctorRegistered` and `PhoneVerified` hold, in either order), the system shall accrue the **registration grant** [+20 Pul] once per person; no Pul shall be spendable by a person whose phone is not verified.
- **EARS-6** _(realizes: US-2, US-3)_ — When feature 022 reports `ProfileVerified` for a doctor, the system shall accrue the **profile grant** [+30 Pul, +2 Bre] once per person.
- **EARS-7** _(realizes: US-2, US-3, US-4)_ — When feature 024 reports `LessonCompleted` — its computed completion status, which already requires watch time or a passed test — the system shall accrue the **lesson award** [+10 Pul, +1 Bre] once per (person, lesson); when the completion's `mode` is offline or open learning the Pul component shall not be accrued (Bre and Con only); a test mistake, a failed attempt or a repeated pass shall never produce a debiting posting; a podcast completed outside its lesson shall accrue nothing.
- **EARS-8** _(realizes: US-2, US-3)_ — When feature 024 reports `ModuleCompleted` (all lessons done and the module test passed), the system shall accrue the **module award** [+20 Pul, +3 Bre, +1 Con] once per (person, module), with the same offline/open rule for the Pul component as EARS-7.
- **EARS-9** _(realizes: US-3, US-5)_ — When `AttendanceConfirmed` arrives for a registration whose server-side presence share is at least the configured **presence share** [30 % of the event's duration], the system shall accrue the **participation award** [+2 Bre, +1 Con] once per (person, event), identical at every price and for open events, and shall accrue **no Pul** for any event; a presence share below the parameter shall not count as attendance.
- **EARS-10** _(realizes: US-3, US-4)_ — When a doctor's question to the speaker, event rating or interactive answer during a live event is reported, the system shall accrue its **engagement award** [+1 Bre each] at most **once per (person, event, action)**; a further report of the same action on the same event shall be a `duplicate` per EARS-4.
- **EARS-11** _(realizes: US-2, US-3, US-8)_ — When an invitee who arrived on a doctor's referral has both a verified phone and a first completed lesson, the system shall accrue the **referral award** to the inviter [+30 Pul, +2 Bre] and to the invitee [+30 Pul], each once per invitee; when the inviter has already received the **monthly referral cap** [5 per calendar month, Europe/Moscow] the inviter's award shall not be posted for that invitee, while the invitee's award shall still be posted.
- **EARS-12** _(realizes: US-4, US-3)_ — The system shall write **no posting that debits Bre or Con** from a person account other than a compensating posting that reverses a specific earlier accrual (EARS-28); no rule shall express a penalty, and no posting shall convert between denominations (1 Con = 2 Bre is a read-side weight only).
- **EARS-13** _(realizes: US-7, US-15)_ — When a signed-in doctor requests `GET /v1/me/points/gating/:contentRef`, the system shall return the `GatingDecision` for that doctor: `open` for an open item or any lesson; for a priced event, `reserve` when the available Pul covers the price, `reserve-with-advance` in advance mode when the shortfall fits the advance cap (EARS-16), and otherwise `short` with the exact **shortfall** and an `earnHint` counting the lessons needed at the active lesson award — never a negative number and never a «not enough» decision in advance mode within the cap.
- **EARS-14** _(realizes: US-5)_ — When 020 reports `RegistrationCreated` for an event with a Pul price > 0 and the doctor's available Pul covers it, the system shall **reserve** the price by a posting from the person account to the system reserve account referencing the registration and the event; an open event or a zero price shall produce no posting.
- **EARS-15** _(realizes: US-6, US-8)_ — When 020 reports `RegistrationCreated` for an **advance-mode** event and the available Pul is below the price, the system shall reserve the available Pul from the balance and cover **exactly the shortfall** by an advance posting from the system advance account, opening an obligation of that amount for the person; the decision shall be the same for every doctor on that event and shall not read the arrival source.
- **EARS-16** _(realizes: US-6)_ — If opening an advance would take the person's open obligations above the **advance cap** [150 Pul, counted per person], then the system shall treat the event as **threshold** for that doctor (EARS-17); an open obligation shall never block a reserve-free action — open events and lessons stay open — and shall never be presented by the API as a negative balance.
- **EARS-17** _(realizes: US-7)_ — When 020 asks to reserve for a **threshold-mode** event (or an advance-mode event beyond the cap) and the available Pul is below the price, the system shall refuse the reserve with RFC 7807 problem `points-threshold-short` carrying the shortfall and the `earnHint` of EARS-13, write no posting, and leave the sign-up to fail closed in 020.
- **EARS-18** _(realizes: US-5, US-6)_ — When a reserved registration is cancelled by the doctor at any time, the event is cancelled or rescheduled by the platform, or the event ends without `AttendanceConfirmed` for that registration within the settlement window (no-show), the system shall **release** the reserve by a compensating posting (`reverses_posting_id` → the reserve) and annul an advance used for that event together with its obligation by a compensating posting; on a no-show no participation award shall be accrued; no other consequence shall follow.
- **EARS-19** _(realizes: US-5)_ — When `AttendanceConfirmed` arrives for a reserved registration (EARS-9 presence rule), the system shall **debit** the reserve by a posting from the system reserve account to the system sink account referencing the reserve, exactly once per registration.
- **EARS-20** _(realizes: US-6)_ — When Pul is accrued to a person with an open obligation, the system shall first **settle the obligation** by a posting from the person account to the system advance account of `min(accrued Pul, remaining obligation)` in the same transaction, oldest obligation first, and emit `AdvanceSettled` with the remaining amount.
- **EARS-21** _(realizes: US-5)_ — If a reserve would give a person more than the **concurrent limited-seat reserve limit** [3 open reserves on limited-seat events], then the system shall refuse it with problem `points-reserve-limit` and write no posting; the waiting list stays with 020.
- **EARS-22** _(realizes: US-5, US-4)_ — The system shall refuse any posting that would take a person's **available Pul below zero**, serialising postings per person account so concurrent reserves cannot overdraw it, and shall write no time-based expiry posting — Pul does not expire.
- **EARS-23** _(realizes: US-9)_ — When `GET /v1/points/leaderboard/:specialtyCode?month=YYYY-MM` is requested, the system shall compute, among doctors of that specialty holding an **active `leaderboard-dissemination` consent**, the score **[2]·Con + [1]·Bre earned in that calendar month** (credits in the month net of their reversals; the Pul balance never ranks), rank only those doctors, and return the top [10] plus — for a signed-in doctor — their own rank and score with [5] neighbours above and below; a doctor without the consent shall receive their own would-be rank privately and shall never appear in, or shift the rank numbers of, anyone else's response.
- **EARS-24** _(realizes: US-9)_ — The leaderboard row of a doctor shall exist only while a separate versioned `leaderboard-dissemination` consent (152-FZ art. 10.1) is active, off by default, carrying the doctor's naming choice (surname with initials or a pseudonym) and separate city and photo flags; when the consent is revoked the row shall be absent from the very next leaderboard response.
- **EARS-25** _(realizes: US-11, US-12)_ — When an admin publishes a rule version through `POST /v1/admin/points/rules/:ruleId/versions`, the system shall validate its parameters against the rule's schema (accrual amounts per action and denomination, caps, presence share, advance cap, referral cap, concurrent-reserve limit, leaderboard weights and sizes — the action set a closed enum with no prescription, sale, sponsor or arrival-source input), store it as a new immutable version effective from now or a later `effectiveFrom`, audit the change, and apply it to postings produced afterwards without a release; past postings keep the version they carry.
- **EARS-26** _(realizes: US-11)_ — When an admin sets an item's gating through `PUT /v1/admin/points/gating/:contentRef`, the system shall accept `open`, `advance` or `threshold` with a Pul price [standard 50, premium or limited-seat 100] for an event, refuse any mode but `open` for a lesson or a module, refuse any mode but `open` for an НМО-accredited event (problem `points-gating-invalid`), audit the change, and apply it to reserves created afterwards; existing reserves keep the price they were reserved at.
- **EARS-27** _(realizes: US-12)_ — Every posting shall carry a non-null `rule_id` and `rule_version` (a reversal carries the reversed posting's), enforced by a database constraint, and a posting row shall be refused UPDATE and DELETE by a database trigger, with postings partitioned by month on `occurred_at` as `audit_ledger` is.
- **EARS-28** _(realizes: US-13)_ — When an admin posts a correction through `POST /v1/admin/points/corrections` — a reversal of a named posting or a manual adjustment with a mandatory reason — the system shall write it as a new compensating posting (`reverses_posting_id` set for a reversal, rule `manual-correction` for an adjustment), refuse a second reversal of the same posting, write an `audit_ledger` record with the admin, the reason and the posting ids, and never edit or delete an existing posting; a manual adjustment shall not take available Pul below zero (EARS-22).
- **EARS-29** _(realizes: US-14)_ — When 036 requests `GET /v1/admin/points/aggregates` for a project (optionally an output and a month), the system shall return sums per denomination, rule id and rule version together with the count of distinct persons, built from postings, and shall return **no person identifier**; named data is 036's under its separate consent.
- **EARS-30** _(realizes: US-10, US-15)_ — Every API response of the engine that carries a Pul amount shall expose it as an integer `pulCost` / `amount` with the unit `Pul`, shall expose **no** field that derives a «free» or money statement from a zero Pul cost, and no problem detail, admin message or field name shall call a Pul price «бесплатно» or points «баллы»; the money statement is the consumer's, independent of `pulCost` (020, #3801).
- **EARS-31** _(realizes: US-1, US-13)_ — When the personal-data lifecycle closes a person's account for erasure or consent refusal, the system shall set `closed_at` on the account, refuse every later posting to it (problem `points-account-closed`), release no reserve and settle no obligation by itself, and leave every existing posting unchanged, the posting subject being re-pointed only by the ADR-0009 erasure procedure.

## Invariants

- One person has at most one open attention-points account.
- The balance of every denomination equals the fold of its postings; no stored balance exists.
- No posting row is ever updated or deleted; every posting has a unique `event_id`, a non-null rule id and version.
- A (person, content item, action) dedupe key has at most one accrual posting set.
- Available Pul is never below zero; Bre and Con decrease only by a reversal of a specific accrual.
- No event accrues Pul; no lesson or module costs Pul; an НМО-accredited event is always open.
- The arrival source never changes a gating decision, a price or an accrual.
- Open obligations of a person never exceed the active advance cap.
- A leaderboard response contains only doctors with an active dissemination consent, ranked among themselves.
- An attention aggregate contains no person identifier.

## Verification

Backend-only (F-22): Vitest e2e against `apps/api` plus unit tests is complete coverage; no browser row.

| EARS | Test type             | Indicative target                                                     | Required proof                                                                                                   |
| ---- | --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | Vitest e2e            | `apps/api/test/points/points-account.e2e-spec.ts`                     | Concurrent first facts open one account; the unique constraint holds                                             |
| 2    | Vitest e2e            | `apps/api/test/points/points-account.e2e-spec.ts`                     | `GET /v1/me/points` equals the fold of seeded postings; another person's account → 403                           |
| 3    | Vitest e2e            | `apps/api/test/points/points-accrual.e2e-spec.ts`                     | One posting per non-zero denomination with event id, key, rule id/version, project/output; `PointsCredited`      |
| 4    | Vitest e2e            | `apps/api/test/points/points-dedupe.e2e-spec.ts`                      | Same key from two clients and from an offline-sync replay → one posting set, second answer `duplicate`           |
| 5    | Vitest e2e            | `apps/api/test/points/points-accrual-registration.e2e-spec.ts`        | Grant only once both facts hold, in either order; unverified phone cannot reserve                                |
| 6    | Vitest e2e            | `apps/api/test/points/points-accrual-registration.e2e-spec.ts`        | Profile grant once                                                                                               |
| 7    | Vitest e2e            | `apps/api/test/points/points-accrual-learning.e2e-spec.ts`            | Lesson award once; offline mode posts no Pul; a failed attempt posts nothing                                     |
| 8    | Vitest e2e            | `apps/api/test/points/points-accrual-learning.e2e-spec.ts`            | Module award once with all three denominations                                                                   |
| 9    | Vitest e2e            | `apps/api/test/points/points-participation.e2e-spec.ts`               | Award at ≥ share, none below; never Pul                                                                          |
| 10   | Vitest e2e            | `apps/api/test/points/points-engagement.e2e-spec.ts`                  | One award per action per event                                                                                   |
| 11   | Vitest e2e            | `apps/api/test/points/points-referral.e2e-spec.ts`                    | Award after both conditions; the 6th invitee of a month gives the inviter nothing, the invitee still gets theirs |
| 12   | Vitest unit + e2e     | `apps/api/src/points/rules.spec.ts`, `points-corrections.e2e-spec.ts` | Rule schema rejects a negative Bre/Con amount; only a reversal debits Bre/Con                                    |
| 13   | Vitest e2e            | `apps/api/test/points/points-gating.e2e-spec.ts`                      | Every decision branch with exact shortfall and `earnHint`                                                        |
| 14   | Vitest e2e            | `apps/api/test/points/points-reserve.e2e-spec.ts`                     | Reserve posting on a priced event; none on an open event                                                         |
| 15   | Vitest e2e            | `apps/api/test/points/points-advance.e2e-spec.ts`                     | Exact shortfall covered; a doctor with a medrep attribution gets the identical postings                          |
| 16   | Vitest e2e            | `apps/api/test/points/points-advance.e2e-spec.ts`                     | At 150 open, the next advance-mode event behaves as threshold; lessons stay open                                 |
| 17   | Vitest e2e            | `apps/api/test/points/points-reserve.e2e-spec.ts`                     | `points-threshold-short` with the shortfall; no posting                                                          |
| 18   | Vitest e2e            | `apps/api/test/points/points-release.e2e-spec.ts`                     | Each release reason reverses the reserve and annuls the advance; no-show posts no participation award            |
| 19   | Vitest e2e            | `apps/api/test/points/points-reserve.e2e-spec.ts`                     | Debit once per registration, idempotent on replay                                                                |
| 20   | Vitest e2e            | `apps/api/test/points/points-advance.e2e-spec.ts`                     | A lesson's Pul settles the obligation first; remaining reported                                                  |
| 21   | Vitest e2e            | `apps/api/test/points/points-reserve.e2e-spec.ts`                     | The 4th limited-seat reserve → `points-reserve-limit`                                                            |
| 22   | Vitest e2e            | `apps/api/test/points/points-concurrency.e2e-spec.ts`                 | Parallel reserves never overdraw; no expiry job exists                                                           |
| 23   | Vitest e2e            | `apps/api/test/points/points-leaderboard.e2e-spec.ts`                 | Score formula, month boundary, top/neighbours, non-consenting doctor invisible and not counted                   |
| 24   | Vitest e2e            | `apps/api/test/points/points-leaderboard.e2e-spec.ts`                 | Revocation removes the row on the next response; naming and flags honoured                                       |
| 25   | Vitest e2e            | `apps/api/test/points/points-admin-rules.e2e-spec.ts`                 | New version applies to new postings only; invalid parameters → 422; non-admin → 403; audit row written           |
| 26   | Vitest e2e            | `apps/api/test/points/points-admin-gating.e2e-spec.ts`                | Lesson / НМО non-open → `points-gating-invalid`; existing reserve keeps its price                                |
| 27   | Vitest e2e (DB)       | `apps/api/test/points/points-ledger-immutability.e2e-spec.ts`         | UPDATE/DELETE refused by the trigger; null rule version refused; monthly partition used                          |
| 28   | Vitest e2e            | `apps/api/test/points/points-corrections.e2e-spec.ts`                 | Compensating posting + `audit_ledger` row; double reversal refused                                               |
| 29   | Vitest e2e            | `apps/api/test/points/points-aggregates.e2e-spec.ts`                  | Sums per denomination and rule version; no person id in the payload                                              |
| 30   | Vitest unit           | `packages/schemas/src/points/points.spec.ts`                          | Response schemas carry no «free» field; a copy scan of problem details finds no «бесплатно» / «баллы»            |
| 31   | Vitest e2e            | `apps/api/test/points/points-account-closure.e2e-spec.ts`             | Closed account refuses postings; history unchanged                                                               |
| all  | Gherkin (spec record) | `025-scenarios.feature`                                               | Each tag maps to its Vitest e2e above; no browser runner (backend-only)                                          |

## Dependencies and sequencing

- **The ledger first** (EARS-1, 3, 4, 22, 27) — every other clause posts through it.
- **Accrual sources wait for their producers**: EARS-5/6 on 022's `PhoneVerified` / `ProfileVerified` (022 Issue #1791), EARS-7/8 on 024's completion facts, EARS-9/10/18/19 on 020's registration and attendance facts. A producer that has not shipped leaves its clause unexercisable, not stubbed; the engine clause ships with its e2e driving the real fact once the producer exists.
- **Spend** (EARS-13–21) precedes 020's priced events; `eventEconomyFacts()` keeps `pulCost: 0` (`DEBT.md`) until EARS-26 gives events real prices.
- **Leaderboard** (EARS-23/24) precedes 018 #1495; **aggregates** (EARS-29) precede 036.
- **Admin UI** for EARS-25/26/28 is a follow-up Issue opened with this set.

## Open questions carried forward

For the Product Lead, designed around rather than resolved here:

- **Con↔Bre exchange visible to the doctor** — default: a weight only (EARS-12, EARS-23); a doctor-facing exchange would be a new posting kind, not a schema change.
- **Sponsor billing weights** of Con, Bre and Pul (036) — every posting carries its rule version (EARS-27), so any weighting can be recomputed from EARS-29.
- **The no-show settlement window** — the time after `EventEnded` at which an unconfirmed reserve is released; a parameter of the rule book with a proposed default of 24 hours (design §5).
