---
title: "Feature 012 — Content taxonomy (PRD)"
description: "Product requirements for the content taxonomy that binds the Academy's public surface: first-class projects, experts, topics and partners entities with m2m joins to events, an operator CRUD surface in the existing admin app (Refine), and a public read API the landing, catalogs and event pages consume. Feature 012 of the Academy public surface epic; source of the 012 EARS triplet (ADR-0014)."
slug: academy-public-012-content-taxonomy-product
epic: ../../product/academy-public/brief.md
status: In dev
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`012-product-ru.md`](./012-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · First on the epic's critical path — every other feature (013, 014, 015, 016) reads what 012 creates.

## Feature summary

The substrate of the whole epic. Today the academy's structure lives as free text on an event row: a speaker is a string, a project is a name someone re-types per broadcast, a topic is nothing at all, and a partner exists only in a contract outside the platform. Feature 012 turns that structure into **real entities the operator describes once and links to events** — `projects`, `experts`, `topics`, `partners` — plus the many-to-many joins that express how they actually relate (an event belongs to several projects; an expert appears on many events, in a role that differs per event; a partner sponsors a project).

Two deliverables sit in the same slice. The **operator CRUD surface** lands in the existing `admin` app (Refine, consistent with events in feature 007): the screens where a content editor creates a project, adds an expert, tags an event with topics and attaches a partner. The **public read API** exposes the same data to the portal so the landing feed, the projects and experts catalogs, the archived-event page and the `/webinars` filters all read one taxonomy instead of each inventing its own.

The corrected person model has one canonical speaker source. An Expert may exist without an account, or may be created from or explicitly linked to an existing User; one User can own at most one Expert. A speaker is only an ordered `event_experts` relationship carrying the event-specific role and position. Existing `event_speakers` rows are legacy input, never a second authoring or public-projection path: the single cutover release removes the legacy path first, and the Tech Lead then re-creates the sixteen production rows by hand on production with direct SQL statements taken from an owner-approved mapping table. Nothing matches by name.

Every entity and relationship in this feature follows the retained-row lifecycle fixed by ADR-0003 §3.6. Domain rows are never physically deleted and no relationship cascades away: entities move through `draft | published | retired` with `deleted_at`, joins through `active | retired` with `deleted_at`, and a restore is an explicit transition. Normal public reads serve only published, non-retired records; history and restore flows opt into retained rows deliberately.

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
- **US-2** — As a **content operator**, I maintain an Expert with separate family, given and optional patronymic names plus professional details and optional photo, so one derived display name/card appears consistently everywhere.
- **US-3** — As a **content operator**, I attach several experts to an event and state **each one's role on that event** (speaker, moderator, …), because the same person is a speaker at one broadcast and a moderator at the next.
- **US-4** — As a **content operator**, I link an event to one or more projects, because a broadcast genuinely can belong to two programs at once.
- **US-5** — As a **content operator**, I tag events with topics from a maintained list, so a doctor can browse the academy by subject rather than by date.
- **US-6** — As a **content operator**, I describe a partner once — title, logo, website — and attach it to the projects it sponsors, so the partner block on a project page is data, not hand-made markup.
- **US-7** — As a **content operator**, I retire or restore any of these entities without deleting its record or historical relationships, and I see the affected current public surfaces before I confirm the lifecycle transition.
- **US-8** — As the **Tech Lead**, I re-create each of the sixteen legacy speaker rows by hand with direct SQL statements on production after the cutover release, as ordered event-to-expert links built from the owner-approved mapping table, so that no migration machinery, queue or guessed identity ever stands between the legacy row and its canonical Expert.
- **US-9** — As a **content operator**, I find the entity I need quickly — a searchable, paginated list per entity kind — because the expert bench and the event archive both keep growing.
- **US-10** — As a **doctor**, the projects, experts and topics I see on the public pages are the same ones the operator maintains — there is no second, stale copy of the academy's structure.
- **US-11** — As a **product owner**, the platform can answer "which events belong to this project / this expert / this topic" and the reverse, so the catalogs and the `/webinars` filters of the later features are a query, not a new data model.
- **US-12** — As a **visitor**, nothing in the taxonomy leaks data that is not meant to be public — the public read API exposes published content only, while drafts and internal partner details stay in the admin.
- **US-13** — As a **content operator**, I can create an Expert without an account or create/link one from an existing User, while the system prevents one User from owning duplicate Experts.
- **US-14** — As a **content operator**, I edit family, given and patronymic names separately, never edit a system-owned slug, and copy the generated public link in one action.
- **US-15** — As a **content operator**, I can upload, replace and remove every authored entity image or file so an accidental or outdated value is reversible.
- **US-16** — As a **content operator**, I can attach every cross-link from either endpoint page, while one canonical relationship row remains the storage owner.
- **US-17** — As a **content operator**, every list is paginated and every search/filter applies immediately, with active chips and one Reset all action; controls with no possible effect are not actionable.
- **US-18** — As a **product owner**, I cut the platform over from `event_speakers` to `event_experts` in one release, after which the Tech Lead re-creates the sixteen rows by hand and I simply look at the live event cards, with no automatic name merge and no indefinite merged projection.

## Flows

**Describe a project and populate it (US-1, US-3, US-4, US-6):**

1. Operator opens the admin app → Projects → creates a project with its descriptive fields and links experts through `project_experts`, marking exactly one eligible expert as curator before publication.
2. Operator opens an event → links it to the project, and attaches experts, each with a role on that event.
3. Operator may attach several sponsoring partners to the project and designate at most one as the primary partner shown on project cards; neither a partner nor an event is required for publication.
4. When the project's required fields and curator are complete, the operator explicitly publishes it. Only then does the public read API serve the project with whichever eligible events, experts and partners are linked; portal surfaces (015, and the landing feed of 013) never expose its draft state.

**Maintain the expert bench (US-2, US-8, US-9):**

1. Operator opens Experts → searches the list → creates or edits an expert.
2. The operator may create the Expert without a User, select an existing User while creating it, or explicitly link an unlinked Expert and User later; duplicate User→Expert ownership is refused.
3. The operator maintains structured family/given/patronymic fields, uploads/replaces/removes the photo, and copies the generated public link without editing the slug.

**Topic tagging (US-5, US-11):**

1. Operator maintains a closed, curated topics list on its own admin surface; the event form selects existing topics and does not create them inline.
2. Operator tags events with topics; `specialties[]` on the event is untouched — it is the **audience** axis, a different dimension from topic, and the two are never merged.

**Migrate and cut over legacy speakers (US-8, US-18):**

1. Production holds sixteen legacy rows across eight events, so the migration is a one-off manual pass, not a machine. There is no review queue, no import artifact, no unmatched/ambiguous/duplicate classification, no cutover state record, no table trigger, no deploy rollback floor, no import script and no admin migration screen. Identity is decided by the Tech Lead — no name matching, no User or Expert inference and no generated suggestion establishes or proposes it.
2. The **cutover release** ships everything at once: ordered `event_experts` becomes the only speaker path, the canonical resolver reads it alone with no legacy merge branch and no legacy fallback, the free-text speakers field leaves the event create/update contract, every admin write seam and every public and admin read DTO, and one forward migration removes the objects of the withdrawn design — which production never received — together with the legacy join column, its foreign key, its unique index and the legacy table itself.
3. After that release is deployed the Tech Lead re-creates the sixteen rows by hand on production, working from a mapping table prepared from the legacy rows and approved by the Product Lead: direct SQL statements via `psql` on data-prod insert the missing Expert with structured names, an explicitly authored permanent public slug and an already-published state, plus one `event_experts` row per legacy row with the event-specific role and position. Both the slug and the published state are set by hand because a direct statement bypasses the server-side slug generator and the draft default, and without them the Expert would not render on the public event card at all. The admin Expert form is not the mechanism; the feature-010 row-level audit trigger still records the pass, because the session sets the acting Tech Lead and a `manual-dba` source, and the executed statements go into the deploy record. Duplicate legacy strings for the same person become one Expert, per-event regalia differences live in the link's role, an Expert already linked to another event is reusable, and only a duplicate retained event-to-Expert pair is refused. Until that pass is done the event cards render without speakers, which is accepted. Because the release ships a single migration, recovery below it is a roll forward or a database restore rather than an application-only rollback; `deploy:prod` snapshots the database before migrating.

**Branches:**

- **Retiring an entity or relationship that published content depends on** → the system previews the affected current surfaces and requires explicit confirmation. The row and every historical relationship remain stored; no cascade runs. A retired top-level entity leaves public listings and new selectors, while a relationship changes the current public projection only through its own explicit retire transition. The sole eligible curator of a published project cannot be retired or demoted; the operator first replaces that curator atomically or retires the project itself.
- **An entity with no linked public content yet** → it may still publish. A project may publish with zero events and zero partners when its fields and sole eligible curator are complete; an expert may publish with zero events and zero projects. Later doctor-facing features own how those empty related collections render.

## Product acceptance criteria

- `projects`, `experts`, `topics` and `partners` exist as **first-class entities with their own identity and their own admin screens** — never as string tags on an event.
- The authoring contract is explicit: Project has kind/title/description/optional cover; Expert has family/given/optional patronymic names, professional fields, optional User and photo; Topic and Partner have titles plus Partner optional logo/HTTPS website. Every slug is generated, never authored.
- Slugs are generated and owned by the system. No create/edit form or API accepts an operator-authored slug; admin detail provides **Copy public link**.
- The relationships are **m2m joins**: `event_projects`, `event_experts` (with per-event role and ordering), `project_experts` (with `curator | member` role), `project_partners` (many links, at most one active primary display partner per project), and `event_topics`.
- An event can belong to **several** projects, and an expert to **many** events — both directions are queryable.
- `specialties[]` on the event **stays untouched** as the audience axis; topics are a separate dimension and no data is moved between them.
- Speaker output is the ordered `event_experts` relation only. New free-text authoring is removed; the one cutover release removes the legacy field, its join column and the legacy table, after which the Tech Lead re-creates the sixteen legacy rows by hand through the existing admin surfaces — no name merging anywhere.
- Expert names are structured as family, given and optional patronymic fields. An Expert optionally links one User, and a unique User→Expert constraint prevents duplicate Expert ownership.
- Project cover, Expert photo and Partner logo controls support upload, replace and remove. Every cross-link is authored from either endpoint page while persisting one retained join row.
- Every admin list is paginated; text search and all filters apply immediately, active values render as chips, one Reset all clears them, and a no-op action is disabled or absent.
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
- Payload CMS (`apps/cms`) as the editing surface — a reserved slot for a future vertical (epic decision #11).
- Public-facing search across the taxonomy, and any recommendation or ranking logic.
- Access control beyond the platform's existing admin roles — 012 introduces no new role model.
- Expert self-service cabinet or account provisioning. The optional User↔Expert link is in scope, but it neither creates an account nor changes authentication roles.

## Confirmed product decisions

The Product Lead approved the base package in [#1240](https://github.com/doctor-school/ds-platform/issues/1240#issuecomment-5305116379) and separately approved the primary-partner addendum in [#1240](https://github.com/doctor-school/ds-platform/issues/1240#issuecomment-5307268480) on 2026-08-16. The retained-row lifecycle was approved on 2026-08-15. These are implementation inputs, not open questions:

- **Expert identity:** one editorial `expert` record may stand alone or optionally link one existing User; both creation paths converge on that record and one User cannot own duplicate Experts.
- **Lifecycle:** no domain row or relationship is physically deleted. Retire/restore uses lifecycle status + `deleted_at`; FKs are restrictive/no-action and cascades are forbidden.
- **Topics:** a closed operator-curated entity list; event authoring selects existing topics rather than creating strings inline.
- **Speaker migration:** `event_speakers` is legacy input only. One cutover release makes `event_experts` the only speaker path and drops the legacy join column and the legacy table in the same forward migration; the Tech Lead then re-creates those sixteen rows by hand as Experts and ordered `event_experts` links through the existing admin surfaces, never name-merging.
- **Project curator:** an expert linked through `project_experts` with role `curator`; other linked experts use `member`. A published project has exactly one eligible curator and replaces that curator atomically.
- **Fields and optionality:** Expert stores structured person fields and derives public `name`/initials; all four kinds have system-owned slugs; media remains optional and reversible.
- **Slugs and publication:** slugs are system-owned and never operator-editable; admin offers Copy public link. A project may publish without events or partners when its fields and curator are complete; an expert may publish without events or projects.
- **Partners on projects:** a project may have many partner links, but at most one active link is the primary display partner; public project entity/summary data exposes that partner or `null`, while relationship reads expose every eligible link.
- **API and access:** REST/OpenAPI under `/v1`; cursor pagination on public growing lists, explicit page/offset pagination for admin tables, bidirectional relationship reads, zero-auth published-only public reads, and existing `platform_admin` authorization for ordinary taxonomy admin routes. ADR-0009 erasure approval is a separate compliance workflow, not a taxonomy Delete action.
