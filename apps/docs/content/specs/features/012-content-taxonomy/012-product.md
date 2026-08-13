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

Free-text speakers do not break on the way. The existing `event_speakers` text stays and keeps rendering; an event gains linked `experts` gradually as the operator migrates it, and a partially migrated event is a normal state, not a defect.

## `surface:` classification and its rationale

**`surface: user-facing`** — stated, not silently picked.

The feature has two layers and F-22 resolves them together. The public read API is, on its own, a backend-only layer: it has no screen, and its correctness is verifiable by e2e tests alone. The **admin CRUD is a UI surface** — an operator opens a screen, fills forms, and gets a result — and F-22 is explicit that a UI surface in any trigger forbids `backend-only`. So the whole feature is `user-facing`, and its UI deliverable — the admin CRUD screens — ships in the same WBS as the entities and the API, never after them.

Two consequences the downstream EARS spec inherits:

- The **operator is the user** of this feature's UI. There is no doctor-facing screen in 012; the doctor-facing surfaces are 013/014/015/016, which consume the API. A reviewer must not expect a public page here.
- The **design-approval gate applies to the admin screens**, at the weight of an internal operator tool: they are built from `@ds/design-system` and the Refine patterns feature 007 already established, and they are re-confirmed live before merge like any other user-facing surface.

## User stories

- **US-1** — As a **content operator**, I create a project once — title, description, cover, curator — and reuse it across every event that belongs to it, instead of re-typing its name per broadcast.
- **US-2** — As a **content operator**, I maintain an expert as a real person — name, photo, credentials, bio — so the same expert card appears identically on every event, project and catalog page where they show up.
- **US-3** — As a **content operator**, I attach several experts to an event and state **each one's role on that event** (speaker, moderator, …), because the same person is a speaker at one broadcast and a moderator at the next.
- **US-4** — As a **content operator**, I link an event to one or more projects, because a broadcast genuinely can belong to two programs at once.
- **US-5** — As a **content operator**, I tag events with topics from a maintained list, so a doctor can browse the academy by subject rather than by date.
- **US-6** — As a **content operator**, I describe a partner once — title, logo, website — and attach it to the projects it sponsors, so the partner block on a project page is data, not hand-made markup.
- **US-7** — As a **content operator**, I edit or retire any of these entities without breaking the events already linked to them, and I am told what a change affects before it is destructive.
- **US-8** — As a **content operator**, the events whose speakers are still free text keep working exactly as before, and I can migrate them to real experts one at a time, on my own schedule.
- **US-9** — As a **content operator**, I find the entity I need quickly — a searchable, paginated list per entity kind — because the expert bench and the event archive both keep growing.
- **US-10** — As a **doctor**, the projects, experts and topics I see on the public pages are the same ones the operator maintains — there is no second, stale copy of the academy's structure.
- **US-11** — As a **product owner**, the platform can answer "which events belong to this project / this expert / this topic" and the reverse, so the catalogs and the `/webinars` filters of the later features are a query, not a new data model.
- **US-12** — As a **visitor**, nothing in the taxonomy leaks data that is not meant to be public — the public read API exposes published content only, while drafts and internal partner details stay in the admin.

## Flows

**Describe a project and populate it (US-1, US-3, US-4, US-6):**

1. Operator opens the admin app → Projects → creates a project with its descriptive fields and curator.
2. Operator opens an event → links it to the project, and attaches experts, each with a role on that event.
3. Operator attaches the sponsoring partner to the project.
4. The public read API immediately serves the project with its events, experts and partner; the portal surfaces (015, and the landing feed of 013) render it without a further step.

**Maintain the expert bench (US-2, US-8, US-9):**

