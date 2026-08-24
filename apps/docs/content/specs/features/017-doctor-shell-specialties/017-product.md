---
title: "Feature 017 — Doctor storefront shell & the specialty catalog (PRD)"
description: "Product requirements for the first screen of the second site: `doctor.school` as the doctor's storefront — the shell every doctor-facing screen consumes (header by sign-in status, navigation, footer with the single link into the Academy), the Минздрав specialty catalog as the doctor's first action with search over 105 entries plus «Другое», the remembered choice in the profile and in an anonymous session, the announcements calendar, the scale statistics and the voluntary leaderboard. Wave 1 of the two-site IA epic; the shell all of 018–021 build on; source of the 017 EARS triplet (ADR-0014)."
slug: two-site-ia-017-doctor-shell-specialties-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`017-product-ru.md`](./017-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · **First in wave 1** (017 → 018 → 019 → 020 → 021). 017 is `blocked_by` **#1440** — the `apps/doctor` application does not physically exist yet, so there is nothing to build in. Taxonomy canon: ADR-0016 §5 (two reference books — Минздрав specialties and educational directions, with a managed adjacency table) and §8 (what belongs to the storefront).

## Feature summary

Doctor.School today has one public site, and it speaks to everybody at once. A doctor who arrives sees the Academy — projects, experts, the backstage of how education gets made — and has to work out for themselves which part of it is for them. The doctor storefront (`doctor.school`) is the answer: a **second site on the same design system**, whose entire job is to show one doctor the content that is actually theirs.

017 is that site's foundation, and it delivers two things everything after it depends on.

The first is the **shell** — the header (logo, search, and **one of two by sign-in status**: «Войти / Регистрация» or «Личный кабинет»), the navigation, and the footer carrying «Документы и контакты» plus the **single link into the Academy**. Every other doctor-facing screen consumes this shell and never redefines it; a decision taken here is repeated on seven other screens. The storefront carries **no Academy content of its own** — no project feed, no partner news, no Academy podcasts (NG-2, REQ-24).

The second is the **specialty catalog as the doctor's first action** (REQ-101). The Минздрав list — 105 entries plus «Другое» — is presented so that a doctor can both _find_ the one they already know and _see_ what exists, with search over the list because 105 items cannot be scrolled. Picking a specialty is what turns the site from a brochure into a product: from that moment the content is targeted to that specialty and its adjacent areas (REQ-1), where adjacency is a **managed reference table, not a similarity of names** (OWD-11). The choice is remembered — in the profile for a signed-in doctor, in the anonymous session for a guest — so the second visit opens straight into the targeted view.

Around those two, the home page carries what makes the site credible and alive: the **scale statistics** the legacy site proved worked («с нами уже N врачей · 105 специальностей · …», REQ-116), the **nearest events with the month calendar** and the link «Все события» (REQ-2, REQ-75), a «Что исследовать» showcase of the formats, and the **platform leaderboard** — in which a doctor appears **only by separate consent to public display** (REQ-34), the default being not to publish.

017 also owns the **marketing routes that move out of `apps/promo` into `apps/doctor`** (ADR-0015 §2 — one host owns one information architecture). Taking `apps/promo` out of service after the move is a **separate engineering deliverable of wave 1**, not part of this PRD.

## User stories

- **US-1** — As a **doctor arriving for the first time**, I understand within seconds that this site teaches doctors and that learning here is **free for me**, without having to read about how it is financed.
- **US-2** — As a **doctor**, my first action is choosing my specialty from the official Минздрав list (105 entries plus «Другое»), and I can do it without leaving the first screen.
- **US-3** — As a **doctor**, I find my specialty by typing part of its name instead of scrolling a 105-item list.
- **US-4** — As a **doctor who has chosen**, the site remembers my specialty — in my profile when I am signed in, in my session when I am not — so my next visit opens already targeted at me.
- **US-5** — As a **doctor whose interests changed**, I can change my specialty at any time from the collapsed specialty row, without redoing the whole first-visit flow.
- **US-6** — As a **cautious visitor**, I can look at the whole home page before choosing anything — nothing blocks the page until I pick a specialty.
- **US-7** — As a **visitor**, the header shows me exactly one of «Войти / Регистрация» or «Личный кабинет» depending on whether I am signed in — never both, never an ambiguous state.
- **US-8** — As a **doctor deciding whether this is serious**, I see the platform's scale — how many doctors are already here, how many specialties, lessons and events — as a plain line of numbers.
- **US-9** — As a **doctor**, I see the nearest events and a compact month calendar on the home page and can go from there to the full events feed.
- **US-10** — As a **doctor**, a «Что исследовать» block shows me what the formats actually are — a school, a lesson of the day, a clinical-case review — before I commit to anything.
- **US-11** — As a **doctor**, I see the platform leaderboard and understand at a glance that appearing in it is **voluntary**; if I have not consented, I simply have no row there and the page says why calmly.
- **US-12** — As a **doctor**, the storefront never shows me the Academy's internal life; the only way across is one link in the footer, and I take it only if I want to.
- **US-13** — As a **doctor on a phone**, the header, the catalog, its search, the calendar and the leaderboard all work as well as on desktop — a large share of doctors arrive from mobile.
- **US-14** — As a **visitor who followed an old marketing link**, the public marketing routes now answer from `doctor.school` inside one information architecture, rather than from a separate marketing site with its own navigation.
- **US-15** — As an **operator**, I maintain the specialties, the educational directions and the adjacency links between them in one place, and the storefront's targeting follows from those reference books rather than from per-page settings.
- **US-16** — As a **product owner**, the shell decided here — header, navigation, footer — is the single shell of the storefront: features 018–021 consume it and none of them re-invents it.

## Flows

**First touch (US-1, US-2, US-3, US-6):**

1. A visitor opens `doctor.school` → the shell renders with the guest header, then the hero: the headline, the sub-line about what a doctor gets here, the evolutionary goal **verbatim**, and the scale statistics.
2. Below it, the **specialty catalog** — the main block of the screen: a set of specialties visible immediately, a search field over the whole list, an expand control for the rest, and «Другое» last.
3. The visitor may scroll past it and read the calendar, «Что исследовать» and the leaderboard — **nothing blocks the page** on the absence of a choice.
4. The visitor types part of a name → the list narrows; nothing matches → the catalog says so and keeps the search recoverable.
5. The visitor picks a specialty → the storefront becomes targeted and the specialty feed (feature 018) takes over.

**Return visit (US-4, US-5):**

1. A doctor with a remembered specialty opens the home page → it opens **already as the targeted view**, with the same blocks in their targeted form.
2. The specialty catalog is collapsed to a single row naming the current specialty with a «сменить» affordance.
3. «сменить» re-opens the catalog in its full form; picking another specialty re-targets everything and is remembered in turn.

**Sign-in status (US-7):**

1. Guest → the header shows «Войти / Регистрация», which leads to the registration/sign-in surface (feature 021); 017 does not draw that surface.
2. Signed in → the header shows «Личный кабинет» plus the points plate; the remembered specialty moves from the anonymous session into the profile.

**Crossing into the Academy (US-12):**

1. The footer carries «Академия Doctor.School» — the storefront's only Academy link; a second crossing exists in the doctor's cabinet («Стать экспертом») and is not part of 017.

**Branches:**

- **«Другое» chosen** → the doctor is not left without content: the storefront falls back to general (non-targeted) selections and says so, rather than showing an empty targeted feed.
- **Announcements fail to load** → that block states the reason and offers a retry; the rest of the page stays usable.
- **No upcoming events for the chosen specialty** → the calendar block shows its honest empty state and points at adjacent areas.
- **Leaderboard empty, or the doctor never consented** → the block renders with a calm explanation instead of a missing or fabricated row.

## Product acceptance criteria

- `doctor.school` is **publicly readable with no account** — the home page, the specialty catalog, the announcements, «Что исследовать» and the leaderboard are all visible to a guest.
- The **shell** (header, navigation, footer) is delivered as the storefront's single shell and is consumed unchanged by every later doctor-facing screen; the header renders **exactly one** of «Войти / Регистрация» / «Личный кабинет» according to sign-in status.
- The **specialty catalog is the doctor's first action** and offers the full Минздрав list — 105 entries plus «Другое» — with **search over the list**; the list is never presented as a bare 105-item scroll.
- **Nothing blocks the home page** on the absence of a chosen specialty — no modal gate, no empty page.
- A chosen specialty is **remembered** — in the profile for a signed-in doctor, in the anonymous session for a guest — and a return visit opens the targeted view with the catalog collapsed to a changeable row.
- The chosen specialty is the **primary axis of content targeting**, and adjacency is read from a **managed reference table** (ADR-0016 §5, OWD-11) — never derived from name similarity, and never presented to the doctor as their own specialty.
- Specialties (Минздрав), educational directions and schools are **three distinct things**, never merged into one on-screen list and never labelled with one word.
- The home page carries the **scale statistics** (doctors, specialties, lessons, events) and the **evolutionary goal verbatim**, with no gloss and no «готовится» marker beside it.
- The home page shows the **nearest events plus a compact month calendar** and a link to the full events feed; before a specialty is chosen these are general, after it they are targeted.
- The **leaderboard** renders only doctors who gave **separate consent to public display**; the default is not to publish, and the voluntary nature is visible next to the block.
- The storefront carries **no Academy content** — no project cards, no Academy podcasts, no partner news — and **exactly one** Academy link, in the footer.
- The interface **never states who finances the doctor's learning**; it says only that learning is free for the doctor.
- The site shows **no prices in roubles, no cart, no subscription** — there are no payments on the platform and doctors are never charged.
- The **public marketing routes previously served by `apps/promo`** answer from `doctor.school` under this shell's information architecture.
- Everything above works at the **mobile breakpoint** as well as at desktop, and meets the platform accessibility bar for a public surface (`playwright-axe`): the search field labelled, the catalog entries real controls, the leaderboard readable by a screen reader.

## Out of scope

- **The specialty feed itself** — the targeted mixed feed a chosen specialty opens is feature **018**; 017 delivers the choice and the shell.
- **The events feed** (`#d-events`) — feature **019**; 017 links to it.
- **The event page and registration** — features **020** / **021**; the header's «Войти / Регистрация» only leads there.
- **The doctor's cabinet** — consent toggles, privacy settings, document upload and the «Стать экспертом» crossing all live in the cabinet, not on the home page.
- **Taking `apps/promo` out of service** — a separate wave-1 engineering deliverable (ADR-0015 §2) with its own Issue and its own acceptance; 017 owns only the arrival of the routes.
- **Mobile applications** — a separate track and a separate repository (owner decision F-4); the site's mobile breakpoint is in scope, the app is not.
- **The full leaderboard page** — 017 shows the block and the link out.
- **A search results surface** — the header search field is part of the shell; where it leads is not specified here.
- **The Academy's own screens** — anything behind the footer link belongs to the Academy features.

## Open questions

- **How the 105 specialties are presented.** The three options are enumerated in the Stage-A forks below and the canvas carries a default, but the owner has not picked. This is the screen's main product decision, not a styling detail.
- **Where the leaderboard lives** — a full section on the home page or a compact plate beside the catalog; it decides whether the leaderboard competes with the first action for attention.
- **What a doctor who picks «Другое» gets.** The requirement package fixes that «Другое» exists, not what targeting means for it.
- **How many specialties one doctor may hold.** Left open by OWD-11 — this PRD assumes exactly one primary specialty, which is an assumption, not a recorded decision. _(agent-proposed — UNCONFIRMED.)_
- **Whether an anonymous choice survives sign-in and other devices.** The storefront remembers a guest's choice in the session; whether it migrates into the profile on registration is unresolved.
- **Where the header search leads** and what it covers — the placeholder promises «уроки, школы и события», but no results surface exists in the package.
- **How the scale statistics are computed and refreshed** — live counts, periodically recomputed figures, or operator-set numbers.
- **The Academy link's destination** — the Academy home page, or a doctor-oriented entry point on it.
- **Which marketing routes move** out of `apps/promo`, and under which paths they answer on `doctor.school` — the map states the move, not the route list.

## Stage-A forks (развилки)

Both forks below come from the screen prompt. **The canvas default is a working assumption only** — an owner pick is still required, and nothing here is recorded as decided.

| #           | Fork                                       | Options                                                                                                                                                                                                               | Canvas default                                                                                                                       | Lead recommendation                                                                                                                            | Owner pick  |
| ----------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **F-017-1** | How the 105 Минздрав specialties are shown | **А** — a tile grid of the popular specialties plus search plus «Показать все» · **Б** — search as the hero element with the most frequent suggested beneath · **В** — the full alphabetical list with letter anchors | **А** (canvas prop `catalogVariant`, default `А`)                                                                                    | none — **А** reads as an invitation and **В** as a directory, but the trade-off («I know mine» versus «show me what exists») is a product call | **PENDING** |
| **F-017-2** | Where the leaderboard lives                | a separate section on the home page · a compact plate beside the catalog                                                                                                                                              | the **separate section** — the canvas resolved this silently and carries **no prop**, so the promised second variant was never drawn | none                                                                                                                                           | **PENDING** |

**State variants on the canvas (content-driven, not design forks):** sign-in status (guest / signed in — both mandatory), specialty chosen / not chosen, and the `dataState` prop (`обычно` default · loading skeleton · empty calendar · load error). These are states the built screen must handle, not options to choose between.

## Approved mockup

**Stage A is not resolved for this feature.** The owner drew the canvas and it is vendored; the **canvas defaults are the working assumption, and the Stage-A pick is this PRD's fork table above** — no fork is decided until the owner records a pick there.

- **Canvas:** [`design-source/doctor-home.dc.html`](../../../../../../design-source/doctor-home.dc.html) — screen `#d-home`, composition drawn from scratch on the tokens of `design-system.dc.html`.
- **Units reused as-is:** the event card (`webinar-card.dc.html`), the month calendar in its compact form (`webinars-month.dc.html`), the doctor content card in its base form (its anatomy is decided on the 018 canvas, and this screen is brought into line with it), and the points plate in its base form (its anatomy is decided on the `#d-lesson` canvas).
- The composition switcher fixed at the bottom of the canvas is a **design-review aid, not a product control**, and is not built.
