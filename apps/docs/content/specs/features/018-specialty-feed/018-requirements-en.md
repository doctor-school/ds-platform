---
title: "018 — The specialty feed"
description: "Requirements for the doctor's return screen on doctor.school: one mixed feed targeted by the chosen specialty with the nearest events first, schools and courses with the series framing, lessons shared with the mobile application on one points account, the «Зачем это мне» value block, adjacent areas as their own labelled block, the specialty-filtered scale statistics, the consent-gated specialty leaderboard, the communities list, the guest-readable feed with honest gate states, the empty / partially empty / loading / per-block error renders, and the doctor content card unit the later screens consume unchanged."
slug: 018-specialty-feed
status: Draft
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/13
prior_decisions:
  - ADR-0014 — Product-design delivery lifecycle (§2 PRD → EARS `realizes:` trace; Stage A precedes user-facing implementation; the vendored canvas is the composition source of truth)
  - ADR-0015 — Two-storefront topology (§2 host-to-application map; the feed is a route of `apps/doctor` on `doctor.school`; §4 one session model across the two hosts)
  - "ADR-0016 — Core domain model (§4 schools, courses, modules, lessons and events as project results; §5 the two linked reference books with adjacency; §6 the points ledger; §8 every entity declares its storefront ownership)"
  - "ADR-0001 — Identity / Auth / RBAC (the feed reads: `access: public`; gated content and the points plate: `access: authenticated`)"
  - ADR-0002 — Backend Core Stack (NestJS + nestjs-zod; REST/OpenAPI under `/v1`; RFC 7807 Problem Details)
  - ADR-0003 — Data Layer (retained rows, restrictive foreign keys, no physical delete)
  - ADR-0004 — Frontend Stack (Next.js 15 on the shared design system)
  - ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS numbering)
  - ADR-0013 — Design-token SoT and the design-system-first adoption gate
lang: en
---

> **EN (this)** · **RU:** [`018-requirements-ru.md`](./018-requirements-ru.md)
>
> PRD source: [`018-product.md`](./018-product.md) (US-1…US-15). Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md). 018 is the **second feature of wave 1** and is `blocked_by` **017** — it renders inside 017's shell and is targeted by the specialty 017 lets the doctor choose. It puts a screen in front of a doctor, so `surface: user-facing`.

# 018 — The specialty feed (Requirements)

## Stage-A decisions in force

All three PRD forks are decided; nothing below re-opens them.

| Fork        | Decision                                                                                                                                                                                                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-018-1** | **Б — «сначала прийти»**: the nearest events stand at the top of the feed, schools and courses below them. Owner pick 2026-08-25, verbatim «Б — события вверху (Рекомендуется)». The canvas `blockOrder` default `А` is superseded; variants А and В are not built.                                                                     |
| **F-018-2** | **Б — a typographic doctor content card with no cover image** (kicker, title, metadata, counter). Owner pick 2026-08-25, verbatim «Б — без картинки (Рекомендуется)». No cover-image slot, no image upload obligation and no variant-А or variant-В card ships; the dense list row of variant В is not built as a separate card either. |
| **F-018-3** | **Adjacent areas are a separate block** at the end of the feed, not a «смежная» marker on cards inside the main blocks. Owner pick 2026-08-25, verbatim «Отдельный блок (Рекомендуется)». The canvas carries no prop for the alternative and none is drawn.                                                                             |

The canvas **state** props are not forks — they are content-driven obligations every 018 surface must handle: `loggedIn` (guest / signed in) and `dataState` (`обычно` · loading skeleton · empty for the specialty · partially empty · per-block error), plus the content card's own states (normal, hover, focus, started, completed, gate, «скоро»).

## Outcomes

- A doctor who has chosen a specialty lands on one screen that answers «what can I learn, what can I attend, who do I grow with» without a search, and returns to that same screen on every later visit.
- The nearest events stand first, so the doctor's first visible result on `doctor.school` is something they can attend (F-018-1, owner R4 №1).
- Schools and courses read as the doctor's end products, a course as a **series** with its episode count, and the Academy's backstage vocabulary — «проект» first among it — never reaches the doctor's interface.
- Lessons on the site and lessons in the mobile application are visibly one product on one points account, stated as a line inside the lessons block and never as a second section of the site.
- The value exchange is stated in the doctor's own words and ends at «бесплатно для врача»; the interface never names who finances the learning.
- Adjacent content is always reachable and always labelled as adjacent, resolved from the managed adjacency reference table rather than any computed likeness.
- A doctor sees themself among peers: the scale line and the leaderboard are both filtered to the specialty, and the leaderboard exists only where a public-display consent is recorded.
- A guest reads the whole feed before registering, and every gated step says so honestly on the card instead of disappearing.
- The **doctor content card** exists once, as a design-system unit with its full state set, and the school screen, the learning module and the home page's selections consume it unchanged.
- Empty, partially empty, loading and per-block failure are all real renders; no screen state of this feature is a placeholder.

