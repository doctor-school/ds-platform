---
title: "025 — Design"
description: "Design companion to the 025 attention points engine requirements: the module placement, the ledger ER fragment (accounts, postings with denomination and a fact-level event id unique with its leg, the posting-keys table, rule versions, gating, obligations), the immutability and partitioning mirrored from audit_ledger, the accrual cascade with dedupe and obligation settlement, the reserve lifecycle state machine, the gating decision, the leaderboard read model, the admin API and the reconciliation of ADR-0003 with ADR-0016."
slug: 025-attention-points-engine-design
lang: en
---

> Requirements: [`025-requirements-en.md`](./025-requirements-en.md) · PRD: [`025-product.md`](./025-product.md) · Scenarios: [`025-scenarios.feature`](./025-scenarios.feature)

# 025 — Design

## 1. Placement

One NestJS module `apps/api/src/points/` owns the ledger, the rule book, the gating decision and the read models; its request/response contracts live in `packages/schemas/src/points/` (the SDK is regenerated into `packages/api-client/`), its tables in `packages/db/src/schema/points-*.ts`. Consumers never import the module's internals: storefronts and the mobile app read over HTTP, and producer features (020, 022, 024, the room) hand facts to the module's in-process fact intake inside their own transaction boundary (`PointsFactIntake.acceptWithin(tx, fact)`, which returns the outcome with a `publishAfterCommit` the producer calls after its COMMIT; `accept(fact)` when the fact is the producer's whole write and the intake owns the transaction), or over the internal endpoint the mobile offline sync replays through. No package outside `apps/api` holds points logic (capability registry row «Attention points engine (025)»).

## 2. Data model

```mermaid
erDiagram
  users ||--o| points_accounts : "person (subject_id)"
  points_accounts ||--o{ points_postings : "debit_account_id / credit_account_id"
  points_rule_versions ||--o{ points_postings : "rule_id + rule_version"
  points_postings ||--o| points_postings : "reverses_posting_id + reverses_occurred_at"
  points_posting_keys ||--|{ points_postings : "event_id (one fact, its legs)"
  projects ||--o{ points_postings : "project_id"
  organisations ||--o{ points_postings : "attributed_organisation_id"
  points_gating ||--o{ points_reserves : "price at reserve time"
  registrations ||--o| points_reserves : "registration_id"
  points_reserves ||--o| points_obligations : "advance part"

  points_accounts {
    uuid id PK
    text subject_kind "person|project_fund|organisation|system"
    uuid subject_id "null for system; system_code instead"
    text unit "attention_points|money"
    timestamptz opened_at
    timestamptz closed_at
  }
  points_postings {
    uuid id PK
    text event_id "the fact; FK points_posting_keys"
    text leg "posting within the fact; unique with event_id"
    uuid debit_account_id FK
    uuid credit_account_id FK
    text denomination "pul|bre|con"
    integer amount "> 0"
    text action
    uuid project_id FK
    text output_type
    uuid output_id
    text rule_id
    integer rule_version
    uuid attributed_organisation_id FK
    uuid attributed_member_id FK
    uuid reverses_posting_id FK "with reverses_occurred_at"
    timestamptz reverses_occurred_at FK "partition key of the reversed posting"
    timestamptz occurred_at "partition key"
    timestamptz recorded_at
  }
  points_rule_versions {
    text rule_id PK
    integer version PK
    jsonb parameters "zod-validated"
    timestamptz effective_from
    uuid published_by
  }
  points_gating {
    text content_ref PK
    text mode "open|advance|threshold"
    integer pul_cost
    boolean limited_seats
  }
  points_reserves {
    uuid registration_id PK
    text state "reserved|settled|released"
    integer price
    uuid reserve_posting_id FK
  }
  points_obligations {
    uuid id PK
    uuid person_account_id FK
    integer opened_amount
    uuid reserve_registration_id FK
  }
```

- **Accounts.** Unique (`subject_kind`, `subject_id`, `unit`) for subjects; system accounts are keyed by a `system_code` (`issuance`, `reserve`, `sink`, `advance`) — one per unit. `amount` is a positive integer; direction is the debit/credit pair, so a fold is `Σ credits − Σ debits` per (account, denomination).
- **Event id, leg and dedupe key** (ADR-0016 §6 / design §2.12 as rewritten in this PR). **One domain fact = one `event_id`**: the producer's event id, or a derived fact id for the engine's own facts (`reserve:<registration>`, `settle:<registration>`, `release:<registration>`). A fact may write several postings — a module award in three denominations, a reserve plus an advance, a release reversing both, an accrual plus its obligation settlement — so a posting is unique on (`event_id`, `leg`), where the `leg` names the posting within the fact (denomination + entry kind: `accrual:pul`, `accrual:bre`, `reserve:balance`, `reserve:advance`, `settle:pul`, `release:balance`, `obligation-settle:pul`, …). Postgres requires the partition key in every unique constraint of a partitioned table, which is why `audit_ledger` scopes its `event_id` uniqueness to `(event_id, created_at)` — dedup within one monthly partition, acceptable for an audit trail. For points that is **not** acceptable: a lesson completed in March and replayed by an offline sync in April must still be a duplicate (EARS-4). So global dedupe lives in the non-partitioned **`points_posting_keys (event_id PK, dedupe_key UNIQUE NULLS DISTINCT, occurred_month)`** — **one row per fact**, the dedupe key being the PRD key `<personId>:<contentRef>:<action>` for an accrual fact and null for a spend fact (whose `event_id` alone is its key) — inserted in the same transaction **before** the fact's postings, so the key is known before the rule is evaluated. The postings of one fact share its `occurred_at` and therefore one partition, so the partition-local unique index on (`event_id`, `leg`, `occurred_at`) is effectively (`event_id`, `leg`). This is how the points ledger satisfies ADR-0003 §3; it is the one deliberate departure from the `audit_ledger` template.
- **Reversal reference.** A reversing posting names the posting it reverses by its full key (`reverses_posting_id`, `reverses_occurred_at`) — a two-column foreign key into `points_postings` (`id`, `occurred_at`). Postgres requires the partition key in every unique key of a partitioned table, so the primary key is (`id`, `occurred_at`) and a foreign key into it must carry both columns; a `CHECK` keeps the pair all-null or all-set.
- **Derived state tables** (`points_reserves`, `points_obligations`) are projections rebuilt from postings; they hold no amount the postings do not already prove and carry the `audit_row_change()` trigger like `registration_attendance`. A cached balance, if ever needed, is the same kind of rebuildable projection.

## 3. Immutability and partitions

Mirrors `audit_ledger` (`packages/db/src/schema/audit-ledger.ts`, migration `0003_audit_ledger_partitioning.sql`): `points_postings` is `PARTITION BY RANGE (occurred_at)` with monthly partitions `points_postings_yYYYY_mMM` plus a `DEFAULT` safety-net partition; a `BEFORE UPDATE OR DELETE` trigger raises for every row (EARS-27); `rule_id` / `rule_version` are `NOT NULL` and a `CHECK` requires `amount > 0`. A posting dated beyond the clock skew would sit in the `DEFAULT` partition and later block the creation of its month's partition, so a `CHECK` bounds `occurred_at <= recorded_at + interval '1 day'` and the ledger core refuses such a fact first, writing nothing, with `points-occurred-at-future` (422). The ledger core's other refusals are `points-insufficient-pul` (a leg would take a person's available Pul below zero, EARS-22) and `points-account-closed` (§9, EARS-31); a replay of an already-recorded fact answers `duplicate` before any of them, even for a since-closed account. The migration is hand-written SQL beside the drizzle schema, as for `audit_ledger`.

## 4. Accrual cascade (EARS-3, 4, 20)

```mermaid
sequenceDiagram
  participant P as Producer (024 / 022 / 020)
  participant I as PointsFactIntake
  participant R as RuleBook
  participant L as Ledger core (tx)
  participant B as PointsEventsPublisher
  P->>I: fact {eventId, personId, action, contentRef, occurredAt}
  I->>L: BEGIN (accept) or a savepoint in the producer's transaction (acceptWithin)
  I->>R: activeVersion(accrual.<action>, occurredAt)
  R-->>I: {ruleId, version, amounts per denomination}
  I->>L: post(fact: dedupe key <personId>:<contentRef>:<action>, one leg accrual:<denomination> issuance→person per non-zero denomination)
  L->>L: lock person account (SELECT … FOR UPDATE); insert points_posting_keys(eventId, dedupeKey)
  alt unique violation
    L-->>I: duplicate (original postings), nothing written
    I-->>P: duplicate
  else new
    opt open obligation and Pul > 0
      I->>L: leg obligation-settle:pul person→advance (min(pul, remaining))
    end
    L->>L: insert postings
    I->>L: COMMIT (accept; acceptWithin: the producer commits)
    I->>B: PointsCredited (+ AdvanceSettled) — after COMMIT: accept itself, or the producer's publishAfterCommit()
    I-->>P: credited
  end
```

The rule is read before the ledger core runs, because the legs are built from it; the dedupe key is computed from the fact alone, so a replay still answers `duplicate` from the key row and never from the rule. The account row lock serialises every posting of one person (EARS-22); concurrent first facts race on the account's unique constraint and the loser re-reads (EARS-1). The mobile offline sync replays its queued facts through the same intake; its pending entries become `credited` or `duplicate` from the intake's answer (EARS-4).

- **Event publication.** apps/api has no event bus; `PointsCredited` is published through the module's one typed in-process provider, `PointsEventsPublisher`, strictly after COMMIT, so a subscriber never sees a credit that rolled back. A duplicate or a zero credit (a rule version crediting 0 in every denomination writes nothing, not even a key row) publishes nothing. `accept(fact)` owns its transaction and publishes after its own COMMIT. `acceptWithin(tx, fact)` posts inside the producer's transaction, whose commit is the producer's: it returns `{ outcome, publishAfterCommit }`, so the obligation sits in the return type — the producer calls `publishAfterCommit()` after its COMMIT, and a producer that rolled back never calls it. Delivery is in-process and at-most-once; the postings, not the event, are the record.
- **EARS-12 in the ledger core.** Whatever the caller, the ledger core refuses a leg that debits Bre or Con from a person account without reversing a specific earlier posting (`points-bre-con-debit`, 422, nothing written). Every leg carries one denomination, so no fact can express a penalty or a conversion between denominations.
- **Built by later slices.** The `obligation-settle:pul` leg (#3811), the per-action award conditions — offline/open learning without Pul, the presence share (#3809) — and the referral monthly cap (#3816). The engagement cap of EARS-10 needs no state: the dedupe key per (person, event, action) is the cap.

## 5. Reserve lifecycle (EARS-14–21)

```mermaid
stateDiagram-v2
  [*] --> decided: RegistrationCreated
  decided --> none: open / zero price
  decided --> refused: threshold short / beyond cap / reserve limit
  decided --> reserved: balance covers
  decided --> reserved_advance: advance mode, shortfall ≤ cap
  reserved --> settled: AttendanceConfirmed (share ≥ param)
  reserved_advance --> settled: AttendanceConfirmed
  reserved --> released: doctor cancel / event cancel / reschedule / no-show
  reserved_advance --> released: same — advance posting reversed, obligation annulled
  settled --> [*]
  released --> [*]
```

- **Postings per transition** (each transition is one fact with its own `event_id`, its postings told apart by `leg`). reserve (`reserve:<registration>`): leg `reserve:balance` person→reserve and leg `reserve:advance` advance→reserve (shortfall, opening the obligation); settle (`settle:<registration>`): leg `settle:pul` reserve→sink (full price); release (`release:<registration>`): one reversal leg per reserve-side posting.
- **No-show.** A scheduled sweep after `EventEnded` + the no-show window [24 h, rule-book parameter `noShow.window`, EARS-18] releases every still-`reserved` registration of that event with reason `no-show`; the sweep is idempotent through the derived `release:<registration>` event id. A late `AttendanceConfirmed` for a released registration finds the `release:` key row, writes no `settle:` fact and accrues only the participation award (EARS-18).
- **After settle**, the obligation stays open and is netted by later Pul accruals (§4); it is never a negative balance — the read model reports `advance.remaining`, and `pul.available` is the fold of the person account, which no posting takes below zero.
- **Gating decision** (EARS-13) is a pure function `decide(gating, balance, openObligations, ruleVersion)` in `packages/schemas/src/points/gating.ts` — `shortfall = price − available`, `pulToEarn = shortfall + Σ remaining obligations` (EARS-20 nets new Pul to obligations first), `lessonsNeeded = ceil(pulToEarn / lesson award)` — shared by the read endpoint and the reserve command so the advertised decision and the enforced one cannot diverge. It never takes an attribution argument (EARS-15 invariant).

## 6. Rule book (EARS-25, 26)

Each `rule_id` has a strict zod parameter schema in `packages/schemas/src/points/rules.ts` — `accrual.<action>` for the closed action set (`registration`, `profile`, `lesson`, `module`, `participation`, `question`, `rating`, `interactive`, `referral-inviter`, `referral-invitee`; `{ pul, bre, con }`, non-negative integers), `cap.engagement` (fixed at 1 by EARS-10), `cap.referral.monthly`, `presence.share` (whole percent), `advance.cap`, `reserve.limitedSeats.max`, `noShow.window` (hours), `leaderboard.{conWeight, breWeight, top, neighbours}`, and `manual-correction` (no parameters — the rule identity a manual adjustment cites, EARS-28). The seed migration (0059) inserts version 1 of every rule with the PRD defaults (`POINTS_RULE_DEFAULTS`), `effective_from` at the epoch so a back-dated fact always finds a version, `published_by` null; a trigger keeps a stored version immutable (only `published_by` may be re-pointed by the erasure procedure). Publishing (`POST /v1/admin/points/rules/:ruleId/versions`) refuses an unknown rule (`points-rule-unknown`, 404), parameters failing the rule's schema (`points-rule-parameters-invalid`, 422, field errors) and an `effectiveFrom` before now (`points-rule-effective-from-past`, 422); the next version number is allocated under a per-rule transaction-scoped advisory lock. `activeVersion(ruleId, at)` = the highest version with `effective_from ≤ at`. The action set is a closed enum; the schema has no field that could take an arrival source, a sponsor or a sales input. Gating rows live in `points_gating`; until an admin sets a row, an event is `open` with price 0, which is today's `eventEconomyFacts()` behaviour and its `DEBT.md` line closes once 020 reads `GatingDecision`.

## 7. Leaderboard read model (EARS-23, 24)

A SQL view over postings of the month (credits to person accounts in `bre` / `con`, minus reversals in the month), joined to `doctor_specialties` and to the active `leaderboard-dissemination` records in `consent_records` (ADR-0009), ranked with `RANK()` over the consenting set only. A non-consenting requester's own position is computed as `1 + count(consenting scores > own score)` and returned only to them. The view reads consent at query time, so a revocation takes effect on the next response with no cache to invalidate; if a materialised refresh is ever introduced, consent filtering stays at read time.

## 8. Admin API and audit (EARS-25, 26, 28)

`/v1/admin/points/*` sits behind the admin role guard (ADR-0001). Each write runs through the request audit context so `audit_ledger` records the actor `sub`, source `admin-ui` / `api`, and the payload (rule version, gating row, correction with its reason and posting ids). The admin UI is a follow-up Issue; the API is complete without it.

## 9. Erasure (EARS-31)

`CloseAccount` sets `closed_at` on the person account; the intake refuses a fact for a closed account with `points-account-closed`. Open reserves are left to the ordinary release path of their events; the anonymised re-pointing of the subject is the ADR-0009 erasure procedure's, not 025's.
