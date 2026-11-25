---
title: "034 — Investors, slice 1: the «Как это работает» page with «Обсудить проект» into the shared queue (Requirements)"
description: "Requirements for slice 1 of feature 034: the Academy page academy.doctor.school/investors that explains how an organisation takes part (it invests in a project, experts produce education, doctors learn, the investor sees the result), what the investor gets and how the relationship is formalised (a contract outside the platform with transparent accounting on it); the «Обсудить проект — оставить заявку» form a representative sends without an account, with the purpose-bound personal-data consent, inline validation, a failure that keeps the input and one request per submission; the confirmation state; the investor request kind of the one 033 application queue — public bot-protected intake, the «Заявка получена» receipt to the work email, the team notification, the admin list and detail, statuses, notes, retention and erasure exactly as for every queue kind."
slug: 034-investment-marketplace
status: Draft
surface: user-facing
storefronts: academy-only
storefronts_reason: "The investor page is an Academy page feeding the apps/admin queue of feature 033; the investor cabinets are on the Academy (ADR-0016 §4), and the doctor storefront has no investor surface (EARS-2)."
tracker: https://github.com/doctor-school/ds-platform/issues/1824
prior_decisions:
  - "ADR-0016 §2 / §4 — the investor is an organisation and invests in a project, the single container of Academy work; the page names projects, never a separate investment object"
  - "ADR-0016 §6 — points and money live in one ledger family; the investor's accounting is the project's ledger, and no payment happens on the platform (CON-16, OWD-3)"
  - "ADR-0016 §7 — consents are separate per purpose: the investor request consent is its own purpose and version"
  - "ADR-0016 §8 — storefront ownership: the page is `academy`; requests are admin-only through the 033 queue"
  - "ADR-0009 §2.3 / §2.6 — erasure on the subject's request; investor requests follow the `applications` row of the retention matrix"
  - "ADR-0011 §2 channel 7 — queue emails carry the recipient address and non-personal text only"
  - "ADR-0013 §A1 — one capability, one owner: the application queue (033) gains a kind; 034 adds no second queue, no own admin and no own notification"
  - "ADR-0014 §2 — every EARS clause carries `realizes: US-N` of `034-product.md`"
  - "ADR-0006 §4 — triplet layout, flat EARS numbering"
  - "033 EARS-11 / EARS-12 / EARS-13…EARS-17 / EARS-20 / EARS-23 / EARS-25 — notification, receipt, admin queue, statuses, notes, erasure, expiry and PD masking, reused unchanged by the investor kind"
  - "003 EARS-16 / EARS-17 — the bot-protection gate (`@BotProtected`) and its stable codes"
lang: en
---

> **EN (this)** · **RU:** [`034-requirements-ru.md`](./034-requirements-ru.md)
>
> Product source: [`034-product.md`](./034-product.md) (slice 1). Public UI: the owner-drawn R4 canvas `design-source/academy-invest.dc.html` (switch «Объём» = «срез 1», «Заявка» = А) — Stage A pending on the page Issue. Admin UI: the 033 «Заявки» screens (approved-non-canvas), which gain the investor kind. Hence `surface: user-facing`. Design: [`034-design.md`](./034-design.md).

# 034 — Investors, slice 1: the «Как это работает» page with «Обсудить проект» into the shared queue (Requirements)

## Outcomes

- `academy.doctor.school/investors` is a real page: a representative of an organisation learns how participation works, what the investor gets and how the relationship is formalised, without any promise of an on-platform payment.
- The representative sends «Обсудить проект» without an account, with explicit personal-data consent; a failure never loses what they typed; one submission is one request.
- Every investor request lands in the one 033 application queue as its own kind, is notified to the team like every queue entry, and the representative receives «Заявка получена» at the work email.
- The page links only to pages that exist and shows no marketplace, no cards and no figures.

## Scope

- The Academy route `/investors` in `apps/portal` (route file only) mounting the investor page route component of `packages/applications` (`@ds/applications`, the 033 capability owner).
- The `investor` request kind of the 033 queue: the `ApplicationKind` member and its `APPLICATION_KINDS` entry in `packages/schemas` / `apps/api/src/applications/`, the public intake `POST /v1/public/applications/investor`, and the forward migration widening the `kind` check.
- The investor kind's labels and detail fields in the 033 admin «Заявки» screens.
- The «Во что инвестировать — Проекты» link to the 030 catalog.
- Boundary — the application queue: projection of `apps/api/src/applications/` + `packages/schemas/src/applications/` (033); diff: one kind (`investor`, public intake, `receiptTo: contact-email`, consent purpose `investor-request-personal-data`, admin label «Инвестор»). Storage, list, detail, statuses, notes, notifications, retention and erasure are 033's and are not re-specified here.
- Boundary — the Academy home: the «Партнёрам → Как это работает» hero card, the «Инвесторам → Как это работает» persona entry and the «Инвесторам» navigation item are 029's home (#1799) and point at `/investors`; 034 owns the target page.