1. Operator opens Experts → searches the list → creates or edits an expert.
2. On an event that still carries free-text speakers, the operator links the matching expert; the free-text value stays as the fallback until every speaker of that event is linked. _(agent-proposed — UNCONFIRMED: the owner approved "gradual migration with the fallback retained", not the per-event mechanics of the fallback's disappearance.)_
3. Migrated and unmigrated events coexist in the same listing, and the doctor sees no difference in quality on the public page.

**Topic tagging (US-5, US-11):**

1. Operator maintains the topics list as its own small entity.
2. Operator tags events with topics; `specialties[]` on the event is untouched — it is the **audience** axis, a different dimension from topic, and the two are never merged.

**Branches:**

- **Deleting an entity that events depend on** → the operator is warned with what the change affects, and the destructive path is either blocked or explicitly confirmed; a link never silently vanishes from a published event. _(agent-proposed — UNCONFIRMED: the owner approved the entities, not the deletion policy.)_
- **An entity with no public content yet** (a project with zero published events) → it exists in the admin, and its behavior on the public surface belongs to 015/016, not here.

## Product acceptance criteria

- `projects`, `experts`, `topics` and `partners` exist as **first-class entities with their own identity and their own admin screens** — never as string tags on an event.
- The relationships are **m2m joins**, and the event↔expert join carries the person's **role on that event**: `event_projects`, `event_experts` (with role), `project_partners`, `event_topics`.
- An event can belong to **several** projects, and an expert to **many** events — both directions are queryable.
- `specialties[]` on the event **stays untouched** as the audience axis; topics are a separate dimension and no data is moved between them.
- The existing free-text `event_speakers` keeps rendering as before, and **an event may be partially migrated** to linked experts without any visible degradation to the doctor.
- Every entity has a **complete CRUD** in the `admin` app: create, read, list with search and pagination, edit, and a safe retire/delete path that surfaces what a change affects.
- The admin screens are built from the design system and the Refine conventions established by feature 007 — no bespoke admin styling, no hand-assembled controls.
- A **public read API** exposes the taxonomy and its links to the portal, serving **published content only**; internal partner detail (commercial terms, contacts) is never on the public read path.
- The data the public API serves and the data the operator maintains are the **same records** — no second copy, no sync step, no manual export.
- The API answers both directions of every relationship (events of a project / projects of an event, and the same for experts and topics), because 013's feed and 014/015/016's listings are queries against it.
- Nothing in this feature changes the doctor-facing pages themselves — 012 makes them possible, the later features build them.

## Out of scope

- The public pages that consume the taxonomy — the landing (013), the archived-event state (014), `/projects` (015), `/experts` (016). 012 delivers the entities, the admin and the API only.
- `event_recordings` and the `leads` table — they belong to 014 and 013 respectively, though they sit in the same epic data model.
- Partner **commercial** mechanics from the legacy system — sponsorship sums, contracts, paid flags, promo codes. The partner entity here is descriptive (title, logo, website, link to sponsored projects); the sponsor-package machinery is not in this epic.
- A bulk migration of every historical event's free-text speakers into `experts` — the migration is operator-driven and gradual by owner decision.
- Payload CMS (`apps/cms`) as the editing surface — a reserved slot for a future vertical (epic decision #11).
- Public-facing search across the taxonomy, and any recommendation or ranking logic.
- Access control beyond the platform's existing admin roles — 012 introduces no new role model. _(agent-proposed — UNCONFIRMED as an exclusion.)_

## Open questions

- **Expert identity vs. platform user.** Whether an `expert` is a standalone record or may be tied to a registered user account (the legacy system carried both a supplier type and a display card) is unresolved; the PRD requires one entity with a per-event role, not two.
- **Deletion policy.** What happens to an entity that published events depend on — blocked, soft-retired, or confirmed-cascade — is agent-proposed above and needs an owner call.
- **Topics list ownership.** Whether topics are a closed operator-curated list or can be created inline while tagging an event.
- **Free-text speaker fallback end-state.** When and how the `event_speakers` text finally disappears from a fully migrated event.
- **Curator vs. expert.** Whether a project's curator is an `expert` in a curator role or a separate field.
- **Public API shape and consumers' pagination needs** — driven by 013/015/016, which are specified after this PRD.
