---
title: "Feature 046 — Congress abstracts and talk submissions (PRD)"
description: "Product requirements for abstract and talk submissions from the congress site orthobio.ru: submission together with the participant registration (044), several submissions per participant, edit and add-another until the deadline through a link in the confirmation email, a submission window held in settings, and a read-only submissions registry for the congress partner. Source of the 046 EARS triplet (ADR-0014)."
slug: two-site-ia-046-congress-submissions-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`046-product-ru.md`](./046-product-ru.md)

> Epic: [«Two storefronts — information architecture» product brief](../../product/two-site-ia/brief.md) · Parent feature: [044 — Congress sign-up](../044-congress-signup/044-product.md). Feature Issue: #2379; this draft spec's Issue: #2385.

## Summary

The product owner described congress participation as follows (verbatim, RU): «Существует три варианта участия в Конгрессе, для каждого из них предусмотрена своя форма: Участник … Каждая другая форма подразумевает заполнение формы участника. То есть быть участником обязательно в любом случае, остальные два варианта опциональны. Подать тезисы для обсуждения на Конгрессе. Выступить с докладом на Конгрессе. Подаётся тема, название доклада, список соавторов доклада.» — being a participant is mandatory; submitting an abstract and applying for a talk are optional additions to it.

Feature 046 builds on the 044 sign-up and re-does none of it. The participant registration stays mandatory and runs exactly the 044 path: a passwordless Doctor.School account, the personal-data consent, the event registration row, the confirmation email. 046 attaches **submissions** of two kinds to that registration — an **abstract** and a **talk application**. One participant may hold several, each linked to their registration for this congress.

An **abstract** is text later published on the congress pages: «Тезисы вводятся текстом, тут всё чётко структурируем, так как это контент для отображения на страницах Конгресса.» It is therefore neither a free field nor a file but a structured record: title, topic (section), authors, length-limited text sections and keywords. A **talk application** is shorter: topic, talk title and the co-author list with a flag for who presents.

Submissions are accepted only until a deadline, and the deadline is a setting, not a code constant: «Да, но тоже вынести эту дату в настройки, чтобы можно было легко менять.» Today the deadline is 1 December 2026; the congress site already states «с 1 октября по 1 декабря 2026». Until the deadline the author can correct a submission and add another through the link in the confirmation email — no password, no platform sign-in. After the deadline submitting and editing are closed, while the participant registration stays open until the 044 window closes (22 April 2027, 00:00 Moscow time).

