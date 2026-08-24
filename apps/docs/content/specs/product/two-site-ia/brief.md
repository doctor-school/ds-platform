---
title: "Doctor.School relaunch — two-site IA — product brief"
description: "Thin product brief for the two-storefront relaunch epic: doctor.school as the doctor storefront and academy.doctor.school as the Academy backstage for experts and investors. JTBD, cross-cutting information architecture, the provisional 017…044 feature decomposition across seven build waves, success metrics, and prior art. Source layer for the per-feature PRDs and their EARS triplets (ADR-0014)."
slug: two-site-ia-brief
milestone: https://github.com/doctor-school/ds-platform/milestone/13
parent_issue: https://github.com/doctor-school/ds-platform/issues/1430
status: Draft
features:
  - 017-doctor-shell-specialties
  - 018-specialty-feed
  - 019-doctor-events-feed
  - 020-event-page-two-storefronts
  - 021-doctor-registration
  - 022-doctor-account
  - 023-school-and-course
  - 024-learning-module-path
  - 025-attention-points-engine
  - 026-congress-front
  - 027-communities
  - 028-legal-pages
  - 029-academy-home-relaunch
  - 030-projects-catalog-and-page
  - 031-experts-catalog-and-page
  - 032-investors-leaderboard
  - 033-author-application
  - 034-investment-marketplace
  - 035-investor-cabinet
  - 036-accruals-and-units-ledger
  - 037-documents-and-consent-lifecycle
  - 038-nmo-registry-and-checkins
  - 039-admin-crm-people-and-roles
  - 040-admin-content-production
  - 041-event-constructor
  - 042-marketing-integration
  - 043-migration-getcourse-and-congress
  - 044-congress-2026-intake
lang: en
---

> **EN (this)** · **RU:** [`brief-ru.md`](./brief-ru.md)

> **Scope (owner decision, 2026-08-22).** The platform relaunches as **two storefronts on one platform**: `doctor.school` — the doctor storefront; `academy.doctor.school` — the Academy backstage for experts and investors. Discovery package, requirements register (REQ-1…142) and the owner-approved R4 wireframe: [`README-ru.md`](./README-ru.md). Topology: [ADR-0015](../../../adr/0015-two-storefront-topology-ru.md); core domain model: [ADR-0016](../../../adr/0016-core-domain-model-ru.md); screen → REQ → feature decomposition: [`functional-map-ru.md`](./functional-map-ru.md).

> **Feature numbers 017…044 are provisional.** They are the working labels of the functional map, assigned in wave order; a number becomes final the moment that feature's `NNN-product.md` PRD is created. Until then it identifies a row of the map, not an artifact.

> **Owner decision — design-complete first.** All 24 R4 screens are drawn as canvases and Stage-A approved **before** any of them is built; the waves below are build order inside the delivery stage only, never a licence to start building a screen whose design is still open.

---

## Problem

- The live platform is **one public surface for two audiences that need opposite things**. `academy.doctor.school` today carries the doctor's entry, the expert's story and the investor's pitch at once; a doctor looking for a lecture lands in the Academy's backstage, and an expert deciding whether to join sees a doctor's catalogue.
- The doctor storefront **does not exist**. `doctor.school` is served by `apps/promo` — marketing routes only: no specialty catalogue, no feed, no learning path, no account.
- Doctors come for **events first** (R4 revision №1), yet there is no doctor-facing feed of what runs now, this week, or in their specialty — the current listing is a single flat page bound to the Academy.
- The value promise — **learning is free for the doctor because an investor organisation funds it** — has no surface that makes the exchange legible: no attention-points balance the doctor can see, no accrual ledger the investor can audit.
- Expert and investor funnels **dead-end**: no self-service author application, no «Это я» claim on an expert card, no investor cabinet showing what the funded audience actually did.
- Legally required surfaces (personal-data policy, consent register, document verification, NMO records) are **partly absent**, which caps how much of the doctor audience can be onboarded and reported on at all.

## Jobs-to-be-done

- **Doctor:** pick my specialty and immediately see content and events that are actually mine; reach «Участвовать» in a couple of clicks; learn in short modules and keep one attention-points balance across web and mobile; get my documents verified once and my NMO records issued; never be asked who paid for it.
- **Expert / author:** understand the Academy from the outside (projects, experts, growth path), claim my own expert card, and apply self-service without needing a personal introduction.
- **Investor organisation:** understand the business model, see the leaderboard of who already invests and what share of doctor attention they mined, pick a project or an expert to fund, and afterwards read a cabinet naming the doctors reached (identity, specialty, workplace — never contacts) with an auditable accrual report.
- **Academy team (internal):** run people, roles and access; drive content through methodologist → producer → medical review → publication; construct events and congresses; migrate the existing audience without losing its legal basis.

## Cross-cutting information architecture

