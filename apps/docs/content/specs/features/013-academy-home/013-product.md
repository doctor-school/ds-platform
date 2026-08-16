---
title: "Feature 013 — Static Academy home (PRD)"
description: "Owner-approved first production slice of the Academy home: the exact static demo at public /, with the partnership form deliberately disabled."
slug: academy-public-013-academy-home-product
epic: ../../product/academy-public/brief.md
parent_issue: https://github.com/doctor-school/ds-platform/issues/1240
reservation_issue: https://github.com/doctor-school/ds-platform/issues/1307
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [013-product-ru.md](./013-product-ru.md)

## Release decision

On 2026-08-16 the Product Lead explicitly authorized publishing the approved
static Academy home to production before making the partnership form work.
This release reproduces the merged Academy demo and does not submit or persist
form values. The working form is a separate, immediately following tracked
slice. No other product behavior may be added without explicit Product Lead
approval.

## User stories

- **US-1** — As a visitor, I can open public / and understand the Academy,
  its people, projects, broadcasts, partner proposition, and participation
  formats.
- **US-2** — As a visitor, I can see the six approved people with their supplied
  portraits and the two approved project/broadcast rows.
- **US-3** — As a visitor, I can open the approved external content and privacy
  links from the page.
- **US-4** — As a prospective partner, I can see the future partnership form,
  while the page states unambiguously that its fields are disabled and data is
  not sent.
- **US-5** — As the Product Lead, I receive the exact reviewed demo composition,
  copy, assets, links, themes, and responsive behavior in production without a
  CMS, database, API, or invented content.

## Approved source

The content and behavior source of truth is the clean Academy demo reviewed at
commit 7330e4d8a99bdeca73285e2b4eabf09d7021788c and merged to main as
e20d64c25b98c30afb280c21bf6966e017a1d1eb.

The production order is:

1. header;
2. one full-width partner hero;
3. What;
4. People, with the Project block before six person cards;
5. Events;
6. Why;
7. Projects without invented metrics;
8. partner value;
9. participation formats;
10. disabled partnership-form preview;
11. footer.

The Project block and Events use the same two approved rows. The B2B row links
exactly to
https://rutube.ru/video/a682bead10b37ce96beef4f3a6d59b08/?r=wd.
The privacy link is exactly https://doctor.school/index/privacy-pay.

## Disabled form contract

The form preview is copied without functional expansion:

- its fieldset and submit button are disabled;
- it visibly says «Демо: данные не отправляются»;
- it sends no request and stores no data;
- there is no form endpoint in this release.

The next form slice will use the explicitly approved role order:
«Эксперт», «Партнёр», «Участник подкаста», «Соавтор направления», «Компания».
That decision is recorded for the follow-up only and does not make the disabled
preview functional.

## Out of scope

- working form submission or server-side JSON files;
- CMS or dynamic content;
- database, queues, notifications, CRM, analytics, or admin surface;
- editorial redesign or copy changes beyond the approved demo.

## Acceptance

The production route / matches the approved demo at desktop and mobile
breakpoints in light and dark themes, contains the exact approved content and
links, and cannot submit the disabled form.

## Open questions

None for this static release.
