---
title: "029 — Academy home relaunch after the narrowing to backstage (Requirements)"
description: "Requirements for feature 029: the Academy home at academy.doctor.school/ on the owner-drawn canvas — the split hero «Экспертам» / «Партнёрам» with count lines computed from the platform (public running projects of 030, published experts through a new count read, published organisations of 032 EARS-12), «Кто мы» with the mission and the evolutionary goal, the 030 projects block, the nearest events through the shared 019 block capped at three, the 048 materials rail, and the persona entries to the 033 «Подать заявку» and 034 «Как это работает» pages; the 013 fixture sections retire. The partner entries are a separate requirement and delivery slice behind 034 slice 1."
slug: 029-academy-home-relaunch
status: Draft
surface: user-facing
storefronts: academy-only
storefronts_reason: "The Academy home at / of apps/portal only; the doctor storefront home is feature 017, which mounts the same 019 nearest-events block (#1485)."
tracker: https://github.com/doctor-school/ds-platform/issues/1799
prior_decisions:
  - "ADR-0016 §2, §4, §8 — the Academy is the backstage for experts and partners; the project is the single container; the home is an `academy` surface"
  - "ADR-0015 — two storefronts from one code; the doctor storefront home (017) is untouched"
  - "ADR-0014 §2 — every EARS clause carries `realizes: US-N` of `029-product.md`"
  - "ADR-0006 §4 — triplet layout, flat EARS numbering"
  - "ADR-0013 §A1 — one capability, one owner package: the home mounts the 030 projects block, the 019 events block and the 048 rail, never a copy; ADR-0013 — UI from `@ds/design-system`"
  - "030 EARS-8 / EARS-11 / EARS-12 — the catalog read, the shared project card and the home projects block"
  - "032 EARS-12 — `GET /v1/public/organisations/count`"
  - "033 EARS-2 / EARS-18 — the «Экспертам → Подать заявку» entries lead to `/apply`; the interim partnership form writes to the shared application queue"
  - "048 EARS-14 / EARS-16 — the materials rail on the Academy home after the events block, and its states"
  - "019 / #1485 (owner decision 2026-11-03) — a home's nearest events are the shared `EventsFeed` block with a cap and «Все события»"
  - "Owner 2026-10-28 (#1799) — every home block reads an admin-managed model; no hand-set values, no «later» placeholders"
  - "Owner 2026-11-10 — no «бесплатно» or other money statement in product copy"
lang: en
---

> **EN (this)** · **RU:** [`029-requirements-ru.md`](./029-requirements-ru.md)
>
> Product source: [`029-product.md`](./029-product.md). Public UI: the owner-drawn canvas `design-source/academy-home.dc.html` at its switch defaults (goal = А, nav = А; rail `scope` = «срез 1»), vendored by #1450 / #2161 / PR #3500. Stage A: the rail approved 2026-11-11 (#3516), the split hero «в» approved 2026-08-13 (013); the current canvas as a whole is pending (PRD «Approved mockup»). Hence `surface: user-facing`.

# 029 — Academy home relaunch after the narrowing to backstage (Requirements)

## Outcomes

- An expert or a partner opening `academy.doctor.school/` sees the backstage and their own entry in the first screen; the doctor-first 013 landing is gone.
- Every figure on the home is computed from the platform at the moment of the request; a figure that cannot be computed is left out, never faked.
- Every block of the home is a mount of the block that owns it — the 030 projects block, the 019 events block, the 048 rail — and every entry leads to a real page.

## Scope

- The composition of `/` on `apps/portal`: the order of its sections, the hero, «Кто мы», the events section mount, the persona entries, the retirement of the 013 fixture sections.
- The public expert count read `GET /v1/public/experts/count` (EARS-4) — the only backend this feature adds.
- Boundary lines (behaviour owned elsewhere; the home passes only the listed parameters):
  - «Что мы делаем» — projection of 030 EARS-12 (`@ds/design-system` project card over `GET /v1/public/projects`); host diff: placement after «Кто мы».
  - «Ближайшие эфиры» — projection of `packages/events-storefront` `./feed` `EventsFeed`; host diff: `ACADEMY_EVENTS_STOREFRONT`, `limit: 3`, the Academy events block-retry action, the section heading (EARS-7).
  - «Новости, блог и видео» — projection of 048 EARS-14 (`@ds/design-system` `FeedRail` through `apps/portal/app/materials-feed-section.tsx`); host diff: none — 048 already places it after the events block.
  - «Подать заявку» entries — targets of 033 EARS-2 (`/apply`); the interim partnership form — 033 EARS-18.

### Out of scope

- The data and UI of the mounted blocks and of the 033 / 034 pages; the organisation count read (032 EARS-12).
- The Academy navigation and the shell (`@ds/storefront-shell` Academy config).
- The background inscription «BBM: Академия смыслов» (REQ-123): not on the canvas (PRD «Open questions»).
- The doctor storefront home (017): 029 changes nothing on `doctor.school`.

## Constraints

