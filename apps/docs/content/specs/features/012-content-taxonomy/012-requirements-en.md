---
title: "012 — Content taxonomy: projects, experts, topics and partners"
description: "Requirements for first-class retained projects, experts, topics and partners; their retained many-to-many links to events and one another; gradual explicit migration from legacy free-text event speakers; platform_admin Refine authoring; and publish-safe bidirectional REST reads for later Academy surfaces."
slug: 012-content-taxonomy
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1280
issues:
  [
    1282,
    1283,
    1284,
    1285,
    1286,
    1287,
    1288,
    1289,
    1290,
    1291,
    1292,
    1293,
    1294,
    1295,
    1296,
    1297,
    1298,
    1299,
    1300,
  ]
prior_decisions:
  - ADR-0014 — Product-design delivery lifecycle (§2 PRD → EARS `realizes:` trace; Stage A precedes user-facing implementation)
  - "ADR-0001 — Identity / Auth / RBAC (admin reads and commands: `access: authenticated`, `required_roles: platform_admin`; public reads: `access: public`)"
  - ADR-0002 — Backend Core Stack (NestJS + nestjs-zod; REST/OpenAPI under `/v1`; public cursor pagination, admin offset pagination; RFC 7807; idempotency)
  - ADR-0003 — Data Layer (§4 retained-row lifecycle; Postgres + Drizzle; restrictive foreign keys; no physical delete or cascade)
  - ADR-0004 — Frontend Stack (§3 existing `apps/admin` Refine surface with custom providers over the NestJS API)
  - ADR-0013 — Design-token SoT and design-system-first adoption gate
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS numbering)
lang: en
---

> **EN (this)** · **RU:** [`012-requirements-ru.md`](./012-requirements-ru.md)
>
> PRD source: [`012-product.md`](./012-product.md) (US-1…US-12). Epic: [Academy public surface](../../product/academy-public/brief.md). Feature 012 has an operator-facing admin UI, so `surface: user-facing`; public Academy pages remain owned by 013–016.

# 012 — Content taxonomy (Requirements)

## Outcomes

- A content operator describes a project, expert, topic or partner once and reuses the same retained record everywhere.
- Events relate to several projects, experts and topics through real many-to-many rows; projects relate to experts and partners in both directions.
- An expert is one standalone editorial record. `project_experts.role` is `curator | member`; `event_experts` carries the event-specific role, position and optional explicit match to one legacy speaker row.
- Existing free-text speakers continue to render during gradual migration. A linked, published expert replaces only the explicitly matched legacy row in the current projection; there is no name matching, deduplication, overwrite or implicit retirement.
- Operators create, search, edit, publish, retire and restore taxonomy data in the existing Refine admin. No Delete action exists.
- Later Academy surfaces read publish-safe taxonomy records and every relationship direction through `/v1` REST; no copy, export or synchronization step exists.

## Scope

**In:**

- Top-level retained entities:
  - `projects`: stable id + slug, title, description, cover-media reference;
  - `experts`: stable id + slug, name, photo-media reference, credentials, bio; no platform-user foreign key in 012;
  - `topics`: stable id + slug and title, maintained as a curated list;
  - `partners`: stable id + slug, title, logo-media reference and website URL.
- Common entity fields: `status: draft | published | retired`, nullable `deleted_at`, monotonic `version`, and timestamps. Create starts in `draft`; restore returns to `draft`.
- Retained joins: `event_projects`, `event_experts`, `project_experts`, `project_partners`, `event_topics`; each has a stable id, `status: active | retired`, nullable `deleted_at`, `version`, timestamps and a uniqueness constraint for its logical endpoint pair.
- `event_experts`: required event-specific `role`, non-negative `position`, and nullable unique `legacy_speaker_id`. The #1278 retained-row runtime prerequisite gives existing `event_speakers` stable identity and retained semantics so the match cannot drift when the event is edited.
- Refine resources for entity list/detail/create/edit and lifecycle actions; relationship editors on the relevant event/project forms; search and explicit retained-row filters.
- Publish-safe public entity reads, bidirectional relationship reads and the merged current speaker projection.

**Out:**

