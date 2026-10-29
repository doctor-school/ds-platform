---
title: "048 — Materials feed: own materials, the reading page and the rail on the Academy home (Requirements, slice 1)"
description: "Requirements for slice 1 of feature 048: platform administrators write news items and expert columns in apps/admin with a TipTap rich-text editor of @ds/design-system, preview, publish, edit and unpublish them; every published material becomes an entry of the one materials feed that later network connectors also write; the Academy home shows that feed as one horizontal rail «Новости, блог и видео» — newest first, the next card partly visible, ←/→ on desktop, swipe on a phone, keyboard scrolling, older materials loaded near the end, honest loading / empty / error states, nothing moving or playing by itself; each material has its own reading page on academy.doctor.school; the doctor storefront shows nothing of the feed; platform-administrator-only writes with the second factor and the 010 change audit. No network connector, source list or per-material hiding in this slice."
slug: 048-materials-feed
status: Draft
issues: []
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/issues/3403
prior_decisions:
  - "ADR-0016 §4 — the project is the single container; attributing a material to a project is the later 030 slice «Закулисье», not slice 1 of 048"
  - "ADR-0016 §8 — every entity declares its storefront ownership; materials and feed entries are `academy` (and the admin); the doctor storefront has no feed and no reading page"
  - "ADR-0015 — two storefronts from one code; the rail and the reading page are Academy-host surfaces"
  - "ADR-0014 §2 — every EARS clause carries `realizes: US-N` of `048-product.md`"
  - "ADR-0006 §4 — triplet layout, flat EARS numbering"
  - "ADR-0013 §A1 — one capability, one owner package: one feed card and one rail for every source; ADR-0013 — UI from `@ds/design-system`"
  - "ADR-0004 design §10.1 — Payload owns marketing content only and no domain data; materials are written in `apps/admin` and stored through the platform API; ADR-0004 design — rich text is TipTap with custom extensions, loaded by dynamic import"
  - "ADR-0002 / ADR-0003 — NestJS + Zod contract in `packages/schemas` + Drizzle schema in `packages/db`"
  - "012 — the experts directory and its public display name, the media contract of covers, the admin session, idempotency, precondition, audit and list contracts (EARS-16 / EARS-17 / EARS-23)"
  - "047 — `platform_admin` in the dedicated admin session with the second factor"
lang: en
---

> **EN (this)** · **RU:** [`048-requirements-ru.md`](./048-requirements-ru.md)
>
> Product source: [`048-product.md`](./048-product.md) («Delivery slices», item 1). Public UI: the canvases `design-source/unit-feed-card.dc.html` and `design-source/academy-home.dc.html` (rail «Новости, блог и видео», switch `scope` = «срез 1», `data` norm / load / empty / err), vendored by PR #3500 (Stage A pending). The reading-page canvas `academy-material.dc.html` is not drawn yet: its behaviour is specified here, its look is a Stage-A gate of its package ([`048-design.md`](./048-design.md) «UI composition»). Admin UI: approved-non-canvas (the admin-screen default of #3490) except the rich-text editor, which goes to Stage A as one element (PRD Flows step 1). Hence `surface: user-facing`.

# 048 — Materials feed: own materials, the reading page and the rail on the Academy home (Requirements, slice 1)

## Outcomes

- A platform administrator writes a news item or an expert column in the admin, previews it, publishes it, and it is the first card of the rail on the Academy home with no release and no page editing.
- An edit or an unpublish of a material shows on the site on the next read; an unpublished material is on no public surface.
- The Academy home carries one horizontal rail of materials, newest first, that a visitor moves with ←/→, a swipe or the keyboard, that loads older materials near its end and never moves or plays by itself.
- Every own material has its reading page on `academy.doctor.school`; every card leads to a page that exists.
- The feed is one store of entries in one card shape, so each later network slice adds a connector and changes nothing built here (PRD US-10).

## Scope

- The «Материалы» section of `apps/admin`: list, full-page form with the rich-text editor, preview, publish and unpublish, built from the approved admin kit of `@ds/design-system` plus its new rich-text editor primitive.
- The material and feed-entry tables in `packages/db` with their forward migration; the admin material endpoints, the public feed read and the public material read in `apps/api`; their Zod contract, including the rich-text body document, in `packages/schemas`.
- The shared feed card, the rail and the rich-text renderer in `@ds/design-system`; the reading page route `/materials/{slug}` and the rail section of the Academy home in `apps/portal`.

### Out of scope

