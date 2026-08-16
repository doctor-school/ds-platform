---
title: "012 — Content taxonomy (Design)"
description: "Design for retained taxonomy entities and joins, explicit legacy-speaker matching and merged projection, Refine admin lifecycle management, bidirectional publish-safe REST reads, and the concurrency/idempotency protocol."
slug: 012-content-taxonomy-design
status: Draft
tracker: https://github.com/doctor-school/ds-platform/milestone/12
lang: en
---

# 012 — Content taxonomy (Design)

## 1. Architecture

012 is one vertical spanning `packages/db` (retained schema + migrations), `packages/schemas` (Zod/OpenAPI SSOT), `apps/api` (admin commands and public reads), generated `@ds/api-client`, and `apps/admin` (Refine resources plus event/project relationship editors). It extends the 007 event aggregate; it does not add a second content store and renders no doctor-facing page.

```mermaid
flowchart LR
  ADM[apps/admin — Refine taxonomy + event/project editors]
  APIA[apps/api /v1/admin — platform_admin]
  APIP[apps/api /v1/public — allow-listed reads]
  SCH[packages/schemas — Zod + OpenAPI]
  DB[(Postgres — entities, retained joins, event_speakers, audit_ledger)]
  S3[[Object storage/CDN — cover, photo, logo]]
  NEXT[013–016 portal consumers]

  ADM -->|commands, If-Match, Idempotency-Key| APIA
  APIA --> SCH
  APIP --> SCH
  APIA --> DB
  APIP --> DB
  APIA --> S3
  APIP -->|CDN URLs only| NEXT
  APIP --> NEXT
```

Every domain mutation runs inside feature 010's audit-context transaction. No taxonomy-specific audit table or history viewer is introduced.

## 2. Data model

```mermaid
erDiagram
  EVENTS ||--o{ EVENT_PROJECTS : has
  PROJECTS ||--o{ EVENT_PROJECTS : groups
  EVENTS ||--o{ EVENT_EXPERTS : presents
  EXPERTS ||--o{ EVENT_EXPERTS : participates
  EVENT_SPEAKERS ||--o| EVENT_EXPERTS : explicitly_matched_by
  PROJECTS ||--o{ PROJECT_EXPERTS : includes
  EXPERTS ||--o{ PROJECT_EXPERTS : belongs_to
  PROJECTS ||--o{ PROJECT_PARTNERS : sponsored_by
  PARTNERS ||--o{ PROJECT_PARTNERS : sponsors
  EVENTS ||--o{ EVENT_TOPICS : tagged_with
  TOPICS ||--o{ EVENT_TOPICS : classifies

  PROJECTS {
    uuid id PK
    text slug UK
    project_kind kind
    text title
    text description
    text cover_ref
    timestamptz first_published_at
    taxonomy_status status
    timestamptz deleted_at
    int version
  }
  EXPERTS {
    uuid id PK
    text slug UK
    text name
    text photo_ref
    text professional_role
    text credentials
    text affiliation
    text bio
    timestamptz first_published_at
    taxonomy_status status
    timestamptz deleted_at
    int version
  }
  TOPICS {
    uuid id PK
    text slug UK
    text title
    timestamptz first_published_at
    taxonomy_status status
    timestamptz deleted_at
    int version
  }
  PARTNERS {
    uuid id PK
    text slug UK
    text title
    text logo_ref
    text website_url
    timestamptz first_published_at
    taxonomy_status status
    timestamptz deleted_at
    int version
  }
  EVENT_EXPERTS {
    uuid id PK
    uuid event_id FK
    uuid expert_id FK
    text role
    int position
    uuid legacy_speaker_id FK
    relationship_status status
    timestamptz deleted_at
    int version
  }
  PROJECT_EXPERTS {
    uuid id PK
    uuid project_id FK
    uuid expert_id FK
    project_expert_role role
    relationship_status status
    timestamptz deleted_at
    int version
  }
```

The omitted joins use the same envelope: UUID id, their two endpoint FKs, `active | retired`, `deleted_at`, `version`, `created_at`, `updated_at`. All logical endpoint pairs are unique across active and retained rows: a previously retired relation is restored, never reinserted under a new id. `cover_ref`, `photo_ref`, `logo_ref`, `website_url` and `first_published_at` are nullable; publish-required draft fields may remain null only until publication.

### 2.1 Database constraints