- Doctor-facing rendering: `/`, `/webinars` facets/archive, `/projects`, `/experts` and their detail pages belong to 013–016.
- `event_recordings`, `leads`, Payload CMS, partner commercial terms/contracts, public taxonomy search, recommendation/ranking, bulk speaker migration, expert self-service, or a user↔expert identity link.
- New roles or access-policy concepts; 012 reuses `platform_admin`.
- A general audit-history browser. Feature 010 already captures mutations in `audit_ledger`; 012 only keeps retained rows explicitly addressable for inspect/restore.

## Constraints

- **Retained rows only.** No application path issues `DELETE`, `TRUNCATE`, data-bearing drop, `ON DELETE CASCADE`, or identifier reuse for these entities, joins or migrated `event_speakers`. Every foreign key is `RESTRICT`/`NO ACTION`.
- **Lifecycle consistency.** `retired` iff `deleted_at` is non-null; `draft`, `published` and `active` iff it is null. Entity transitions are `draft → published`, `draft|published → retired`, `retired → draft`; join transitions are `active → retired → active`. Retiring an entity never changes its joins.
- **Public default deny.** Public reads include only `published` entities with `deleted_at IS NULL`, `active` joins with `deleted_at IS NULL`, and events allowed by the existing public-event policy. A draft, retired or unknown public id produces the same 404 shape.
- **Explicit retained reads.** Admin lists default to non-retired entities / active joins. Retained rows appear only through an explicit status or `includeRetired=true` query; an admin detail by stable id remains addressable for restore.
- **One current speaker projection.** An active mapping suppresses its matched legacy row only when the linked expert is published and non-retired. Otherwise the legacy fallback remains. Rows sort by `position ASC`, then source rank (`expert` before `legacy`), then stable row id; equal-name rows are never deduplicated.
- **Publish completeness.** Drafts may be incomplete. Publication requires every kind's public fields; a project additionally requires exactly one active `curator` link to an eligible published, non-retired expert.
- **No stub seam.** Schema, migrations, API, generated SDK, Refine UI and browser wiring ship as real vertical slices. Seeds, fake repositories, placeholder selectors or manual DB steps do not satisfy an EARS clause.
- **Retained idempotency records.** An idempotency record is `active` for the 24 h replay window, then expires by UPDATE to `status='expired'` plus `deleted_at`; it is retained forever, never TTL-deleted or reused.

## Prior decisions

- **ADR-0003 §4:** every application-owned entity and relationship is retained; normal reads filter `deleted_at IS NULL`, historical/restore reads opt in, and all FKs are restrictive.
- **ADR-0002 §§3–4, 9:** Zod is the request/response SSOT, REST is versioned under `/v1`, public growing lists use opaque cursors, admin tables may use offset pagination, mutation errors are RFC 7807 and mutations are idempotent.
- **ADR-0004 §3:** taxonomy editing extends the existing Refine admin through custom data/auth/access providers; it does not create a second backend or use Payload CMS.
- **ADR-0013 + AGENTS.md §6:** implementation runs the design-system-first gate; interaction states and token discipline come from `@ds/design-system`.
- **Feature 007:** the current event aggregate owns `specialties[]` and ordered `event_speakers`; 012 adds taxonomy beside it and changes speaker reconciliation from physical replacement to stable retained rows.
- **Feature 010:** all new tables receive the generic audit trigger, so mutations append attributed `data.<table>.<op>` rows without a taxonomy-specific audit implementation.

## Lead technical decisions

- **LD-1 — optimistic versioning for authoring races.** ADR-0002 requires idempotency but does not prevent two different valid requests from overwriting one another. Every mutable taxonomy/speaker row therefore carries a monotonic `version`, returned as an ETag; PATCH and lifecycle/link commands require `If-Match`. The same precondition binds a retirement confirmation to the version whose impact was previewed, closing the preview→confirm TOCTOU window. A stale precondition returns 412 without mutation.
- **LD-2 — stable merged-speaker ordering.** `position` is the editorial order. The total tie-break is `position ASC`, source rank (`expert` before `legacy`), stable row id ASC; the write path also rejects a conflicting visible slot except when a mapped expert deliberately takes the suppressed legacy row's position. This makes every read deterministic without name-based behavior.

