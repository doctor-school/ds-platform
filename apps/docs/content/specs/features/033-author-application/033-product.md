---
title: "Feature 033 — Author application, slice 1: the «Подать заявку» page and the shared application queue (PRD)"
description: "Product requirements for slice 1 of feature 033: the real Academy page «Подать заявку» where an expert applies to make a project with the Academy under their one Doctor.School account, and the one admin application queue that also receives the investor requests of feature 034 — reviewed by a platform administrator, with a team notification on every new application. Later slices (producer routing, draft, clinical case) are out of scope. Source of the 033 EARS triplet (ADR-0014)."
slug: two-site-ia-033-author-application-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`033-product-ru.md`](./033-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · Functional-map registry row 033 and §E (`apps/docs/content/specs/product/two-site-ia/functional-map-ru.md`). Owner decisions of 2026-10-28 on [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions», cascade item 4: «first slices of the real pages 033 «Подать заявку» and 034 «Как это работает» with one shared application queue in admin (admin review is the processing route; producer routing, draft, clinical case — later 033 slices)». Lead decisions are marked _(lead decision 2026-10-28; owner sees it at Stage A)_; anything else beyond recorded decisions is marked `agent-proposed — UNCONFIRMED`.

## Feature summary

The Academy home (029) sends experts to **«Подать заявку»** («Экспертам → Подать заявку»). Today there is no page behind it. Slice 1 makes it real: an Academy page that explains what an expert can do with the Academy and how an application is handled, and a form with which a signed-in expert applies — under the **same account** a doctor uses (REQ-42; ADR-0016 §1: one person — one account, roles are attributes).

Every application lands in **one shared application queue in the admin**. The same queue receives the investor requests «Обсудить проект» of feature 034 (slice 1), and it is where the partner-request stories of the frozen 013 PRD (US-5…US-9) now live (functional map §E): the queue is the place requests are stored, and notifying the team of a new request is a behaviour of the queue (the channel is chosen at spec time). In slice 1 the processing route is **review by a platform administrator** under feature 047 access (role `platform_admin`, admin session with TOTP per 011).

This PRD owns the queue as a capability; 034 adds its own kind of request to it. Capability owner: a new row in [`capability-ownership.md`](../../product/two-site-ia/capability-ownership.md), registered with the design spec (ADR-0013 §A1). Storefront affiliation (ADR-0016 §8): the page — `академия`; applications and the queue — `только админка`.

## User stories

**Page and form (expert):**

- **US-1** — As an **expert**, I open «Подать заявку» from the Academy home or menu and understand from the page what I can do with the Academy (a course, a lesson, a podcast, a talk), how my application will be handled and who will contact me — before I fill anything in.
- **US-2** — As an **expert who is not signed in**, the page tells me that the application goes under my Doctor.School account — no separate «expert registration» — and lets me sign in or register, returning me to the form afterwards. _(Sign-in before the form, because the draft that would carry my input across sign-in is a later slice — agent-proposed — UNCONFIRMED.)_
- **US-3** — As a **signed-in expert**, I see which account I am applying under, fill in the form — topic, specialty (official Ministry of Health list, «Другое» if mine is missing), format (course-series, single lesson, podcast, talk), about me — and submit it. The field set is the canvas `academy-apply.dc.html` set minus the clinical case, per the owner-approved cascade; it is confirmed at Stage A with the canvas. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-4** — As an **expert**, if I leave something required empty or invalid, the form tells me what to fix next to the field and keeps everything else I typed.
- **US-5** — As an **expert**, if the submission fails (network, server), I am told plainly, my input stays on the page and I can retry.
- **US-6** — As an **expert**, after submitting I see a clear confirmation: the application is received, an Academy administrator will review it and contact me, plus where to look while I wait (projects, experts); I also receive a «заявка получена» email, whose text is shown at Stage A. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-7** — As an **expert who already has an application in review**, I see that it is in work and can still send another one about a different project. _(agent-proposed — UNCONFIRMED.)_
- **US-8** — As an **expert**, I give explicit consent to the processing of the personal data in my application for this purpose, with a link to the policy, before I can send it (152-ФЗ; ADR-0016 §7 — consents are separate per purpose). _(Lead-asserted legal constraint, as in 013 — UNCONFIRMED by the owner.)_

**Queue (team):**

- **US-9** — As a **platform administrator**, I see all applications in one admin list — author applications (033) and investor requests (034) together — newest first, and filter it by kind and by status.
- **US-10** — As a **platform administrator**, I open an application and see everything the applicant sent, who they are and how to reach them (for an author application — the account it came from).
- **US-11** — As a **platform administrator**, I move an application through its review: new → in review → closed with an outcome (accepted / declined), and leave an internal note for the rest of the team; the applicant never sees the note. _(Statuses and note — agent-proposed — UNCONFIRMED.)_
- **US-12** — As a **member of the Academy team**, I am notified of every new application as it arrives, so nobody has to watch the admin; a failed notification never loses the application — the queue is the record of truth. _(Inherits 013 US-8/US-9; channel chosen at spec time.)_
- **US-13** — As a **platform administrator**, the partnership requests already collected by the interim home-page form are in the same queue, so the team has one place for every request: they are migrated into the queue, and the interim form's storage is retired. _(lead decision 2026-10-28; owner sees it at Stage A)_

**Owner:**

- **US-14** — As a **product owner**, applications holding personal data are kept no longer than needed and are deleted on a defined schedule. The retention of the application record is set at design time in the platform's retention registry (new storage ⇒ retention at design), by analogy with the platform's existing personal-data request records — a design obligation of the spec, not an owner question. _(lead decision 2026-10-28; owner sees it at Stage A)_

## Flows

**Expert applies (US-1…US-8):**

1. Visitor taps «Подать заявку» on the home → lands on the «Подать заявку» page: what you can do, the path of the application, the form.
2. Not signed in → the form area shows the account gate («Заявка отправляется под той же учётной записью, что у врача») with «Войти / Регистрация»; after sign-in or registration (003 / 021) the visitor returns to this page with the form open.
3. Signed in → the form shows «Отправите как <name · email>»; the expert fills topic, specialty, format, about, ticks the consent and taps «Отправить заявку».
4. The application is stored in the queue, the team is notified and the applicant receives the «заявка получена» email; the page shows the confirmation state with links to projects and experts and «Отправить ещё одну заявку — про другой проект».

**Branches:** a required field empty → inline message, nothing sent, input kept; server unavailable → «Не удалось отправить — сервер недоступен. Введённое сохранено. Попробовать ещё раз»; a repeat submission of the same form (double tap) does not create a second application. _(agent-proposed — UNCONFIRMED.)_

**Administrator reviews (US-9…US-11):**

1. The team gets the notification of a new application.
2. An administrator opens the queue in the admin, filters «Заявки авторов» or «Заявки инвесторов», opens the application.
3. The administrator contacts the applicant outside the platform (email / phone), moves the status, leaves a note; closing records the outcome.

## Product acceptance criteria

- `academy.doctor.school` serves a real «Подать заявку» page; the home «Экспертам → Подать заявку» entries lead to it. No placeholder text, no dead form.
- An application is sent only under a signed-in Doctor.School account; a guest is led through sign-in or registration and back to the form; there is no separate expert account.
- The form carries topic, specialty from the official list, format and about-me, with the required fields marked; validation messages say what to fix and never wipe other input; a server failure keeps the input and offers retry.
- The applicant cannot send without the explicit personal-data consent; the consent is recorded with the application.
- Every submitted application appears in the one admin queue together with 034 requests, with its kind, time, applicant and content; a double submission creates one application.
- The team is notified of each new application, and the applicant receives a «заявка получена» email; a failure of either notification neither loses the application nor shows an error to the applicant.
- Every public intake into the queue — including the no-account investor form of 034 — is protected against bots and floods with the platform's existing bot-protection posture, as other public forms are.
- Only an administrator with the 047 `platform_admin` role sees and works the queue; the applicant never sees internal notes or statuses beyond «received».
- Every status change in the queue is attributed to the administrator who made it and timed. _(agent-proposed — UNCONFIRMED.)_
- Applications are deleted on the retention schedule recorded at design in the platform's retention registry; nothing is kept indefinitely by default.
- Page, form and queue are usable on a phone and pass the platform accessibility bar (`playwright-axe`).

## Out of scope

Later slices of 033, each with its technical dependency:

- **Producer routing** — the administrator assigns a producer, the producer decides — `blocked_by` **040** (production route: nobody to assign without it).
- **Draft that survives sign-in** and the guest filling the form first — later slice (functional map row 033); also `blocked_by` **031** (the application leans on the catalogues as social proof and on the expert ↔ account link).
- **Clinical case field** (REQ-141) — later slice, together with the methodologist route of **040**.
- **Growth path of the expert on the page** (REQ-131) and **author terms** (smart-contract accruals) as live data — `blocked_by` **031** (growth path) and **036** (accruals); in slice 1 the page may describe them only as text content. _(agent-proposed — UNCONFIRMED.)_
- The applicant's own «my applications» status view in the cabinet, and emails to the applicant beyond the «заявка получена» email (for example on a status change). _(agent-proposed — UNCONFIRMED.)_
- Roles narrower than `platform_admin` for working the queue — feature 039.
- The investor page and its form — feature 034 (it only adds its request kind to this queue).

## Open questions

_None for slice 1._ Retention, the confirmation email, the slice-1 field set and the interim partnership requests are recorded lead decisions above; the owner sees them at Stage A.

## Approved-mockup reference

Empty — filled at Stage A (`author-design-mockup`). Input: [`design-source/academy-apply.dc.html`](../../../../../../design-source/academy-apply.dc.html) (R4 canvas: form, account gate, sent confirmation, path of application, growth path variants, clinical-case switch) and the «Экспертам» entries of [`design-source/academy-home.dc.html`](../../../../../../design-source/academy-home.dc.html). The admin queue screens have no canvas yet.

## Prior art

- 013 PRD US-5…US-9 — partner lead form, confirmation, team notification «DS Лиды», «the stored record is the record of truth» — now behaviours of this queue (functional map §E).
- The interim home stub stores partnership requests as private files on the portal volume (`apps/docs/content/operations/academy-partnership-submissions.md`) — the stand-in this queue replaces.
- 012 admin list compositions — reused for the queue list.