## Scope

**In:**

- The **specialty feed route** in `apps/doctor` on `doctor.school`, rendered inside 017's shell layout, with the breadcrumbs and the specialty heading carrying «сменить специальность» (which re-opens 017's catalog).
- The **specialty-filtered scale line** — colleagues, schools, lessons of that specialty (REQ-116).
- The **nearest-events block** at the top of the feed per F-018-1: the reused event card unit from `design-source/webinar-card.dc.html` with the sign-up counter visible at all times, the offline colleagues' meet-up rendered as a **format of event**, and «Все события по специальности →» into feature 019.
- The **schools and courses block**: schools as end products, a course carried as a **series** with its episode count, and the «Готовится» state for a school in preparation.
- The **lessons block**: the lesson of the day through the doctor content card, «Все N уроков →», and the line stating that the same lessons live in the mobile application on one shared points account.
- The **«Зачем это мне» value block** — a new specialty, an international placement, mentorship with an expert, a document at the end of a course — closing on «всё бесплатно для врача» with the legal partner marking and no financing statement.
- The **adjacent-areas block** at the end of the feed (F-018-3), naming the adjacent specialties read from the managed reference table and linking into their own feeds.
- The **specialty leaderboard** — consented rows only, the voluntary note, the calm no-consent explanation, and «Весь лидерборд →».
- The **communities block** — the associations and communities of the direction with what they are for, as a read-only list with a link out (LD-5).
- The **doctor content card** as a `@ds/design-system` unit in Stage-A variant **Б**, with the state set normal / hover / focus / started (progress) / completed / gate / «скоро», exported for 019, 023, 024 and the home page's selections.
- The **guest read path**: the whole feed readable with no account, the gate state on gated cards, and the fail-closed server behaviour behind it.
- All five `dataState` renders per block and the whole-feed empty and partially-empty statements.
- Mobile-breakpoint parity and the `playwright-axe` accessibility bar on the whole feed.

**Out:**

- **The shell, the specialty choice and the specialty book** — feature **017**; 018 consumes the shell and the chosen specialty and adds only the breadcrumbs and the specialty heading.
- **The full events feed** `#d-events`, its facet panel and its week/month views — feature **019**; 018 links to it.
- **The event page, the room and registration** — features **020** / **021** / **006**; 018 links into them.
- **The school screen and the learning module** — wave-2 features **023** / **024**; 018 links into them and hands them the card unit.
- **The lesson screen and the points plate's anatomy** — decided on the `#d-lesson` canvas (feature **025**); 018 uses the plate in its base form.
- **The communities' own surfaces** — a community page and the membership flow are features **027** / **022** (REQ-120); 018 lists and links out only (LD-5).
- **Consent management for public display** — the toggle lives in the doctor's cabinet; 018 reads the recorded consent and never offers a control to change it.
- **The mobile application** — a separate track and repository; 018 states that the lessons are shared and ships no store link or QR (LD-6).
- **Recommendation mechanics** — no ranking, personalisation, algorithmic ordering or «на основе ваших данных» claim is specified or built (LD-1).
- **Pagination and «показать ещё» inside the feed** — each block ships a fixed depth with its «Все …» link-out (LD-3).
- **Registering interest in a school in preparation** — «Готовится» is a publication state only; no interest control ships (LD-4).

## Constraints

