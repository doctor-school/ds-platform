---
title: "Feature 012 — Content taxonomy (PRD)"
description: "Product requirements for the content taxonomy that binds the Academy's public surface: first-class projects, experts, topics and partners entities with m2m joins to events, an operator CRUD surface in the existing admin app (Refine), and a public read API the landing, catalogs and event pages consume. Feature 012 of the Academy public surface epic; source of the 012 EARS triplet (ADR-0014)."
slug: academy-public-012-content-taxonomy-product
epic: ../../product/academy-public/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`012-product-ru.md`](./012-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · First on the epic's critical path — every other feature (013, 014, 015, 016) reads what 012 creates.

## Feature summary

The substrate of the whole epic. Today the academy's structure lives as free text on an event row: a speaker is a string, a project is a name someone re-types per broadcast, a topic is nothing at all, and a partner exists only in a contract outside the platform. Feature 012 turns that structure into **real entities the operator describes once and links to events** — `projects`, `experts`, `topics`, `partners` — plus the many-to-many joins that express how they actually relate (an event belongs to several projects; an expert appears on many events, in a role that differs per event; a partner sponsors a project).

Two deliverables sit in the same slice. The **operator CRUD surface** lands in the existing `admin` app (Refine, consistent with events in feature 007): the screens where a content editor creates a project, adds an expert, tags an event with topics and attaches a partner. The **public read API** exposes the same data to the portal so the landing feed, the projects and experts catalogs, the archived-event page and the `/webinars` filters all read one taxonomy instead of each inventing its own.

Free-text speakers do not break on the way. The existing `event_speakers` rows stay and keep rendering; an event gains linked `experts` gradually as the operator migrates it, and a partially migrated event is a normal state, not a defect. Linking a real expert records which legacy speaker entry it supersedes in the current projection; it neither overwrites nor retires that legacy row.

Every entity and relationship in this feature follows the retained-row lifecycle fixed by ADR-0003 §4. Domain rows are never physically deleted and no relationship cascades away: entities move through `draft | published | retired` with `deleted_at`, joins through `active | retired` with `deleted_at`, and a restore is an explicit transition. Normal public reads serve only published, non-retired records; history and restore flows opt into retained rows deliberately.

## Current platform → replacement delta

- **Current DS Platform:** feature 007 stores one event aggregate with `partner_ref`, `specialties[]`, and ordered free-text `event_speakers`; editing speakers replaces that ordered list wholesale. There are no project, expert, topic, or partner domain records to query.
- **Legacy source system:** the epic brief's mined prior art proves that projects, experts, partners, topics, and per-event roles are real business concepts, while also showing the cost of parallel expert types and boolean-scattered lifecycle.
- **Replacement in 012:** add first-class retained entities and retained m2m relationships beside the current event model, expose them through the existing NestJS/OpenAPI stack, and extend the existing Refine admin rather than creating a second backend or content copy.

## `surface:` classification and its rationale

**`surface: user-facing`** — stated, not silently picked.

The feature has two layers and F-22 resolves them together. The public read API is, on its own, a backend-only layer: it has no screen, and its correctness is verifiable by e2e tests alone. The **admin CRUD is a UI surface** — an operator opens a screen, fills forms, and gets a result — and F-22 is explicit that a UI surface in any trigger forbids `backend-only`. So the whole feature is `user-facing`, and its UI deliverable — the admin CRUD screens — ships in the same WBS as the entities and the API, never after them.

Two consequences the downstream EARS spec inherits:

- The **operator is the user** of this feature's UI. There is no doctor-facing screen in 012; the doctor-facing surfaces are 013/014/015/016, which consume the API. A reviewer must not expect a public page here.
- The **design-approval gate applies to the admin screens**, at the weight of an internal operator tool: they are built from `@ds/design-system` and the Refine patterns feature 007 already established, and they are re-confirmed live before merge like any other user-facing surface.

## User stories

- **US-1** — As a **content operator**, I create a project once — kind (`school | media | program`), title, description, optional cover and curator — and reuse it across every event that belongs to it, instead of re-typing its name per broadcast.
- **US-2** — As a **content operator**, I maintain an expert as a real person — name, professional role, credentials, affiliation, bio and optional photo — so the same expert card appears identically on every event, project and catalog page where they show up.
- **US-3** — As a **content operator**, I attach several experts to an event and state **each one's role on that event** (speaker, moderator, …), because the same person is a speaker at one broadcast and a moderator at the next.
- **US-4** — As a **content operator**, I link an event to one or more projects, because a broadcast genuinely can belong to two programs at once.
- **US-5** — As a **content operator**, I tag events with topics from a maintained list, so a doctor can browse the academy by subject rather than by date.
- **US-6** — As a **content operator**, I describe a partner once — title, logo, website — and attach it to the projects it sponsors, so the partner block on a project page is data, not hand-made markup.
- **US-7** — As a **content operator**, I retire or restore any of these entities without deleting its record or historical relationships, and I see the affected current public surfaces before I confirm the lifecycle transition.
- **US-8** — As a **content operator**, the events whose speakers are still free text keep working exactly as before, and I can migrate them to real experts one at a time, on my own schedule.
- **US-9** — As a **content operator**, I find the entity I need quickly — a searchable, paginated list per entity kind — because the expert bench and the event archive both keep growing.
- **US-10** — As a **doctor**, the projects, experts and topics I see on the public pages are the same ones the operator maintains — there is no second, stale copy of the academy's structure.
- **US-11** — As a **product owner**, the platform can answer "which events belong to this project / this expert / this topic" and the reverse, so the catalogs and the `/webinars` filters of the later features are a query, not a new data model.
- **US-12** — As a **visitor**, nothing in the taxonomy leaks data that is not meant to be public — the public read API exposes published content only, while drafts and internal partner details stay in the admin.

## Flows

**Describe a project and populate it (US-1, US-3, US-4, US-6):**

1. Operator opens the admin app → Projects → creates a project with its descriptive fields and links experts through `project_experts`, marking exactly one eligible expert as curator before publication.
2. Operator opens an event → links it to the project, and attaches experts, each with a role on that event.
3. Operator may attach several sponsoring partners to the project and designate at most one as the primary partner shown on project cards; neither a partner nor an event is required for publication.
4. When the project's required fields and curator are complete, the operator explicitly publishes it. Only then does the public read API serve the project with whichever eligible events, experts and partners are linked; portal surfaces (015, and the landing feed of 013) never expose its draft state.

**Maintain the expert bench (US-2, US-8, US-9):**

1. Operator opens Experts → searches the list → creates or edits an expert.
2. On an event that still carries free-text speakers, the operator links the matching expert to the specific legacy speaker entry. The public speaker projection merges linked experts with the remaining unmatched legacy entries in one ordered list; it does not name-dedupe automatically, overwrite the legacy row, or wait for the whole event to be migrated.
3. Migrated and unmigrated events coexist in the same listing, and the doctor sees no difference in quality on the public page.

**Topic tagging (US-5, US-11):**

1. Operator maintains a closed, curated topics list on its own admin surface; the event form selects existing topics and does not create them inline.
2. Operator tags events with topics; `specialties[]` on the event is untouched — it is the **audience** axis, a different dimension from topic, and the two are never merged.

**Branches:**

- **Retiring an entity or relationship that published content depends on** → the system previews the affected current surfaces and requires explicit confirmation. The row and every historical relationship remain stored; no cascade runs. A retired top-level entity leaves public listings and new selectors, while a relationship changes the current public projection only through its own explicit retire transition. The sole eligible curator of a published project cannot be retired or demoted; the operator first replaces that curator atomically or retires the project itself.
- **An entity with no linked public content yet** → it may still publish. A project may publish with zero events and zero partners when its fields and sole eligible curator are complete; an expert may publish with zero events and zero projects. Later doctor-facing features own how those empty related collections render.

## Product acceptance criteria

- `projects`, `experts`, `topics` and `partners` exist as **first-class entities with their own identity and their own admin screens** — never as string tags on an event.
- The authoring contract is explicit: a project has kind `school | media | program`, title, slug and description plus optional cover; an expert has name, slug, professional role, credentials, affiliation and bio plus optional photo; a topic has title and slug; a partner has title and slug plus optional logo and HTTPS website.
- Slugs are generated from the display name on create, may be edited until first publication, and become permanently immutable after that first publication, including after retirement and restore.
- The relationships are **m2m joins**: `event_projects`, `event_experts` (with per-event role and ordering), `project_experts` (with `curator | member` role), `project_partners` (many links, at most one active primary display partner per project), and `event_topics`.
- An event can belong to **several** projects, and an expert to **many** events — both directions are queryable.
- `specialties[]` on the event **stays untouched** as the audience axis; topics are a separate dimension and no data is moved between them.
- The existing free-text `event_speakers` keeps rendering as before, and **an event may be partially migrated** to linked experts without any visible degradation to the doctor. A linked expert supersedes only its explicitly matched legacy entry in the current projection; the retained legacy row remains available to history/restore flows.
- Every entity has complete lifecycle management in the `admin` app: create, read, list with search and pagination, edit, retire, and restore. There is **no hard-delete action** and no cascade; retire and restore each surface the affected current public projections, and confirmation must be refreshed if that footprint changes before the transition commits.
- Every top-level taxonomy row carries `status: draft | published | retired` plus nullable `deleted_at`; every relationship that can be retired carries `status: active | retired` plus nullable `deleted_at`. Restoring an ordinarily retired entity returns it to `draft`, so public re-publication is always deliberate. A separately approved legal PD-erasure process is irreversible and leaves the retained row non-restorable; it is not an ordinary lifecycle transition.
- Publication validates the kind-specific required fields. Only a project has a relationship prerequisite: exactly one active curator whose expert is published and non-retired. Projects need no events or partners; experts, topics and partners need no relationships. Optional media and partner website never block publication, and an expert without a photo uses an initials fallback.
- A published project always retains exactly one eligible curator. Replacing that curator is one atomic operation; retiring the curator expert or retiring/demoting the sole curator link is refused until a replacement is committed or the project itself is retired.
- The admin screens are built from the design system and the Refine conventions established by feature 007 — no bespoke admin styling, no hand-assembled controls.
- A **public read API** exposes the taxonomy and its links to the portal, serving **published content only**; internal partner detail (commercial terms, contacts) is never on the public read path.
- The data the public API serves and the data the operator maintains are the **same records** — no second copy, no sync step, no manual export.
- The API answers both directions of every relationship (events of a project / projects of an event, and the same for experts and topics), because 013's feed and 014/015/016's listings are queries against it. Public lists use the ADR-0002 cursor contract; admin lists may use explicit page/offset pagination.
- Nothing in this feature changes the doctor-facing pages themselves — 012 makes them possible, the later features build them.

## Out of scope

- The public pages that consume the taxonomy — the landing (013), the archived-event state (014), `/projects` (015), `/experts` (016). 012 delivers the entities, the admin and the API only.
- `event_recordings` and the `leads` table — they belong to 014 and 013 respectively, though they sit in the same epic data model.
- Partner **commercial** mechanics from the legacy system — sponsorship sums, contracts, paid flags, promo codes. The partner entity here is descriptive (title, logo, website, link to sponsored projects); the sponsor-package machinery is not in this epic.
- A bulk migration of every historical event's free-text speakers into `experts` — the migration is operator-driven and gradual by owner decision.
- Payload CMS (`apps/cms`) as the editing surface — a reserved slot for a future vertical (epic decision #11).
- Public-facing search across the taxonomy, and any recommendation or ranking logic.
- Access control beyond the platform's existing admin roles — 012 introduces no new role model.
- Turning an expert into a login identity or adding an expert self-service cabinet. An `expert` is an editorial domain record in 012; a future optional link to a platform user is additive and must not create a second expert type.

## Confirmed product decisions

The Product Lead approved the complete package in [#1240](https://github.com/doctor-school/ds-platform/issues/1240#issuecomment-5305116379) on 2026-08-16. The retained-row lifecycle was approved on 2026-08-15. These are implementation inputs, not open questions:

- **Expert identity:** one standalone editorial `expert` record. A future optional platform-user link is additive and out of scope; there is never a parallel supplier/person type.
- **Lifecycle:** no domain row or relationship is physically deleted. Retire/restore uses lifecycle status + `deleted_at`; FKs are restrictive/no-action and cascades are forbidden.
- **Topics:** a closed operator-curated entity list; event authoring selects existing topics rather than creating strings inline.
- **Speaker migration:** the legacy rows stay indefinitely as retained source data. The current projection merges linked experts with unmatched legacy entries; no bulk replacement, implicit dedupe or automatic end-state is required.
- **Project curator:** an expert linked through `project_experts` with role `curator`; other linked experts use `member`. A published project has exactly one eligible curator and replaces that curator atomically.
- **Fields and optionality:** project = kind/title/slug/description + optional cover; expert = name/slug/professional role/credentials/affiliation/bio + optional photo; topic = title/slug; partner = title/slug + optional logo/website.
- **Slugs and publication:** slugs are generated on create, editable until first publication and immutable thereafter. A project may publish without events or partners when its fields and curator are complete; an expert may publish without events or projects.
- **Partners on projects:** a project may have many partner links, but at most one active link is the primary display partner; public project entity/summary data exposes that partner or `null`, while relationship reads expose every eligible link.
- **API and access:** REST/OpenAPI under `/v1`; cursor pagination on public growing lists, explicit page/offset pagination for admin tables, bidirectional relationship reads, zero-auth published-only public reads, and existing `platform_admin` authorization for ordinary taxonomy admin routes. ADR-0009 erasure approval is a separate compliance workflow, not a taxonomy Delete action.