- `taxonomy_status = draft | published | retired`; `relationship_status = active | retired`; `project_kind = school | media | program`; `project_expert_role = curator | member`.
- CHECK constraints bind lifecycle to deletion timestamp: top rows `(status = 'retired') = (deleted_at IS NOT NULL)`; joins and migrated speakers `(status = 'retired') = (deleted_at IS NOT NULL)`.
- Every FK is the default `NO ACTION` or explicit `RESTRICT`; no cascade appears in generated migration SQL.
- Unique `(project_id, expert_id)`, `(event_id, project_id)`, `(event_id, expert_id)`, `(project_id, partner_id)`, `(event_id, topic_id)` include retained rows. A partial unique index permits at most one active `project_experts(role='curator')` per project.
- Publishing a project additionally requires exactly one active curator whose expert is `published` and non-retired; drafts may be incomplete.
- A slug is unique per entity kind across retained rows and matches `[a-z0-9]+(?:-[a-z0-9]+)*`; `first_published_at` is nullable before publication and set by the first publish transaction. A migration-level `BEFORE UPDATE` guard permits only `NULL → timestamp` and rejects clearing or changing a non-null value, so application bugs cannot unlock the slug.
- `event_experts.legacy_speaker_id` is nullable and unique. A composite FK/constraint over `(event_id, legacy_speaker_id)` proves that the legacy row belongs to the same event.
- `version` starts at 1 and is incremented atomically by every successful update or lifecycle command.

### 2.2 Authoring fields and validation

The Zod schemas in `packages/schemas` encode the requirements matrix directly: project title 1–160, kind enum and description 1–2000; expert name 1–160, professional role 1–160, credentials 1–500, affiliation 1–240 and bio 1–4000; topic title 1–120; partner title 1–160 and optional absolute HTTPS website up to 2048. Display labels are required on create; the other required public fields may be null only on a draft. PATCH omission means unchanged, while explicit null is accepted only for optional fields or an incomplete draft field. Updates to a published row re-run the publish contract.

If create omits `slug`, the service generates it with one shared canonical lowercase-ASCII transliteration/slugification function that the admin preview also imports. A conflict with any retained slug of the same kind is 409 `SLUG_CONFLICT`; the service does not silently choose a different public identity. PATCH predicates slug updates on `first_published_at IS NULL`; otherwise it returns 409 `SLUG_IMMUTABLE`. First publish sets `first_published_at` and status atomically.

Media schemas accept optional JPEG/PNG/WebP, at most 10 MiB, decoded width and height at most 6000 px and total pixels at most 25 million, with no minimum dimensions. Validation decodes and verifies the actual binary rather than trusting filename or client MIME. Expert photo absence yields deterministic display initials derived from the normalized name. The admin mirrors these bounds for preflight, but API validation remains authoritative.

Input-mask declaration is `none` for every 012 field: each value is editorial text, a separately validated slug/URL/integer, or a file—not a fixed-format identifier—so a mask would fabricate or rewrite content rather than assist entry. Refine uses plain text/textarea controls with trim and character counters. Slug has generated preview plus pattern/length feedback, partner website uses a URL input, `event_experts.position` is integer step 1 from 0 through 32767, and its role is trimmed 1–80. Field validation is 400 `VALIDATION_FAILED`; a valid-shaped mutation that would leave a published projection incomplete is 409 `PUBLISH_REQUIREMENTS_NOT_MET` with field-addressed errors.

### 2.3 Existing-row conformance prerequisite (#1278)