- **Two storefronts, one platform.** `doctor.school` → the new `apps/doctor` app; `academy.doctor.school` → `apps/portal`, narrowed to backstage; `admin.doctor.school` → `apps/admin`. One NestJS API, one Postgres schema, one Zitadel — no per-storefront backend, database or identity tenant (ADR-0015 §1–2). `apps/promo` folds into `apps/doctor`: its marketing routes move in as route segments so that one host owns one information architecture, and retiring it is a tracked wave-1 engineering deliverable, not a silent deletion (ADR-0015 §2).
- **One person, one account across both hosts.** Roles (doctor, expert, speaker, organisation member) are attributes of that account, not separate logins; organisation membership is a revocable link (ADR-0016 §1–3, OWD-1/OWD-8). Sessions are host-only cookies per host, with OIDC silent re-auth for continuity between them.
- **The doctor's only trace of the Academy is a single link** (REQ-24, NG-2). The Academy never becomes a second doctor catalogue; the doctor storefront never exposes backstage.
- **Every entity declares its storefront belonging** — `doctor` / `academy` / `both` / `admin-only` (ADR-0016 §8). That is what makes «where is this shown» answerable per feature instead of per screen.
- **Project is the single cross-cutting container**; school, course, podcast and event are its results (ADR-0016 §4, OWD-9). Accruals, participant roles and reporting all hang off the project axis.
- **One event page serves both storefronts** — online, offline and hybrid share a single page (owner decision D-4), rendered on the doctor storefront and on the Academy, backed by the shipped event engines (004/005/006/014).
- **Attention points and money are one append-only ledger family** (ADR-0016 §6): points accrue and are spent against content gating; money is accounted from mined attention. Money movement itself stays outside the platform on day one (CON-16, OWD-3), while the platform remains the ledger of record (OWD-13).
- **Personal data has one lifecycle**: doctor documents are stored permanently in the profile, verification is a right-gated queue, consents are separate per purpose, provable and revocable (ADR-0016 §7, OWD-12, REQ-34). Every legally public page is generated from that accepted policy, never published ahead of it.
- **Interface copy never names who pays.** The doctor reads «бесплатно для врача»; the funding relationship is an Academy-side concept. The money-carrying role is **инвестор (организация)** / **первоинвестор** — never «партнёр» as the money carrier.

## Feature decomposition

28 provisional features across seven build waves. Row detail — screens, REQ coverage, `blocked_by` rationale and engine reuse — lives in [`functional-map-ru.md`](./functional-map-ru.md) §B–§C; this table is the epic-level view only.

| Wave  | Features                | Surfaces                 | What becomes demonstrable                                                                                                                        |
| ----- | ----------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1** | 017, 018, 019, 020, 021 | doctor (+ event on both) | The whole doctor funnel: entry → specialty → feed → event → «Участвовать» → registration → return to the point of interest; `apps/promo` retired |
| **2** | 022, 023, 024, 025, 044 | doctor · backend         | The doctor learns and accrues attention points, sees them in the account, reaches a school as a product; congress-2026 sign-ups land in our DB   |
| **3** | 028, 037, 038           | both · backend           | The doctor passes verification, receives a document and an NMO code; the platform is legally public                                              |
| **4** | 029, 030, 031, 033      | academy                  | The whole expert funnel: heard of it → read the backstage → «Это я» / application                                                                |
| **5** | 032, 034, 035, 036      | academy · backend        | The whole investor funnel: understood the model → checked the leaderboard → cabinet with the accrual report                                      |
| **6** | 039, 040, 042, 043      | admin · backend          | The team runs people, content and mailings in the system; the existing audience has migrated                                                     |
| **7** | 026, 027, 041           | doctor · admin           | The congress lives on the platform; communities work                                                                                             |

**Wave 1 also carries one engineering deliverable, not a pipeline feature:** retiring `apps/promo` once its marketing routes are served from `apps/doctor`. It has no PRD; its acceptance is «the routes answer from `doctor.school`, the old app is undeployed and removed from the repository».

**Features outside this decomposition:** 012 (`content-taxonomy`) and 014 (`event-recordings`) continue to completion as they are. 013 (`academy-home`) stays frozen and is re-specified as **029**; 015 (`projects-catalog`) → **030**; 016 (`experts-catalog`) → **031**.

## Success metrics

- A doctor who has never used the platform reaches «Участвовать» on a real event **without ever seeing the Academy backstage** — the wave-1 funnel runs end to end on `doctor.school`.
- `doctor.school` is served by `apps/doctor` alone; `apps/promo` is undeployed and deleted with no marketing route lost.
- A doctor's attention-points balance is **identical on web and mobile** — one ledger, one number (OWD-10).
- An investor organisation reads a cabinet report naming the doctors reached **strictly within the scope of their consents**, with accruals traceable to a single project number.
- A verified doctor receives an NMO record from the platform's own registry, with the ≥90 min + 2 check-ins rule enforced.
- Every one of REQ-1…142 is owned by a landed feature or an explicitly recorded non-goal — no requirement silently drops in the relaunch.

## Prior art — source system

There is no legacy Bubble system behind this epic. Its prior art is **our own live Academy platform** — features 001–016 running in production on `academy.doctor.school`: authentication (003), the event page and listing (004), registration (005), the webinar room with heartbeat presence (006), the minimal event admin (007), the portal shell (008), the doctor profile (009), the universal edit audit (010), admin 2FA (011), content taxonomy (012) and event recordings (014), the last two still in flight. The relaunch **reuses those engines rather than rebuilding them**: 019/020 stand on 004/005/006/014, 021 on 003/005, 022 on 009, 039 on 010/011. What changes is the information architecture around them, not the engines themselves.

The second body of prior art is the **discovery package** itself ([`README-ru.md`](./README-ru.md)): REQ-1…142 with its non-goals and constraints, the one-way-doors register OWD-1…13, the discovery glossary, the owner-approved R4 clickable wireframe with its screen ↔ REQ map, the canvas ↔ R4 reconciliation, and the functional map. It is **reference, not template**: the wireframe fixes structure and coverage, the canvases in `design-source/` fix the design, and neither dictates the data model — that is ADR-0016's job.

---

_This brief is the epic layer of ADR-0014's two-tier product spec: it decomposes, the co-located `NNN-product.md` PRDs carry the user stories, and the EARS triplets are authored from those PRDs — never the other way around._