## Event Model

### Commands

- `CreateTaxonomyEntity(kind, fields)` / `UpdateTaxonomyEntity(kind, id, fields)` — create a `draft` entity or edit the same retained row.
- `PublishTaxonomyEntity(kind, id)` — `draft → published`, after validating its public projection.
- `PreviewRetirement(target)` — return the currently visible related projections that the entity or join would remove.
- `Retire(target)` / `Restore(target)` — explicit lifecycle transitions with no cascade; entity restore targets `draft`, join restore targets `active`.
- `CreateRelationship(kind, endpoints, attributes)` / `UpdateRelationship(id, attributes)` — create or change one retained join; `event_experts` accepts `role`, `position`, and optional `legacySpeakerId`.

Every mutation requires `Idempotency-Key`; every update/transition requires the current `If-Match` version.

### Events

| Event                                                      | Meaning                                                                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TaxonomyEntityCreated/Updated/Published/Retired/Restored` | One entity changed state or content; feature 010 records the row diff in the same transaction.                    |
| `TaxonomyRelationshipCreated/Updated/Retired/Restored`     | One explicit relationship changed; no endpoint or sibling relation changes with it.                               |
| `EventSpeakerMatched`                                      | An `event_experts` row now explicitly references one retained legacy speaker; the legacy row itself is unchanged. |

### Read models

- `TaxonomyAdminList/Detail` — all authoring fields, status, version and relationship summaries; offset/page pagination, search and explicit retained filters.
- `PublicProject`, `PublicExpert`, `PublicTopic`, `PublicPartner` — allow-listed public fields only, sourced from the authored rows.
- Bidirectional relationship collections — both endpoints of all five joins, cursor-paginated on public routes with `{ data, pagination: { nextCursor, hasMore } }`.
- `PublicEventSpeaker[]` — deterministic merge of eligible linked experts and unmatched retained free-text speakers.
- `RetirementImpact` — target id/version plus affected currently-public event/project/expert/topic/partner identifiers; it contains no hidden record content.

### Policies

- Slugs and logical endpoint pairs remain unique across retained rows; a duplicate create returns a conflict and points the operator to the retained row for restore.
- A project has at most one active `curator`; other project experts are `member`. A legacy speaker may be matched by at most one retained `event_experts` row, and the speaker must belong to the same event.
- Topic assignment always selects an existing non-retired topic. `specialties[]` is never read from or written to `topics`.
- Media binaries use the existing object-storage abstraction; public DTOs expose CDN URLs, never storage keys. Retiring/restoring a row never deletes its media.

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more PRD stories and is covered by `012-scenarios.feature`.

- **EARS-1** _(realizes: US-1, US-9)_ — When a `platform_admin` creates or edits a project through its Refine resource, the system shall persist one first-class retained `projects` row with stable id/slug/version, title, description and cover reference (a draft may be incomplete), and render that same row on list/detail; a project shall never be an event string or second copy.
- **EARS-2** _(realizes: US-2, US-9)_ — When a `platform_admin` creates or edits an expert through its Refine resource, the system shall persist one standalone editorial `experts` row with stable id/slug/version, name, photo reference, credentials and bio (a draft may be incomplete), with no required platform-user link or parallel expert type.
- **EARS-3** _(realizes: US-5, US-9)_ — When a `platform_admin` creates or edits a topic through its Refine resource, the system shall persist one curated `topics` row with stable id/slug/version and title; topics shall never be free-form event tags.
- **EARS-4** _(realizes: US-6, US-9)_ — When a `platform_admin` creates or edits a partner through its Refine resource, the system shall persist one descriptive `partners` row with stable id/slug/version, title, logo reference and website URL; commercial terms and contacts are not fields of the public contract.
- **EARS-5** _(realizes: US-1, US-2, US-5, US-6, US-10, US-12)_ — When an operator publishes a valid `draft` entity, the system shall validate all fields required by its public projection and transition it to `published`; a project additionally shall have exactly one active `curator` linked to a published, non-retired expert. Public list/detail shall then expose only the kind allow-list and CDN media URLs, while incomplete drafts, retired rows and internal fields/storage keys remain absent and indistinguishable from unknown.
- **EARS-6** _(realizes: US-4, US-11)_ — When an operator links an event and a project, the system shall create or restore one `event_projects` row, allow one event to have several projects, expose event→projects and project→events reads, and never modify the event or project lifecycle as a side effect.
- **EARS-7** _(realizes: US-3, US-8)_ — When an operator links an expert to an event, the system shall persist one `event_experts` row with required event-specific role, non-negative position and optional explicit `legacySpeakerId`; a supplied legacy id shall resolve to one retained speaker of that same event and be unique across retained expert links, and the command shall never infer a match from a name.
- **EARS-8** _(realizes: US-2, US-3, US-8, US-10)_ — When a public event speaker projection is read, the system shall merge active linked experts with active legacy rows using LD-2's total order: an eligible published expert supersedes only its explicitly matched legacy row, while unmatched rows and fallback for a draft/retired/unlinked expert remain; matching shall not overwrite, retire or name-deduplicate any legacy row.
- **EARS-9** _(realizes: US-1, US-2, US-11)_ — When an operator links an expert to a project, the system shall persist one `project_experts` row with `curator | member`, enforce at most one active curator, and expose project→experts and expert→projects reads with the role.
- **EARS-10** _(realizes: US-6, US-11, US-12)_ — When an operator links a partner to a project, the system shall persist one `project_partners` row and expose project→partners and partner→projects public reads using only partner title, logo URL and website URL; commercial/internal data shall never enter the projection.
- **EARS-11** _(realizes: US-5, US-11)_ — When an operator tags an event, the event form shall offer only existing non-retired topics, provide no inline creation, persist one `event_topics` row per pair, expose both directions, and leave `specialties[]` byte-for-byte unchanged.
- **EARS-12** _(realizes: US-10, US-11, US-12)_ — When a public caller reads taxonomy collections or either direction under `/v1/public`, the system shall query the same authored rows, apply published/active/non-deleted allow-lists at every hop, use opaque cursor pagination with `{ data, pagination: { nextCursor, hasMore } }`, return no duplicate pair, and never leak a draft, retired endpoint, inactive join or admin-only field.
- **EARS-13** _(realizes: US-7)_ — When an operator requests retirement of an entity or relationship, the admin shall first show `RetirementImpact` for the same current version and require confirmation; the server shall then set `retired` + `deleted_at` once, preserve every row/FK, change no related lifecycle state, and remove the target from default selectors/current public projections only by filtering.
- **EARS-14** _(realizes: US-7, US-8)_ — When an operator restores a retained entity or relationship, the system shall clear `deleted_at` and transition an entity to `draft` or a join to `active`; detail and explicit `includeRetired` reads address the same stable row, while defaults still exclude retained rows. No HTTP Delete route or Delete control shall exist.
- **EARS-15** _(realizes: US-9)_ — When an operator lists a taxonomy resource, the admin API and Refine table shall support bounded page/offset pagination, total, case-insensitive title/name/slug search and explicit status/`includeRetired` filters; retired entities shall not appear in new-link selectors, and empty results shall be a successful empty page.
- **EARS-16** _(realizes: US-1, US-2, US-3, US-4, US-5, US-6, US-7, US-8, US-9, US-12)_ — Admin reads/commands shall be `authenticated` / `platform_admin` (401 unauthenticated, 403 non-admin); public reads shall be `public`; validation/cursor errors shall be 400, unknown/non-public 404, duplicate pairs/slugs and invalid transitions 409, missing preconditions 428, and stale versions 412, as RFC 7807 Problem Details with stable `errorCode` and `traceId`.
- **EARS-17** _(realizes: US-7, US-10, US-11)_ — The system shall require `Idempotency-Key` on every mutation and replay the original result for the same actor/route/payload during its 24 h active window while rejecting reuse with another payload; expiry shall UPDATE that application-owned row to `expired` + `deleted_at` and retain it forever, never delete/reactivate/reuse it. Per LD-1, mutable rows expose version/ETag and mutate only when `If-Match` names the current version; every committed mutation receives feature 010 audit capture in the same transaction.
- **EARS-18** _(realizes: US-1, US-2, US-3, US-4, US-5, US-6, US-7, US-8, US-9)_ — Before any new or changed taxonomy/event-admin UI slice starts, the team shall complete Stage A: run `build-ui-from-design-system`, present 2–3 concrete Refine compositions and record the product-owner choice; implementation shall use `@ds/design-system` primitives with full states and no Delete UI, and the real result shall pass live-stand Playwright plus owner Stage-B confirmation before merge.

## Invariants

- No taxonomy entity, join or migrated legacy speaker row is physically deleted or cascade-deleted; stable ids/slugs/pairs are never reused.
- `retired ⇔ deleted_at IS NOT NULL`; entity restore always yields `draft`, join restore `active`.
- A public relationship is visible only when the join is active and every taxonomy endpoint is published and non-retired.
- A matched legacy speaker remains stored and unchanged; an explicit eligible mapping is the only suppression rule.
- `specialties[]` and topics are different axes and never synchronize.
- One authored Postgres row feeds admin and public projections; no export/sync/fake seam exists.
- Idempotency rows expire by retained lifecycle UPDATE and are never physically deleted or reused.

## Verification

| EARS  | Test type                                 | Indicative target                                                                  | Required proof                                                                                                                                           |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–5   | Vitest e2e + schema tests                 | one bounded entity-kind suite per EARS                                             | Each kind creates/edits independently; publish completeness (including eligible curator), allow-lists and draft/retired 404.                             |
| 6–11  | Vitest e2e + DB constraints               | one bounded join/projection suite per EARS                                         | Every join, both cardinalities, curator/legacy constraints, LD-2 ordering, topic isolation and no cascades.                                              |
| 12    | Vitest e2e + contract                     | `apps/api/test/taxonomy/public-reads.e2e-spec.ts`                                  | Both directions, cursor boundaries and filtering at every hop; allow-list snapshot.                                                                      |
| 13–14 | Vitest e2e + migration test               | `apps/api/test/taxonomy/lifecycle.e2e-spec.ts`                                     | Preview-before-confirm, retire/restore, explicit retained reads, restrictive FKs and absence of DELETE.                                                  |
| 15    | Vitest e2e + Playwright                   | `apps/api/test/taxonomy/admin-list.e2e-spec.ts`, `apps/admin/e2e/taxonomy.spec.ts` | Search/page/status/retained filters and selectors on the real API.                                                                                       |
| 16–17 | Vitest e2e                                | `apps/api/test/taxonomy/protocol.e2e-spec.ts`                                      | Authz, exact Problem Details, idempotent replay, key collision, 428/412 and audit rows.                                                                  |
| 18    | Playwright + axe + UI lint + owner record | `apps/admin/e2e/taxonomy.spec.ts`                                                  | Stage-A decision recorded first; create/link/retire/restore, reject+accept/error timing, keyboard states, both breakpoints/themes; live Stage-B verdict. |
| all   | Playwright BDD                            | `012-scenarios.feature`                                                            | Every EARS tag executes against the real Refine admin + NestJS/Postgres stack; no stub or seed-only acceptance.                                          |

## Dependencies and sequencing

- Feature 007 supplies the existing event form and legacy speaker projection; #1278 makes its speaker rows stably retained, and 012 adds explicit expert matching/current-projection behavior without breaking unmigrated events.
- GitHub [#1278](https://github.com/doctor-school/ds-platform/issues/1278) is the critical-path implementation prerequisite after this spec merges and before any new 012 entity: it owns current-table retained-row conformance, stable `event_speakers`, idempotency expiry and removal of existing cascade/delete paths. 012 consumes that runtime and does not duplicate it.
- Feature 010 supplies generic audit capture; every new taxonomy table must be attached to its coverage guard.
- 013–016 consume the public API only after this spec is on `main`; they own all doctor-facing rendering.
- EARS-18 Stage A is the first UI gate and blocks the UI portions of EARS-1…15; each entity kind and each join/projection remains its own bounded vertical slice rather than one four-entity CRUD issue.