The current 007 table is position-keyed and its editor replaces rows with delete-then-insert. GitHub [#1278](https://github.com/doctor-school/ds-platform/issues/1278) is the critical-path retained-row runtime prerequisite that owns conformance of current tables: stable retained `event_speakers`, idempotency rows and removal of existing cascade/delete paths. 012 does not duplicate that migration. Before any 012 entity implementation, #1278 must provide:

1. add/backfill stable UUID `id`, `status: active | retired`, `deleted_at`, `version` and timestamps;
2. retain uniqueness of `(event_id, position)` for the active authoring order;
3. replace the event FK cascade with `NO ACTION`/`RESTRICT`;
4. change the 007 DTO/editor reconciliation to carry row ids and retire/restore removed rows instead of deleting them;
5. attach feature 010's audit trigger and coverage entry.

The #1278 backfill changes no speaker text, ordering or current projection. 012 consumes the resulting stable `event_speakers.id`; creating an `event_experts` match never updates the matched row's name, regalia, status or `deleted_at`. If #1278 is not merged, EARS-7/8 are blocked—no positional-FK workaround is permitted.

## 3. Lifecycles

```mermaid
stateDiagram-v2
  [*] --> draft: create entity
  draft --> published: publish
  draft --> retired: retire after impact confirmation
  published --> retired: retire after impact confirmation
  retired --> draft: restore

  state JoinLifecycle {
    [*] --> active: create relation
    active --> retired: retire after impact confirmation
    retired --> active: restore
  }
```

Retiring a top-level entity leaves every join unchanged. Public traversal filters the endpoint and therefore hides it; restoring the entity to `draft` still does not publish it. Republish is deliberate. Retiring a join affects only that relationship. A restore reuses the same row/id and fails with 412 if the caller's version is stale. The only refusal overlay is the published-project curator invariant below: it blocks an invalidating mutation rather than changing another row implicitly.

### 3.1 Retirement preview

```mermaid
sequenceDiagram
  participant O as Operator
  participant A as Refine admin
  participant API as apps/api
  participant DB as Postgres
  O->>A: choose Retire
  A->>API: GET .../:id/retirement-impact
  API->>DB: read current row version + currently-public traversals
  API-->>A: RetirementImpact(version, affected ids)
  A-->>O: confirmation dialog (no Delete wording)
  O->>A: confirm
  A->>API: POST .../:id/retire + If-Match + Idempotency-Key
  API->>DB: atomic version check; status=retired, deleted_at=now(), version++
  DB-->>API: row + feature-010 audit record
  API-->>A: updated detail + ETag
```

If anything changed after preview, `If-Match` fails with 412 and the UI reloads the impact before it can ask again. This prevents confirmation against stale blast-radius data.

### 3.2 Published-project curator invariant

Every committed `published` project has exactly one active curator whose expert is `published` and non-retired. The partial unique index enforces the upper bound; publish, curator mutation and expert lifecycle services enforce the lower bound and eligibility while holding the project row lock. Directly retiring the curator expert, retiring the sole curator relation or changing its role to `member` returns 409 `PUBLISHED_PROJECT_REQUIRES_CURATOR` without any row, version, media or audit mutation.

`ReplaceProjectCurator(projectId, expertId)` is the only curator-change path while the project is published. With the project's `If-Match`, one transaction locks the project, verifies the replacement expert, creates/restores/promotes its retained `project_experts` row, demotes the former curator row to `member`, increments both affected relation versions and the project version, and writes the ordinary feature-010 audit rows. A concurrent replacement loses the project-version predicate with 412. Retiring the project itself is allowed and leaves joins untouched; restore yields `draft`, and a later publish revalidates curator eligibility.

As defense in depth, public project reads repeat the eligibility predicate and fail closed: an inconsistent imported or manually corrupted `published` project is omitted/404 and emits an operational error rather than leaking an invalid public projection.

## 4. Legacy speaker merge

The public projection is a query policy, not a migration job.

```mermaid
flowchart TD
  L[active retained legacy speaker rows]
  J[active event_experts rows]
  E[published, non-retired experts]
  M{join has explicit legacy_speaker_id and eligible expert?}
  X[suppress exactly that legacy row]
  K[keep legacy row]
  A[add eligible unpaired expert]
  S[sort by position, source rank expert→legacy, stable id]

  J --> E --> M
  L --> M
  M -->|yes| X --> S
  M -->|no match / expert not eligible| K --> S
  J -->|eligible, no legacy id| A --> S
```

Names are never compared. A draft or retired expert cannot suppress the fallback. Retiring the join makes the fallback visible again; restoring it suppresses the same stable legacy row again. The total order is `position ASC`, source rank (`expert` before `legacy`), stable row id ASC (LD-2). The additive public speaker DTO keeps `name` and `credentials` for legacy compatibility and may carry `expertId`, `expertSlug`, `photoUrl`, `role` for linked experts; internal storage keys and retained-row state are absent.

Position conflicts are rejected at write time: the active current projection must have one deterministic slot per visible row. A mapped expert may take the matched legacy row's position because that row is suppressed; an unpaired expert must use an unoccupied position.

## 5. HTTP surface

### 5.1 Admin entities and relationships

For each entity resource `{projects|experts|topics|partners}`:

| Method/path                                                      | Purpose                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------- |
| `GET /v1/admin/<resource>?page&pageSize&q&status&includeRetired` | Refine list; offset/page + total; defaults exclude retired. |
| `POST /v1/admin/<resource>`                                      | Create draft; multipart where a media file is present.      |
| `GET /v1/admin/<resource>/:id`                                   | Detail by stable id, including retired rows.                |
| `PATCH /v1/admin/<resource>/:id`                                 | Edit same row; `If-Match` required.                         |
| `POST /v1/admin/<resource>/:id/publish`                          | Draft → published.                                          |
| `GET /v1/admin/<resource>/:id/retirement-impact`                 | Preview current visible consequences.                       |
| `POST /v1/admin/<resource>/:id/retire`                           | Confirmed retire.                                           |
| `POST /v1/admin/<resource>/:id/restore`                          | Retired → draft.                                            |

Projects additionally expose `POST /v1/admin/projects/:id/replace-curator` with `{ expertId }`, project `If-Match` and `Idempotency-Key`; this is the atomic command from §3.2.

For `{event-projects|event-experts|project-experts|project-partners|event-topics}`, the same retained command pattern is exposed at `/v1/admin/<join>`: filtered list, POST create, PATCH attributes, GET retirement impact, POST retire, POST restore. There is no DELETE route. The Refine provider maps `deleteOne` to an unsupported operation rather than an HTTP call.

Create and edit use the same multipart envelope when that entity kind carries media: a canonical JSON `payload` plus at most one kind-specific `cover|photo|logo` file. PATCH without a file keeps the current reference; an explicit nullable media field clears it only when the entity's publish contract permits absence. A replacement always uses a fresh entity-scoped object key and never overwrites an existing object in place. The idempotency request hash includes canonical JSON plus the uploaded file's SHA-256 digest, so a different binary under the same scope/key is a 409 reuse conflict.

The failure order follows the existing feature-007 storage policy. Validation and idempotency ownership happen before upload; an object-storage failure makes no DB/audit mutation. After a successful fresh-key upload, the DB transaction rechecks `If-Match`, swaps the reference, writes audit, and completes the idempotency response atomically. A refused/failed transaction best-effort deletes the newly uploaded unreferenced object; after commit, the superseded object is best-effort deleted. Cleanup failure is warn-logged with the orphan key and never rolls back an already committed content mutation. Concurrent same-key/same-hash requests have one owner; others wait for or replay its stored result and never perform a second upload.

### 5.2 Public reads

- `GET /v1/public/{projects|experts|topics|partners}` and `/:idOrSlug` return cursor-paginated lists / one allow-listed projection.
- Entity allow-lists are exact: project `id, slug, kind, title, description, coverUrl`; expert `id, slug, name, professionalRole, credentials, affiliation, bio, photoUrl, initials`; topic `id, slug, title`; partner `id, slug, title, logoUrl, websiteUrl`. Optional URLs are nullable.
- Both directions of every join are concrete nested resources:
  - `/events/:key/projects` ↔ `/projects/:key/events`;
  - `/events/:key/experts` ↔ `/experts/:key/events`;
  - `/projects/:key/experts` ↔ `/experts/:key/projects`;
  - `/projects/:key/partners` ↔ `/partners/:key/projects`;
  - `/events/:key/topics` ↔ `/topics/:key/events`.
- `GET /v1/public/events/:key/speakers` returns the merged projection from §4 (and may be folded additively into the existing `PublicEventPage` DTO by the handler).

Each growing collection accepts bounded `limit` and opaque `cursor`, returns ADR-0002's exact envelope `{ data, pagination: { nextCursor, hasMore } }`, and orders by a stable tuple that ends in id. Public taxonomy search is deliberately absent. Event traversals reuse the existing public event eligibility policy rather than inventing another lifecycle.

### 5.3 Authorization and errors

Admin routes: `authenticated`, `required_roles: platform_admin`; public routes: `public`, no session variation. All DTOs live in `packages/schemas` and generate OpenAPI/client types.

| Status    | Stable reason                                                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400       | Zod/query/cursor/media validation (`VALIDATION_FAILED`, `MEDIA_INVALID`, `CURSOR_INVALID`).                                                                                                         |
| 401 / 403 | Missing admin session / missing `platform_admin`.                                                                                                                                                   |
| 404       | Unknown admin id, or unknown/non-public public resource (`RESOURCE_NOT_FOUND`, identical public body).                                                                                              |
| 409       | `SLUG_CONFLICT`, `SLUG_IMMUTABLE`, `PUBLISH_REQUIREMENTS_NOT_MET`, `PUBLISHED_PROJECT_REQUIRES_CURATOR`, duplicate pair, invalid transition, cross-event legacy match or occupied speaker position. |
| 412 / 428 | Stale `If-Match` / required precondition absent.                                                                                                                                                    |

Every error is `application/problem+json` with RFC 7807 fields plus `errorCode` and `traceId`; no database key or hidden lifecycle state leaks.

## 6. Idempotency, concurrency and audit

- Every mutation requires `Idempotency-Key`. Scope is authenticated actor + method + normalized route; Postgres stores request hash and completed response. The application-owned row stays `active` for the 24 h replay window, then expires by UPDATE to `status='expired'` + `deleted_at=now()`; it is retained forever and never TTL-deleted. During the active window, the same scope/key/hash replays the original status/body and another hash returns 409 `IDEMPOTENCY_KEY_REUSED`; an expired stable key is not reused or reactivated.
- Admin detail/mutation responses expose `ETag` derived from `version`. PATCH, relationship mutation and lifecycle commands require `If-Match`; the SQL update predicates on both id and version, increments version and returns 412 on zero rows caused by a race.
- Unique constraints remain the final race guard. A second relation insert cannot produce a duplicate even when requests arrive concurrently.
- Feature 010's `withAuditContext` and DB trigger wrap all mutations. Retained lifecycle actions therefore produce ordinary `data.<table>.update` history with actor/source; no duplicate manual audit writer is added.

## 7. Refine admin composition

The admin owns four resource lists/details/forms plus relationship editors embedded in the existing 007 event form and the project detail. Tables show status, search, page controls and an explicit “include retired” filter; selectors exclude retired rows; detail routes can open them for restore. Lifecycle actions are Publish, Retire and Restore. Delete is absent from navigation, action menus, provider and API.

EARS-18 Stage A is the first UI gate: before any entity or join UI slice, run `build-ui-from-design-system`, inventory the existing Refine/event patterns and `@ds/design-system`, search the approved registry whitelist, present 2–3 concrete compositions, and record the product-owner choice. Stage B drives the chosen real UI on the live stand before merge. All copy uses the typed RU catalog; primitives own focus/hover/active/disabled/loading states.

Implementation WBS stays vertical and bounded: project, expert, topic and partner each have their own schema→API→SDK→Refine→browser slice (EARS-1…4); `project_experts` (EARS-9) lands before publish/public projection (EARS-5), so the first project publication consumes a real eligible-curator relation; each remaining join/projection is its own EARS-6…8/10…11 slice. No “build all taxonomy CRUD” issue is acceptable, and none may start its UI portion before EARS-18 Stage A. EARS-16 auth/error classification and EARS-17 idempotency/concurrency/audit are acceptance criteria of every applicable slice as it lands. Their dedicated children are final completeness sweeps against the assembled real route set, not permission to retrofit safeguards later.

## 8. Verification strategy

- **DB/migration:** all four new entities and five joins satisfy lifecycle CHECKs, `first_published_at` set-once behavior, stable uniqueness and restrictive FKs; #1278 separately proves migrated current tables/speakers/idempotency and removal of pre-existing delete/cascade paths; audit-trigger coverage is green.
- **API e2e:** real Postgres and object storage; exact field/media bounds, generated and permanently locked slugs, complete/incomplete and zero-relation publication, atomic curator replacement plus every refusal branch, all relationship directions, public default-deny, cursor edges, search/offset, retire preview/confirm/restore, partial speaker migration, exact Problem Details, authz, idempotency and optimistic races. Tests use `it('EARS-N: ...')`.
- **Browser:** Playwright BDD on the live Refine app creates all kinds, exercises counters/previews/URL/integer/file controls without masks, links event/project/expert/topic/partner, replaces a curator, maps a legacy speaker, verifies reject and accept branches, retires/restores, and proves no Delete/inline-topic creation. Axe, keyboard state, desktop/mobile and light/dark checks accompany the Stage-B owner verdict.
- **No stub acceptance:** browser and API tests operate on committed schemas/migrations and generated SDK types, not seeds standing in for authoring or relationship endpoints.

## 9. Dependencies and sequencing

1. Merge this accepted SDD artifact and open/wire its bounded EARS Issues.
2. Complete [#1278](https://github.com/doctor-school/ds-platform/issues/1278) before any new 012 entity handler: it owns retained-row runtime conformance for current tables, including `event_speakers`, idempotency expiry and existing cascade/delete removal.
3. Complete EARS-18 Stage A before any EARS-1…15 UI work.
4. Deliver project → expert → topic → partner → `project_experts` → publication, then the remaining bounded relationship/projection verticals. Every applicable handler includes EARS-16/17 safeguards in its own PR; the dedicated EARS-16/17 work items verify the assembled route set rather than introducing those safeguards late.
5. Only after the complete 012 parent closes may 013–016 consume the public relationships.

The dependency is real, not a scaffold license: 012 keeps the observable legacy-speaker contract, but it must consume #1278's committed stable row identity and may not add a temporary positional mapping, hardcoded seed or duplicate migration.
