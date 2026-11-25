---
title: "Feature 029 — Academy home relaunch after the narrowing to backstage (PRD)"
description: "Product requirements for feature 029: the Academy home at academy.doctor.school/ rebuilt on the owner-drawn canvas for its real audience — experts and partners, not doctors. A split hero with an entry per persona and counts computed from the platform, «Кто мы» with the mission and the evolutionary goal, «Что мы делаем» from the 030 projects, the nearest events through the shared 019 block, the 048 materials rail and the persona entries to the 033 and 034 application pages. Every block reads an admin-managed model; nothing on the page is a hand-set value. Re-specifies the composition of feature 013. Feature 029 of the two-site IA epic; source of the 029 EARS triplet (ADR-0014)."
slug: 029-academy-home-relaunch-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
storefronts: academy-only
storefronts_reason: "The Academy home at / of apps/portal only; the doctor storefront home is feature 017, which mounts the same 019 nearest-events block (#1485)."
lang: en
---

> **EN (this)** · **RU:** [`029-product-ru.md`](./029-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · Functional-map registry row 029 (`apps/docs/content/specs/product/two-site-ia/functional-map-ru.md` §B) is the scope of record. Owner decisions are recorded on [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions» (2026-10-28), [#3403](https://github.com/doctor-school/ds-platform/issues/3403) (2026-10-29), [#1485](https://github.com/doctor-school/ds-platform/issues/1485) (2026-11-03) and in chat (2026-11-10, 2026-11-11, 2026-11-25). Lead decisions are marked _(lead decision; owner sees it at Stage A)_; anything else this PRD adds is marked `agent-proposed — UNCONFIRMED`.

## Feature summary

The Academy (`academy.doctor.school`) is the platform's backstage: its audience is **experts** who make education and **partners** — organisations that invest in it — not doctors, who have their own storefront `doctor.school` (OWD-5, ADR-0016). Today's home is still feature 013's dual-audience landing of August 2026: a doctor-first argument, fixture texts, fixture experts and fixture events, a lead form and, since 048 slice 1, the materials rail. Feature 029 rebuilds `/` on the owner-drawn canvas `design-source/academy-home.dc.html` for that real audience.

Owner principle, 2026-10-28: «не городить временные костыли, которые потом заведомо будут убраны, а сразу делать нормально — дорабатывать модель данных, если надо, делать админку для ведения справочников» — every block of the home reads a real model the admin keeps; there are no hand-set values and no «later» placeholders. Owner, 2026-11-11: the home ships in a minimal composition on top of the **first slices** of the features it reads, not after whole catalogs. Owner, 2026-11-25: «вести работу над тем, что нужно для реализации главной, параллельно» — the prerequisites run in parallel and the home goes first on the Academy track.

The page, top to bottom, follows the canvas switch defaults (#1799: «its switch defaults are the decision»; goal = variant А):

1. **Split hero** — the line «Академия Doctor.School · закулисье платформы» and two cards: **«Экспертам»** («Создавайте образование вместе с нами», «Подать заявку», a line with the number of projects in production and of experts) and **«Партнёрам»** («Постройте репутацию в экспертной среде», «Как это работает», a line with the number of partners and «прозрачная модель»).
2. **«Кто мы»** — what Doctor.School is, with the row «Миссия | Эволюционная цель».
3. **«Что мы делаем»** — the first three projects of the «Все проекты» catalog with «Все проекты →» (feature 030).
4. **«Ближайшие эфиры»** — the nearest events through the shared events block with a cap and «Все события» (feature 019, owner decision 2026-11-03, #1485).
5. **«Новости, блог и видео»** — the one horizontal materials rail (feature 048; it replaced the canvas blocks «Новости и блог» and «Рилсы и видео», owner decision 2026-10-29, #3403). Networks join it as later 048 slices and do not change the home.
6. **Two persona entries** — «Экспертам» («Ваше имя — в проектах Академии», «Подать заявку на участие в проекте») and «Инвесторам» («Внимание врачей для вашего бренда — этично и прозрачно», «Как это работает»).

## User stories

- **US-1** — As an **expert** or a **partner** who opens the Academy for the first time, I see in the first screen that this is the Academy's backstage and which entry is mine — «Экспертам» or «Партнёрам» — without reading an argument written for doctors.
- **US-2** — As a **visitor**, the numbers in the first screen — projects in production, experts, partners — are real numbers computed from the platform at the moment I open the page, never figures someone typed in; a number the platform cannot give me right now is left out, never faked.
- **US-3** — As a **visitor**, I read who Doctor.School is, its mission and its evolutionary goal in the owner's words, without a «coming soon» mark.
- **US-4** — As a **visitor**, «Что мы делаем» shows the Academy's real projects as they are kept in the admin and takes me on to «Все проекты» and to each project's page.
- **US-5** — As a **visitor**, I see the nearest events in the same block the events page and the doctor storefront home use — the same cards, marks, empty and error states — with «Все события» to the full listing.
- **US-6** — As a **visitor**, the home carries one rail of the Academy's latest materials, newest first, as feature 048 defines it.
- **US-7** — As an **expert**, both «Экспертам» entries — the hero card and the persona block — take me to the real «Подать заявку» page (033), never to a dead end.
- **US-8** — As a **partner**, both partner entries — the «Партнёрам» hero card and the «Инвесторам» persona block — take me to the real «Как это работает» page (034), never to a dead end.
- **US-9** — As a **product owner**, publishing, retiring or reordering a project, publishing an expert or an organisation, or publishing a material changes the home on its next read with no release and no page editing.
- **US-10** — As a **visitor on a phone**, the whole page reads and works as well as on a desktop, and it passes the platform's accessibility bar.
- **US-11** — As a **product owner**, the 013 landing's doctor-first argument, fixture texts, fixture experts and fixture events are gone from `/`; the home holds no content of its own besides its fixed copy.

## Flows

**Expert (US-1, US-2, US-7):**

1. The visitor opens `/` → the split hero; the «Экспертам» card reads «N проектов в производстве · M экспертов».
2. The visitor taps «Подать заявку» in the hero, or scrolls to the «Экспертам» persona block and taps «Подать заявку на участие в проекте» → `/apply` (033 EARS-2 owns that route and its account gate).

**Partner (US-1, US-2, US-8):**

1. The visitor opens `/` → the «Партнёрам» card reads «K партнёров · прозрачная модель».
2. The visitor taps «Как это работает» in the hero or in the «Инвесторам» persona block → `/investors`, the 034 investor page, with its «Обсудить проект» form into the shared application queue.

**Content (US-4, US-5, US-6):** «Что мы делаем» → a project card → `/projects/{slug}`, or «Все проекты →» → `/projects`; an event card → its event page, or «Все события» → `/webinars`; a material card → its reading page or its original.

**Branches:**

- **A count read fails or the count is zero** → that number is left out of its line; the rest of the page renders (US-2).
- **No public project** → «Что мы делаем» is not shown (030 EARS-12).
- **No nearest event / the events read fails** → the shared block's own empty state or its error state with «Повторить» (019).
- **No material / the feed read fails** → the rail's own empty or error state (048 EARS-16).

**Partner entry before 034 slice 1 ships.** The partner entries are a separable part of this feature: they lead to a page that does not exist until 034 slice 1 lands. _(agent-proposed — UNCONFIRMED; the lead decides with the owner whether the home ships before 034 slice 1.)_ If the home ships first, the «Партнёрам» card's action and the «Инвесторам» persona block are not rendered, and the home keeps the existing partnership form — whose submissions already go into the shared application queue by 033 EARS-18 — as its last section, so a partner is never left without a way in; the 034 entries then replace that form. If the home waits for 034 slice 1, it ships with both entries and without the form.

## Product acceptance criteria

- `/` on the Academy renders the six parts above in the canvas order, for a guest and a signed-in visitor alike; the doctor storefront's `/` is untouched.
- The hero's three numbers are computed from the platform at the moment of the request: projects in production — public projects at the stage «проект идёт» (030); experts — published experts (012 registry); partners — published organisations (032 EARS-12). Nobody types them; a failed or zero count is left out, never shown as «0» or as a stale figure.
- «Что мы делаем» is the 030 home block, «Ближайшие эфиры» is the shared 019 events block with a cap, the rail is the 048 rail — each with its own states; the home adds no second implementation of any of them.
- Both «Экспертам» entries lead to `/apply`; both partner entries lead to `/investors` (034); no entry leads to a dead link or an in-page placeholder.
- The mission, the evolutionary goal and «Кто мы» use the owner's texts with no «готовится» mark and with no statement about money: «бесплатное» / «бесплатным» is removed from them (owner, chat 2026-11-10: «вообще убираем эти фразы… Просто убрать и всё»).
- The 013 sections built on fixtures — «Что такое Doctor.School», «Зачем», the fixture experts, the fixture events, the fixture projects, «Выгоды», «Форматы» — and their fixture data are gone from the home.
- At a phone width there is no horizontal page scroll, every action is keyboard-reachable, and the page passes the `playwright-axe` gate.

## Out of scope

- The data and the UI of the blocks the home mounts: the project card and the home projects block (030 EARS-11, EARS-12), the nearest-events block (019, #1485), the materials rail (048), the «Подать заявку» page (033), the «Как это работает» page (034), the organisation count read (032 EARS-12).
- The Academy navigation and the shell (`@ds/storefront-shell`, its Academy config): the nav items and their targets belong to the shell and to the features that ship the pages.
- The background inscription «BBM: Академия смыслов» (REQ-123): the canvas does not draw it, and the canvas is the composition of record. `agent-proposed — UNCONFIRMED`; see Open questions.
- The doctor storefront home (017).
- Final marketing copy beyond the canvas texts — a later owner pass; copy is content, not structure.

## Open questions

- **Shipping the home before 034 slice 1** — the lead's call with the owner (see «Partner entry before 034 slice 1 ships»). The spec keeps the partner entries a separate requirement and a separate delivery slice so either answer is a sequencing choice, not a re-specification.
- **REQ-123 «BBM: Академия смыслов».** The registry row lists the background inscription, the owner-drawn canvas has none. This PRD follows the canvas; the owner confirms at Stage A.
- **Nearest-events cap.** The canvas draws two cards; this PRD takes **3**, the doctor home's cap, so both storefront homes cap the shared block alike. _(lead decision; owner sees it at Stage A)_

## Approved mockup

The canvas `design-source/academy-home.dc.html` is **owner-drawn** (vendored by #1450 / #2161, re-pulled with the feed rail by PR #3500 on 2026-10-29), and #1799 «Discovery decisions» records that its switch defaults are the decision. Recorded Stage-A approvals:

- **The materials rail** («Новости, блог и видео», `scope` = «срез 1», states norm / load / empty / err) — approved by the owner on 2026-11-11 ([#3516 comment 6796895267](https://github.com/doctor-school/ds-platform/issues/3516#issuecomment-6796895267)).
- **The split-hero composition «в»** — approved on 2026-08-13 for the 013 canvas «Главная» (013-product «Approved mockup»); the canvas comment keeps it («Stage A, остаётся»).

There is **no recorded Stage-A approval of the current canvas as a whole** (the backstage hero texts, «Кто мы» with the goal row, the persona entries). The 030 and 033 specs carry their home entries as «Stage A pending» too. The owner's Stage-A pick on the full current canvas, with the data mapping of this PRD (count lines, the events cap, «бесплатное» removed, the partner entry before 034), is recorded here before the home is built.

## Prior art

- **Feature 013** (`specs/features/013-academy-home/`, live since August 2026) — the dual-audience landing this feature replaces at `/`. Kept: the route, the public page with no authentication, the shell, the 048 rail that 048 EARS-14 placed in it. Dropped: the doctor-first screens and every fixture section (US-11). The 013 lead form already writes to the shared application queue through 033 EARS-18 and leaves the home when the 034 entries arrive.
- **Bubble** — the legacy Doctor.School system has no backstage home for experts and partners; there is nothing to mine for this page.
