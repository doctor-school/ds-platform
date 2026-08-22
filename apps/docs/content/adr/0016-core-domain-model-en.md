---
title: "ADR-0016 — Core domain model for the two-storefront platform (people, organisations, projects, reference books, ledger) [EN]"
description: "The relaunch of Doctor.School as two storefronts on one platform fixes a set of one-way doors (OWD-1…13) that are statements about the domain model, not about topology. This ADR settles the core entities and their relationships once: one account per person with roles as attributes, organisations with revocable memberships, the expert entity that exists without an account, the project as the single traceable container, two linked reference books, and an append-only ledger for points and money."
lang: en
---

> **EN (this)** · **RU:** [`0016-core-domain-model-ru.md`](./0016-core-domain-model-ru.md)

# ADR-0016 — Core domain model for the two-storefront platform

**Date:** 2026-08-22
**Status:** Accepted
**Related to:** epic [#1430](https://github.com/doctor-school/ds-platform/issues/1430) (Doctor.School relaunch — two-site IA), [#1433](https://github.com/doctor-school/ds-platform/issues/1433); discovery provenance — Plane DSP-251 (wireframe R4, owner-approved) and DSP-252 (discovery closed); input package `apps/docs/content/specs/product/two-site-ia/`
**Inherits:** ADR-0001 §6 (one IdP, one account model), ADR-0002 §3 (Zod SSOT in `packages/schemas`), ADR-0003 (Postgres 17 + Drizzle + pgvector; retained-row lifecycle; append-only ledger pattern §2.7), ADR-0009 (PD lifecycle and consent records), ADR-0015 (two-storefront topology — sibling, in authoring)
**Companion design spec:** [`0016-core-domain-model-design-en.md`](./0016-core-domain-model-design-en.md)

---

## Context

The Product Lead decided on 2026-08-22 to relaunch Doctor.School as **two storefronts on one platform**: `doctor.school` — the doctor-facing storefront; `academy.doctor.school` — the backstage (experts, investors, project work). Per ADR-0015 (sibling, in authoring) this is **one backend, one Postgres, one IdP** serving both storefronts; this ADR takes that premise as given and writes no topology content.

The discovery package (`specs/product/two-site-ia/`, DSP-244 → DSP-249 → DSP-252) closed with a register of thirteen one-way doors. Most of them are statements about the **domain model**, not about deployment: OWD-1 (one person = one account, roles as attributes), OWD-2 (an investor sees doctor personalia but never contacts), OWD-3 (money moves by contracts off-platform, the platform shows the chain "contributed → unit fund → accruals"), OWD-4 (the clinical base — clinic plus institute — is a first-class participant from day one), OWD-8 (an investor is an organisation; membership is a revocable link, not a property of an account), OWD-9 (a project is traceable across both storefronts and all accounting), OWD-10 (one points balance across web and mobile), OWD-11 (two linked reference books), OWD-12 (Doctor.School stores document copies and is the issuer), OWD-13 (the platform is the ledger of accruals and postings, external accounting is a mirror). Two doors of the register are **not** core-model statements and are routed rather than modelled: **OWD-5** (the Academy is a separate public domain with its own audience but part of **one** Doctor.School ecosystem — no monetisation of its own, funded by investors buying doctors' attention) is a positioning and topology door and belongs to ADR-0015 plus the §8 storefront-ownership attribute, which is the only trace it leaves in the model; **OWD-7** (the GetCourse exit — content migrates and there is **no integration with GetCourse, now or ever**) is honoured as a constraint on the migration named in §9, not as an entity.

The register itself defers the technical form of every one of these to "the ADR of the Commit lane". This ADR **is** that artifact for the core model. Without it, the feature slices of the relaunch would each invent their own shape for the same entities — the exact retrofit cost the one-way-door register was written to avoid.

The platform is not greenfield. Production runs with users, and the current Drizzle schema (`packages/db/src/schema/`) already carries `users`, `events` + `event_speakers`, `registrations`, the feature-012 taxonomy (`projects`, `experts`, `topics`, `partners` and their link tables with the retained-row lifecycle), feature-014 `event_recordings`, ADR-0009 `consent_records`, feature-010 `audit_ledger`, plus the operational tables. The model below **absorbs** those tables; it does not rewrite them.

---

## Decision

### 1. One person, one account; roles are attributes

`users` remains the single account entity across both storefronts (OWD-1, ADR-0001 §6): one person, one Zitadel subject, one row. A doctor who is also an expert, also an employee of an investor organisation, also a podcast guest is **one** `users` row.

Roles are **not** account subtypes and not a single scalar column. The model carries **role assignments**: a person holds zero or more roles, each optionally scoped to a context (an organisation, a project) and each with a validity interval. The existing `users.role` scalar is the degenerate case of this (a single global role) and is superseded by the role-assignment relation; the column stays as the migration source and is retired once assignments are populated (see §9).

Consequence made explicit: **no `doctors` table, no `partners_users` account type, no separate Academy login.** Everything that distinguishes people is an attribute or an assignment on the one account.

### 2. Organisation as a first-class entity; membership as a revocable link

An **organisation** is a first-class entity covering every institutional counterparty. Per Q-40 the set of organisation kinds is **open and extensible** — kinds are added and removed without a model change — and the starting set is exactly three: **investor** (the canonical Doctor.School term for whoever puts money into doctors' attention or into a project — pharma, medical-equipment manufacturers), **clinical base** (clinic + the institute operating on its base — OWD-4), and **licensee / educational organisation** (certificates may also be issued by an institute or a clinic under contract, which does not contradict §7). "Employer" is deliberately **not** a product kind (Q-38 → NG: Doctor.School is not a job board and hiring is a manual service outside the model). Organisation kind is a multi-valued attribute, not a table per kind: one counterparty may combine kinds (Q-40, V-RV-10), so the kinds are a set on a single organisation row.

**Membership** is a separate relation `person ↔ organisation` carrying its own role (investor representative, medical representative, organisation admin, …), a validity interval and a revocation state (OWD-8). Per Q-33 simultaneous memberships in several organisations are **constrained, not free**: the platform either forbids a second active membership or, at minimum, warns the person and the admins — so the model carries a uniqueness/warning rule over active memberships, and which of the two modes ships is a wireframe-level detail of the same decision, not a re-opened question. Authority is evaluated **in the context of a specific organisation and a specific sponsored object**: a representative sees the personalia of the doctors attached to the object the organisation paid for — its webinar, its lesson, its school — and never the whole project (Q-32, OWD-2). When an employee leaves, the **membership** is revoked, never the account: attribution of the doctors they brought stays with the organisation, and the person keeps only their personal "brought N" history (Q-33).

Per REQ-114 the medical representative is **a user of the investor organisation**, not a new user type: an organisation holds many users with different roles, and every medical representative has a personal link/promo code with **personal attribution** of the doctors they bring. Attribution is therefore a first-class **subject on the ledger posting** (§6), not free-text metadata — a posting produced by an attributed doctor's action names both the organisation and the attributing member, which is what makes the per-representative breakdown in the investor cabinet a query rather than a report rebuild.

The existing feature-012 `partners` table is the seed row family of organisations (see §9).

### 3. The expert exists without an account; linking is an explicit, reversible relation

An **expert** is a domain entity — a physical person with a professional profile — that exists independently of any account (REQ-97). Speakers, lesson authors and podcast guests are always experts. The feature-012 `experts` row family stays the base and is not replaced.

The account ↔ expert link is a **separate relation with explicit states** — `unlinked` → `claimed` ("It's me", initiated by the person) → `confirmed` (manual confirmation by an Academy admin) → `rejected` — per REQ-106, which closed brainstorm Q-27 in favour of claim-first with manual confirmation, universal for **any** order of events (the person may pre-exist the expert, e.g. the ~10k migrated GetCourse doctors, or the expert may pre-exist the account, e.g. historical congress speakers).

The link carries financial meaning: on confirmation, the history and accruals accumulated on the expert become visible and payable on the account (REQ-98). Therefore the relation is **audited and reversible**: a confirmation and a revocation are both events in the audit ledger, and the accrual ledger (§6) is never rewritten — accruals stay attached to the expert, and the account inherits them **through** the link.

Invariant: at most one confirmed link per expert and at most one confirmed expert per account. Competing claims go to manual resolution; expert-duplicate merge reuses the feature-012 legacy-speaker merge mechanics.

### 4. The project is the single traceable container; everything else is a project output

Per REQ-4/11/50/79 and rule V-RV-9, a **project** is the container of Academy work; a school, course, module, lesson, podcast, event and congress are its **outputs**, not sibling project types. The feature-012 `projects` table is that container (OWD-9).

Every output entity carries a **project reference**. Outputs are distinguished by **type and audience**, never by living in separate trees: an Academy event and a doctor-storefront lesson are both project outputs. The existing `events` table is the event output; `event_projects` is the existing project reference for it. The content hierarchy of the doctor storefront — school → course → module → lesson — is introduced as output entities under the same container, with a lesson as the funding unit (REQ-31).

This is what makes "one project, all its content, roles, accruals and payments" a single query (OWD-9) rather than a retrospective join.

### 5. Two linked reference books: Minzdrav specialties (closed) and directions (open)

Per OWD-11 the model carries **two** books:

- **`specialties_minzdrav`** — the closed, official list (105 entries + "Other"), used in the doctor profile, for documents and for НМО. Not editorially extendable.
- **`directions`** — the open, own book (ortho-biology, rheumatology, …). Schools, courses and subscriptions are built on directions. Directions carry **adjacency** as a self-relation with a kind and a weight, and are linked **many-to-many** to Minzdrav specialties — the link that drives content display (REQ-1).

**`topics` vs `directions` — decided.** The feature-012 `topics` table is defined in `012-design.md` §2 as the open, own, editorially managed classification axis for events (`event_topics`), with no adjacency and no relation to any official list. That is exactly the seed of the directions book. **Decision: `topics` IS the directions book, extended** — the row family is kept and renamed, gaining the adjacency self-relation and the many-to-many link to `specialties_minzdrav`. It is not a second, parallel axis. Content and profile targeting therefore has one open axis (directions) and one regulated axis (Minzdrav specialties), linked; the distinction the glossary draws between the regulated specialty and the product direction lands on those two tables and nowhere else.

### 6. Points and money: one append-only ledger family

Per OWD-13 and REQ-112 the platform is the **source of truth** for accruals and postings; external accounting is a mirror with no integration in scope (CON-16). The model is an **append-only ledger** in the sense of ADR-0003 §2.7:

- **Ledger accounts** — one per subject that can hold a balance: per person (attention points, OWD-10/REQ-3), per project unit fund, per investor organisation, plus the system accounts a double-entry posting needs.
- **Postings** — immutable, double-entry-style entries: each posting moves a quantity from one account to another, carries a unit (attention points / money), a project reference (OWD-9), an occurred-at, the id of the rule that produced it, and an **attribution subject** — the organisation and, where REQ-114 applies, the member (medical representative) whose personal link brought the doctor. Corrections are compensating postings; nothing is updated in place.
- **Accrual rules referenced by id.** The rules themselves (what earns how many points, prices in points, welcome bonuses) are explicitly **two-way doors** (REQ-36/48/49) and are **out of scope of this ADR** — the ledger only pins the id so that any posting can be traced back to the rule version that produced it.
- **No mutable balance column.** A balance is a fold over postings, materialised as a cache if and when read performance demands it. This is what keeps "one points balance on web and mobile" (OWD-10) true by construction rather than by synchronisation.
- The **"contributed → unit fund → accruals"** chain (OWD-3) is a **report over the ledger**, not a stored structure. Money moves by contracts off-platform on the first bet; the platform records the postings that mirror those contracts.

**REQ-134 (investor terminology fork) is left open deliberately** and the model is built so it costs nothing to settle: the ledger subject is an account attached to a person or an organisation, and the smart-contract role is a **role assignment plus the postings that reference it**. The same organisation (or person) can therefore be the smart-contract subject, an Academy audience member, or both, with **no schema change** — only different role assignments and different postings. The fork is about the two **labels** REQ-134 will pick; the model commits to neither and needs no rename whichever way it lands.

### 7. Documents and consents under the PD lifecycle

Per OWD-12 and REQ-22, Doctor.School stores copies of the doctor's documents (diploma, certificates, passport, СНИЛС) permanently in the profile and is itself the issuer/verifier. The model carries **document records**: subject (the person), document type, an object-storage key (never the bytes in Postgres), issued-at and expiry, verification state, verifier and verified-at.

Document records are **personal data of the highest sensitivity** and live under the ADR-0009 PD lifecycle: retention, deactivation and erasure follow ADR-0009, access is gated by the "verification" right (REQ-113), and every access and state change is an entry in the feature-010 `audit_ledger` (CON-15).

Per Q-31 Doctor.School holds the educational licence, obtains per-school licences as a matter of course, and is therefore the **issuer of record** for certificates, professional-development удостоверения and НМО codes; the `issuer` attribute of a document record exists because the licensee kind (§2) allows an institute or a clinic to issue under contract, not because the default is unsettled.

Consents are **per purpose, explicit and revocable** (REQ-34) and reuse the existing `consent_records` family (ADR-0009) — one record per purpose and version, with revocation recorded as a new record rather than a deletion. An investor receives data only for the doctors who consented for that purpose (OWD-2, CON-2). Per Q-35 the product offers **no self-service partial revocation**: consent to share data with investors is part of the deal for free education, any refusal means losing everything — profile, points and platform history — and each case is worked manually by a platform manager. The model reconciles that with the append-only ledger of §6 explicitly: erasure **never deletes or rewrites a posting**. Instead the person's ledger account is **closed and its balance frozen** (the points cease to be spendable, which is what "loss of points" means operationally), and the posting's subject is **re-pointed to an anonymised subject** carrying no personalia, exactly as ADR-0009 erasure requires. The accrual chain stays auditable and the investor reports already issued stay valid; what disappears is the identifiable person behind them.

### 8. Every entity declares its storefront ownership

Each entity in the model carries a **storefront-ownership** attribute with the values `doctor` (the `doctor.school` storefront), `academy` (`academy.doctor.school`), `both`, and `admin-only`. This is a modelling attribute recorded per entity in the companion design spec — it makes the "the doctor has no access to the backstage" invariant (OWD-6, NG-2/REQ-24) checkable at the model level, and it gives every future feature slice an unambiguous answer to "where does this surface". It is **not** an authorization mechanism: authorization stays with role assignments and the policy engine (ADR-0003 §4).

### 9. Mapping to the current schema — absorb, never rewrite

The full table is in the companion design spec. The rule: every existing table is classified **kept / renamed / extended / retired**, and the two shipped feature verticals are **absorbed as they are**:

- **Feature 012** (`projects`, `experts`, `topics`, `partners`, `event_experts`, `event_projects`, plus the retained-row lifecycle of #1278/#1288/#1289) — absorbed. `projects` becomes the §4 container, `experts` the §3 base, `topics` the §5 directions book (renamed + extended), `partners` the §2 organisation seed. **No rewrite of feature 012.**
- **Feature 014** (`event_recordings`) — absorbed unchanged as an output artifact of the event output.
- `users` kept (§1), `events` + `event_speakers` + `registrations` kept, `consent_records` kept (§7), `audit_ledger` kept, the operational tables (`lifecycle`, `presence_beats`, `idempotency_keys`, `media_cleanup_jobs`, `stream_config`) untouched.

**REQ-105 (migration of the ~10k GetCourse doctors and the congress registration base) is named here as a follow-up, not designed here.** It is the people-side of **OWD-7** — the GetCourse exit, whose accepted form is that content moves to the new platform and **there is no integration with GetCourse and never will be**; the door as originally written covered content only, so the migration of people was split out into REQ-105. The constraint OWD-7 puts on that follow-up is binding here: the migration is a one-off import into the model above, never a sync, and no entity may assume a live GetCourse counterpart. The follow-up itself needs its own artifact covering legal basis, consent re-confirmation and field mapping, and it precedes the first investor report — but it is a migration decision, not a core-model decision.

---

## Rejected alternatives

**A. Separate schemas (or separate databases) for the doctor storefront and the Academy.** Rejected: it contradicts OWD-6/OWD-10 directly, and every entity that genuinely spans both storefronts — the person, the project, the expert, the points balance — would need cross-schema synchronisation. The two-storefront split is a **presentation** boundary; §8 records it as an attribute instead.

**B. Account subtypes — `doctor`, `expert`, `partner_user` as separate user tables or separate logins.** Rejected by OWD-1: the same human is routinely several of these at once, and splitting them makes the eventual merge a data-and-trust migration. Roles as assignments (§1) cost one relation and remove the merge entirely.

**C. Membership as a property of the account (an `organisation_id` column on `users`).** Rejected by OWD-8: membership is explicitly a revocable link and not a property of an account, so revoking access on an employee's departure would mean touching the account, and the history of past memberships would be overwritten rather than closed. The Q-33 constraint reinforces this rather than weakening it: "at most one active membership, or a warning to the person and the admins" is a rule **over the link relation** — a column can neither hold the historical links nor raise the warning.

**D. Points as a mutable balance column on the person.** Rejected: it cannot answer "why is my balance this number", makes corrections destructive, and turns "one balance on web and mobile" into a synchronisation problem. The append-only ledger (§6) follows ADR-0003 §2.7 and makes the balance derivable.

**E. Making the project one output type among many (a school is a project, a congress is a project).** Rejected by rule V-RV-9: it destroys the single traceability key OWD-9 depends on. The congress is an event output of the "Ortho-biology" project (REQ-79), not a project.

**F. One reference book — treating the Minzdrav specialty as the only axis, or the open direction as the only axis.** Rejected by OWD-11: the official list cannot be extended for products, and the open list cannot be used for documents and НМО. Two books linked many-to-many is the accepted decision; the adjacency lives on the open book.

**G. Storing document bytes in Postgres.** Rejected: object storage with a key in the record, per ADR-0003; it keeps the PD-erasure path of ADR-0009 workable and the database small.

---

## Open questions (deferred)

Product decisions this ADR deliberately does **not** settle. Each stays with the Product Lead and blocks only the slice that needs it. The questions the finalisation session closed (Q-31 in its main part, Q-32, Q-33, Q-34 → REQ-114, Q-35, Q-38, Q-40) are **not** listed here — they are carried by the decision above.

1. `TODO(Product Lead)` **REQ-134** — investor terminology fork: which label goes to the smart-contract role and which to the Academy audience. The model is fork-proof (§6); only the labels are open, and this ADR pre-commits to neither side.
2. `TODO(Product Lead)` **REQ-105** — legal basis and consent re-confirmation for migrating the ~10k GetCourse doctors and the congress registration base; the migration design is a separate artifact (§9, OWD-7).
3. `TODO(Product Lead)` **REQ-36/48/49** — accrual rules, point prices and bonus policy (two-way doors, referenced by id in §6 and out of scope here).
4. `TODO(Product Lead)` **Q-31 residue only** — the main part is closed (Doctor.School is the licence holder and the issuer, §7); what remains is naming: what is promised to the doctor by a direction that has no place in the Minzdrav nomenclature (ortho-biology). Recorded by the owner as explicitly **not a blocker**; it changes reference-book copy, not the model.
5. `TODO(Product Lead)` — whether account ↔ expert confirmation is a **mandatory** precondition of the first payout to an author (accruals accumulate on the expert but cannot be withdrawn until linked). This is a policy rule, not a model change.

---

## Consequences

**Positive.** The one-way doors of the discovery package are closed in a single artifact, so every relaunch feature slice inherits the same entity shapes instead of inventing them. Features 012 and 014 keep shipping unchanged — the model absorbs them rather than superseding them. Roles-as-assignments and membership-as-a-link remove the two most expensive retrofits the register warned about. The ledger makes both the points balance and the investor-facing money chain derivable, and it survives the REQ-134 fork untouched.

**Costs and risks.** Role assignments and organisation memberships are more machinery than a scalar column: authorization must consult the assignment context, and the policy layer (ADR-0003 §4) grows accordingly. The `topics` → directions rename touches shipped feature-012 surface and needs its own migration slice with the retained-row lifecycle preserved. The ledger forbids in-place balance updates, so every accrual path must be written as postings and every read as a fold — with a materialised balance cache once volumes demand it. Document records raise the platform's PD exposure (152-ФЗ), which is why §7 binds them to ADR-0009 and to the audit ledger from day one.

**Deferred by construction.** Payment integration stays out (CON-16); accrual rules stay out (REQ-36/48/49); the GetCourse migration stays out (REQ-105). None of them requires a change to the entities decided here.

---

## Cross-references

- Discovery input package: `apps/docs/content/specs/product/two-site-ia/` — `README-ru.md` (navigation), `one-way-doors-ru.md` (OWD-1…13), `requirements-ru.md` (REQ ids cited above), `discovery-glossary-ru.md` (terminology — binding), `brainstorm-q-27-ru.md` (account ↔ expert, closed by REQ-106), `review-r1-synthesis-ru.md` (rule V-RV-9).
- ADR-0015 — two-storefront topology (sibling, in authoring): one backend, one Postgres, one IdP.
- ADR-0001 §6 — one IdP and the account model; ADR-0002 §3 — Zod SSOT in `packages/schemas`; ADR-0003 — Postgres 17 + Drizzle, retained-row lifecycle, append-only ledger pattern §2.7, policy engine §4; ADR-0009 — PD lifecycle and consent records.
- Feature specs absorbed: `specs/features/012-content-taxonomy/012-design.md` §2 (data model), `specs/features/014-event-recordings/014-design.md`.
- Current schema: `packages/db/src/schema/`.
- Companion design spec: [`0016-core-domain-model-design-en.md`](./0016-core-domain-model-design-en.md).

---

## Verification

This ADR is verified by the artifacts that consume it, not by tests of its own:

1. Every relaunch feature spec (ADR-0014 pipeline) that introduces or touches a core entity cites the §-number of this ADR that governs it; a spec that invents a new shape for a decided entity is a review failure.
2. The first schema slice implementing §§1–6 lands as Drizzle migrations whose tables match the entity/field inventory of the companion design spec, with `packages/schemas` Zod contracts per ADR-0002 §3.
3. The mapping table of the design spec is re-checked whenever a table in `packages/db/src/schema/` is added or renamed — a table absent from the mapping is decision-debt.
4. Terminology conformance: no product artifact of this epic uses the synonyms banned by `discovery-glossary-ru.md`.