### Out of scope

- Marketplace of investment products (cards, audience, capacity, remaining places, «хочу инвестировать в X» pre-fill) — later slice of 034, `blocked_by` 032 and 036.
- The automatic commercial offer («Скачать КП», canvas «Кнопка» = Б) — later slice of 034, after the marketplace.
- «Кто уже инвестирует — Партнёры», «Документы и лицензия» and linking a request to a 032 organisation — later slice, after the 032 public catalog.
- The investor organisation cabinet and the page block «Организация, не персона» — feature 035.
- The request channel variants Б (team contact without a form) and В (modal) of the canvas — not built; variant А is the slice.
- Any payment on the platform (CON-16, OWD-3).
- The queue itself, its admin and its notifications — 033 slice 1 (#4028, #4029, #4030).

## Constraints

- The request is a member of the closed `ApplicationKind` enum with its own payload and contact schema; it adds no table, no list and no admin section (033 «Request kinds»).
- The intake is public and `@BotProtected("investor-request")` (003 EARS-17); it needs no session.
- The consent is its own purpose `investor-request-personal-data` with its own version, recorded on the request (purpose, version tag, time); a no-account request has no `consent_records` row, as the 033 partnership kind (ADR-0016 §7).
- No request content leaves through email: the receipt and the team notice are the 033 generic bodies (ADR-0011 §2 channel 7).
- The page promises no payment, price or transfer on the platform; participation is a contract outside the platform (CON-16, OWD-3).
- The doctor storefront (`apps/doctor`) serves no `/investors` route and reads no application contract (ADR-0016 §8).

## Prior decisions

- PRD [`034-product.md`](./034-product.md) slice 1 and its recorded lead decisions of 2026-10-28 (entry naming, request channel А, «Заявка получена» email, no «Организация, не персона» on the page).
- The 033 triplet: [`033-requirements-en.md`](../033-author-application/033-requirements-en.md) and [`033-design.md`](../033-author-application/033-design.md) «Request kinds (the 034 seam)».
- The settlements of the PRD's _agent-proposed — UNCONFIRMED_ items: [`034-design.md`](./034-design.md) «Lead decisions».
- ADRs in the frontmatter `prior_decisions`.

## Event Model

**Commands** — `SubmitInvestorRequest` (guest representative).

**Events** — `ApplicationSubmitted` (kind `investor`, id); the 033 notification, status, note, expiry and erasure events apply unchanged.

**Read models** — the 033 admin queue list and detail, with the investor kind.

**Policies** — «one submission, one request» (idempotency key on the row, replay bound to the body); «a public intake is bot-protected»; «the queue is the record of truth; notifications are attempted after commit and never change the answer»; «a kind is a schema member, not a second queue»; «the page links only to pages that exist».

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more PRD stories and is covered by `034-scenarios.feature`.

- **EARS-1** _(realizes: US-1, US-2)_ — WHEN a visitor, signed in or not, opens `academy.doctor.school/investors`, THE SYSTEM SHALL render the header «Инвесторам» with the line «Как устроено участие: вы входите в проект — эксперты производят обучение — врачи учатся.» and the investor path «узнал → понял модель → проверил доверие → договор вне платформы → работает в кабинете» with «понял модель» marked as the current step; the block «Как это работает» with its three steps (you invest in a project — a school, a course or a congress, the Academy projects are in «Проекты»; experts produce the education, whose results reach doctor.school and the doctors of your audience; you see the result — doctor attention, analytics and the project report) and the line «Условия участия — в коммерческом предложении.»; the block «Что получает инвестор» with doctor-attention analytics, participant lists without contact data, surveys and research, and the annual exclusive on a project; the block «Как оформляются отношения» stating that participation is formalised by a contract outside the platform and the platform keeps transparent accounting on the project; and the block «Следующий шаг» with the form of EARS-3; THE SYSTEM SHALL show no marketplace, no product card, no audience or capacity figure, no «Организация, не персона» block, no cabinet entry, no «Скачать КП» and no statement of a payment on the platform.
- **EARS-2** _(realizes: US-1)_ — THE SYSTEM SHALL serve `/investors` only on the Academy host: the doctor storefront SHALL have no `/investors` route, SHALL import no application contract, and doctor-storefront requests for that path SHALL get its not-found page.
- **EARS-3** _(realizes: US-3, US-4)_ — THE SYSTEM SHALL show in «Следующий шаг», to every visitor without asking for an account, the heading «Обсудить проект — оставить заявку», the line «Команда Академии ответит и соберёт коммерческое предложение.», and the form with «Организация» (required, trimmed 1–200), «ФИО» (required, trimmed 1–200), «Роль в организации» (optional, trimmed 0–120), «Рабочая почта» (required, an email address of at most 254 characters), «Телефон» (optional, trimmed 0–32), «Задача» (optional, trimmed 0–2000), the consent of EARS-4 and «Отправить заявку»; optional fields SHALL carry the mark «необязательно»; every «Обсудить проект» control of the page SHALL lead to this one form.
- **EARS-4** _(realizes: US-5)_ — THE SYSTEM SHALL show the consent checkbox unticked with «Согласие на обработку персональных данных из заявки», the line «Данные нужны, чтобы команда Академии связалась с вами по заявке.» and the link «Политика персональных данных и согласия» to `/documents/privacy-policy`; WHEN an investor request is stored, THE SYSTEM SHALL record on it the purpose `investor-request-personal-data`, the current version tag and the time; THE SYSTEM SHALL refuse a body without the consent or with a version tag other than the current one with `400` and a field error on the consent.
- **EARS-5** _(realizes: US-6)_ — WHEN the representative taps «Отправить заявку» with a required field empty («Заполните поле»), a malformed work email («Похоже, в адресе опечатка»), a value out of bounds or the consent unticked («Отметьте согласие — без него заявку не отправить.»), THE SYSTEM SHALL send nothing, SHALL show what to fix next to each such field, move focus to the first one and keep every other value typed; WHEN the server refuses the body with field errors (`400`), THE SYSTEM SHALL show them next to the same fields with the same rule.
- **EARS-6** _(realizes: US-3, US-4, US-8)_ — WHEN any caller posts `POST /v1/public/applications/investor` with a canonical UUID idempotency key, a valid bot-protection proof and a valid body, THE SYSTEM SHALL store one `applications` row of kind `investor`, status `new`, no applicant user, the contact (organisation, full name, role, work email, phone), the payload (task), the subject line (the organisation), the consent of EARS-4 and `submitted_at`, and SHALL answer `201 { id }`; a repeat of the same key with the same body SHALL answer the same result and create nothing; the same key with a different body SHALL be refused with `422 IDEMPOTENCY_KEY_REUSED`; a missing or rejected proof SHALL be refused with `BOT_PROTECTION_REQUIRED` / `BOT_PROTECTION_REJECTED`, and a field-invalid body with `400` and field errors.
- **EARS-7** _(realizes: US-6)_ — WHEN the submission fails on the network or with a `5xx`, THE SYSTEM SHALL show «Не удалось отправить — сервер недоступен. Введённое сохранено.» with «Попробовать ещё раз», keep every value and retry with the same idempotency key; WHILE a submission is in flight, THE SYSTEM SHALL disable «Отправить заявку», so a double tap sends one request.
- **EARS-8** _(realizes: US-7)_ — WHEN the submission succeeds, THE SYSTEM SHALL replace the form with the state «Запрос отправлен» and the sent-state text the owner picks at Stage A — the owner's canvas text «Коммерческое предложение придёт на указанную почту.» until that pick — and SHALL offer «Отправить ещё одну заявку», which opens an empty form with a new idempotency key.
- **EARS-9** _(realizes: US-7, US-8)_ — WHEN an investor request is committed, THE SYSTEM SHALL send the 033 team notification (033 EARS-11) and one «Заявка получена» receipt (033 EARS-12) to the work email of the request, with the 033 generic bodies that carry no organisation, name, task or other request content, SHALL record both outcomes on the request and SHALL NOT change the intake's answer on any outcome.
- **EARS-10** _(realizes: US-8)_ — WHEN a platform administrator opens «Заявки», THE SYSTEM SHALL list investor requests with the kind «Инвестор» and the organisation as the subject line and offer the kind filter «Инвесторы»; WHEN the administrator opens an investor request, THE SYSTEM SHALL show «Организация», «ФИО», «Роль в организации», «Рабочая почта», «Телефон» and «Задача» with their labels, the consent purpose, version and time, and the notification outcomes; THE SYSTEM SHALL let the administrator move its status, add notes and erase its personal data exactly as for every queue kind (033 EARS-13…EARS-17, EARS-20).
- **EARS-11** _(realizes: US-9)_ — WHEN «Следующий шаг» renders, THE SYSTEM SHALL show «Во что инвестировать — Проекты» linking to `/projects`; THE SYSTEM SHALL render no link to a page that does not exist on the Academy (no partners catalog, no «Документы и лицензия», no investor cabinet).
- **EARS-12** _(realizes: US-5, US-8)_ — THE SYSTEM SHALL keep investor requests under the `applications` row of the ADR-0009 §2.6 retention matrix with the consent purpose `investor-request-personal-data` in its legal basis: closed as `expired` after one year without a status change (033 EARS-23), erased to the tombstone one year after closing or on the subject's request (033 EARS-20), the contact and payload masked in the 010 change audit (033 EARS-25); THE SYSTEM SHALL keep no copy of a request outside the queue.
- **EARS-13** _(realizes: US-1, US-3)_ — WHILE the viewport is a phone or a narrow screen, THE SYSTEM SHALL keep the page, the form with its errors, the failure state and the confirmation state usable without horizontal scrolling of the page, with every field and action keyboard-reachable, and every one of these screens SHALL pass the platform's `playwright-axe` gate.

## Invariants

- One submission is one investor request: a repeat of its idempotency key never creates a second row (EARS-6, EARS-7).
- An investor request exists only with its consent purpose, version and time on it (EARS-4, EARS-6).
- The intake is reachable without an account and never without a bot-protection proof (EARS-6).
- An investor request is a row of the 033 queue and nowhere else; no 034 code stores, lists or notifies it on its own (EARS-6, EARS-9, EARS-10, EARS-12).
- The page promises no payment on the platform and links only to existing pages (EARS-1, EARS-11).

## Verification

| #   | Type                                        | What it proves                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V-1 | Vitest — `packages/schemas` / `packages/db` | `ApplicationKind` has `investor`; the investor payload / contact schemas accept the bounds and refuse out-of-bounds, missing required and malformed email; the migration widens the `kind` check and an `investor` row is accepted (EARS-3, EARS-6).                                                                                       |
| V-2 | Vitest e2e — `apps/api`                     | Investor intake: `201` with one row, its contact, payload, subject line and consent purpose / version; replay with the same key; same key with another body `422`; missing / rejected proof; missing consent, stale version tag and field errors `400`; no session needed (EARS-4, EARS-6).                                                |
| V-3 | Vitest e2e — `apps/api`                     | After an investor intake the team notice goes to the `platform_admin` staff and the receipt to the work email; neither body carries organisation, name, task or phone; a mailer failure records `failed` and answers `201` (EARS-9).                                                                                                       |
| V-4 | Vitest e2e — `apps/api`                     | Admin list returns investor rows with the kind filter; the detail returns the labelled contact and task; status move, note and erasure work on an investor row; the purge expires and erases investor rows; the audit row masks contact and payload (EARS-10, EARS-12).                                                                    |
| V-5 | Vitest — UI (`packages/applications`)       | Page blocks present and no slice-2 block; form fields, «необязательно» marks, inline errors with focus and kept input, consent error, in-flight disable, failure state and retry with the same key, «Запрос отправлен» and «Отправить ещё одну заявку» with a new key; the projects link (EARS-1, EARS-3…EARS-5, EARS-7, EARS-8, EARS-11). |
| V-6 | Playwright / E2E — Academy                  | A guest opens `/investors`, reads the blocks, submits with an empty organisation and is told, fixes it, ticks the consent, submits and sees «Запрос отправлен»; the server-unavailable branch keeps input and retries (EARS-1, EARS-3…EARS-8).                                                                                             |
| V-7 | Playwright / E2E — admin                    | A platform administrator filters «Инвесторы» in «Заявки», opens the new investor request and sees its organisation, contact and task, moves it to «На рассмотрении» and adds a note (EARS-10).                                                                                                                                             |
| V-8 | Playwright / E2E — doctor                   | `doctor.school/investors` renders the doctor not-found page (EARS-2).                                                                                                                                                                                                                                                                      |
| V-9 | Playwright + axe                            | At a 390 px viewport the page, the form with errors, the failure and the confirmation state have no horizontal page scroll; clean `playwright-axe` runs on each (EARS-13).                                                                                                                                                                 |

## Work-package map

Each Issue is a sub-issue of #1824 and ships its UI with its backend; slices, dependencies and their rationale: `034-design.md` «Delivery slices». Issue numbers are written back by `open-ears-issues`.

| EARS                                          | Work package                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| EARS-4 (server), EARS-6, EARS-9, EARS-12      | **Investor request kind** — enum member, kinds-table entry, migration, public intake with consent, bot protection, receipt, matrix row |
| EARS-10                                       | **Investor requests in the admin queue** — kind label, filter, detail field labels                                                     |
| EARS-1…EARS-5, EARS-7, EARS-8, EARS-13 (page) | **«Инвесторам» page** — route, doctor-host absence, blocks, form, states; carries the page's Stage A                                   |
| EARS-11                                       | **Projects link of the page** — «Во что инвестировать — Проекты» after the 030 catalog                                                 |
| V-6 / V-7 / V-8 / V-9 journeys                | **Browser journeys** — CI Playwright Academy, admin and doctor-host journeys; integration Issue                                        |