- No figure on the home is stored or typed in; each is read at the moment of the request (owner 2026-10-28).
- No copy on the home states who pays or does not pay; the canvas words «бесплатное» / «бесплатным» are not carried (owner 2026-11-10).
- One failing read hides only its own part; the page always renders.
- UI from `@ds/design-system`; the canvas is the composition and look.

## Prior decisions

See frontmatter `prior_decisions`. Additionally: 013 (live since August 2026) is replaced at `/` by this feature; its post-login landing outcome (008 EARS-7 amendment) is untouched.

## Event Model

**Commands** — none of its own (the interim partnership form's `SubmitPartnershipRequest` belongs to 033).

**Events** — none of its own; the home re-reads on every request, so `ProjectPublished` / `Retired` / `Reordered` (030), `OrganisationPublished` (032), `ExpertPublished` (012) and `MaterialPublished` (048) show on the next read.

**Read models** — `PublicExpertCount` (EARS-4, new); `PublicOrganisationCount` (032 EARS-12); the catalog read (030 EARS-8), from which the hero takes the number of `running` projects; the upcoming feed (019); the materials feed (048 EARS-9).

**Policies** — «a figure the platform cannot compute is left out»; «a home block is a mount of its owner block»; «a home entry leads to a page that exists».

## EARS requirements

- **EARS-1** _(realizes: US-1, US-11)_ — WHEN a visitor, signed in or not, opens `academy.doctor.school/`, THE SYSTEM SHALL render inside the Academy shell, in this order: the hero (EARS-2, EARS-3, EARS-5), «Кто мы» (EARS-6), «Что мы делаем» (030 EARS-12), «Ближайшие эфиры» (EARS-7), «Новости, блог и видео» (048 EARS-14) and the persona entries (EARS-8, EARS-9); and SHALL render none of the 013 sections «Что такое Doctor.School», «Зачем», the expert, event and project sections over fixtures, «Выгоды» and «Форматы», with no fixture data left in `apps/portal`.
- **EARS-2** _(realizes: US-1, US-7)_ — WHEN the home renders its hero, THE SYSTEM SHALL show the line «Академия Doctor.School · закулисье платформы» and two cards side by side on a desktop and stacked on a phone: «Экспертам» with the heading «Создавайте образование вместе с нами», the text «Участвуйте в подкасте, создайте курс или школу, выступите на конгрессе — с командой производства, как автор или соавтор проекта.» and the action «Подать заявку» leading to `/apply`; and «Партнёрам» with the heading «Постройте репутацию в экспертной среде» and the text «Участвуйте в проектах вместе с экспертами: соавторство направлений, события и прямой доступ к профессиональной среде.».
- **EARS-3** _(realizes: US-2, US-9)_ — WHEN the home renders the «Экспертам» card, THE SYSTEM SHALL show under its action the line «N <проект> в производстве · M <эксперт>», where N is the number of items of the 030 EARS-8 read at the stage `running` and M is the EARS-4 count, each with the Russian plural form of its number («1 проект», «3 проекта», «5 проектов»; «1 эксперт», «2 эксперта», «12 экспертов»), both read at the moment of the request; a segment whose number is zero or whose read failed SHALL be left out together with its separator, and the line SHALL not render when no segment is left.
- **EARS-4** _(realizes: US-2)_ — WHEN a caller reads `GET /v1/public/experts/count`, THE SYSTEM SHALL return `{ count }` — the number of experts of the 012 registry in the status `published` — computed at the moment of the request with no stored or hand-entered figure; publishing, retiring or restoring an expert SHALL change the next answer. The Academy storefront is its only storefront consumer; the doctor storefront reads it nowhere.
- **EARS-5** _(realizes: US-2, US-9)_ — WHEN the home renders the «Партнёрам» card, THE SYSTEM SHALL show the line «K <партнёр> · прозрачная модель», where K is the 032 EARS-12 count read at the moment of the request with its Russian plural form («1 партнёр», «2 партнёра», «14 партнёров»); WHEN the count is zero or its read failed, THE SYSTEM SHALL show «Прозрачная модель» alone.
- **EARS-6** _(realizes: US-3)_ — WHEN the home renders «Кто мы», THE SYSTEM SHALL show the kicker «Академия», the heading «Кто мы», the text «Doctor.School создаёт децентрализованное образование для врачей — образование, в развитии которого может участвовать каждый: и эксперт, и компания.» and the row of two panels «Миссия» — «Создать равную свободную среду для самореализации врачей, где талант важнее связей, а качественное образование доступно каждому. Сделать медобразование децентрализованным и открытым и минимизировать врачебные ошибки.» — and «Эволюционная цель» — «Создаём децентрализованное медицинское образование» —, stacked on a phone, with no «готовится» mark.
- **EARS-7** _(realizes: US-5)_ — WHEN the home renders «Ближайшие эфиры», THE SYSTEM SHALL show the kicker «Эфиры» and the heading «Ближайшие эфиры» over the shared `EventsFeed` block of `@ds/events-storefront/feed` with the Academy events host config, `limit: 3` and the Academy events page's block-retry action, so the cards, registered marks, empty state, error state with «Повторить», skeleton and «Все события» link to `/webinars` are that block's own; the home SHALL hold no event list, card or state of its own.
- **EARS-8** _(realizes: US-8)_ — WHEN the home renders the «Партнёрам» card and the persona entries, THE SYSTEM SHALL show in the card the action «Как это работает» and, next to the «Экспертам» persona block, the block «Инвесторам» with the heading «Внимание врачей для вашего бренда — этично и прозрачно», the text «Организация участвует в проектах рядом с экспертами: партнёрский материал всегда помечен, модель открыта.» and the action «Как это работает», both actions leading to the 034 investor page; and SHALL render no partnership form on the home.
- **EARS-9** _(realizes: US-7)_ — WHEN the home renders the persona entries, THE SYSTEM SHALL show the block «Экспертам» with the heading «Ваше имя — в проектах Академии», the text «Участвуйте в подкасте, создайте курс или школу, выступите на конгрессе. К проекту эксперт присоединяется как автор или соавтор — с командой производства.» and the action «Подать заявку на участие в проекте» leading to `/apply`; the two persona blocks side by side on a desktop and stacked on a phone.
- **EARS-10** _(realizes: US-8)_ — WHILE EARS-8 is not delivered, THE SYSTEM SHALL render the «Партнёрам» card with no action, render no «Инвесторам» block, and keep the interim partnership form of 033 EARS-18 as the last section of the home with its existing fields, consent, success and error states; the delivery of EARS-8 removes this state and the form together.
- **EARS-11** _(realizes: US-10)_ — WHILE the viewport is a phone or a narrow screen, THE SYSTEM SHALL keep every section of the home usable with no horizontal scrolling of the page and every action keyboard-reachable, and the home SHALL pass the platform's `playwright-axe` gate in each delivered state (EARS-10 before EARS-8, EARS-8 after).

## Invariants

- No number on the home is stored, seeded or typed; each comes from a public read at the moment of the request (EARS-3, EARS-4, EARS-5).
- Every home block is a mount of its owner block; the home carries no project, event or material data of its own (EARS-1, EARS-7).
- Every home action leads to a route that exists in the same release (EARS-2, EARS-8, EARS-9, EARS-10).
- The doctor storefront reads no count of this feature and its home is unchanged.

## Verification

| #   | Type                       | What it proves                                                                                                                                                                                                                                                                                                         |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1 | Vitest e2e — `apps/api`    | `GET /v1/public/experts/count` counts only `published` experts; publishing, retiring and restoring an expert changes the next answer; no auth required (EARS-4).                                                                                                                                                       |
| V-2 | Vitest — UI                | The count lines: plural forms for 1 / 2 / 5 / 12 / 21; a zero or failed segment dropped with its separator; no line when both expert segments drop; «Прозрачная модель» alone for a zero or failed partner count (EARS-3, EARS-5).                                                                                     |
| V-3 | Vitest — UI                | The home renders the sections in order with the canvas texts, contains no «бесплатн» in its copy and none of the 013 fixture sections; the events section passes `limit: 3` and the Academy host config to `EventsFeed` (EARS-1, EARS-2, EARS-6, EARS-7, EARS-9).                                                      |
| V-4 | Playwright / E2E — Academy | `@journey` An expert opens `/`, reads the counts computed from seeded data, taps «Подать заявку» in the hero and lands on `/apply`; back on the home, taps «Подать заявку на участие в проекте» and lands on `/apply`; a project card opens its page; «Все события» opens `/webinars` (EARS-1…EARS-3, EARS-7, EARS-9). |
| V-5 | Playwright / E2E — Academy | `@journey` Before EARS-8: the «Партнёрам» card has no action, there is no «Инвесторам» block, a guest submits the partnership form and sees its success state (EARS-10). After EARS-8: both «Как это работает» actions open the 034 page and there is no form (EARS-8).                                                |
| V-6 | Playwright / E2E — Academy | `@rule` With the organisation count failing, the partner line reads «Прозрачная модель» and the rest of the page renders; with no public project, «Что мы делаем» is absent (EARS-5, 030 EARS-12).                                                                                                                     |
| V-7 | Playwright + axe           | At a 390 px viewport the home has no horizontal page scroll, the hero cards and the persona blocks stack; a clean `playwright-axe` run in the delivered state (EARS-11).                                                                                                                                               |
| V-8 | Playwright / E2E — doctor  | `doctor.school/` is unchanged and requests no expert or organisation count (Invariants).                                                                                                                                                                                                                               |

## Work-package map

Each Issue is a sub-issue of #1799 and ships its UI with its backend; slices and dependencies: [`029-design.md`](./029-design.md) «Delivery slices». Issue numbers are written back by `open-ears-issues`.

| EARS                                                                    | Issue | Work package                                                                                                                                                                 |
| ----------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-1…EARS-7, EARS-9, EARS-10, EARS-11; V-1…V-4, V-5 (before), V-6…V-8 | —     | **Home composition** — hero with count lines, expert count read, «Кто мы», mounted blocks, expert entries, interim partner state, fixture retirement, narrow screens and axe |
| EARS-8; V-5 (after), V-7                                                | —     | **Partner entries** — «Как это работает» in the hero and the «Инвесторам» block to the 034 page; the interim form leaves the home                                            |
