---
title: "Feature 013 — Academy home and partnership form (PRD)"
description: "Product contract for the shipped static Academy home and the owner-approved follow-up that enables its partnership form with private server-side JSON persistence."
slug: academy-public-013-academy-home-product
epic: ../../product/academy-public/brief.md
parent_issue: https://github.com/doctor-school/ds-platform/issues/1240
reservation_issue: https://github.com/doctor-school/ds-platform/issues/1307
status: In dev
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [013-product-ru.md](./013-product-ru.md)

## Release history and amendment

### Shipped first slice — static Academy home

On 2026-08-16 the Product Lead explicitly authorized publishing the approved
static Academy home to production before making the partnership form work. The
first slice, delivered by Issue #1311 and PR #1313, reproduced the merged
Academy demo and deliberately did not submit or persist form values.

### Approved follow-up — working partnership form

The Product Lead subsequently approved
[Issue #1312](https://github.com/doctor-school/ds-platform/issues/1312) as the
immediate follow-up. It enables the existing partnership form and saves each
accepted submission as one private server-side JSON record. This amendment
preserves the meaning and numbering of US-1…US-5 and adds US-6. No other
product behavior may be added without explicit Product Lead approval.

## User stories

- **US-1** — As a visitor, I can open public / and understand the Academy,
  its people, projects, broadcasts, partner proposition, and participation
  formats.
- **US-2** — As a visitor, I can see the six approved people with their supplied
  portraits and the two approved project/broadcast rows.
- **US-3** — As a visitor, I can open the approved external content and privacy
  links from the page.
- **US-4** — As a prospective partner viewing the first static slice, I can see
  the future partnership form while the page states unambiguously that its
  fields are disabled and data is not sent.
- **US-5** — As the Product Lead, I receive the exact reviewed demo composition,
  copy, assets, links, themes, and responsive behavior in the first production
  slice without a CMS, database, API, or invented content.
- **US-6** — As a prospective participant, I can submit my approved contact,
  role, and consent fields through the existing partnership form, receive
  accessible feedback, and see success only after my submission has been
  privately saved.

## Approved source

The content and composition source of truth remains the clean Academy demo
reviewed at commit 7330e4d8a99bdeca73285e2b4eabf09d7021788c and merged to main
as e20d64c25b98c30afb280c21bf6966e017a1d1eb. Issue #1312 changes only the
partnership form's behavior and states; it does not redesign the page or revise
its approved editorial content.

The page order remains:

1. header;
2. one full-width partner hero;
3. What;
4. People, with the Project block before six person cards;
5. Events;
6. Why;
7. Projects without invented metrics;
8. partner value;
9. participation formats;
10. partnership form — disabled in the shipped first slice and enabled by
    Issue #1312;
11. footer.

The Project block and Events use the same two approved rows. The B2B row links
exactly to
https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd.
The privacy link is exactly https://doctor.school/index/privacy-pay.

## Working form contract — Issue #1312

The enabled form contains:

- a required name;
- an optional company or clinic;
- one required combined contact field labelled «Email или Telegram», with the
  placeholder `name@company.ru или @username`, whose value is either a valid
  email address or a Telegram handle;
- a required role, offered in this exact order: «Эксперт», «Партнёр»,
  «Участник подкаста», «Соавтор направления», «Компания»;
- required consent linked to exactly
  https://doctor.school/index/privacy-pay.

An accepted submission creates exactly one private server-side JSON record.
The form uses no database, CMS, Mattermost, queue, worker, CRM, or notification.
Raw submitted values do not appear in application logs, and visitors have no
public read or list surface for saved records. Retention remains governed by
the linked privacy policy and ADR-0009; this slice makes no new decision about
a retention duration.

## Flows

### Happy path

1. The visitor enters a name, optionally a company or clinic, one valid email
   address or Telegram handle in the combined contact field, selects one
   approved role, and gives the required consent.
2. The visitor submits the form.
3. Only after one private JSON record has been saved, the form is replaced with
   the exact success text: «Спасибо! Заявка сохранена.»

### Invalid values

The visitor stays on the form, receives accessible inline errors for the fields
that need attention, and no JSON record is created.

### Write failure

The form and entered values remain available. Above the submit control, the
visitor sees the exact error text: «Не удалось сохранить заявку. Попробуйте ещё
раз.» No success state is shown.

## Product acceptance criteria

- The shipped page composition, content, links, responsive behavior, and light
  and dark themes remain intact while the partnership form becomes operable.
- Missing or invalid required values cannot be saved and are explained with
  accessible inline field errors.
- A valid submission creates exactly one private JSON record and shows the
  approved success state only after the write succeeds.
- A failed write preserves the form and its values and shows the approved error
  above the submit control.
- Raw values are absent from application logs, and no public read or list
  endpoint exposes submissions.
- Browser coverage exercises rejection, acceptance, write failure, mobile,
  both themes, keyboard interaction, and automated accessibility checks.

## Out of scope

- CMS or dynamic editorial content;
- database, Mattermost, queue, worker, CRM, notification, analytics, or admin
  workflow;
- a public read or list surface for submitted records;
- a new retention duration or policy beyond the linked privacy policy and
  ADR-0009;
- a new outbound-contact promise or response-time guarantee in the form's
  success state;
- editorial redesign or copy changes beyond the approved form states.

## Approved mockup reference

The shipped Academy home and its existing partnership-form composition are the
approved visual source. Issue #1312 adds only the approved validation, success,
and write-failure states described above; final rendered behavior remains
subject to the recorded live Stage-B review.

## Open questions

None for Issue #1312.
