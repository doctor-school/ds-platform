---
title: "Feature 013 — Academy home page & lead capture (PRD)"
description: "Product requirements for the academy home page at /: an eight-screen dual-audience landing that routes doctors to content and partners to a lead form, a live feed of the latest эфиры built on the reusable event-list unit, and lead capture that persists to the leads table and posts to the Mattermost channel «DS Лиды». Feature 013 of the Academy public surface epic; source of the 013 EARS triplet (ADR-0014)."
slug: academy-public-013-academy-home-product
epic: ../../product/academy-public/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`013-product-ru.md`](./013-product-ru.md)

> Epic: [Academy public surface — product brief](../../product/academy-public/brief.md) · Owner priority #1 on the critical path (after 012 content-taxonomy).

## Interim state (2026-08-16 → until [#1324](https://github.com/doctor-school/ds-platform/issues/1324) ships)

A **temporary static stub** is live at `/` since release-2026.08.16-2 (Issues [#1311](https://github.com/doctor-school/ds-platform/issues/1311) / [#1312](https://github.com/doctor-school/ds-platform/issues/1312), PRs [#1313](https://github.com/doctor-school/ds-platform/pull/1313) / [#1318](https://github.com/doctor-school/ds-platform/pull/1318)). It is **not an implementation of this PRD** and it does not narrow this PRD's scope: it is a hand-written static slice with a private JSON-file partnership form, standing in until the real home page exists.

- This document — US-1…US-12 below — remains the canonical product contract of Feature 013.
- The stub's own scope is described separately in the INTERIM triplet in this directory (`013-requirements-en.md` / `013-requirements-ru.md` / `013-design.md` / `013-scenarios.feature`) and its six stub stories in [`013-interim-stub-stories.md`](./013-interim-stub-stories.md). Those files describe the stub, never this PRD.
- The full home page is authored and built under [#1324](https://github.com/doctor-school/ds-platform/issues/1324); the stub is dismantled by [#1323](https://github.com/doctor-school/ds-platform/issues/1323) once it ships.
- **The stub's copy is not to be reused** — owner instruction: «Не надо слепо переносить тексты из текущей главной.» The real page's copy is a product decision, not an inheritance from the stub.

## Feature summary

The academy's front door. `/` stops redirecting to `/webinars` and becomes a landing page that serves **two audiences at once** — a doctor who has never heard of Doctor.School and a pharma partner evaluating whether to sponsor. The page explains what the academy is, who stands behind it, and what participation looks like; it carries a **live feed of the latest эфиры** so a doctor can go straight into real content; and it ends on a **lead form** whose submission is persisted on the platform and delivered to the commercial team's Mattermost channel «DS Лиды» in the same moment. The page is fully public — nothing on it requires authentication — and it never intercepts an authenticated user, whose post-login landing remains `/webinars` — an outcome 013 delivers by re-pointing the login target itself (see the acceptance criteria), not one it inherits.

## User stories

- **US-1** — As a **guest doctor**, I land on `/` and within a minute understand what Doctor.School Academy is and whether it is for me — without registering, without a wall, and without marketing noise.
- **US-2** — As a **guest doctor**, I see a live feed of the latest эфиры right on the home page and open one that interests me, landing on its event page where I can register.
- **US-3** — As a **visitor**, the home page routes me into the academy's sections — эфиры, projects, experts — so `/` is a hub, not a dead-end brochure.
- **US-4** — As a **guest doctor**, I see who stands behind the brand — real experts with names and credentials, plus the academy's own media (podcast / discussions) — so I can judge whether this is a serious professional community.
- **US-5** — As a **pharma partner**, I understand from the home page what the academy offers a sponsor: the audience, the formats of participation, and the benefits I get — stated concretely enough to decide whether to talk.
- **US-6** — As a **pharma partner**, I reach a short lead form from any point of the page (the hero CTA and the closing CTA both lead there) and submit my request in under a minute.
- **US-7** — As a **pharma partner**, after submitting I get an immediate, unambiguous confirmation that my request was received and that someone will contact me — I never wonder whether it went through.
- **US-8** — As a **member of the commercial team**, every submitted request appears immediately in the Mattermost channel «DS Лиды» with the submitter's contact details, so I can respond without watching an inbox.
- **US-9** — As a **member of the commercial team**, every request is also stored on the platform, so the channel is a notification and not the only copy — a lost message never means a lost lead.
- **US-10** — As an **authenticated user**, logging in still takes me to `/webinars` — the landing is an entry point for visitors and never a detour on my way to my events.
- **US-11** — As a **visitor on a phone**, the whole page — every screen, the эфиры feed, and the lead form — works and reads as well as on desktop, since a large share of doctors arrive from mobile.
- **US-12** — As a **product owner**, I can hand the page's copy a final editorial pass without a rebuild of its structure — the screens are a structure, the words are content.

## Flows

**Doctor path — discover content (US-1, US-2, US-3):**

1. Guest opens `/` → hero renders with the dual CTA: **[Стать партнёром]** and **[Посмотреть эфиры]**.
2. Guest scrolls (or taps «Посмотреть эфиры») → reaches the live feed of latest эфиры, rendered by the shared event-list unit.
3. Guest taps an event card → lands on `/webinars/[slug]`, where registration (feature 005) takes over.
4. Alternatively the guest follows a section link — эфиры (`/webinars`), projects (`/projects`), experts (`/experts`).

**Partner path — leave a request (US-5, US-6, US-7, US-8, US-9):**

1. Guest taps **[Стать партнёром]** in the hero → the page moves to the lead form in the closing screen (a single form, reached from either CTA).
2. Guest reads the partner-benefit and participation-format screens on the way — the form is the end of an argument, not a cold ask.
3. Guest fills the form — **имя · компания/клиника · email или Telegram · роль (селект) · обязательный чекбокс согласия на обработку персональных данных со ссылкой на политику (152-ФЗ)** — and submits via «Обсудить партнёрство». _(Field set agent-proposed — UNCONFIRMED, taken from the Stage-A design package block 9; Stage A resolves the final list. The consent checkbox is lead-asserted rather than uncertain — see acceptance criteria.)_
4. The request is **persisted** as a `leads` record **and** posted to the Mattermost channel «DS Лиды».
5. The page shows a confirmation state in place of the form: request received, we will contact you.

**Authenticated user (US-10):**

1. A logged-in user hits `/` directly → the landing renders (it is public, not blocked).
2. Logging in from anywhere → the doctor arrives at `/webinars`. **This requires a change 013 owns, not a property it inherits.** Today the login page sends a successful login to `/` (`apps/portal/lib/registration-resume.ts` → `DEFAULT_LANDING = "/"`, consumed by `apps/portal/app/login/page.tsx`), and `/webinars` is reached only because `apps/portal/app/page.tsx` calls `permanentRedirect("/webinars")`; the recorded spec agrees — feature 008 **EARS-7 pins the post-login target to `/`**. The moment 013 takes `/` for the landing that redirect is gone, and an unchanged login target would drop every post-login doctor on the marketing page — the exact regression US-10 forbids.

**Lead-form branches:**

- **Invalid or incomplete input** → the field is marked with an actionable message stating what to fix; nothing is submitted, nothing is lost from the other fields.
- **Mattermost delivery fails** → the lead is still persisted and the visitor still sees success; the notification failure is an operational problem, never the visitor's problem. _(agent-proposed — UNCONFIRMED: the owner approved the dual sink but not its failure ordering.)_
- **Repeat submission** from the same visitor in one session → accepted; de-duplication is a commercial-team concern, not a page behavior. _(agent-proposed — UNCONFIRMED.)_

## Page structure

Eight screens from the owner's PDF brief, in order, plus the owner-added live feed. Copy below is **placeholder draft** (see Copy).

1. **Hero** — the academy's one-line proposition + dual CTA **[Стать партнёром]** / **[Посмотреть эфиры]**. Both audiences are addressed in the first screen; neither is buried.
2. **«Что это» — 3–4 cards**: эксперты · индустрия · образование · партнёры. What the academy is made of, one card per pillar.
3. **«Зачем» — two-column comparison**: «сейчас» (how continuing medical education works today) vs. «что мы создаём». The argument screen.
4. **Ecosystem map — «что мы создаём»**: how experts, industry, doctors, and content connect into one system.
5. **People + media — «Кто стоит за брендом»**: expert cards (name, specialty, role) plus the academy's own media block (podcast / discussions).
6. **Partner benefits — 3–4 cards**: what a sponsoring partner gets.
7. **Participation formats — cards**: the concrete ways a partner can take part.
8. **Closing CTA + lead form**: the single lead form both CTAs lead to — имя · компания/клиника · email или Telegram · роль (селект) · mandatory personal-data consent checkbox with a policy link (152-ФЗ) · «Обсудить партнёрство» — with its filling, validation-error, and confirmation states. _(Field set agent-proposed — UNCONFIRMED per the Stage-A package block 9; Stage A resolves.)_

**Live эфиры feed (owner addition, decision #7–8 of the epic tracker).** A feed of the latest эфиры sits on the page as a content screen — placed between the doctor-facing argument and the partner-facing argument, so the doctor path completes before the partner pitch begins. _(agent-proposed — UNCONFIRMED: the owner fixed that the feed exists, not its position in the screen order; Stage A decides.)_ It is **rendered by the reusable event-list design-system unit** — the same card + list + filters + pagination components used on `/webinars`, project pages, expert pages, and the «Прошедшие» tab. The home instance shows the latest N with no filters and links onward to `/webinars`.

## Copy

Placeholder RU copy, drafted fresh at this PRD. The legacy PDF texts are **rejected** by the owner («они плохого качестве и там много бессмыслицы») and are not to be reused. Tone: **экспертный, премиальный, без инфобизнеса** — no exclamation marks, no growth-hacking promises, no «успей записаться».

| Screen                 | Placeholder copy (RU)                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Hero                 | H1: «Академия Doctor.School» · Подзаголовок: «Профессиональное образование для врачей — от практикующих экспертов, при поддержке индустрии». CTA: «Стать партнёром» / «Посмотреть эфиры».                                                                                                                                                                                                   |
| 2 Что это              | «Эксперты» — «Практикующие врачи и исследователи, которые ведут эфиры и отвечают за содержание.» · «Индустрия» — «Фармкомпании, которые финансируют образование и получают выверенный доступ к профессиональной аудитории.» · «Образование» — «Регулярные онлайн-эфиры, разборы и проекты — без оплаты со стороны врача.» · «Партнёры» — «Долгосрочные программы, а не разовые размещения.» |
| 3 Зачем                | «Сейчас»: «Разрозненные вебинары, случайные темы, непрозрачный охват.» → «Что мы создаём»: «Проекты с постоянной экспертной командой, понятной аудиторией и измеримым результатом.»                                                                                                                                                                                                         |
| 4 Экосистема           | «Врачи, эксперты и индустрия в одном контуре: эксперт формирует программу, индустрия её поддерживает, врач получает бесплатное обучение — а партнёр получает подтверждённый охват.»                                                                                                                                                                                                         |
| 5 Кто стоит за брендом | «За каждым проектом стоят конкретные люди — врачи, которых знает профессиональное сообщество.» + медиаблок: «Подкаст и дискуссии Академии — разговоры о профессии без формата лекции.»                                                                                                                                                                                                      |
| 6 Выгоды партнёра      | «Целевая аудитория» — «Врачи нужных специальностей, а не обезличенный трафик.» · «Прозрачная отчётность» — «Подтверждённые участники и минуты присутствия по каждому эфиру.» · «Экспертная среда» — «Ваш бренд рядом с содержанием, которому доверяют.»                                                                                                                                     |
| 7 Форматы участия      | «Генеральный партнёр проекта» · «Поддержка отдельного эфира» · «Совместный образовательный проект» — с одной поясняющей строкой на карточку.                                                                                                                                                                                                                                                |
| 8 Финальный CTA        | H2: «Обсудим участие» · «Оставьте заявку — свяжемся и предложим формат под вашу задачу.» · Кнопка: «Обсудить партнёрство». Подтверждение: «Заявка отправлена. Мы свяжемся с вами в ближайшее время.»                                                                                                                                                                                        |

**Final copy is a later owner editorial pass** — this table is a structural placeholder of reasonable marketing quality, not approved marketing text.

## Product acceptance criteria

- `/` serves the academy landing to any visitor with **zero authentication**; the previous `/` → `/webinars` redirect is gone, while `/webinars` remains the canonical discovery listing.
- **The post-login landing keeps working — by an in-scope change of this feature, not by inheritance.** Removing the `/` → `/webinars` redirect obliges 013 to re-point the post-login target **from `/` to `/webinars` directly**: the login redirect default (`DEFAULT_LANDING` in `apps/portal/lib/registration-resume.ts`), the two tests pinning it (`apps/portal/app/login/page.test.tsx`) — which assert the route, so they stay green through the regression and must be re-pointed too — and a delivery-time **inline rewrite of feature 008's EARS-7 landing target**, which 013 supersedes. That EARS edit happens in the 013 delivery PR, not in this product-layer PR. A doctor landing on the marketing page after login is the failure this criterion exists to prevent.
- The page presents the eight screens above, in order, plus a live feed of the latest эфиры.
- The эфиры feed shows real, currently published events and each entry opens that event's page; the feed is rendered by the **shared event-list unit**, not by a home-page-only copy of it.
- Both hero CTAs work: «Стать партнёром» reaches the lead form, «Посмотреть эфиры» reaches content.
- Section entry points to эфиры, projects, and experts are present. Until 015/016 ship, the projects and experts entry points behave per the tracked deferral below — never as a dead link or a 404.
- The lead form carries a **mandatory personal-data consent checkbox with a link to the privacy policy** (152-ФЗ): submission is impossible while it is unchecked, and the consent given is recorded with the lead. _(**Lead-asserted — UNCONFIRMED by the owner.** This is not among the #1240 decisions; it originates in block 9 of this epic's design package and is stated here as a legal constraint on collecting personal data through a public form, not as an owner product decision. It is hardened rather than optional because the lead judges it legally required — the owner can still overrule it.)_
- A lead submission **persists a `leads` record** and **posts to the Mattermost channel «DS Лиды»**; the visitor sees an explicit confirmation state. The persisted record is the record of truth — a channel-delivery failure does not lose the lead and does not surface to the visitor.
- Form validation errors are actionable (they say what to fix) and never discard the visitor's other input.
- The page is fully usable on mobile — every screen, the feed, and the form.
- Copy is content, not structure: replacing the placeholder texts with the owner's final copy requires no structural change.
- The page meets the platform's accessibility bar for a public marketing surface (keyboard-reachable CTAs and form, labelled fields, honest contrast) — the same `playwright-axe` gate every user-facing surface passes.

**Tracked deferral (from the epic's critical path).** 013 ships before 015 (projects) and 016 (experts). Until those land, the landing's projects/experts entry points must resolve to something honest — the accepted form is to **link only what exists and present the not-yet-shipped sections as content on the landing itself** (the ecosystem and people screens already carry projects and experts as narrative), rather than link to an empty route. _(agent-proposed — UNCONFIRMED: the epic records the deferral as tracked but does not fix its concrete resolution; this is the proposed one, owner call at Stage A.)_ A dev placeholder page is a banned stub, not an option.

## Out of scope

- The `/projects` and `/experts` section pages themselves — features 015 and 016; the landing only links to them.
- Recordings and the archived-event page state — feature 014.
- The taxonomy entities, admin CRUD, and public read API the page consumes — feature 012 (a hard dependency, not a parallel).
- The event page and registration mechanics — features 004/005.
- Lead lifecycle beyond capture: CRM, statuses, assignment, follow-up automation, an admin screen for `leads`.
- Notification email to the submitter (the confirmation is on-page only) and any marketing automation.
- Final marketing copy and final imagery — an owner pass and Stage A respectively.
- Analytics instrumentation for the funnel metrics named in the epic brief. _(agent-proposed — UNCONFIRMED as an exclusion; the metrics exist in the brief but no measurement mechanism was approved.)_

## Open questions

- **Final copy.** Every text in the Copy table is placeholder; the owner's editorial pass is pending and lands before Stage-B GO.
- **Lead form fields.** The field set is taken from the Stage-A package (имя · компания/клиника · email или Telegram · роль-селект · consent) and is marked `agent-proposed — UNCONFIRMED`: whether a free-text message field is added, and what the role-select options finally are, is carried by the approved canvas «Главная» (Stage A closed 2026-08-13) and is read off the vendored copy before implementation (see Approved mockup). The consent checkbox is treated as fixed above, but on lead assertion rather than owner approval — it is flagged there for the owner to confirm or overrule.
- **Feed size and placement.** This PRD places the feed between the doctor-facing and partner-facing arguments; the Stage-A design brief places it as block 2, directly under the hero, at 3–6 cards. Stage A is closed (2026-08-13): position and count are carried by the approved canvas «Главная» and are read off the vendored copy (see Approved mockup).
- **Deferral resolution for projects/experts entry points** until 015/016 ship (see Tracked deferral) — owner call.
- **Privacy-policy document.** The consent checkbox requires a policy page to link to; which document that is, and whether it exists on the platform today, is unresolved (the requirement itself is fixed, only its link target is open).
- **Mattermost channel provisioning.** «DS Лиды» is a new channel named by the owner — who creates it, and which credential the API posts under, is unresolved.

## Approved mockup

**Stage A resolved 2026-08-13.** From the composition fork in the design brief ([`design-brief-academy-public-ru.md`](../../product/academy-public/design-brief-academy-public-ru.md), section 1) the owner picked **variant (в) — split hero: doctor column + partner column** and finished the page design themselves as canvas **«Главная»** in the claude.ai Design app (project «DS Platform»). Owner verbatim: «Дизайн главной завершён: идём по варианту В.» That canvas is the approved mockup and the composition SoT for this page.

The canvas is **vendored verbatim** at [`design-source/home.dc.html`](../../../../../../design-source/home.dc.html) (pulled 2026-08-13 via DesignSync from project `8cc2f39a`, canvas file `Главная.dc.html`; the canvas prop default `variant: v` matches the owner's pick). That copy is the fidelity spec 013 builds against (AGENTS.md §6 — UI design is approved before it is built): every canvas-carried resolution (feed placement and card count, final lead-form field set, per-breakpoint composition) is read off the vendored copy — never off this PRD's placeholders.
