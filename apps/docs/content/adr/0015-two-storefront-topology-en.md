---
title: "ADR-0015 — Two-storefront topology (doctor.school + academy.doctor.school on one platform) for DS Platform [EN]"
description: "Doctor.School relaunches as two public storefronts on one platform: doctor.school (the doctor-facing storefront) and academy.doctor.school (the backstage for experts and partners). This ADR fixes the host to application map, confirms one backend / one database / one IdP, and records the fitness of the current stack against the doctor storefront capabilities."
lang: en
---

> **EN (this)** · **RU:** [`0015-two-storefront-topology-ru.md`](./0015-two-storefront-topology-ru.md)

# ADR-0015 — Two-storefront topology (doctor.school + academy.doctor.school on one platform) for DS Platform

**Date:** 2026-08-22
**Status:** Accepted
**Related to:** epic [#1430](https://github.com/doctor-school/ds-platform/issues/1430) (milestone «Doctor.School relaunch — two-site IA»), this ADR [#1432](https://github.com/doctor-school/ds-platform/issues/1432); discovery provenance — Plane `doctor-school` DSP-252 (discovery closed) and DSP-251 (wireframe R4 owner-approved); input package `apps/docs/content/specs/product/two-site-ia/`
**Inherits:** ADR-0001 §6 (IdP + session model), ADR-0002 (NestJS API + REST/OpenAPI + `@ds/api-client`), ADR-0003 (Postgres 17 + Drizzle + pgvector), ADR-0004 (Next.js 15 app-split + design system), ADR-0005 (React Native + Expo mobile), ADR-0012 (deployment topology v1)
**Sibling, in authoring:** ADR-0016 — core domain model (Issue [#1433](https://github.com/doctor-school/ds-platform/issues/1433)). Entities are named here only where the topology depends on them; their shape is decided there.

---

## Context

The Product Lead decided on 2026-08-22 to relaunch the product as **two public storefronts of one platform**:

- **`doctor.school`** — the doctor-facing storefront: specialty catalogue, schools, courses, modules and lessons, events (online and offline), attention points, documents and verification.
- **`academy.doctor.school`** — the **backstage**: projects of the Academy, catalogues of partners / projects / experts, the author and co-author workspaces, the partner (investor) workspace.

The discovery package fixes the boundaries this ADR must respect as one-way doors:

- **OWD-1** — one person = one account across both storefronts; roles (doctor, expert, speaker) are attributes, not separate logins.
- **OWD-5** — the Academy is a **separate public domain with its own audience**, but part of one ecosystem, not a separate product.
- **OWD-6** — **one platform, two fronts** (not two systems): person and school/product data are shared; the doctor has no access to the backstage.
- **OWD-7** — leaving GetCourse: content moves onto this platform, no GetCourse integration exists or will exist.
- **OWD-9** — a project is traceable across both storefronts and the whole ledger.
- **OWD-10** — the doctor sees the same lessons, events and one attention-points balance on the web storefront and in the mobile applications.
- **OWD-12** — Doctor.School stores copies of the doctor documents and is itself the issuer of the training documents.

The premise «one backend / one database» is stated in the input package as a premise **to be verified** (`README-ru.md` → stage 1). This ADR verifies it against the code that exists, then fixes the front-end topology, because the previously recorded host to application map no longer describes either the product or production:

- ADR-0004 §2 recorded `apps/promo` = `doctor.school` and `apps/portal` = `app.doctor.school`. In production since 2026-08-03 (Issue #1171) the portal is served at **`academy.doctor.school`**, and `app.doctor.school` is a 301 to it.
- The doctor-facing storefront in the new picture is a **first-class product surface** with authenticated learning, a points ledger and document flows — not the marketing landing that `apps/promo` was scoped for.

---

## Decision

### 1. One backend, one database, one IdP — the OWD-6 premise holds

Both storefronts, the admin surfaces and the mobile applications are clients of **one** API, **one** database and **one** identity provider. No per-storefront backend, no per-storefront database, no per-storefront tenant.

Evidence from the code as it stands (not an aspiration):

| Layer    | Fact                                                                                                                                                                                                                                                                                               | Consequence                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API      | `apps/api` is a single NestJS application (ADR-0002 §2/§4); the REST contract is generated once into `@ds/api-client` from the Zod SSOT in `packages/schemas`. There is no host-aware or tenant-aware routing anywhere in the application.                                                         | A second storefront is a new **client** of the same contract, not a fork.                                 |
| Database | One Postgres 17 instance with one Drizzle schema in `packages/db/src/schema/*.ts` (users, events, registrations, taxonomy, event-recordings, consent-records, audit-ledger, lifecycle, presence-beats, idempotency-keys, media-cleanup-jobs). No storefront or tenant discriminator column exists. | One person row, one registration row, one ledger — OWD-1, OWD-9 and OWD-10 are satisfied by construction. |
| Identity | One Zitadel instance at `id.doctor.school` (ADR-0001 §6); sessions are host-only cookies issued per front-end host, cross-host continuity via OIDC silent re-auth.                                                                                                                                 | One account spanning both hosts without a shared `.doctor.school` cookie.                                 |
| Delivery | ADR-0012 §1 — one `api-prod` plane and one `data-prod` plane.                                                                                                                                                                                                                                      | The second storefront adds a front-end container and an nginx virtual host, nothing else.                 |

The alternatives (a backend, a database or an IdP per storefront) are rejected below, each against the one-way door it breaks.

### 2. Host to application map

```
apps/doctor/   # NEW — doctor.school            · the doctor-facing storefront (public + authenticated)
apps/portal/   # academy.doctor.school          · the Academy backstage (authenticated, role-gated)
apps/admin/    # admin.doctor.school            · Refine + 2FA, internal operations
apps/cms/      # cms.doctor.school              · Payload v3, editorial content
```

- **`apps/doctor` is a new Next.js 15 application** built on the same `@ds/design-system`, `@ds/api-client` and `packages/schemas` as the rest. Public pages (specialty catalogue, school / course / lesson descriptions, event announcements, marketing landing) are statically generated or ISR; authenticated pages (module path, points, documents, tickets) are SSR with the host-only session cookie.
- **`apps/portal` serves `academy.doctor.school`** — the host it already serves in production. Its scope narrows to the backstage: projects, catalogues, author / co-author / partner workspaces.
- **`apps/promo` folds into `apps/doctor`.** The marketing landing becomes route segments of the doctor storefront (statically generated per route), so one host owns one information architecture and the doctor never crosses an application boundary between «read about the school» and «start the module». `apps/promo` is retired once its routes are served by `apps/doctor`; that retirement is a tracked deliverable of stage 3, not a silent deletion.
- **`apps/admin` and `apps/cms` are unchanged.** Their audiences, security perimeters and deploy cadence are unaffected by the storefront split.
- `apps/docs`, `apps/showcase` and `apps/academy-demo` are internal surfaces, out of scope here.

### 3. One application per storefront (the chosen shape)

The doctor storefront and the Academy backstage are **separate Next.js applications**, not one application routing on the `Host` header. Reasons, each tied to an existing decision:

1. **Audiences and information architectures do not overlap.** The doctor storefront is a learning product; the backstage is a workspace for experts and partners. OWD-6 requires shared _data_, not a shared front end.
2. **The authentication perimeters are per host anyway.** ADR-0001 §6 issues host-only `__Host-` cookies; a single application serving both hosts would still hold two independent session scopes, gaining nothing while making backstage code paths reachable on the doctor host through a routing mistake. OWD-6 («the doctor has no access to the backstage») deserves a build-time boundary, not a runtime host condition.
3. **Independent deploy cadence and isolated security perimeters** — the same rationale ADR-0004 §2 already applies to the existing app-split (ADR-0004 → Consequences).
4. **The doctor storefront is the web core of the mobile product.** Q-36 fixes the mobile applications as a cross-platform product over a web core; a storefront that is its own application shares route- and data-level primitives through `packages/*` without dragging backstage code into the mobile build graph.

### 4. Session and access across the two hosts

- **One account (OWD-1).** Zitadel is the single identity provider; a person authenticates once and is the same subject on both hosts.
- **Per-host session cookies.** The session cookie on the doctor host and the one on the academy host are separate by construction (`__Host-` cookies cannot be scoped to a parent domain). Continuity between hosts is an OIDC silent re-auth (`prompt=none`) at the IdP — ADR-0001 §6, unchanged.
- **The host is not the authorization boundary.** Roles and organisation memberships are attributes of the person (OWD-1, OWD-8); the API authorizes every request against those attributes regardless of which storefront issued it. The academy host additionally refuses to render a backstage surface for a subject with no backstage attribute — defence in depth on top of the API decision, never a substitute for it.
- **The doctor sees exactly one trace of the Academy** — the single entry point recorded in the input package (REQ-24); no backstage navigation is reachable from the doctor storefront.

### 5. Mobile

ADR-0005 stands unchanged: React Native + Expo, distribution via App Store / Google Play / RuStore, monorepo placement per ADR-0005 §11. The mobile applications talk to the **same `api.doctor.school`** as both storefronts (OWD-10: one catalogue, one points balance). Universal Links and App Links target **`doctor.school`**, and the association files are served by `apps/doctor`.

### 6. Fitness of the current stack against the doctor storefront

One row per capability the doctor storefront requires. «Fits with additions» names the addition; no vendor is selected here.

| Capability                                                         | Verdict                                 | What it rests on / what must be added                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module path with video lessons (REQ-16, REQ-50)                    | **Fits with additions** (named)         | Object storage + CDN for media (ADR-0002 §8) and a transcoding / packaging worker on the existing BullMQ queue (ADR-0002), producing adaptive HLS with signed, expiring playback URLs. Progress tracking reuses the existing lifecycle and presence tables. **No vendor is chosen in this ADR** — OQ-4.       |
| Attention-points economy (REQ-3, REQ-36, OWD-10, OWD-13)           | **Fits with additions** (named)         | An append-only ledger table family (accruals, transactions, balances) in the same Postgres — shape decided by ADR-0016. One balance per person follows from §1; no per-client accounting.                                                                                                                     |
| Document verification with stored copies (REQ-22, REQ-113, OWD-12) | **Fits with additions** (named)         | A private object-storage bucket with server-side encryption and no public URLs, plus the personal-data lifecycle and audit obligations of ADR-0009; access only through the «verification» permission, every access written to the existing audit ledger.                                                     |
| НМО credits and certificates (REQ-57, REQ-104, Q-17, Q-31)         | **Fits with additions** (named)         | A platform-side registry of accruals plus an **operator-driven export** — the state НМО portal exposes **no public API for providers**, so no integration seam is built now. Training documents are issued by Doctor.School itself (Q-31: DS holds the educational licence), rendered from the same registry. |
| Offline events and the congress (REQ-79…86, REQ-99, CON-9)         | **Fits as-is** (plus check-in)          | The event and registration model of features 005 / 007 already covers announcement → registration → attendance; the offline delta is ticketing and check-in on top of the existing registration row, not a new subsystem.                                                                                     |
| Cross-platform mobile (Q-36, OWD-10)                               | **Fits as-is**                          | ADR-0005 as written: same API, shared `packages/schemas` · `api-client` · `utils` · `hooks`; the doctor storefront is the web core.                                                                                                                                                                           |
| Migration off GetCourse (OWD-7, REQ-105)                           | **Fits as-is** (import, no integration) | A one-off import into the same schema (content and people). No GetCourse integration seam is built — OWD-7. The legal basis for migrating people and re-confirming consents is a product question — OQ-6.                                                                                                     |

### 7. Deployment shape

ADR-0012 is unchanged in cluster shape: `api-prod` (API plane) and `data-prod` (persistence plane). The front-end delta is one additional container and one additional nginx virtual host: `doctor.school` → `apps/doctor`, `academy.doctor.school` → `apps/portal`, `admin.` and `cms.` as today. `app.doctor.school` remains a 301 to the academy host for as long as links to it survive in the wild.

---

## Rejected alternatives

### A backend per storefront

Two APIs over one database duplicate every contract, guard and migration, and give the doctor storefront and the backstage two places to disagree about the same person. Over separate databases they break OWD-1 (one account), OWD-9 (a project traceable across both storefronts) and OWD-10 (one points balance) outright.

### A database per storefront

Both storefronts read and write the same person, project, school and ledger rows. Splitting them creates a synchronisation problem between two products that OWD-6 explicitly says are not two products, and turns «one balance everywhere» (OWD-10) into an integration task instead of a property.

### A separate IdP or a separate identity tenant per storefront

It reintroduces «one person, two logins», which OWD-1 closes as a one-way door. Roles are attributes of a single subject; the same person is legitimately a doctor and an expert.

### One Next.js application serving both hosts by host-based routing

It buys no session sharing (host-only cookies are per host regardless — ADR-0001 §6), couples the deploy cadence of two audiences, and turns the OWD-6 backstage boundary into a runtime routing condition instead of a build-time separation.

### Growing `apps/promo` into the doctor storefront

Rejected as a framing, adopted as a migration. `apps/promo` is scoped as an SSG marketing surface with no session, no authenticated data fetching and no product design surface for learning; the doctor storefront is a full authenticated product. The new application `apps/doctor` is created for that scope and **absorbs the promo routes** (§2), rather than stretching the promo application to carry sessions, a points ledger and document flows.

---

## Open questions (deferred)

| OQ                                                                                                                                                           | Owner                            | Review trigger                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------- |
| **OQ-1.** Investor terminology fork — the smart-contract role versus the Academy audience (**REQ-134**)                                                      | `TODO(Product Lead)`             | Before the Academy backstage IA is sliced into features (stage 3) |
| **OQ-2.** Congress 2026 — the scope of the first end-to-end slice on the platform (**Q-10**, **CON-9**, REQ-79…86)                                           | `TODO(Product Lead)`             | Before registration opens (November 2026)                         |
| **OQ-3.** Academy mission and values copy (**REQ-103**)                                                                                                      | `TODO(Product Lead)`             | Before the Academy landing is built                               |
| **OQ-4.** Video hosting, transcoding and CDN vendor for the module path (§6, row 1)                                                                          | Tech Lead                        | Before the first video lesson ships                               |
| **OQ-5.** The exchange format of the НМО registry export (**REQ-104**, **Q-17**) — no provider API exists today                                              | `TODO(Product Lead)` + Tech Lead | When the first programme carrying НМО credits is scheduled        |
| **OQ-6.** Legal basis and consent re-confirmation for migrating people off GetCourse (**REQ-105**, **OWD-7**)                                                | `TODO(Product Lead)`             | Before the first partner report covering migrated doctors         |
| **OQ-7.** The boundary of doctor personal data a partner may see (**Q-32**, **REQ-39**, OWD-2) — this ADR fixes only that the API, not the host, enforces it | `TODO(Product Lead)`             | Before the partner workspace is sliced into features              |

---

## Consequences

### Positive

- The «one backend / one database» premise is verified against the code rather than assumed: OWD-1, OWD-9 and OWD-10 hold by construction, with no synchronisation machinery to build.
- The second storefront costs one front-end container and one nginx virtual host — the ADR-0012 cluster shape and the ADR-0002 API contract are untouched.
- The backstage boundary of OWD-6 is a build-time separation (a different application) plus an API authorization decision, not a runtime host check.
- The doctor storefront is the web core the mobile product needs (Q-36), sharing schemas, client and design system through `packages/*`.
- The host map in the ADR corpus now matches production (`academy.doctor.school` = the portal), so the next session reads facts instead of drift.

### Negative

- One more Next.js application to build, deploy and keep visually consistent; `apps/promo` must be migrated and retired rather than left standing (tracked at stage 3).
- Two storefronts mean two design surfaces to keep in parity with `design-source/`; a shared design system reduces but does not remove the cost.
- Cross-host continuity depends on OIDC silent re-auth: a browser that blocks third-party frames makes the move from `doctor.school` to `academy.doctor.school` a visible re-login. Accepted — the audiences that cross hosts are experts and partners, not doctors.
- Video, points and document capabilities are named as additions, not built: each is a tracked deliverable with its own cost, and none of them is a stack change.

### Architectural qualities (metrics, not declarations)

| Quality              | Metric                                                            | Target                      |
| -------------------- | ----------------------------------------------------------------- | --------------------------- |
| Account unity        | Identity providers / person records per human across both hosts   | 1 / 1                       |
| Data unity           | Databases holding person, project or points rows                  | 1                           |
| API unity            | Backend applications serving the storefronts                      | 1 (`apps/api`)              |
| Storefront isolation | Backstage routes reachable from the doctor host                   | 0                           |
| Delivery delta       | Infrastructure components added by the second storefront          | 1 container + 1 nginx vhost |
| Points consistency   | Attention-points balances per person across web and mobile        | 1                           |
| Cross-host re-auth   | Person-visible logins to move between hosts (silent re-auth path) | 0                           |

---

## Cross-references

- **ADR-0001 §6** — IdP and session model; source of the per-host cookie and OIDC silent re-auth rule reused in §4.
- **ADR-0002 §2/§4** — one NestJS application, REST + OpenAPI contract, `@ds/api-client` codegen; the evidence base of §1.
- **ADR-0002 §8** — media storage and delivery; the anchor for the video addition in §6.
- **ADR-0003** — Postgres 17 + Drizzle + pgvector; one schema, the evidence base of §1.
- **ADR-0004 §2** — Next.js app-split and the host map, carrying `apps/doctor` and the academy host.
- **ADR-0005 §11** — mobile monorepo placement and shared packages; §5 here fixes the API and deep-link targets.
- **ADR-0009** — personal-data lifecycle obligations behind the document-storage row of §6.
- **ADR-0012 §1** — production cluster shape; unchanged, extended by one front-end container (§7).
- **ADR-0014** — the product-spec pipeline that stage 3 of the epic follows.
- **ADR-0016** (sibling, in authoring — Issue [#1433](https://github.com/doctor-school/ds-platform/issues/1433)) — the core domain model: person, project, school / course / lesson, points ledger, expert to account linking, clinical base, verification.
- **Input package** — `apps/docs/content/specs/product/two-site-ia/` (`README-ru.md`, `one-way-doors-ru.md`, `requirements-ru.md`, `discovery-glossary-ru.md`, `screens-ru.md`, `next-steps-ru.md`).

---

## Verification

```bash
# The old host map must not survive anywhere in the docs corpus
grep -rn "app\.doctor\.school" apps/docs/content/ | grep -v "0015-two-storefront-topology"
grep -rn "promo/.*doctor\.school" apps/docs/content/

# The academy host must be the portal host in every ADR that names it
grep -rn "academy\.doctor\.school" apps/docs/content/adr/

# EN + RU section parity of this ADR
grep -c "^### " apps/docs/content/adr/0015-two-storefront-topology-en.md apps/docs/content/adr/0015-two-storefront-topology-ru.md
```

**Known stale mentions in code, deliberately out of scope of this ADR (they follow at stages 3–4):**

- `tools/deploy/smoke-prod.mjs` — `PROD_PORTAL_HOST` names `academy.doctor.school` correctly, but the variable name still reads «portal» for what is now the Academy backstage host.
- `apps/portal/package.json` — the package description still describes the portal as the doctor-facing surface.
- `apps/promo/*` — retires into `apps/doctor` when the doctor storefront ships its marketing routes (§2).
- Live directory inventories that legitimately still name `apps/promo` because the directory still exists — the UI-surface globs in `tools/lint/*.ts` and in the skills (`do-feature-iteration`, `do-hotfix-pr`, `run-iteration-end-checklist`), the app list in `.claude/rules/repo-conventions.md`, and the dev-port table in the local-dev-environment tech spec. They follow the directory, not this ADR.
