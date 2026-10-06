---
title: Wave-2 entry gate — events-storefront behaviour matrix, EARS disposition, PR sequence
status: Draft — slice 0 of #2028
---

# Wave-2 entry gate — `@ds/events-storefront`

## 1. Purpose and established facts

This is the wave-entry gate required by `2026-09-07-one-code-two-storefronts-plan-en.md` §4 («Wave-entry gate», the paragraph opening «The wave Issue carries a **behaviour matrix**»). No code PR of wave 2 (#2028) opens until every row below carries a test id and an explained difference. The document is slice 0 of #2028 and changes no code; the wave-1 gate (`2026-09-15-auth-flow-wave-1-entry-gate-en.md`) is its template.

- **Scope.** The events surfaces of both storefront hosts that wave 2 folds into `packages/events-storefront`: the Academy listing `/webinars` with its month view and the viewer page `/account/events` (`apps/portal`), the doctor feed `/events` with its live block and month band, and the doctor home nearest-events block (`apps/doctor`). The unit list is the wave-2 row of plan §4: `components/{discovery-listing,event-list-router,calendar-shell,month-calendar-view,month-calendar-mobile,view-switcher}.tsx`, `lib/{public-events,my-events,month-grid,event-lifecycle,msk,recording-signal,recording-cta,participation-cta}.ts`, `app/webinars/page.tsx`, `app/account/events/page.tsx` from `apps/portal`; `app/(storefront)/events/page.tsx` + `events/month-pane.tsx`, `lib/{events-feed,events-feed-cards,events-live,events-month,events-month-grid}.ts` from `apps/doctor`. Two units the plan row does not name travel with them because the listing cannot move without them: `apps/portal/lib/webinars-url.ts` (the Academy URL codec) and the three doctor client islands beside the route — `events/{live-block,day-anchor-scroll,resume-anchor-scroll}.tsx`.
- **Canvas precondition met.** #2076 is closed: ONE canvas `design-source/events-feed.dc.html` (+ module `events-feed-kit.js`) switched by a `host` prop (`витрина врача | Академия`), vendored by PR #2567; `doctor-events.dc.html` and `events-feed-month.dc.html` are archived under `design-source/archive/` and are no longer a composition source (plan §6 table, row «`doctor-events.dc.html` vs `events-feed.dc.html`»).
- **Design-system support merged.** #2578 — `EventsFilter` renders the host's facet set (doctor · Академия); #2577 — `WebinarCard` venue-local time slot for hybrid events and separate kind and format labels; #2579 — `EventList` sticky day / month group plates with a header offset. The wave composes these blocks; it does not re-draw them.
- **One event-time formatter.** `formatEventTime` is owned by #2539 (landed in #2622) at `packages/schemas/src/events/event-time.ts` and re-exported by `@ds/events-storefront` (`packages/events-storefront/src/index.ts`). No host formats an event time itself (004 «Amendment — 2026-10-02», «One formatter»).
- **What `@ds/events-storefront` holds today.** Only the one-tap registration (#2005: `client/registration-client.ts`, `client/registration-resume.ts`, `server/register-action.ts`, `server/registration-state.ts`, `ui/register-one-tap.tsx`) and `useViewerZone` (`ui/use-viewer-zone.ts`). Exports: `.`, `./client`, `./ui`, `./server`. Per plan §4 L148 the wave-2 sequence starts from this surface.
- **Event audience and kind landed.** #2509 landed (PR #2610): the event-kind dictionary and the event audience `doctors | experts`, the audience being the only storefront selector (012 LD-11, LD-12). The doctor read `GET /v1/storefront/doctor/events` and the Academy read `GET /v1/public/events` already select their content sets server-side.
- **`mirror-of` markers.** `grep -rn "mirror-of: " apps/doctor` returns nothing (plan §3, «Lifetime of a copy»); step (d) of the four wave steps is satisfied by construction. The doctor events units are the pre-existing fork the matrix lists, not marked copies.

**Owner decisions already in approved spec text** — cited, not restated as new:

- 019 **LD-11** (one module on both storefronts; the permitted differences are the content set, the filter set and the header copy — «any other storefront difference is a defect, not a product fact»), **LD-12** (the open event-kind dictionary — verbatim «урок - контент ленты специальности. Список видов события может пополняться. Надо как-то заложить возможность его расширения, он пока не фиксирован.»), **LD-13** («Прошедшие» is the one archive mechanism; «the Academy's separate archive tab retires in favour of this tense»), **EARS-16 / EARS-17 / EARS-18**, the «Differences between storefronts» table (`contentSet`, `filterSet`, `headerCopy`), and the amendments 2026-10-01 (kind from the dictionary, format = delivery mode), 2026-10-02 (event time in the viewer's zone) and 2026-10-05 (the feed per the approved canvas: tense tabs «Прошедшие | Будущие» with «Будущие» default, the month view on the same page, the 1024 px sticky column / «Фильтры (N)» sheet, at most two live strips, a three-row «Мои события», Pul-only cost, the two-option specialty facet, the facet set from the host).
- 012 **LD-11** (the kind is an open dictionary entity with allowed formats) and **LD-12** (the audience is the only storefront selector).
- 004 «Amendment — 2026-10-01» (the Academy content set is `experts`; the Academy listing is the shared module at its Academy `host`; the archive tab retires), «Amendment — 2026-10-02» (online and hybrid times in the viewer's zone, offline in МСК; server renders МСК and the client re-formats; mixed lists group by the shown day; one formatter) and «Amendment — 2026-10-05» (the Academy listing per the canvas: no «Неделя / Месяц» switcher, the month view reached by «Календарь на месяц →» and left by «← Лента событий», the month geometry at 1024 px).
- 014 «Amendment — 2026-10-01», verbatim: «The «Предстоящие · N | Прошедшие · N» tabs of EARS-11 become the «Будущие / Прошедшие» tense switch of the shared events-feed module (019 EARS-10, LD-13): the past reading is the same feed, the same card unit in its post-live state with the recording action, the same facet panel (EARS-12…EARS-14) and the same URL-state contract (LD-11 here, 019 LD-1), grouped by month newest first, over the Academy content set of 004 «Amendment — 2026-10-01». No separate archive tab, page or block («Архив записей») is rendered.» Its «What does not change» keeps «the personal «Мои события» page with its own «Предстоящие | Записи» tabs, which is a viewer's history and not the events feed».
- Owner decision (5), «убрать "бесплатно по Pul" — все события бесплатны для врача», **is in spec text twice**: as the facet rule in 019 LD-4 (verbatim «"бесплатно по Pul" - это можно убрать, они все будут бесплатными для врачей» — no free-by-Pul facet) and as the card rule in 019 «Amendment — 2026-10-05», «Card cost (EARS-2)» («an event without a Pul cost shows no cost line and no free-of-charge wording — «бесплатно для врача» is retired»).
- Owner decision (6), the doctor topic facet = the existing `directions`, **is in spec text**: 019 LD-4, «The topic facet is **direction** (feature 012's topics, stored in `directions`) until a medical-topic taxonomy carries content», and the `filterSet` row / 2026-10-05 «Facet set from the host» («Направление»).

Decisions not yet in spec text (for part 2): none of (5) / (6). The owner questions this matrix raises are the `OPEN — owner question` rows of section 2, collected in §2.7.

## 2. Behaviour matrix

TODO

### 2.1 PR 2.1 — Academy move

| #   | Scenario | Academy behaviour (file:line) | Doctor behaviour (file:line) | Shared contract | Allowed difference | Test id(s) |
| --- | -------- | ----------------------------- | ---------------------------- | --------------- | ------------------ | ---------- |

### 2.2 PR 2.2 — doctor mounts

| #   | Scenario | Academy behaviour (file:line) | Doctor behaviour (file:line) | Shared contract | Allowed difference | Test id(s) |
| --- | -------- | ----------------------------- | ---------------------------- | --------------- | ------------------ | ---------- |

### 2.3 PR 2.3 — 2026-10-01 behaviour changes

| #   | Scenario | Academy behaviour (file:line) | Doctor behaviour (file:line) | Shared contract | Allowed difference | Test id(s) |
| --- | -------- | ----------------------------- | ---------------------------- | --------------- | ------------------ | ---------- |

### 2.4 Out of the matrix

TODO
