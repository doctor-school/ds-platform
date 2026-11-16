---
title: "Feature 034 — Investors, slice 1: the «Как это работает» page with «Обсудить проект» into the shared queue (PRD)"
description: "Product requirements for slice 1 of feature 034: the real Academy page for investors that explains how participation works, what an investor gets and how the relationship is formalised, and ends with the «Обсудить проект» request form whose submissions land in the one admin application queue of feature 033. The marketplace of investment products and the automatic commercial offer are later slices. Source of the 034 EARS triplet (ADR-0014)."
slug: two-site-ia-034-investment-marketplace-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
storefronts: academy-only
storefronts_reason: "The investor page is an Academy page feeding the apps/admin queue of feature 033; the investor cabinets are on the Academy (ADR-0016 §4), and the doctor storefront has no investor surface."
lang: en
---

> **EN (this)** · **RU:** [`034-product-ru.md`](./034-product-ru.md)

> Epic: [Two-site IA — product brief](../../product/two-site-ia/brief.md) · Functional-map registry row 034 and §E (`apps/docs/content/specs/product/two-site-ia/functional-map-ru.md`). Owner decisions of 2026-10-28 on [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions», cascade item 4 (approved by the owner, summarised there in English by the agent lead); the investor terminology — owner decision of 2026-08-22, functional map §F-1. Decisions of the agent lead (the AI session that orchestrates the work, AGENTS.md §7 — not the owner) are marked _(lead decision 2026-10-28; owner sees it at Stage A)_ or _(lead decision; owner sees it at Stage A)_; anything the owner-drawn R4 canvas already carries cites it; anything else beyond recorded decisions is marked `agent-proposed — UNCONFIRMED`.

## Feature summary

The Academy home (029) sends organisations to **«Как это работает»** (the «Инвесторам» persona entry; the hero card is labelled «Партнёрам»). Naming follows the canvas: the hero card says «Партнёрам», the persona block and the page say «Инвесторам». _(lead decision 2026-10-28; owner sees it at Stage A)_ Investor terminology (REQ-134) is closed by the owner, who kept the canvas variant: the smart-contract role is «первоинвестор», the Academy audience is «инвестор»; nothing is renamed (owner, chat 2026-08-22; functional map §F-1; ADR-0016 §6). Today there is no page behind it. Slice 1 makes it real: an Academy page that explains the model — the organisation invests in a project, experts produce education, doctors learn, the investor sees the result — what the investor gets, and that the relationship is a contract outside the platform with transparent accounting on it (CON-16, OWD-3: no payments on the platform). The page ends with **«Обсудить проект — оставить заявку»**: a short request form for an organisation's representative.

Every request lands in the **shared application queue** owned by feature 033, next to author applications; it is reviewed by a platform administrator under 047 access (role `platform_admin` — lead decision, functional map, PR #3415), and the team is notified of each new request (a queue behaviour). This replaces the partner lead capture of the frozen 013 PRD (US-5…US-9, functional map §E): after the Academy narrowed to the backstage, the investor's way in is this page, not a landing form. Slice 1 is therefore `blocked_by` **033 slice 1**: requests go into the shared application queue that 033 owns (its storage, admin list, statuses and notification), so this slice cannot be finished before that queue exists.

Storefront affiliation (ADR-0016 §8): the page — `академия`; requests — `только админка` (via the 033 queue).

## User stories

- **US-1** — As a **representative of an organisation** (a pharma company, a medical-equipment maker, an investor in BBM's evolutionary goal — owner REQ-9), I open «Как это работает» from the Academy home and understand how participation works: what I invest in, who produces the education, how it reaches doctors and how I see the result. _(Clinics and other institutions as an audience — agent-proposed — UNCONFIRMED; the owner's REQ-9 list names neither.)_
- **US-2** — As a **representative**, I see concretely what an investor gets (doctor-attention analytics, participant composition without contact data, surveys and research, an annual exclusive on a project) and how the relationship is formalised (a contract outside the platform, transparent project accounting on it), so I can decide whether to talk. _(Copy from the canvas `academy-invest.dc.html` — content, final wording an owner pass.)_
- **US-3** — As a **representative**, I reach the «Обсудить проект» form from the page (the closing block and any «Обсудить проект» button lead to the same form) and send a short request: organisation, full name, role in the organisation, work email, phone, my task. _(Field set from the owner-drawn R4 canvas `academy-invest.dc.html`, vendored in #1451: organisation, full name, work email required; role, phone optional.)_
- **US-4** — As a **representative**, I send the request without creating an account — the investor cabinet is for organisations already working with the Academy. _(agent-proposed — UNCONFIRMED.)_
- **US-5** — As a **representative**, I give explicit consent to the processing of the personal data in my request, with a link to the policy, before I can send it (152-ФЗ; ADR-0016 §7). _(Lead-asserted legal constraint, as in 013 — UNCONFIRMED by the owner.)_
- **US-6** — As a **representative**, invalid or missing fields are explained next to the field without losing the rest of my input; a server failure keeps my input and lets me retry. _(lead decision, UX mechanics; the invest canvas draws no form-error or failure state; owner sees it at Stage A.)_
- **US-7** — As a **representative**, after sending I see an unambiguous confirmation that the request is received and that the commercial offer will come to the email I gave — «КП придёт на указанную почту» (owner-drawn R4 canvas); I can send another request. I also receive a «заявка получена» email, as in 033, whose text is shown at Stage A. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-8** — As a **platform administrator**, investor requests appear in the shared queue as their own kind, with the organisation and contact of the representative and their task, and I work them with the same statuses and notes as author applications (033 US-9…US-11). _(Statuses and notes — lead decision, `033-design.md` decision 4.)_
- **US-9** — As a **representative**, I can move on from the page to what already exists on the Academy — the «Все проекты» catalog (030) — and never land on a dead link or an empty marketplace. _(lead decision, the slice-1 canvas edit; owner sees it at Stage A.)_

## Flows

**Representative leaves a request (US-1…US-7):**

1. Visitor taps «Как это работает» on the home → lands on the investor page: «Как это работает» (three steps), «Что получает инвестор», «Как оформляются отношения», «Следующий шаг». «Организация, не персона» belongs to the investor cabinet and is not on the slice-1 page. _(lead decision 2026-10-28; owner sees it at Stage A)_
2. Visitor taps «Обсудить проект — оставить заявку» → the form in «Следующий шаг» (canvas default: request channel variant А, form on the page; no messenger contact on the page). _(lead decision 2026-10-28; owner sees it at Stage A)_
3. Visitor fills organisation, full name, work email (and optionally role, phone), describes the task, ticks the consent, taps «Отправить заявку».
4. The request is stored in the 033 queue, the team is notified and the representative receives the «заявка получена» email; the form is replaced by «Запрос отправлен» with «Отправить ещё одну заявку».

**Branches:** missing required field → inline message, nothing sent; server failure → plain message, input kept, retry; double submission → one request. _(lead decision, `033-design.md` decision 3; owner sees it at Stage A.)_

**Administrator (US-8):** notification → queue filtered «Заявки инвесторов» → open → contact the representative outside the platform → status and note per 033.

## Product acceptance criteria

- `academy.doctor.school` serves a real investor page; the home «Инвесторам / Партнёрам → Как это работает» entries lead to it.
- The page presents the model, what the investor gets and how the relationship is formalised; it promises no on-platform payment.
- The «Обсудить проект» form needs no account; organisation, full name and work email are required (owner-drawn R4 canvas); validation messages say what to fix and keep other input; a server failure keeps input and offers retry _(lead decision, as US-6)_.
- The public no-account form is protected against bots and floods with the platform's existing bot-protection posture, as other public forms are. _(lead decision, security posture.)_
- The request cannot be sent without the explicit personal-data consent; the consent is recorded with the request. _(Lead-asserted legal constraint, as US-5 — UNCONFIRMED by the owner.)_
- Every request appears in the shared 033 queue as an investor request with organisation, contact and task; a double submission creates one request _(lead decision, `033-design.md` decision 3)_; the team is notified as for every queue entry, and the representative receives the «заявка получена» email.
- The confirmation is shown in place of the form with the canvas wording «КП придёт на указанную почту»: the team prepares the offer by hand, not an automatic offer. _(The canvas wording — owner-drawn R4 canvas; the slice-1 canvas edit «свяжется и подготовит КП» is the lead's and is not used.)_
- The page shows no marketplace block, no cards and no figures until the later slice brings real data; links go only to pages that exist.
- Investor requests follow the shared queue's row in the ADR-0009 §2.6 retention matrix (033 US-14): a request with no status change for a year closes by itself as «expired» and is erased one year after it closes _(agent-proposed — UNCONFIRMED; `033-design.md` decision 16)_; the representative's personal data is erased per ADR-0009 §2.3 on the subject's request; nothing is kept outside that policy.
- The page and form are usable on a phone and pass the platform accessibility bar (`playwright-axe`).

## Out of scope

Later slices of 034, each with its technical dependency:

- **Marketplace of investment products** — cards (school / course / expert application / expert) with potential audience, market capacity and remaining places; «хочу инвестировать в X» pre-filling the request — `blocked_by` **032** (cards read after the partner catalog, and both pages share the organisation model) and **036** (audience, capacity and remaining places are ledger figures).
- **Automatic commercial offer** («Скачать КП», canvas button variant Б) — later slice, after the marketplace.
- Linking a request to an organisation in the 032 registry, and «Кто уже инвестирует — Партнёры» — after the 032 partner catalog is public. _(agent-proposed — UNCONFIRMED.)_
- The investor organisation cabinet («Вы вошли как сотрудник организации-инвестора») and the page block «Организация, не персона» that leads to it — feature 035.
- Any payment on the platform (CON-16, OWD-3).
- The queue itself — feature 033 slice 1; this slice is `blocked_by` it (requests go into the shared application queue that 033 owns).

## Open questions

_None for slice 1._ The entry naming, the contact channel, the confirmation email and retention are recorded lead decisions above; the owner sees them at Stage A.

## Approved-mockup reference

Empty — filled at Stage A (`author-design-mockup`). Input: [`design-source/academy-invest.dc.html`](../../../../../../design-source/academy-invest.dc.html) (R4 canvas: how it works, what the investor gets, organisation, relationship, next-step form with sent state; marketplace states belong to the later slice; the switch «Объём» = «срез 1», the default, shows this slice — no marketplace, no «Организация, не персона», the consent row in the form, links only to «Проекты») and the «Инвесторам» / «Партнёрам» entries of [`design-source/academy-home.dc.html`](../../../../../../design-source/academy-home.dc.html).

## Prior art

- 013 PRD US-5…US-7 — partner benefits, partner lead form, confirmation — re-homed here and in the 033 queue (functional map §E).
- 015 PRD US-9/US-10 (pharma partner path to a request) — refined towards the marketplace of 034 (functional map §E row 015).
- The interim home stub's partnership form (private files on the portal volume) — replaced by this form and the 033 queue.
