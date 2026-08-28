---
title: "Feature 014 — Event recordings & the archived-event page (PRD)"
description: "Product requirements for turning a finished broadcast into standing content: event_recordings (edited / raw) with the edited-on-top display rule, the post-live state of the event page with a publicly readable announcement and a login-gated player, an honest «запись готовится» state, recordings reachable from «Мои события», and the archive's front door on `/webinars` — the «Прошедшие» tab plus project/expert/topic facets in the shared event-list unit. Feature 014 of the Academy public surface epic; covers the scope of #1188 / Plane DSP-229; source of the 014 EARS triplet (ADR-0014)."
slug: academy-public-014-event-recordings-product
epic: ../../product/academy-public/brief.md
status: In dev
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`014-product-ru.md`](./014-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · Third on the critical path (after 012 and 013) · Covers the scope of [#1188](https://github.com/doctor-school/ds-platform/issues/1188) / Plane DSP-229, target 2026-08-21 — that Issue is delivered through this feature and is not specified separately.

## Feature summary

Today a broadcast ends and its page becomes a dead end: an announcement for something that already happened, with nothing to watch and no reason to come back. The academy has dozens of past events and all of that value evaporates the moment the stream stops.

Feature 014 gives an event a **life after the broadcast**. A recording becomes a real record attached to the event — in two kinds, the **raw** capture of the stream and the later **edited** cut — with a display rule that never leaves the doctor waiting for the montage: while only raw exists, raw plays; once edited appears, edited takes the main player and raw moves to a secondary «Смотреть оригинал трансляции» slot.

The event page gets a **post-live state** rather than a new page — `/webinars/[slug]` stays the single event page for every context (epic decision #4). That state is **publicly readable**: the announcement, description, speakers, project and topics are visible to anyone, because the archive is how a guest discovers the academy. **Playback is login-gated** (epic decision #3): for a guest the player position carries a poster and an honest invitation to sign in — free registration, an entry driver, deliberately not a paywall. When the broadcast is over and no recording exists yet, the page says so plainly with a timeframe instead of showing a broken player.

And the doctor's own history stops being upcoming-only: **«Мои события» shows the past events the user registered for**, each leading to its recording — the outcome #1188 asks for, delivered here.

An archive nobody can browse is not an archive, so this feature also gives it a front door: `/webinars` gains a **«Прошедшие» tab** and **filter facets by project, expert and topic**. **Assignment decision (2026-08-13): owner-delegated, lead-decided — these belong to 014, not 015.** The reasoning is recorded because the epic left the call open: the archive is a registration driver (epic decision #3) and a driver needs a browsable entrance shipped with it, not one feature later; the facets' primary value case is precisely the accumulated archive, since a handful of upcoming broadcasts needs no filtering; and the reusable event-list unit (epic decision #7) gains its **filter capability here**, so 015 and 016 consume it ready-made instead of each growing its own. The release ships as one complex, so shipping order does not bear on the assignment. This is a lead decision under delegated authority — not an agent proposal awaiting confirmation.

## User stories

- **US-1** — As a **doctor who missed a broadcast**, I open its event page and watch the recording, so missing a live эфир no longer means losing the content.
- **US-2** — As a **doctor**, when only the raw stream capture exists I can already watch it — I am not made to wait for the edited cut before the content is available at all.
- **US-3** — As a **doctor**, once the edited version is published it is the one I get by default, with the original broadcast still reachable if I want it — the better version is never buried under the rougher one.
- **US-4** — As a **guest**, I can read a past event's page fully — what it was about, who spoke, which project it belonged to — without an account, so an archived broadcast is a real entry point to the academy.
- **US-5** — As a **guest**, when I try to watch I am told clearly that viewing requires signing in and that it is free, and I can sign in or register right there and come back to the same recording.
- **US-6** — As a **doctor**, when a broadcast has ended but its recording is not ready yet, the page tells me honestly that it is being prepared and when to expect it — instead of an empty player or silence.
- **US-7** — As a **registered doctor**, «Мои события» shows me the past events I signed up for, not only the upcoming ones, so my own history is where I look first.
- **US-8** — As a **registered doctor**, each past event in «Мои события» takes me straight to its recording, making the section the shortest path back to content I already chose.
- **US-9** — As a **content operator**, I attach a recording to an event and state its kind (raw or edited), and the page reflects the right one without any further intervention from me.
- **US-10** — As a **content operator**, publishing the edited version later automatically promotes it and demotes the raw one — I never edit a page to make the display rule happen.
- **US-11** — As a **doctor on a phone**, the archived page and the player work as well as on desktop, because a large share of the audience watches on mobile.
- **US-12** — As a **product owner**, the archive measurably drives registration — a guest who came for a recording has an obvious, low-friction path to an account.
- **US-13** — As a **doctor or a guest**, I browse past эфиры on `/webinars` through a «Прошедшие» tab, so the archive is a place I can walk into rather than a set of links I must already have.
- **US-14** — As a **doctor or a guest**, I narrow the listing by project, expert and topic, so an archive of dozens of broadcasts leads me to the ones about my subject instead of making me scroll through everything.
- **US-15** — As a **guest browsing the archive**, an entry I pick from the «Прошедшие» listing takes me to a page I can read in full, where the invitation to sign in for playback is the natural next step — browsing and the registration driver are one continuous path.
- **US-16** — As a **product owner**, the filter capability lives in the shared event-list unit, so the project, expert and «Мои события» listings gain the same behavior without anyone rebuilding it.
- **US-17** — As a **content operator**, I upload/replace/remove the recording poster and the Event program PDF through file controls; I never type storage references, and recording duration is derived from video metadata rather than manual seconds.
- **US-18** — As a **visitor**, every archived-event speaker comes from the canonical ordered event-to-expert list after migration, with no legacy/free-text fallback.
- **US-19** — As a **content operator**, recording lists/selectors use pagination, immediate search/filtering, active chips, one Reset all and no actionable no-op controls.

## Flows

**Watch a recording as a registered doctor (US-1, US-2, US-3):**

1. Doctor opens `/webinars/[slug]` for a finished event → the page renders in its post-live state, the player in the hero position.
2. If both kinds exist → the **edited** recording is in the main player, and the raw capture is reachable through the secondary «Смотреть оригинал трансляции» affordance.
3. If only **raw** exists → it plays in the main player, with no secondary slot.
4. The rest of the page — speakers (clickable expert cards), project(s), topics, materials — renders as on a live event page, reading the 012 taxonomy.

**Guest hits the gate (US-4, US-5, US-12):**

1. Guest opens the same page → announcement, description, speakers, project and topics all render; nothing is hidden.
2. In the player's position the guest sees a poster plus a plain invitation to sign in to watch, stating that access is free.
3. Guest signs in or registers → returns to the same event page and the player renders. _(decided: the owner approved the gate and its framing as a registration driver, and on 2026-08-17 set the platform-wide return-to-origin rule that makes the return land back on the same recording — EARS-6.)_

**Recording not ready (US-6):**

1. The broadcast has ended and no recording of either kind is attached.
2. The page shows an honest «запись готовится» state with an expected timeframe, in the player's position — never an empty or broken player, and never a silently missing section.
3. The state disappears by itself the moment a recording is attached; the operator does not edit the page. _(The timeframe's source is the per-event readiness date the operator sets — decided, see the questions section below.)_

**«Мои события» (US-7, US-8):**

1. Registered doctor opens `/account/events` → alongside upcoming events they see the **past events they registered for**.
2. Each past entry links to its event page, where the recording (or the «готовится» state) waits.
3. The listing is rendered by the **shared event-list unit** (epic decision #7), not by a section-only copy of it.

**Browse the archive on `/webinars` (US-13, US-14, US-15, US-16):**

1. A visitor — signed in or not — opens `/webinars` and switches to the **«Прошедшие»** tab; the listing shows finished events, most recent first. _(Ordering agent-proposed — UNCONFIRMED.)_
2. The visitor narrows the listing with facets — **project, expert, topic** — reading them from the 012 taxonomy; the facets apply to the upcoming tab as well, since they are a property of the list unit, not of the archive.
3. Selecting an entry opens `/webinars/[slug]` in its post-live state — for a signed-in doctor the player, for a guest the fully readable page plus the sign-in invitation, which is the archive's registration driver in action.
4. Both tabs, the facets and the pagination are the **shared event-list unit** (epic decision #7) — the filter capability is added to that unit here, and the project, expert and «Мои события» listings inherit it.

**Operator flow (US-9, US-10):**

1. Operator attaches a recording to an event and marks its kind — `raw` or `edited`.
2. The page applies the display rule from the data alone; publishing an edited recording later promotes it without any page edit.
3. The rule is data-driven, so a mistake is fixed by fixing the record, not by re-touching a page.

**Branches:**

- **Both recordings absent but the event never happened** (cancelled) → out of scope here; the cancelled state belongs to the event lifecycle, not to this feature.
- **More than one recording of the same kind** on one event → treated as an operator error rather than a supported state. _(agent-proposed — UNCONFIRMED.)_
- **A recording exists but its source is unavailable** at playback time → the page must fail honestly (an explicit "recording temporarily unavailable" message), never a silently dead player. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- An event carries **recordings as first-class records** with an explicit **kind — `edited` or `raw`** — not a single video URL field on the event.
- The **display rule holds without operator intervention**: raw alone → raw in the main player; edited present → edited in the main player and raw in a secondary slot behind a «Смотреть оригинал трансляции» affordance. Publishing the edited cut later changes the page by itself.
- `/webinars/[slug]` remains the **single event page for every context** — the post-live state is a state of that page, not a second route.
- The post-live page is **publicly readable in full** — announcement, description, speakers, project(s), topics, materials — for a visitor with no account.
- **Playback renders for authenticated users only.** A guest gets a poster plus an honest, non-paywall invitation to sign in, stating that access is free; the sign-in path is reachable from that spot.
- When a finished event has no recording, the page shows an explicit **«запись готовится»** state with a timeframe, in the player's position; the state clears automatically once a recording is attached.
- **«Мои события» lists the user's past registered events**, each linking to its event page and its recording — closing the outcome of #1188 / Plane DSP-229. The listing uses the shared event-list unit.
- `/webinars` carries a **«Прошедшие» tab** that lists finished events, reachable by any visitor without an account, and **filter facets by project, expert and topic** driven by the 012 taxonomy.
- The tab, the facets and the pagination are delivered **inside the shared event-list unit**, not as a `/webinars`-only implementation: the same filter capability is available to the project, expert and «Мои события» listings that consume the unit afterwards.
- An entry opened from the «Прошедшие» listing lands on the event's post-live state, so **browsing the archive and the login-gated player are one continuous path** for a guest.
- The existing `/webinars` listing is **refined, not redesigned** — upcoming discovery keeps working exactly as it does today.
- Speakers, project and topics on the archived page come from the **012 taxonomy** — this feature reads that data, it does not re-model it. After migration, speakers come only from canonical ordered `event_experts`.
- Recording poster and existing Event program PDF authoring each use file upload with replace and explicit remove plus retained cleanup; storage references are never operator input. Recording duration is derived from validated video metadata and is never a manual seconds field.
- The whole archived state works on mobile — the player, the secondary recording affordance, and the login invitation alike.
- The archived page meets the platform's accessibility bar for a public surface — the same `playwright-axe` gate every user-facing surface passes, including the player's controls being keyboard-reachable and the login invitation being a real, labelled action.
- Nothing about the pre-live event page (announcement + registration, features 004/005) regresses — 014 adds a state, it does not redesign the page.

## Out of scope

- **Redesigning the live event page.** The design brief is explicit: the existing page is not reworked; only its post-live state is designed (design brief section 4).
- The **video hosting / streaming decision** — where recordings physically live, how they are uploaded and transcoded. 014 requires that a recording is a record with a kind and a playable source; the delivery mechanism is a technical decision, not a product one.
- **Attendance-gated access** — the gate is authentication, not registration for that specific event; any doctor with an account can watch any published recording.
- **Download of recordings**, offline viewing, and playback position / resume-where-you-left-off.
- **A redesign of the `/webinars` listing.** The tab and the facets are a refinement of the existing showcase (design brief section 5); its composition and the upcoming-events experience are not reworked.
- **Materials beyond the video** (slides, handouts) as a new upload surface — existing event materials keep rendering; no new materials model here.
- **Analytics on watch behavior** (views, watch time, completion) and any reporting to partners.
- **Notifications** — telling a registered doctor that "the recording is ready" is not in this epic (the epic excludes notification delivery).

## Questions raised at authoring — all decided

Every question this PRD raised while it was being written is decided: by the owner's answers of 2026-08-17 on [#1326](https://github.com/doctor-school/ds-platform/issues/1326), by the vendored canvases, or by a lead decision in the requirements. Each is kept below with the clause that decides it, so the record points at where the answer lives. Nothing here is awaiting an answer.

- **The «запись готовится» timeframe** — **decided:** a per-event readiness date the operator sets, never a fixed platform promise. The plaque carries the date line when the operator filled it and stays honest without one. Deciding clauses: EARS-7 and lead decision LD-5 (`events.recording_expected_by` lives on the event, because the plaque exists precisely when no recording row does).
- **Presentation of the secondary recording** — **decided** by the approved canvas: all three design-brief forms (spoiler / tabs / bottom section) are encoded as the `secondaryUi` prop of `webinar-archive.dc.html`, and its default **`spoiler`** is the operative pick, written into the requirements' scope as `secondaryUi: spoiler`.
- **Guest-return behavior after sign-in** — **decided:** the owner set the platform-wide return-to-origin rule on 2026-08-17, so a guest who signs in from the gated player lands back on the exact page they were consuming. Deciding clause: EARS-6 (same-origin targets only; a per-surface default landing applies only when no valid target exists).
- **How far back «Мои события» reaches, and tab vs. one merged list** — **decided:** the **full** registration history, newest first, inside the **two canvas tabs** «Предстоящие» / «Записи» as `my-events.dc.html` draws them — not one merged list and not a bounded window. Deciding clauses: EARS-9 and lead decision LD-9 (`GET /v1/me/events` gains `tab=upcoming|recordings` over the existing registrations join).
- **A past event the user registered for that has no recording** — **decided:** it **is** listed in the «Записи» tab, carrying the `preparing` badge (owner answer 4). The tab is the doctor's history, not a recording index — which is what closes #1188 / Plane DSP-229. Deciding clauses: EARS-9 and LD-9.
- **Recording visibility control** — **decided:** a recording carries its **own** status scheme, independent of being attached. `AttachRecording` creates a `draft` and never publishes; only `PublishRecording` makes it public, and only once the event is `ended`. Deciding clause: EARS-2 (`draft | published | retired`, set-once `first_published_at`, no Delete route or control anywhere).
- **The form of the «Прошедшие» tab** — **decided:** the facets' form comes from the vendored canvas «ФильтрЭфиров»; the tab's own presentation was set by the owner on 2026-08-17 — **tabs**, mirroring the pair already drawn on the project and expert pages — and URL persistence of the tab, the facet values, the cursor and the week/month view is lead decision LD-11 in the requirements.
- **Facet behavior at the edges** — **decided:** a zero-yield option stays **visible and selectable**, its count simply absent rather than disabled or hidden (owner answer 7), and the single-select-per-facet model composes AND across kinds. Deciding clauses: EARS-12 and lead decision LD-8 (counts reflect the other facets' current selections; a facet's own selection does not filter its own option list).

## Approved mockup

**Stage A resolved 2026-08-13** for the archived-event page. The owner finished the page design themselves as canvas **«Вебинар архив»** in the claude.ai Design app (project «Doctor.School визуальный язык», `8cc2f39a`), from the archived-event section of the design brief ([`design-brief-academy-public-ru.md`](../../product/academy-public/design-brief-academy-public-ru.md), section 4), and handed the project over for page-by-page acceptance (epic #1240 process: page = vendoring + Stage-A record in its feature's PRD). That canvas is the approved mockup and the composition SoT for this feature's page surface.

The canvas is **vendored verbatim** at [`design-source/webinar-archive.dc.html`](../../../../../../design-source/webinar-archive.dc.html) (pulled 2026-08-13 via DesignSync from project `8cc2f39a`, canvas file «Вебинар архив.dc.html»). Every canvas-carried resolution is read off the vendored copy, never off this PRD's prose: the three page states (`recording: montage | raw-only | preparing`), the guest gate (`viewer: guest` — dimmed poster player + boxed login invitation), the «запись готовится» plaque with its per-event date line, and the honest raw-only plaque. The secondary-recording fork (design brief section 4, decision #6) is encoded in the canvas as the `secondaryUi` prop — `spoiler | tabs | section` — with canvas default **`spoiler`**; the default is the operative pick unless the owner overrides it before implementation _(carried by the canvas default, matching the 013 pattern — no separate owner verbatim quote exists for this fork)_.

The second surface — the project/expert/topic **facets** on `/webinars` (design brief section 5) — is resolved by canvas **«ФильтрЭфиров»**, **vendored verbatim** at [`design-source/events-filter.dc.html`](../../../../../../design-source/events-filter.dc.html) (pulled 2026-08-13, canvas file «ФильтрЭфиров.dc.html»): three searchable dropdown facets (Проект / Эксперт / Тема) with per-option counts, single-select per facet, active-filter badges with per-badge clear and «Сбросить всё», stacking to full-width rows on mobile — built as a reusable controlled unit (props `project`/`expert`/`topic` + `onChange`, injectable option lists and counts), which is exactly the shape the shared event-list unit consumes. The **«Прошедшие» tab's own presentation** is carried by no canvas and was resolved outside it: the owner set **tabs** on 2026-08-17, mirroring the «Прошедшие · N» pair already drawn on `project-page.dc.html` / `expert-page.dc.html`, and URL persistence of the tab, the facet values, the cursor and the week/month view is lead decision LD-11 in the requirements.

**Stage A confirmed 2026-08-17** ([#1337](https://github.com/doctor-school/ds-platform/issues/1337)) — the composition was re-read field-by-field off the vendored canvases and the `build-ui-from-design-system` gate was run (package inventory + registry-whitelist search per element class; full record on #1337). Outcomes:

- **Canvas-carried resolutions are decisions.** `webinar-archive.dc.html` declares its props verbatim in the vendored file: `viewer: authed | guest` (default `authed`), `recording: montage | raw-only | preparing` (default `montage`), `secondaryUi: spoiler | tabs | section` (**default `spoiler`**). The guest-gate copy, the raw-only plaque, the «запись готовится» card, the `-80px` player-card pull-up and the ≤900 flat full-bleed composition are read off the file, never off this PRD's prose. Same for the three facets of `events-filter.dc.html` and the two in-scope tabs of `my-events.dc.html`. None of these is re-opened.
- **Absence rules confirmed:** no «Сертификаты» tab (owner decision 2026-08-17, a canvas review miss — no placeholder, flag or disabled stub); no placeholder for the not-yet-available 012 project/topic blocks (EARS-19 — absent, not «скоро»); no Delete control in the recordings panel; canvas cells with no backing field (`Смотрели · N`, `Доступна ещё N дней`, the «Мои события» specialty filter) are omitted rather than filled with sample values.
- **Adoption verdict:** `AspectRatio`, `Collapsible`, `Popover` + `Command` (the facet combobox), `Pagination`, `Dialog`/`AlertDialog` and `Table` are adopted from official shadcn/ui (MIT, Radix — already this package's substrate) into `@ds/design-system`; `Tabs`, `Badge`, `FilterChip`, `Button`, `Link`, `Input`, `NativeSelect`, `Alert`, `Form*`, `WebinarCard` and `WebinarPageContent` are reused as they stand; the poster / guest-gate / plaque player card is **bespoke** — no whitelist registry ships a neo-brutalist player card matching the canvas. Kibo UI's `Video Player` is rejected on fit: 014's source is a provider `embedRef` iframe behind feature 006's abstraction, not a media file this platform controls. The admin readiness date reuses `Input type="date"` rather than adopting a date-picker runtime. Four of the new classes (Disclosure, Combobox, Modal, Pagination) are also needed by 012's admin verticals — each is built **once** in `@ds/design-system` and consumed by both features.
- **Upcoming-tab wording.** `project-page.dc.html` and `expert-page.dc.html` label their pair «Будущие · N | Прошедшие · N»; `my-events.dc.html` says «Предстоящие». The tab mechanism is identical, so this is copy, not a composition fork: `/webinars` and «Мои события» use **«Предстоящие»**; the 015/016 pages carry «Будущие» as their own Stage-A item.
- **The admin composition — decided, option B.** The recordings panel and the «Отметить завершённым (трансляция прошла вне платформы)» command have **no canvas by design** (the neo-brutalist set is portal-facing; admin is stock Refine, ADR-0004 §3). Three compositions were put to the Product Lead — A: a section on the existing single detail page · B: an own «Записи» tab in a tabbed event detail, mirroring the 012 pick · C: a separate Refine resource with an event picker — with the lead recommending **B** for consistency with the 012 admin decision (#1282, 2026-08-17: option B tabbed detail, modal confirmations, retired rows hidden by default, no Delete anywhere). **Decision (Product Lead, working chat 2026-08-17, verbatim «Вариант B.»): option B** — an own «Записи» tab in the tabbed event detail; the mark-ended command sits with the other lifecycle actions, shown only when applicable, with a modal confirmation. Recorded on #1337.

Uncovered controls on the public surface: **none**. The three vendored canvases carry every control 014's public EARS clauses require.