- **017 must land first.** 018 is `blocked_by` [#1494's parent chain](https://github.com/doctor-school/ds-platform/issues/1494) → the 017 shell and specialty choice; no 018 clause may re-implement the header, the navigation, the footer or the catalog, and none may be satisfied by building inside `apps/promo` or `apps/portal`.
- **No financing statement, anywhere.** The interface states that learning is free for the doctor and carries the legal partner marking; it never names who pays. The vendored canvas's «обучение оплачивают партнёры платформы» is a **known canvas defect that is not built** (LD-9).
- **Glossary canon.** Where an organisation behind the platform is named at all, it is «инвестор (организация)» / «первоинвестор»; «партнёр» is never used as the money-carrier in a doctor-facing string.
- **Adjacency is read, never derived.** Adjacent areas and adjacent content come from the managed `directions` ↔ `specialties_minzdrav` link and the direction adjacency self-relation (ADR-0016 §5). String similarity, shared prefixes and embedding similarity are refused at review.
- **Adjacent content is always labelled.** No adjacent item is presented inside a block as the doctor's own specialty (OWD-11).
- **Public by default, fail-closed on payload.** Every block of the feed is readable with no account. Gated content renders its gate state with metadata; the gated payload is withheld by the server for an anonymous reader and is never merely hidden in the client.
- **No Academy noise.** No project cards, no partner news, no Academy podcasts, no backstage navigation (NG-2, REQ-24); the word «проект» does not appear in a doctor-facing string.
- **No commerce.** No price in roubles, no cart, no subscription and no payment affordance on any 018 surface.
- **НМО is an attribute, never a headline.** НМО may mark an event; it is not the screen's title, its main filter or a block of its own (NG-1).
- **No recommendation claims.** No «на основе ваших данных», no explained algorithm, no personalised ordering; the block order is the F-018-1 order for everyone with the same specialty (LD-1).
- **Honest states, no placeholders.** Every block renders exactly one of content, skeleton, an honest empty statement, or an explicit Russian-language error with a working retry. An empty labelled box, an unresolving spinner, a dead control and a «скоро» stub standing in for a missing deliverable each fail review.
- **One card unit.** The doctor content card exists once in `@ds/design-system`. A screen-local re-implementation of it in 018 or in any later feature is a defect.
- **Design-system only.** Every element comes from `@ds/design-system` primitives with tokens-only styling and full interaction states; the vendored canvas is the composition source, and the composition switcher at the foot of the canvas is a review aid that is not built.

## Prior decisions

- **ADR-0015 §2:** the feed is a route of `apps/doctor`; public storefront pages are statically generated or ISR and authenticated views are SSR with the host-only session cookie.
- **ADR-0016 §4:** schools, courses, modules, lessons and events are results of a project; the project itself is the Academy's entity and is never surfaced on the doctor's storefront.
- **ADR-0016 §5:** the closed `specialties_minzdrav` book and the open `directions` book with adjacency as a weighted self-relation and a many-to-many link to specialties — the substrate of every targeted read in 018.
- **ADR-0016 §6:** points and money are one append-only ledger family; the site and the mobile application read one points account per doctor, which is what makes the shared-lessons statement true rather than marketing copy.
- **ADR-0016 §8:** every entity declares its storefront ownership, so «the doctor never meets the backstage» is checkable at the model level rather than only at review.
- **ADR-0014 §2:** the PRD is the source of this triplet, each clause carries `realizes: US-N`, and a recorded Stage-A pick is a decision rather than a question to re-open.
- **ADR-0013 + AGENTS.md §6:** implementation runs the design-system-first gate and builds from the vendored `design-source/` files rather than from issue prose.
- **ADR-0006 §4:** the feature-spec triplet and flat EARS numbering; `it('EARS-N: …')` test titles.
- **Feature 017:** owns the shell, the specialty books, the remembered choice and the resolved targeting set. 018 consumes them; it re-models none of them.
- **Feature 019:** owns the events feed the events block links to. **Features 023 / 024 / 025** own the school screen, the learning module and the lesson screen, and consume the card unit 018 delivers.

## Lead technical decisions

Each records a call the PRD left open. They are lead decisions in the AGENTS.md §6 decision-debt sense — reversible behind a stated contract, and named here rather than buried in the design.

- **LD-1 — the feed order is fixed, identical for every doctor of the same specialty.** The PRD assumes identical ordering and marks the assumption unconfirmed. 018 ships the F-018-1 block order as a server-side constant: two doctors with the same specialty see the same blocks in the same order, and only the specialty (plus its adjacency set) changes what is inside them. No ranking signal, no per-doctor weighting and no ordering configuration exists. This keeps the «no recommendation mechanics» constraint checkable — a personalised order would be a recommendation claim in everything but wording — and leaves ordering strategy a later product decision on top of an unchanged read contract.
- **LD-2 — the doctor content card is a design-system unit with a declared state set, delivered before the blocks that consume it.** The card is built once in `@ds/design-system` in variant **Б**, exports the state set normal / hover / focus / started / completed / gate / «скоро», and carries **no cover-image slot** — so no content-production obligation is created by the shape of the component. The blocks of 018 compose that unit; 019, 023, 024 and the home page's selections import it unchanged. Its build precedes the feed blocks in the WBS, because a card decided after its consumers means rebuilding them.
- **LD-3 — fixed depth per block, no pagination and no «показать ещё» on this screen.** The PRD fixes the blocks, not their depth. Each block renders a fixed number of items and hands depth to the surface that owns it through its «Все …» link (events → 019, lessons → the lessons surface, schools → the school screens). The counts live in one place in the feed's read contract, so changing a depth is a configuration change rather than a spec change, and the feed never grows an in-page paginator that competes with the dedicated feeds.
- **LD-4 — «Готовится» is a publication state read from the content model, with no interest control.** A school in preparation is marked by the operator through the content model's publication state; the feed renders it as «Готовится» inside the schools block rather than dropping the block. 018 ships **no** «сообщить о запуске» control: there is no notification surface behind it in the package, and a control that records nothing would be a banned dead affordance. Registering interest stays a named product decision.
- **LD-5 — the communities block ships as a read-only list with a link out; REQ-120 ownership stays outside 018.** The PRD's acceptance criteria and the vendored canvas both carry the block, while the functional map assigns REQ-120 to features 027 and 022. 018 therefore renders what the canvas draws — the community, what it is for, its doctor count and «Открыть сообщество →» — and implements no membership, no joining and no community surface of its own. If the owner rules the block out of 018's scope, removing it is deleting one block from this screen, not unwinding a mechanism.
- **LD-6 — the mobile-application line is plain text with no store link and no QR.** The application is a separate track and repository (owner decision F-4); a store link or QR pointing at something not yet published would be a user-facing placeholder. The line states the fact — the same lessons, one points account — and the destination lands with the application's own release.
- **LD-7 — every block loads independently; there is no whole-feed error state.** Each block owns its own read, its own skeleton and its own error with a retry that re-runs only that read. One failing block never blanks the feed, never blocks its siblings and never escalates into a page-level error screen. This is what makes the PRD's «one block fails to load» branch a specified render rather than an accident of implementation.
- **LD-8 — gating is enforced server-side and stated on the card.** For an anonymous reader the server returns the card's public metadata plus an explicit gate marker and withholds the gated payload; the client renders «нужна регистрация» from that marker. No gated payload is delivered and then hidden by CSS or by a client-side route guard, so the honest gate state and the access rule are the same mechanism rather than two that can drift apart.
- **LD-9 — the canvas payer line is a known defect and is not built.** The operative copy is «всё бесплатно для врача» plus the legal partner marking. The canvas's «обучение оплачивают партнёры платформы» is not implemented in any state, any breakpoint or any theme, and its owner-side canvas fix is tracked in the PRD's open questions. Where the canvas and this spec disagree on that line, this spec wins.

## Event Model

### Commands

018 is a read surface and introduces **no new commands**. The only writes reachable from it belong to other features and are performed on their own surfaces:

- `ChangeSpecialty(specialtyId)` — feature 017, issued by «сменить специальность» in the heading, which re-opens 017's catalog.
- Event sign-up and registration — features 020 / 021 / 006, reached from a card.

### Events

018 emits no domain events. It **consumes** two from 017:

| Consumed event     | Effect on the feed                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `SpecialtyChosen`  | The feed exists for that actor and renders targeted to the chosen specialty and its adjacency set.         |
| `SpecialtyChanged` | Every block re-reads for the new specialty; no per-block edit, no stale block and no partial re-targeting. |

### Read models

- `SpecialtyFeed { specialty: SpecialtyRef, blocks: FeedBlock[], order: 'events-first', viewer: { loggedIn, hasLeaderboardConsent } }` — the feed envelope; `order` is the F-018-1 constant of LD-1.
- `SpecialtyStatistics { colleagues, schools, lessons, specialty, computedAt }` — the specialty-filtered scale line (REQ-116).
- `FeedEvents { items: PublicEventSummary[], allEventsHref }` — the nearest events; every item carries `signUpCount` and `format` (`online` | `offline-meetup`), and `nmo` as an attribute only.
- `FeedSchools { items: DoctorContentCard[], preparing: SchoolRef[] }` — schools and courses; a course item carries `seriesEpisodes`.
- `FeedLessons { lessonOfTheDay: DoctorContentCard, total, allLessonsHref, sharedWithMobileApp: true }`.
- `ValueBlock { items: { title, body }[], freeStatement }` — «Зачем это мне»; `freeStatement` never names a payer (LD-9).
- `AdjacentAreas { items: { direction: DirectionRef, feedHref }[] }` — resolved from the managed adjacency relation, labelled as adjacent.
- `SpecialtyLeaderboard { rows: { rank, displayName, specialty, points }[], viewerHasConsent: boolean | null }` — consented rows only.
- `SpecialtyCommunities { items: { name, purpose, doctorCount, href }[] }` — read-only (LD-5).
- `DoctorContentCard { kind, kicker, title, meta, counter, state: normal | started | completed | gate | soon, progress?, href }` — the unit of LD-2; no cover-image field exists on it.

### Policies

- Every 018 read is public. Sign-in status changes what a card's `state` is (gate vs. started/completed) and whether the viewer's leaderboard consent is known — never whether a block is readable.
- A card resolves to `gate` for an anonymous reader exactly when the underlying content requires an account; the gated payload is withheld server-side in that case (LD-8).
- Targeting resolves from 017's `TargetingSet`; 018 issues no targeting logic of its own and no block carries per-page targeting configuration.
- A leaderboard row exists only for a doctor with a recorded public-display consent (REQ-34); absence of consent is indistinguishable from absence of the doctor.
- Each block's read is independent; a failed read affects that block only (LD-7).

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more PRD stories and is covered by `018-scenarios.feature`.

- **EARS-1** _(realizes: US-1, US-2)_ — When a visitor opens the specialty feed on `doctor.school`, the storefront shall render it inside feature 017's shell layout with breadcrumbs and the specialty heading carrying «сменить специальность», and shall lay the blocks out in the F-018-1 order — the nearest events first, then schools and courses, then lessons, then «Зачем это мне», then adjacent areas, then the specialty leaderboard, then communities — identically for every visitor holding that specialty per LD-1; the feed shall define no header, navigation or footer of its own, and no ranking, personalisation or «на основе ваших данных» claim shall exist on the surface or in its responses.
- **EARS-2** _(realizes: US-15, US-3)_ — The platform shall deliver the **doctor content card** as one unit in `@ds/design-system`, built in Stage-A variant **Б** — kicker, title, metadata and counter, with no cover-image slot — exposing the states normal, hover, focus, started with its progress, completed, gate and «скоро», and shall have every 018 block and every later consumer (features 019, 023, 024 and the home-page selections) compose that unit unchanged; a screen-local re-implementation of the card shall be a defect.
- **EARS-3** _(realizes: US-9)_ — When any visitor opens the feed, the statistics line shall state the scale **of the chosen specialty** — colleagues, schools and lessons of that specialty — from one computed read carrying its `computedAt`, and shall never present the platform-wide figure in its place; a counter whose source is unavailable shall be omitted with its neighbours still rendering rather than shown as zero.
- **EARS-4** _(realizes: US-4, US-5)_ — When any visitor opens the feed, the nearest-events block shall stand **first** per F-018-1, render each event as the reused event card unit with its sign-up counter visible **at all times**, present an offline colleagues' meet-up as a **format of the same event card** rather than a new card kind, carry НМО only as an attribute of an event and never as a heading or a filter of the screen, and offer «Все события по специальности →» into feature 019; the block shall build no events feed of its own.
- **EARS-5** _(realizes: US-3)_ — When the feed renders schools and courses, it shall present them as the doctor's end products, shall carry a course as a **series** with its episode count («N серий») rather than as an academic module plan, and shall render a school in preparation as «Готовится» per LD-4 with the block staying in place; the word «проект», Academy project cards, partner news and Academy podcasts shall appear in no doctor-facing string or block of this feature, and no price, cart, subscription or payment affordance shall appear anywhere on the surface.
- **EARS-6** _(realizes: US-6)_ — When the feed renders the lessons block, it shall present the lesson of the day through the doctor content card, offer «Все N уроков →», and state as a line **inside that block** that the same lessons are available in the mobile application on **one shared points account** per ADR-0016 §6 — as plain text with no store link and no QR per LD-6 — and shall never present the mobile application as a separate section of the site.
- **EARS-7** _(realizes: US-7)_ — When the feed renders «Зачем это мне», it shall state the exchange from the doctor's side — a new specialty, an international placement, mentorship with an expert, and a document at the end of a course — and shall close on «всё бесплатно для врача» with the legal partner marking; no string in any state, breakpoint or theme of this feature shall name who finances the doctor's learning, and the canvas line «обучение оплачивают партнёры платформы» shall not be built per LD-9.
- **EARS-8** _(realizes: US-8)_ — When the feed renders adjacent content, it shall place the adjacent areas in **their own block at the end of the feed** per F-018-3, naming each adjacent direction as read from the managed `directions` ↔ `specialties_minzdrav` link and the direction adjacency self-relation of ADR-0016 §5 — never from name similarity, shared prefixes or any computed likeness — and shall link each entry into that direction's own feed so the doctor always knows whose feed they are reading; no item anywhere in the feed shall present adjacent content as the doctor's own specialty.
- **EARS-9** _(realizes: US-10)_ — When any visitor opens the feed, the leaderboard shall render **filtered to the chosen specialty**, listing only doctors with a recorded separate consent to public display per REQ-34, stating beside the block that participation is voluntary, and offering «Весь лидерборд →»; a signed-in doctor without that consent shall be told calmly, in the block, that they have no row because they have not allowed public display and that it is changeable in the cabinet, and no row shall ever be fabricated, inferred, anonymised into existence or created by any default other than not publishing.
- **EARS-10** _(realizes: US-11)_ — When any visitor opens the feed, the communities block shall list the associations and communities of the direction with what each is for, its doctor count and a link out to the community per LD-5, and shall implement no membership, joining or community surface of its own — those remain features 027 / 022.
- **EARS-11** _(realizes: US-12)_ — When a visitor with no account opens the feed, every block shall be fully readable, and a card whose content requires an account shall render its honest gate state («нужна регистрация») with its public metadata instead of disappearing; the server shall withhold the gated payload from that anonymous read per LD-8 rather than delivering it and hiding it in the client, and following the gate shall lead into feature 021's registration and back to the card the doctor came from.
- **EARS-12** _(realizes: US-13, US-2)_ — When the feed or one of its blocks has no content or cannot be read, it shall render an honest state rather than an empty page: nothing at all for the specialty shall state so plainly and offer the adjacent areas and the general platform events; a partially empty feed shall keep the affected block in place with its «готовится»/empty statement instead of silently dropping it; a block whose read is in flight shall render its skeleton; and a block whose read fails shall state the reason in Russian and offer a retry that re-runs **only that block's** read per LD-7, with every other block staying usable; a card the doctor has started shall show its progress and a finished one shall render as completed.
- **EARS-13** _(realizes: US-14)_ — When any 018 surface is rendered below the mobile breakpoint, the statistics line, all seven blocks, the event cards with their counters, the doctor content card in every one of its states and the leaderboard shall each render in the canvas mobile composition and remain fully operable; the feed shall pass the `playwright-axe` gate with every card a real labelled link, the gate state announced to a screen reader rather than conveyed by colour alone, and the block headings forming a navigable heading structure.
- **EARS-14** _(realizes: US-1, US-12)_ — The feed shall expose no Academy content and no crossing into the Academy of its own — 017's single footer link remains the entire crossing — and every doctor-facing string of this feature shall follow the glossary canon: an organisation behind the platform is «инвестор (организация)» / «первоинвестор», and «партнёр» is never used as the money-carrier; an Academy content block, a second Academy link or a backstage navigation entry on an 018 surface shall be a defect.
- **EARS-15** _(realizes: US-15 · process gate — not a code Issue)_ — Before implementation of each 018 surface begins, the team shall run the `build-ui-from-design-system` gate against `design-source/doctor-feed.dc.html` and the reused units (`webinar-card.dc.html`, `expert-card.dc.html`, the points plate in its base form) as the composition source of truth, build from `@ds/design-system` primitives with full interaction states and tokens-only styling, cover all five `dataState` renders, both `loggedIn` states and all seven card states at both breakpoints and in both themes, and re-confirm the rendered result with the product owner on the live stand before merge; the recorded Stage-A picks (F-018-1 **Б**, F-018-2 **Б**, F-018-3 separate block) shall be treated as decisions rather than re-opened questions, and neither the canvas composition switcher nor the canvas payer line shall be built.

## Invariants

- The feed renders inside exactly one shell — 017's — and defines no header, navigation or footer of its own.
- The block order is the F-018-1 order and is the same for every visitor holding the same specialty.
- Exactly one doctor content card implementation exists, in `@ds/design-system`, and it has no cover-image field.
- Every figure in the statistics line and every row of the leaderboard is scoped to the chosen specialty, never platform-wide.
- A leaderboard row exists only where a public-display consent is recorded; the default is not to publish.
- Adjacent content always traces to a managed adjacency row and is always labelled as adjacent.
- No 018 response or rendered string states who finances the doctor's learning, and none carries a price, cart or subscription.
- «проект» appears in no doctor-facing string of this feature, and no Academy content or crossing exists on the surface.
- НМО appears only as an attribute of an event, never as a heading or a filter.
- Every block renders exactly one of: content, skeleton, an honest empty statement, or an explicit error with a working retry — never an empty box, an unresolving spinner or a dead control.
- No gated payload is ever served to an anonymous reader, and no gated card is hidden instead of gated.
- A block's failure is contained to that block; the feed has no page-level error state.

## Verification

| EARS | Test type                           | Indicative target                                                                                         | Required proof                                                                                                                                                                                                                       |
| ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Playwright + Vitest e2e             | `apps/doctor/e2e/feed-layout.spec.ts`, `apps/api/test/storefront/specialty-feed.e2e-spec.ts`              | Blocks render in the F-018-1 order with events first; the same order for two doctors of one specialty; 017's shell module is the one rendering the header/footer; no ranking field in the response and no personalisation claim.     |
| 2    | Vitest unit + Playwright + showcase | `packages/design-system/test/doctor-content-card.spec.tsx`, `apps/doctor/e2e/content-card-states.spec.ts` | All seven states render from one exported unit; no cover-image prop exists; 018 blocks and the later consumers import the same module; no screen-local card component in the tree scan.                                              |
| 3    | Vitest e2e + Playwright             | `apps/api/test/storefront/specialty-statistics.e2e-spec.ts`, `apps/doctor/e2e/feed-stats.spec.ts`         | Counters differ between two specialties and never equal the platform total; `computedAt` present; an unavailable counter is omitted with the line still rendering, never zeroed.                                                     |
| 4    | Playwright + Vitest e2e             | `apps/doctor/e2e/feed-events.spec.ts`, `apps/api/test/storefront/feed-events.e2e-spec.ts`                 | Events block first on the page; sign-up counter present in every card state; an offline meet-up renders through the event card with its format marker; НМО only as an attribute; «Все события по специальности →» resolves to 019.   |
| 5    | Playwright + tree scan              | `apps/doctor/e2e/feed-schools.spec.ts`                                                                    | A course renders «N серий» with the episode count; a preparing school renders «Готовится» and the block stays; the rendered page contains no «проект», no Academy card and no price/cart/subscription affordance.                    |
| 6    | Playwright + Vitest e2e             | `apps/doctor/e2e/feed-lessons.spec.ts`, `apps/api/test/storefront/feed-lessons.e2e-spec.ts`               | Lesson of the day through the card unit; «Все N уроков →» present; the shared-app line inside the lessons block, as text with no link or QR; one points account read per ADR-0016 §6; no separate mobile-app section.                |
| 7    | Playwright + full-text scan         | `apps/doctor/e2e/feed-value-block.spec.ts`                                                                | Four value items rendered; «всё бесплатно для врача» plus the legal partner marking; a scan of every rendered state × breakpoint × theme finds no payer statement and not the canvas line.                                           |
| 8    | Vitest e2e + Playwright             | `apps/api/test/storefront/feed-adjacency.e2e-spec.ts`, `apps/doctor/e2e/feed-adjacent.spec.ts`            | Adjacent areas rendered as their own block at the end; entries resolve from the managed link rows; a specialty with no adjacency row yields no entries; each link opens that direction's feed; no unlabelled adjacent item anywhere. |
| 9    | Vitest e2e + Playwright + axe       | `apps/api/test/storefront/feed-leaderboard.e2e-spec.ts`, `apps/doctor/e2e/feed-leaderboard.spec.ts`       | Rows scoped to the specialty; only consented doctors present in the response body; a non-consenting signed-in doctor sees the calm explanation and no row; the voluntary note visible; screen-reader readable.                       |
| 10   | Playwright                          | `apps/doctor/e2e/feed-communities.spec.ts`                                                                | Communities listed with purpose, doctor count and a working link out; no join/membership control rendered anywhere in the block.                                                                                                     |
| 11   | Vitest e2e + Playwright             | `apps/api/test/storefront/feed-gating.e2e-spec.ts`, `apps/doctor/e2e/feed-guest.spec.ts`                  | An anonymous read returns metadata plus the gate marker and **no** gated payload; the guest sees every block; the gated card shows «нужна регистрация»; the gate leads into 021 and returns to the originating card.                 |
| 12   | Playwright + Vitest e2e             | `apps/doctor/e2e/feed-states.spec.ts`, `apps/api/test/storefront/feed-states.e2e-spec.ts`                 | All five `dataState` renders; the empty-specialty statement offering adjacent areas and general events; a failing block's retry re-runs only that block; siblings stay usable; started shows progress and completed renders so.      |
| 13   | Playwright + axe + UI lint          | `apps/doctor/e2e/feed-mobile.spec.ts`                                                                     | Both breakpoints and both themes; axe clean on the feed route; every card a labelled link; the gate state announced, not colour-only; keyboard reach across all blocks; tokens-only styling.                                         |
| 14   | Playwright + tree scan              | `apps/doctor/e2e/feed-purity.spec.ts`                                                                     | No Academy content block, no Academy link and no backstage navigation on the feed; glossary scan finds no «партнёр» used as money-carrier in a doctor-facing string.                                                                 |
| 15   | Owner record + eyes-on render check | Stage-A record in `018-product.md`; Stage-B verdict on the Issue                                          | Canvas-derived composition verified against the vendored files; all five `dataState` × both `loggedIn` × all seven card states reviewed; owner live-stand confirmation before merge. Process gate — not a code Issue.                |
| all  | Playwright BDD                      | `018-scenarios.feature`                                                                                   | Every EARS tag executes against the real `apps/doctor` → NestJS → Postgres stack; no seeded stand-in for the adjacency table, no fake gating and no placeholder block state accepted.                                                |

## Dependencies and sequencing

- **018 is blocked by 017.** The shell layout (017 EARS-1), the chosen specialty (017 EARS-6) and the resolved targeting set (017 EARS-8) are all prerequisites; no 018 clause may be satisfied by re-implementing them or by seeding adjacency by hand.
- **EARS-2 precedes EARS-4…EARS-6 and EARS-12.** The card unit is the substrate of the blocks and of the started/completed/gate renders; building it after its consumers means rebuilding them (LD-2).
- **EARS-11 depends on the access model of ADR-0001** and on feature 021 for the registration destination; 018 renders the gate and the return, it does not build registration.
- **EARS-9 reads the cabinet's public-display consent flag.** 018 consumes it and never writes it; the consent control is the cabinet's deliverable.
- **EARS-4 links into feature 019**, which in turn is `blocked_by` 018 for the card anatomy — the dependency runs one way in each direction and neither block builds the other's surface.
- **Features 019 / 023 / 024 and the home-page selections consume EARS-2's card unit** and must not re-define it.

## Open questions carried forward

These stay open; each is designed around above rather than resolved here, and each is a product decision the owner still owns.

- **Whether the communities block belongs to 018 at all** — the PRD and the canvas carry it, the functional map assigns REQ-120 to 027 / 022. LD-5 ships the read-only list so the screen matches the canvas; an owner ruling either keeps it or deletes one block.
- **What «Готовится» means operationally and whether a doctor may register interest** — LD-4 ships the publication state and no control.
- **How deep each block runs before a doctor needs more** — LD-3 fixes a per-block depth with a link-out and no in-page paginator.
- **Whether ordering ever becomes per doctor** — LD-1 ships one fixed order and rules out any recommendation claim; a later ordering strategy is a product decision on top of an unchanged read contract.
- **Where the mobile-application line leads** — LD-6 keeps it plain text until the application ships its own destination.
- **The canvas payer line** — an owner-side canvas fix is pending; LD-9 fixes the operative copy and refuses the canvas string in the meantime.
