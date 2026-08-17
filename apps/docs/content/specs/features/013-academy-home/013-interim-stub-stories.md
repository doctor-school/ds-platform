---
title: "INTERIM stub stories — not product scope"
description: "The six stories of the temporary static Academy home stub live at / since release-2026.08.16-2. They describe the stub only and are not the product contract of Feature 013 — that contract is 013-product.md (US-1…US-12)."
slug: 013-academy-home-interim-stub-stories
status: Shipped
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [013-interim-stub-stories-ru.md](./013-interim-stub-stories-ru.md)

> **INTERIM STATIC STUB — NOT the Feature 013 product contract.** The stories
> below describe the temporary static home page live at `/` since
> release-2026.08.16-2 (Issues
> [#1311](https://github.com/doctor-school/ds-platform/issues/1311) /
> [#1312](https://github.com/doctor-school/ds-platform/issues/1312)). The
> canonical PRD of Feature 013 is [`013-product.md`](./013-product.md), US-1…US-12
> — a different, non-overlapping set of stories. This file exists solely so the
> INTERIM triplet keeps valid `realizes:` traceability without pointing at PRD
> stories it does not implement. Superseded by
> [#1324](https://github.com/doctor-school/ds-platform/issues/1324); the stub and
> this file are dismantled by
> [#1323](https://github.com/doctor-school/ds-platform/issues/1323).
>
> **Status as of 2026-08-17:** the INTERIM triplet text has been **replaced** by the
> full-home triplet under
> [#1324](https://github.com/doctor-school/ds-platform/issues/1324), so
> `013-requirements-en.md` / `-ru.md`, `013-design.md` and `013-scenarios.feature`
> now describe the full Academy home. The stub's own EARS text remains available in
> git history (spec PR
> [#1315](https://github.com/doctor-school/ds-platform/pull/1315), delivery PR
> [#1318](https://github.com/doctor-school/ds-platform/pull/1318)) — the stub still
> runs in production until #1323 dismantles it, and these stories stay its
> product-side record.

## Stub stories

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

## Approved source of the stub

The content and composition source of truth of the stub is the clean Academy
demo reviewed at commit 7330e4d8a99bdeca73285e2b4eabf09d7021788c and merged to
main as e20d64c25b98c30afb280c21bf6966e017a1d1eb.

**Its copy is not to be reused by the real home page** — owner instruction,
2026-08-17: «Не надо слепо переносить тексты из текущей главной.»