- The admin source list (US-3), automatic intake from networks (US-4), hiding one external material (US-5) and external cards opening on their platform (US-7) — slices 2–5 of 048, one network each (Telegram, VK / VK Видео, RuTube, Dzen).
- The partner mark «Партнёрский материал · <партнёр>» on a card — not part of slice 1 (PRD «Delivery slices» item 1 and the US-1 field set name no partner); it arrives with a later 048 slice that takes the partner from the 032 organisation registry, `blocked_by` 032 slice 1 (#3492).
- Attributing a material to a project — the later 030 slice «Закулисье».
- Linking a column's author to the expert's page — `blocked_by` 031 (expert page); slice 1 shows the expert's name as plain text.
- Experts writing their own columns in a cabinet (REQ-124 in full) — a later 048 slice.
- Images, video or embeds inside the body of a material; the cover is the material's only image.
- A full «all news» archive page; a feed on the doctor storefront; comments, likes, view counters, subscriptions.
- The Academy home re-layout and the final placement of the rail — 029; slice 1 places the rail in today's home (EARS-14).
- Roles narrower than `platform_admin` — 039.

## Constraints

- Materials are platform domain data written through `apps/api` from `apps/admin`, never through Payload `apps/cms` (ADR-0004 design §10.1).
- The rail reads only the feed-entry store; nothing on the home holds a material of its own (PRD acceptance «the 029 home … holds no materials of its own»).
- A material's body is a structured rich-text document restricted to one allowlisted node and mark set; it is never stored or rendered as raw HTML.
- The doctor storefront (`apps/doctor`) serves no feed, no rail and no reading page and imports no feed or material contract (ADR-0016 §8).
- A slug is system-generated and permanent after the first publish (012 authoring contract).
- Only card data and the material itself are stored; no network data exists in slice 1.

## Prior decisions

- PRD [`048-product.md`](./048-product.md) slice 1, its owner decisions of 2026-10-28 / 2026-10-29 and its lead decisions (one mixed rail replacing «Новости и блог» and «Рилсы и видео»; horizontal rail with the next card partly visible, always-visible ←/→ on desktop, no auto-rotation, no autoplay; columns written by the team on the expert's behalf; materials written in `apps/admin` with a TipTap editor, not Payload; source line «BBM Academy · <network>» for the later network cards).
- The settlements of the PRD's _agent-proposed — UNCONFIRMED_ items are recorded in [`048-design.md`](./048-design.md) «Lead decisions».
- ADR-0016 §4, §8; ADR-0015; ADR-0014 §2; ADR-0006 §4; ADR-0013 §A1; ADR-0004 design §10.1; ADR-0002 / ADR-0003 (frontmatter `prior_decisions`).
- 012 — experts directory (`experts`, public display name), cover media contract, EARS-16 / EARS-17 (admin session, CSRF, idempotency, preconditions, 010 audit), EARS-23 (list search and filters); 047 — `platform_admin`.

## Event Model

**Commands** — `CreateMaterial`, `UpdateMaterial` (kind, title, author, cover, body), `PublishMaterial`, `UnpublishMaterial` (platform administrator).

**Events** — `MaterialCreated`, `MaterialUpdated`, `MaterialPublished`, `MaterialUnpublished`, each a 010 change-audit row under the request's actor; `FeedEntryWritten`, `FeedEntryRemoved` — the feed-entry consequences of a publish, an edit of a published material and an unpublish, in the same transaction.

**Read models** — the admin material list and detail; the public feed page (cards, newest first, with a continuation cursor); the public material.

**Policies** — «a material is public only while it is published and, for a column, its expert is published»; «the feed is read only from feed entries»; «a published material has exactly one feed entry, an unpublished one none»; «the card date is the first publication instant and never moves on edit»; «the body is an allowlisted document, never HTML»; «the doctor storefront reads nothing of the feed».

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more PRD stories and is covered by `048-scenarios.feature`.

- **EARS-1** _(realizes: US-1)_ — WHEN a platform administrator creates or edits a material on the «Материалы» full-page form, THE SYSTEM SHALL persist the retained `materials` row with the kind — «Новость» (`news`) or «Колонка эксперта» (`column`) —, the title (trimmed 1–160), the optional normalized cover of the 012 media contract and the body of EARS-2; for a news item the optional author line «Автор» (trimmed 0–120, plain text), for a column the required expert chosen from the non-retired experts of the 012 directory, the author line then stored empty; a new material SHALL be a draft; a refused write SHALL show its field-addressed reasons on the form and change nothing.
- **EARS-2** _(realizes: US-1, US-8)_ — WHEN the rich-text editor of the material form edits the body, THE SYSTEM SHALL offer only the allowlisted set — paragraphs, headings of levels 2 and 3, bold, italic, bulleted and numbered lists, block quotes, line breaks and links — and SHALL strip anything else on paste; WHEN a body is written, THE SYSTEM SHALL store it as a structured document of exactly that set and SHALL refuse with a field error, storing nothing, a body containing another node or mark, a link whose target is not an absolute `https:`, `http:` or `mailto:` address, more than 60 000 characters of text or nesting deeper than 6 levels.
- **EARS-3** _(realizes: US-1)_ — WHEN a platform administrator chooses «Предпросмотр» on the material form, THE SYSTEM SHALL show the current, possibly unsaved, form content as the reading page of EARS-12 renders it, marked «Предпросмотр — материал не опубликован», without saving, publishing or changing the feed.
- **EARS-4** _(realizes: US-1, US-6)_ — WHEN a platform administrator publishes a draft material («Опубликовать»), THE SYSTEM SHALL refuse with `409 PUBLISH_REQUIREMENTS_NOT_MET` and field errors naming each missing item — the title, a body with at least one character of text and, for a column, a published expert — and otherwise SHALL, in one transaction, set `first_published_at` once, transition the material to `published` and write its feed entry; the material SHALL be the first card of the rail on the next read unless a material with a later first publication exists.
- **EARS-5** _(realizes: US-2)_ — WHEN a platform administrator saves an edit of a published material, THE SYSTEM SHALL apply it under the material's `If-Match` version and, in the same transaction, rewrite its feed entry, so the card and the reading page show the change on their next read; the card date SHALL stay the first publication instant; an edit that would leave a publish-required item of EARS-4 missing SHALL be refused with the same code and change nothing.
- **EARS-6** _(realizes: US-2)_ — WHEN a platform administrator unpublishes a published material («Снять с публикации») and confirms, THE SYSTEM SHALL, in one transaction, return it to `draft` with its content kept and remove its feed entry, so it leaves the rail and its reading page answers not found on the next read; WHEN the administrator publishes it again, THE SYSTEM SHALL restore its card at its first publication instant.
- **EARS-7** _(realizes: US-1, US-2)_ — WHEN a platform administrator opens «Материалы», THE SYSTEM SHALL list every material on the `AdminDataList` composition with its title, kind, status, first publication date and author, most recently changed first, with search by title and filters by kind and status (012 EARS-23), the action «Новый материал» and an empty state when there is none; a published column whose expert is no longer published SHALL be marked «Не на сайте: эксперт не опубликован».
- **EARS-8** _(realizes: US-1, US-2)_ — THE SYSTEM SHALL serve the «Материалы» section and every admin material endpoint only to a `platform_admin` in the dedicated admin session with the second factor (011, 047), with CSRF, and SHALL refuse anyone else server-side and hide the section from their navigation; every mutating endpoint SHALL require a canonical UUID idempotency key and, except for create, the current `If-Match` version per 012 EARS-17, refusing a stale version with `412 PRECONDITION_FAILED`; every change to a material SHALL be recorded in the 010 change audit under the acting administrator.
- **EARS-9** _(realizes: US-6, US-10)_ — WHEN any caller reads `GET /v1/public/feed` with an optional `cursor` and a `limit` of 1–24 (default 12), THE SYSTEM SHALL return the public feed entries newest first by publication instant, ties by id, as cards of the common shape — `id`, `kind` (`news` | `column` in slice 1), `title`, `publishedAt`, `image` (`{ url }` or `null`), `source` (`{ platform: "academy", name }`, the name «Академия» for a news item and the expert's public display name for a column) and `href` (`/materials/{slug}`) — with no body, and `nextCursor`, `null` after the last entry; a column whose expert is not published SHALL be absent; a malformed cursor SHALL be refused with `400`.
- **EARS-10** _(realizes: US-10)_ — THE SYSTEM SHALL serve the feed read of EARS-9 only from the feed-entry store, in which every entry names its source platform and its source record, the own-materials writer of EARS-4…EARS-6 being the only writer in slice 1; no field of a card SHALL be specific to the own-materials source, and the feed card SHALL render from the card alone.
- **EARS-11** _(realizes: US-8)_ — WHEN any caller reads `GET /v1/public/materials/{slug}`, THE SYSTEM SHALL answer a public material with its slug, kind, title, `publishedAt`, cover URL or `null`, the author — the news author line or the column expert's public display name, with no expert slug or link — and its body document; a draft, unknown or non-public material SHALL be answered `404` alike.
- **EARS-12** _(realizes: US-8)_ — WHEN a visitor, signed in or not, opens `academy.doctor.school/materials/{slug}` of a public material, THE SYSTEM SHALL render the kind («Новость» / «Колонка эксперта»), the title, the publication date, the author as plain text, the cover when there is one, and the body through the shared rich-text renderer, with no raw HTML, every link to another host opening in a new tab with `rel="noopener noreferrer"`, a way back to the Academy home, and the material's title as the document title; WHEN the material is not public, THE SYSTEM SHALL render the Academy not-found page; WHEN the read fails, THE SYSTEM SHALL show the error state with «Повторить».
- **EARS-13** _(realizes: US-6)_ — WHEN the shared feed card renders a card, THE SYSTEM SHALL show the image or, without one, the no-image layout; the kind mark «Новость» or «Колонка эксперта»; the title clamped to the lines the card holds; the source — «Академия» with the Academy logo for a news item, the expert's name with initials for a column —; and the date as day and month (with the year when it is not the current one, in Moscow time); the whole card SHALL be one keyboard-reachable link to its `href` in the same tab; slice 1 SHALL show no partner mark, no duration and no network mark.
- **EARS-14** _(realizes: US-6)_ — WHEN a visitor opens the Academy home, THE SYSTEM SHALL render, after the events block, the section «Новости, блог и видео» with the kicker «Соцсети и блог» and the line «Что выходит в Академии и в наших соцсетях», and the rail of the first EARS-9 page: on a desktop two rows of cards with the next column partly visible and the buttons ← («Назад к более новым материалам») and → («Дальше, к более ранним материалам») always shown, ← disabled at the start and → disabled at the end once nothing more is to load, each press moving by the visible width; on a phone one row with the next card partly visible, moved by swipe, with no buttons; the rail SHALL be focusable, move one card on ArrowLeft / ArrowRight and to its ends on Home / End, move by mouse drag on a desktop, scroll without animation under reduced motion, and SHALL never move, rotate or play anything by itself.
- **EARS-15** _(realizes: US-6, US-9)_ — WHEN the rail is scrolled to within one and a half cards of its end and the last page carried a `nextCursor`, THE SYSTEM SHALL request the next page (8 cards on a desktop, 6 on a phone), show trailing placeholder cards while it loads, mark the rail busy and announce «Загружаем более ранние материалы», then «Загружено материалов: N» and, after the last page, «Это все материалы.»; WHEN the next page fails, THE SYSTEM SHALL keep every loaded card, announce «Не удалось загрузить более ранние материалы» and offer «Повторить» at the end of the rail.
- **EARS-16** _(realizes: US-9)_ — WHILE the first feed page is loading, THE SYSTEM SHALL show placeholder cards (10 on a desktop, 3 on a phone) with both buttons disabled; WHEN the feed has no entry, THE SYSTEM SHALL show «Записей пока нет.» with «Здесь появятся новости Академии и публикации из наших соцсетей.» and no rail and no buttons; WHEN the first page cannot be read, THE SYSTEM SHALL show «Не удалось загрузить новости.» as an alert with «Повторить», which reads the first page again; the rest of the home SHALL keep working in each case, and no state SHALL show an invented entry.
- **EARS-17** _(realizes: US-6, US-8)_ — THE SYSTEM SHALL serve the rail and the reading page only on the Academy host: the doctor storefront SHALL have no `/materials` route, render no feed, and import no feed or material contract, and doctor-storefront requests for `/materials/{slug}` SHALL get its not-found page.
- **EARS-18** _(realizes: US-1, US-6, US-8)_ — WHILE the viewport is a phone or a narrow screen, THE SYSTEM SHALL keep the rail, the reading page, the admin material list and the material form with its editor usable without horizontal scrolling of the page, with every card, button and editor control keyboard-reachable, and each of these screens SHALL pass the platform's `playwright-axe` gate.

## Invariants

- Nothing on the Academy home or the reading page shows a material that is not public; a public material is published and, for a column, has a published expert (EARS-4, EARS-6, EARS-9, EARS-11).
- A published material has exactly one feed entry and a draft has none, written in the transaction of the change (EARS-4, EARS-5, EARS-6).
- The card date is the first publication instant; no edit and no re-publish moves a card (EARS-5, EARS-6).
- The feed is read from feed entries only, and a card carries nothing that only an own material has (EARS-10).
- No body is stored or rendered as HTML; every stored body belongs to the allowlisted set (EARS-2, EARS-12).
- No card or page links to a page that does not exist: an own card leads to its reading page, and the author links nowhere before 031 (EARS-11, EARS-12, EARS-13).
- Nothing in the rail moves or plays by itself (EARS-14).
- Every material write is made by a `platform_admin` with the second factor and leaves one 010 audit row (EARS-8).

## Verification

| #    | Type                                | What it proves                                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Vitest — `packages/schemas`         | The body contract accepts every allowlisted node and mark and refuses another node, another mark, a relative or `javascript:` link, a text over 60 000 characters and nesting over 6 levels (EARS-2).                                                                                                                             |
| V-2  | Vitest e2e — `apps/api`             | Material create / edit for news and column; bounds; a column without an expert or with a retired one refused; a news author line kept and a column's emptied; a refused write changes nothing (EARS-1, EARS-2).                                                                                                                   |
| V-3  | Vitest e2e — `apps/api`             | Publish refused for each missing item with its field error; publish sets `first_published_at` once and writes one feed entry; an edit rewrites the entry and keeps its date; an edit emptying the body refused; unpublish removes the entry and returns to draft; re-publish restores the original date (EARS-4, EARS-5, EARS-6). |
| V-4  | Vitest e2e — `apps/api`             | The feed read: newest first with ties by id, cursor pages without gaps or repeats across inserts, `limit` bounds, malformed cursor `400`, `nextCursor` `null` at the end, no body; a column with an unpublished expert absent; the material read and the identical `404` for draft, unknown and non-public (EARS-9, EARS-11).     |
| V-5  | Vitest e2e — `apps/api`             | Every admin material endpoint refuses a non-`platform_admin` and a session without the second factor; a missing idempotency key and a stale `If-Match` refused; each write leaves one 010 audit row with the actor (EARS-8).                                                                                                      |
| V-6  | Vitest — `packages/db` + `apps/api` | The feed read touches only the feed-entry table; every entry names its source platform and record; the card schema has no own-material-only field (EARS-10).                                                                                                                                                                      |
| V-7  | Vitest — UI                         | The rich-text renderer: every allowlisted node, an external link with `target` and `rel`, no `dangerouslySetInnerHTML`; the editor strips a pasted image and table (EARS-2, EARS-12). The feed card: image vs no-image, news vs column source, the date with and without the year, one link per card, no partner mark (EARS-13).  |
| V-8  | Vitest — UI                         | The rail: arrows disabled at start and end, keyboard steps and Home / End, next-page request near the end, live announcements, a failed next page keeps the cards and offers «Повторить»; the loading, empty and error states (EARS-14, EARS-15, EARS-16).                                                                        |
| V-9  | Playwright / E2E — admin            | A platform administrator writes a news item and a column with formatted text, previews it, is refused publish without a body, publishes, edits the title, unpublishes and publishes again; the list filters by kind; a registrar has no «Материалы» (EARS-1…EARS-8).                                                              |
| V-10 | Playwright / E2E — Academy          | A visitor sees the published material first in the rail, moves the rail with → and the keyboard, older cards load near the end, opens a card and reads the page; an unpublished material's address is not found; the empty and error states with «Повторить» (EARS-11…EARS-16).                                                   |
| V-11 | Playwright / E2E — doctor           | `doctor.school/materials/{slug}` renders the doctor not-found page and the doctor home shows no rail (EARS-17).                                                                                                                                                                                                                   |
| V-12 | Playwright + axe                    | At a 390 px viewport the home rail swipes with the next card partly visible, the reading page, the material list and the form with the editor have no horizontal page scroll; clean `playwright-axe` runs on each (EARS-18).                                                                                                      |

## Work-package map

Each Issue is a sub-issue of #3403 and ships its UI with its backend; slices and dependencies: `048-design.md` («Delivery slices»). Issue numbers are written back by `open-ears-issues`.

| EARS                                           | Issue | Work package                                                                                       |
| ---------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| EARS-2                                         | —     | **Rich-text body** — body contract, TipTap editor primitive, shared renderer                       |
| EARS-1, EARS-4, EARS-5, EARS-6, EARS-7, EARS-8 | —     | **Materials authoring** — tables and migration, admin endpoints, «Материалы» list and form, access |
| EARS-9, EARS-10, EARS-11                       | —     | **Public reads** — feed read and material read                                                     |
| EARS-3, EARS-12, EARS-17                       | —     | **Reading page** — `/materials/{slug}`, admin preview, doctor-host absence                         |
| EARS-13, EARS-14, EARS-15, EARS-16             | —     | **Feed card and home rail** — shared card, rail, paging and states on the Academy home             |
| EARS-18, V-9 / V-10 journeys (EARS-1…EARS-17)  | —     | **Browser journeys** — CI Playwright admin and Academy journeys, narrow screens and axe            |
