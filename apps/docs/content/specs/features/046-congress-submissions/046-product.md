---
title: "Feature 046 — Congress submissions: oral talks, posters and abstracts (PRD)"
description: "Product requirements for congress submissions in a «Мои заявки на Конгресс» section of the Doctor.School account: a registered participant sends oral talks, posters and abstracts, many and at any time while intake is open; drafts save themselves; statuses and committee comments show in the section and arrive by email; the program committee reviews in the admin; dates and limits are admin settings. Source of the 046 EARS triplet (ADR-0014)."
slug: two-site-ia-046-congress-submissions-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`046-product-ru.md`](./046-product-ru.md)

> Epic: [«Two storefronts — information architecture» product brief](../../product/two-site-ia/brief.md) · Builds on: [044 — Congress sign-up](../044-congress-signup/044-product.md). Feature Issue: #2379; this spec's Issue: #2385.

## Summary

The organisers of the 2027 congress want three kinds of materials from participants — **oral talks**, **posters** and **abstracts** — and wrote down how intake must work: one account, many submissions; the kind belongs to the submission, not to the person; a person may send several talks, a talk and a poster, abstracts and a talk about the same work, or all three, at different times, while intake is open. Registering for the congress stays separate.

**Where it happens.** Registration stays on the congress site orthobio.ru (feature 044). Materials are sent in the participant's Doctor.School account, in a section «Мои заявки на Конгресс» on the Doctor.School doctor storefront — today `new.doctor.school`, and `doctor.school` once the storefront moves to the root domain. A participant reaches it from the link in the 044 confirmation letter or from a button on the congress site, and signs in with the emailed code — the same login as today, nothing new to learn. An account without a congress registration sees one line — «Сначала зарегистрируйтесь участником Конгресса» — and a link to the registration form.

**How a submission is made.** The participant picks a kind and fills its form. Everything saves itself while typing; they can leave and come back. Only when they press «Отправить» does the platform check that the form is complete, that intake for that kind is open, that the limit is not reached and that the person may send this kind. From that moment the submission goes to the program committee.

**Kinds.**

- **Oral talk** — title, authors (each: surname, first name, patronymic if any, workplace; one marked as the presenter), educational goal, summary. The talk is given in person.
- **Poster** — title, authors, goal, content. Posters are for participants strictly younger than 40 on the congress start date (23 April 2027 for the 2027 congress), confirmed by the organisers; the platform asks for the birth date once and remembers it. Poster files and their layout rules come later from the organisers.
- **Abstracts** — title, authors and five sections «Актуальность», «Цель», «Материалы и методы», «Результаты и обсуждение», «Выводы», together no more than 5000 characters including spaces, with one counter for the whole text. Plain text only — tables, formulas, figures and photos cannot be inserted. When sending, the author confirms that there are no incorrect borrowings and no trade names; publication of the abstracts, РИНЦ included, is covered by the one submission consent. Abstracts are not a talk application; on a talk or poster the author can press «Подать тезисы по этой работе» to start abstracts with the same title and authors.

**Statuses.** Черновик → Отправлена → На рассмотрении → Принята / Отклонена / На доработке, and Отозвана when the author withdraws. The author sees the status in the section and receives a letter when the submission is sent, accepted, rejected or returned for revision; for a rejection and a revision request the committee writes a comment, which the author reads in the letter and in the section. A submission returned for revision can be corrected and resent within 3 business days — the letter and the section name the exact deadline, and the section counts down the time left. Until a decision the author can withdraw a submission: before review, while its kind's intake is open, it goes back to a draft for correction; later it becomes «Отозвана» and still counts toward the limit. Before a deadline the platform reminds authors who still have unsent drafts.

**Who reviews.** The **program committee** of the congress works in the Doctor.School admin: a list of every sent submission with filters by kind, status, date and author, and a card that opens at the side with the full text and the author's contacts, where the committee sets the status and writes the comment. Everyone in the committee sees all submissions; there is no distribution between reviewers. The role is given per congress by the Doctor.School team.

**Dates and limits are settings.** Intake opens «по готовности» — when the organisers are ready — and closes on 15 January 2027 for oral talks and on 29 January 2027 for posters and abstracts, each inclusive, until 23:59 Moscow time. Abstracts are limited to 3 per author — every sent abstract counts, whatever became of it; talks and posters are unlimited. All of this, and the counting rule below, is changed by a Doctor.School administrator on a settings screen in the admin, without a platform release.

## User stories

