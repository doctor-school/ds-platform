---
title: "Academy public surface epic — product brief"
description: "Thin product brief for the Academy public surface epic: a lead-generating academy home page at /, a projects catalog, an experts catalog, a login-gated recordings archive, and the content taxonomy that binds them. JTBD, cross-cutting information architecture, feature decomposition (012–016), success metrics, and condensed prior art from the legacy Bubble system. Source layer for the per-feature PRDs and their EARS triplets (ADR-0014)."
slug: academy-public-brief
milestone: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1240
status: Draft
features:
  - 012-content-taxonomy
  - 013-academy-home
  - 014-event-recordings
  - 015-projects-catalog
  - 016-experts-catalog
lang: en
---

> **EN (this)** · **RU:** [`brief-ru.md`](./brief-ru.md)

> **Scope (owner decisions, brainstorm 2026-08-13).** This epic covers the **public surface of the Academy portal**: the home page at `/`, the projects and experts catalogs, the recordings archive for past events, and the first-class content taxonomy behind them. Payload CMS bootstrap, paid tiers, congress/offline verticals, and notification delivery are **explicitly out**. Decisions are persisted on the epic tracker [#1240](https://github.com/doctor-school/ds-platform/issues/1240) until this brief merges.

---

## Problem

- The platform has **no public front door**. `/` permanently redirects to `/webinars`, so a visitor who is not already a registered doctor sees a bare event listing and no reason to care about Doctor.School.
- **Partners have nowhere to land and nothing to convert on.** Sponsorship demand is the funding source for free doctor education, yet there is no page that explains the offer and no way to leave a request — inbound partner interest is lost or handled entirely off-platform.
- **Content is invisible outside a single event link.** Everything the academy has built — recurring projects, the expert bench, the topic coverage — is either free text on an event row or nowhere at all, so a doctor cannot browse by project, expert, or topic, and a partner cannot see the scale of what they'd be funding.
- **Past events evaporate.** Once an event ends, its page offers a dead end: no recording, nothing that turns an archive of dozens of broadcasts into a standing reason to register.
- The legacy Bubble system carried these surfaces (projects, speakers, partners, topic tags) on a schema that also proves the mistakes to avoid — see Prior art.

## Jobs-to-be-done

- **Doctor (guest, first contact):** land on the academy, understand within a minute what it is and whether it is for me, and get to a relevant broadcast, project, or expert without registering first.
- **Doctor (registered):** browse the academy's content by project, expert, and topic; watch the recording of a broadcast I missed.
- **Pharma partner / sponsor:** understand what the academy is, who stands behind it, what participation formats exist and what I get — then leave a request in one short form and be contacted.
- **Doctor.School commercial team:** receive every partner request immediately in the working channel («DS Лиды») with it also persisted on the platform, so nothing depends on someone watching an inbox.
- **Operator / content editor:** describe projects, experts, topics, and partners once as real entities and link them to events, instead of re-typing free-text speaker names per event.

## Cross-cutting information architecture

- **The home page is a dual entry point** — the single owner-load-bearing decision of this epic. Owner verbatim: «Если не будет врачей, то партнёрам будет не интересно. Если не будет партнёров, то мы не сможем предоставить для врачей бесплатное образование. Кто попадёт на главную — мы не знаем, но это входная точка для обоих.» Every screen of `/` serves one of the two flows: doctor → content (эфиры / projects / experts), partner → lead form.
- **The landing takes `/`** (supersedes the 2026-07-17 verdict that `/` redirects to `/webinars`). `/webinars` remains the canonical discovery listing. After login the doctor is returned to the page they tried to consume, with `/webinars` as the landing only when there is no return target (owner rule 2026-08-17, [#1326](https://github.com/doctor-school/ds-platform/issues/1326)) — and that outcome **must be re-implemented, not inherited**. The `/` → `/webinars` redirect is already gone in production (`apps/portal/app/page.tsx` serves the interim stub) while the login default is still `/`, so the regression is live today; feature 008's EARS-7 still pins that target to `/`. Feature 013 therefore re-points the login default and every shipped assertion pinning it, and records the change as an **amendment** of 008 (008 is live in production, so no inline rewrite) — 013 EARS-15, an independently shippable fix that does not wait for the landing build. The landing is an entry point for visitors, never a trap for authenticated users.
- **Route map:** `/` (landing) · `/webinars` (+ filters by project / expert / topic + a «Прошедшие» tab) · `/webinars/[slug]` (**one event page for every context** — pre-live announce+register, post-live recording) · `/projects`, `/projects/[slug]` · `/experts`, `/experts/[slug]` · `/account/events` gains recordings (covers the scope of [#1188](https://github.com/doctor-school/ds-platform/issues/1188)).
- **Data model: first-class entities + m2m joins, never string tags.** `projects`, `experts`, `partners`, `topics`, plus joins `event_projects`, `event_experts` (carrying the person's **role** on that event), `project_experts` (`curator | member`), `project_partners`, `event_topics`, `event_recordings` (`kind: edited | raw`), and `leads`. An event may belong to several projects; an expert to many events and projects. Existing free-text `event_speakers` migrates into `experts` gradually with the unmatched free-text fallback retained. Every domain entity and relationship is retained-row only: lifecycle status + `deleted_at`, no physical delete or domain cascade (ADR-0003 §4). `specialties[]` on events **stays** — it is the audience axis, a separate dimension from topic.
- **Public readability, gated playback.** A past-event page is publicly readable (announcement, speakers, description); the **recording player renders for authenticated users only** — the archive is deliberately a doctor-registration driver.
- **Recording display rule.** While only a `raw` recording exists it plays in the main player; once an `edited` one appears, edited takes the main player and raw moves to a secondary slot behind a «Смотреть оригинал трансляции» affordance. The presentation of that affordance is Stage-A territory.
- **The event list is one reusable design-system unit.** Event card + list + filters + pagination are single components reused on `/webinars`, the project page, the expert page, the «Прошедшие» tab, and the home-page feed — one place to change, applied everywhere.
- **Content editing lands in the existing `admin` app** (Refine), consistent with events (feature 007). `apps/cms` (Payload) stays a reserved slot for a future vertical.
- **Lead capture is dual-sink:** a submission persists to `leads` in our Postgres **and** posts to the Mattermost channel «DS Лиды». The DB is the record of truth; the channel is the working notification.

## Feature decomposition

Five features, numbered from 012. All five PRDs are authored (013 first, per owner priority) and linked below.

| #   | Feature                                                                  | One-liner                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 012 | [`content-taxonomy`](../../features/012-content-taxonomy/012-product.md) | `projects` / `experts` / `topics` / `partners` entities + m2m joins + admin CRUD + public read API — the substrate every other feature reads.                                                                         |
| 013 | [`academy-home`](../../features/013-academy-home/013-product.md)         | The landing at `/`: 8-screen dual-audience structure + live feed of latest эфиры + lead capture → `leads` + Mattermost «DS Лиды».                                                                                     |
| 014 | [`event-recordings`](../../features/014-event-recordings/014-product.md) | `event_recordings` (edited / raw), the archived-event page state, the login-gated player, and recordings in «Мои события» — covers [#1188](https://github.com/doctor-school/ds-platform/issues/1188) / Plane DSP-229. |
| 015 | [`projects-catalog`](../../features/015-projects-catalog/015-product.md) | `/projects` and the project page with its events.                                                                                                                                                                     |
| 016 | [`experts-catalog`](../../features/016-experts-catalog/016-product.md)   | `/experts` and the expert page with their events.                                                                                                                                                                     |

Webinars-listing filters/facets and the «Прошедшие» tab are not a separate feature: they belong to **014**. The owner delegated the UX call to the lead on 2026-08-13 and the lead assigned them to 014 — archive discoverability ships with the archive, since the tab is the registration driver's front door and the accumulated archive is the facets' primary value case; the shared event-list unit gains its filter capability there, and 015/016 consume it ready-made. The 014 PRD records the decision and its full reasoning.

**Critical path:** 012 → **013** (owner priority #1) → 014 (Plane DSP-229 target 2026-08-21) → 015 → 016.

**Tracked deferral on the critical path.** 013 ships before 015/016, so the landing's links to the projects and experts sections point at surfaces that do not exist yet. This is an accepted, tracked sequencing deferral, not a silent stub: 013 owns the deferral explicitly (its PRD names how those entry points behave until 015/016 land), and it closes when 015/016 ship. Stage-A design work for all pages of the epic runs in parallel with 012; the Claude Design prompt package covering **every public page of the epic** — a shared UX foundation (cross-surface navigation, six reusable units) plus per-page sections for `/`, projects, experts, the archived-event state, and the `/webinars` refinement — lives at [`design-brief-academy-public-ru.md`](./design-brief-academy-public-ru.md) (owner-facing RU).

## Success metrics

- `/` serves both flows measurably: a visitor arriving cold reaches either a content surface (event / project / expert page) or the lead form — bounce without either is the failure mode to watch.
- **Partner requests arrive through the platform**: submissions land in `leads` and appear in «DS Лиды» with no manual step; the count of inbound partner requests handled off-platform trends to zero.
- **Content becomes browsable**: every published event is reachable by at least one of project / expert / topic, not only by direct link.
- **The archive drives registration**: past-event pages produce registrations from visitors who came for a recording.
- Doctors who missed a broadcast can watch it — recordings are available for past events rather than being a dead end.

## Prior art — source system

The legacy Doctor.School system (Bubble + Directual) was mined read-only on **2026-08-13** for the projects / experts / partners / topics domain; the webinar-domain mining (2026-07-02) is not repeated here — it lives in [`../webinars/legacy-recon.md`](../webinars/legacy-recon.md). Everything below is a **look-and-take-the-domain reference, never a target schema** (ADR-0014 §3).

| Legacy type            | What it carried                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project`              | Title, description, logo, leader (curator), teachers/speakers lists, cities, specialties, school; owns a list of events and a list of partners.                                                                              |
| `event`                | A ~130-field aggregate — belongs-to project, dates, city, format online/offline, price, NMO/CME fields, `report_photos` / `report_videos` (post-event materials), program blocks.                                            |
| `speakers` / `expert`  | **Two parallel types** — suppliers-with-requisites vs. display cards; per-event linkage through the join `event_people` (event × user × role via the `event_role` lookup: спикер / модератор, plus project and `showInTop`). |
| `partner`              | Title, tradename, logo, website, requisites; sponsorship expressed through the join `partners_project` (partner × project × event, sum, paid, contract, promo codes) — the sponsor-package mechanics.                        |
| `specialties` / cities | Topic tags m2m via `eventspecialties`; city m2m via `city_event`; precomputed date-filter facets denormalised onto the event (`filterDay` / `filterMonth` / `filterYear`).                                                   |
| `stream`               | Per-event `youtube_link` + `second_video_link` — YouTube only in legacy.                                                                                                                                                     |

**Takeaway.** The legacy system proves this domain genuinely needs **first-class `project` / `expert` / `partner` / `topic` entities with m2m joins and a per-event role** — that is not over-modelling, it is what the business already does. It equally proves the mistakes to beat: a **130-field event aggregate**, **boolean-scattered lifecycle** instead of a state machine, **join tables patched over missing relations** rather than designed, **two parallel expert types** where one entity with a role belongs, **denormalised filter facets** compensating for a query layer, and a **single hard-coded video provider**. Feature 012 designs the taxonomy fresh against these findings.

---

_This brief is the epic layer of ADR-0014's two-tier product spec: it decomposes, the co-located `NNN-product.md` PRDs carry the user stories, and the EARS triplets are authored from those PRDs — never the other way around._