The third party is the **congress partner**: «Партнёр Конгресса - видит исключительно заявки на тезисы и доклады. Не видит полный список участников … Им доступна выборка по спикерам и по тезисам. Аналогично с поиском и фильтрацией.» The partner contacts authors about their talks, so contacts are visible: «Контакты он тоже видит, так как они выходят с людьми на связь по поводу докладов. Read-only.» The partner role is bound to one congress by the same event-role binding mechanism the 044 amendment introduces (#2380). The role is granted manually in Zitadel for now; the platform-admin screen for granting such roles is a separate task, #2378.

046 is `user-facing`: the submissions registry and the submission card are `apps/admin` screens, and the submission form and the edit page are congress-site screens (repo `doctor-school/orthobio-site`, Issue orthobio-site#99) talking through the same same-origin `/api` proxy as the 044 form.

## User stories

- **US-1** — As an author-participant, I want to submit an abstract together with my congress registration, so that it reaches the programme and the congress pages.
- **US-2** — As a speaker-participant, I want to submit a talk application together with my registration — topic, title and co-authors, marking who presents — so that the organisers consider my talk.
- **US-3** — As an author, I want to submit several submissions — several abstracts, several talks or both — without registering again.
- **US-4** — As an author, I want to correct a submission or add another until the deadline through the link in my email, without setting a password or signing in to the platform.
- **US-5** — As an author, I want an email listing my submissions with a link to edit them, so that I know everything was accepted and can come back later.
- **US-6** — As a congress partner, I want to see my congress's submissions registry with the authors' contacts and to search and filter it by speaker and by abstract, so that I can contact people about their talks.
- **US-7** — As an organiser, I want the congress partner to see only the submissions — not the participant list, not other events, not other admin sections — and to change nothing.
- **US-8** — As a platform administrator, I want to change the submission opening and closing dates in settings, without a platform release and without editing the congress site.
- **US-9** — As a participant, I want to see outside the submission window that submitting is not yet open or already closed, while still being able to register as a participant.

## Scenarios

1. **Participant + abstract.** The participant fills the participant block, presses «Подать тезисы», fills title, topic, authors, text sections (each with a character counter) and keywords, and submits. The site shows the confirmation; the email carries the registration, the list of submissions and the edit link.
2. **Participant + talk.** Same, pressing «Подать заявку на доклад»: topic, title, co-authors (full name, workplace, email, presents flag).
3. **Two abstracts.** The participant adds two abstract blocks in one submission; the email lists both.
4. **Edit via link.** The author opens the link from the email, sees their submissions, corrects the «Результаты» section of an abstract, adds one more talk and saves. An email with the updated list follows.
5. **Submissions closed.** After the deadline the participant form is still available, but there are no abstract and talk sections — a closed-intake message stands in their place. The email link opens the submissions read-only with the same message. A request carrying submissions that still reaches the API is refused whole and creates nothing.
6. **Partner searches.** The congress partner signs in to the admin, sees the single «Заявки» item, filters by kind «Тезисы», searches by a speaker's surname and by a word from an abstract title, opens the card and sees the full text, the authors and the submitter's contacts.
7. **Partner hits the boundary.** The partner types the participant-roster URL or another section — the server refuses and the admin has nothing to render.

## Product acceptance criteria

- No submission exists without a participant registration: every submission belongs to a participant's registration for this congress.
- One participant may hold several submissions of both kinds; re-sending the same form creates no duplicate submissions.
- Abstracts are stored as structured text with length limits that the form shows and the server enforces identically.
- The submission deadline changes in settings without a platform release and without editing the site: the site reads the dates from the platform.
- Until the deadline the author edits and adds submissions through the email link; after it the link changes nothing.
- The congress partner sees only their congress's submissions, with contacts, with search and filters by speaker and by abstract, and can change nothing; the participant roster is closed to them.
- The form response does not reveal whether the email already had an account (as in 044).

## Approved mockup

No approved mockup yet. The site form, the edit page, the submissions registry and the admin card pass the Stage-A design gate (`build-ui-from-design-system`); the registry reuses the owner-approved admin `AdminDataList` composition, as the 044 roster does. The proposed UX shape is Open question 3.

## Out of scope

- Review, selection, accepted/rejected states and publishing abstracts on the congress pages — the next feature; 046 only collects submissions.
- Withdrawal (deletion) of a submission by its author: the team deletes on request manually, as with 044 registrations.
- File uploads (poster, slides, abstract PDF).
- The screen for granting event-bound roles — #2378; until then roles are granted manually in Zitadel.
- Exporting the submissions registry to a file.
- Submissions through the signed-in doctor's platform registration path (044 EARS-16): 046 works only from the congress-site form.

## Open questions

Three decisions for the product owner. Nothing else in the spec depends on them: each answer slots into a place already reserved for it without restructuring the documents.

1. **The final abstract and talk field set.** The owner is updating it from past congress archives. The spec currently records a base set, to be confirmed by the owner: for an abstract — title, topic (a section from a closed list), authors, the sections «Актуальность», «Материалы и методы», «Результаты», «Выводы», each length-limited, and keywords; for a talk — topic, title and co-authors. Owner decision: confirm this set or supply the replacement — the fields, the topic (section) list and the character limits.
2. **Whether «постерный доклад» stays a third submission kind.** The site lists three kinds today (oral talk, abstract publication, poster), the owner's wording names two. Owner decision: the poster is a separate submission kind (then it is added as a third kind with its own field set), a variant of the abstract (a «poster requested» flag), or not accepted.
3. **Confirmation of the UX shape.** Proposal from research: one site form — the participant block first, then expandable «Подать тезисы» and «Подать заявку на доклад» sections, each repeatable; a co-author repeater (full name, workplace, email, presents flag); abstract sections with character counters; edit and add-another until the deadline through the confirmation-email link, which is not a platform sign-in. Owner decision: accept this shape or name another; email and screen copy is approved at Stage A.

## Prior system — migration source

No platform counterpart: neither the platform nor the 044 form accepts submissions. The field-set source is the past congress archives the product owner is working through (Open question 1). No data migration.