- **US-1** — As a registered participant, I want to open «Мои заявки на Конгресс» from the congress letter or site and sign in with the emailed code, so that I can send materials without a new password or a new registration.
- **US-2** — As a person with a Doctor.School account but no congress registration, I want to be told plainly to register first and where, so that I do not fill a form that cannot be sent.
- **US-3** — As a speaker, I want to send an oral talk with its authors, goal and summary, so that the program committee considers it.
- **US-4** — As a young researcher, I want to send a poster, and to be told clearly if I am not eligible by age, so that I do not waste effort.
- **US-5** — As an author, I want to send abstracts in the required structure with a live character counter, and to give the statements the organisers require, so that my abstracts can be published.
- **US-6** — As a participant, I want to send several submissions of any kinds at different times — including abstracts about a talk I already sent — and to know the limit before I hit it.
- **US-7** — As an author, I want my drafts saved automatically and to be told when a kind is not open yet or already closed, so that I never lose text and never guess why sending is not possible.
- **US-8** — As an author, I want to see each submission's status and the committee's comment in the section and to receive them by email.
- **US-9** — As an author, I want to take back a sent submission before review to correct it, to withdraw a submission until it is decided, and to revise and resend a submission returned for revision within a deadline I can see.
- **US-10** — As a program committee member, I want to see every sent submission of the congress, filter them, read each in full and set a status with a comment, so that the committee decides in one place.
- **US-11** — As a Doctor.School administrator, I want to set the opening dates, deadlines, limits and the counting rule per kind in the admin, so that the organisers' changes need no release.
- **US-12** — _Retired._ No partner role (owner decision 2026-10-08, #2438); the number stays unused.
- **US-13** — As an author with unsent drafts, I want a reminder before the deadline.
- **US-14** — As a participant who just registered, I want the confirmation letter to show me where to send materials.

## Scenarios

1. **From the letter to the first talk.** The participant opens the confirmation letter, presses «Подать материалы в кабинете», signs in with the code, and sees the section. They create an oral talk — they are already listed as the first author with their workplace — type the title and the summary, close the tab, return the next day, finish and send. They accept the personal-data consent once. The status becomes «Отправлена» and a letter arrives.
2. **No registration.** A doctor with a Doctor.School account opens the section. It says «Сначала зарегистрируйтесь участником Конгресса» and links to orthobio.ru/registration.
3. **Poster and age.** The participant chooses a poster; the platform asks for the birth date. Born on 23 April 1987 or earlier, the poster is refused with the explanation that posters are for participants younger than 40 on 23 April 2027; talks and abstracts stay available.
4. **Abstracts about a talk.** On the sent talk the participant presses «Подать тезисы по этой работе», gets abstracts with the same title and authors, writes the five sections watching the counter, gives the two statements, and sends.
5. **The fourth abstract.** With three abstracts sent, the fourth is refused with «Можно отправить не больше 3 тезисов» — also when one of the three was rejected or withdrawn. Only an abstract taken back to a draft before review frees its place.
6. **Closed kind.** On 16 January an oral talk draft can still be read, but says «Приём устных докладов закрыт 15 января 2027 — отправить заявку нельзя».
7. **Committee returns a talk.** A committee member filters by «Устный доклад», opens a talk at the side, chooses «На доработке», writes the comment and saves. It is Tuesday 16 February, so the author has until Friday 19 February, 23:59 Moscow time. The author receives a letter with the comment and that deadline, sees it in the section with the time left, corrects the talk and sends it again, even though oral intake has already closed. Had the author missed the deadline, the talk would stay «На доработке», read-only, until the committee decides — or until the Doctor.School administrator extends the deadline, for example over a holiday.
8. **Deadline moved.** The organisers extend abstracts to 31 January. The administrator changes the last day in the settings; the section shows the new date at once, and authors with drafts receive a fresh reminder.
9. **Withdrawn after review started.** A talk is «На рассмотрении»; the author presses «Отозвать» and confirms. It becomes «Отозвана», cannot be edited or sent again, still counts toward the limit, and the committee sees it as withdrawn.

## Product acceptance criteria

- A submission can be made only from an account registered for the congress; an account without registration sees only the prompt to register.
- Registering, signing in and the congress site forms work exactly as today; the only change to the 044 letter is the link to the section.
- One account can send any number of oral talks and posters and at most 3 abstracts; every sent abstract counts — rejected and withdrawn ones included — and only drafts do not.
- Until a decision the author can withdraw a submission: before review and while its kind is open it returns to a draft; otherwise it becomes «Отозвана», read-only and final.
- Drafts never get lost and are never refused for being incomplete; completeness, dates, the limit and age are checked only on «Отправить», and a refusal says what to fix.
- Abstracts cannot exceed 5000 characters including spaces; the counter on screen and the platform count the same way.
- Posters are refused for participants aged 40 or more on 23 April 2027, with a plain explanation; other kinds stay open.
- The author sees the status and the committee comment in the section and in letters for «Отправлена», «Принята», «Отклонена», «На доработке» and when the revision deadline is extended; «На рассмотрении» sends no letter.
- A rejection or a revision request cannot be saved without a comment.
- A submission returned for revision can be corrected and resent until 23:59 Moscow time of the 3rd business day after the committee's request, even after its kind's intake has closed; the letter names the deadline and the section shows it with a countdown. After it the submission waits for the committee's decision; only the Doctor.School administrator can extend it.
- The committee sees every sent submission of its congress and nothing else in the admin; the committee does not see drafts.
- Dates, limits and the counting rule change on the admin settings screen and take effect without a release.

## Decided rules

Customer decisions, 2026-09-29 (решение заказчика, 2026-09-29):

1. **Abstract limit.** Every sent abstract counts toward the limit of 3 — sent, in review, accepted, rejected, returned for revision and withdrawn after review started. Only drafts do not count.
2. **Withdrawal.** For all three kinds, until a decision («Принята» or «Отклонена»): a submission «Отправлена» whose kind's intake is still open can be taken back for correction («Забрать на исправление») — it returns to a draft and frees its place in the limit. A submission already «На рассмотрении» or «На доработке», or «Отправлена» after its kind's intake has closed, can be withdrawn («Отозвать») — it becomes «Отозвана»: read-only, cannot be sent again, and keeps its place in the limit. The author may still start new submissions while places and intake allow. After «Принята» or «Отклонена» nothing can be withdrawn.
3. **Revision term.** When the committee returns a submission for revision (always with a comment), that submission gets its own deadline: 23:59 Moscow time of the 3rd business day after the request. The intake deadlines do not apply to it. Until then the author can correct and resend it; after it, editing and resending are closed and the submission stays «На доработке» until the committee or the Doctor.School administrator accepts or rejects it. The administrator can extend one submission's deadline in the admin. The section shows the deadline and a countdown; the revision letter states it. Business days are Monday to Friday; public holidays are not taken into account automatically — the extension covers them (tech-lead decision). There is no separate congress-wide «Доработки принимаются до» date.

## Decisions the organisers still confirm

These are built as stated; each is a setting or a small rule that can be flipped when the organisers answer. **Подтверждается организаторами.**

1. No letter is sent when a submission goes «На рассмотрении».
2. The limit counts only the author who sends; counting the first author of every submission as well is a setting, off by default (TZ §8).

## Approved mockup

The cabinet section «Мои заявки на Конгресс» is drawn on the canvas `design-source/doctor-lk-congress.dc.html`, the owner's final layout А (2026-09-30). The admin list, card and settings and the letters have no canvas; each goes through the Stage-A design gate before its slice is built (`046-design.md`, «Delivery slices»); the admin list and side card reuse the owner-approved admin list and the side panel already used for the 044 participant card.

## Dependencies

- **Congress site — `doctor-school/orthobio-site#99`** (re-scoped by the tech lead): a «Подать материалы» section with «Зарегистрироваться» and «Войти в кабинет», and a «Подать материалы в кабинете» button on the «Заявка принята» card. It links to the platform section, today `https://new.doctor.school/account/congress`, and can ship once the section is live.
- **The personal-data consent for submissions** is the organising committee's own text (owner decision 2026-09-30): one consent for every submission kind — the submission content, co-authors' data, the birth date for posters, passing submissions to the program committee, and publication of abstracts, РИНЦ included. The platform publishes it on its documents pages («Согласие на обработку персональных данных для заявок на Конгресс»), the form's checkbox links to it, and every acceptance is recorded with the text version, so a new edition is asked again. It is a separate text from the personal-data policy the congress registration consent records.
- **Role grants** for committee members are made by the Doctor.School team on request until the grants screen (#2378) exists.

## Out of scope

- Poster files and their layout rules.
- Publishing abstracts on the congress pages, scoring, assigning submissions to reviewers.
- A congress questionnaire on the platform or any change to login and registration.
- Co-author accounts or confirmations; a per-organisation limit does not apply: participants register as individuals, there are no organisation accounts, and «Организация / место работы» is plain text in the profile and the submission that nothing is counted or limited by (organisation accounts, if they appear, are a separate decision).
- Exporting the list to a file; resending a failed letter; statistics of past congresses (the organisers have no data yet).

## Open questions

None.

## Prior system — migration source

The 2026 congress collected materials «через личный кабинет на платформе регистрации» — an external registration platform with no source in our repositories, so there is no reviewable predecessor and nothing to migrate.
