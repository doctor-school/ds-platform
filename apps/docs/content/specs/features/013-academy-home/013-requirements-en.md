---
title: "013 — Static public Academy home"
description: "Production requirements for the exact approved static Academy home at / with a deliberately disabled partnership-form preview."
slug: 013-academy-home-requirements
product: ./013-product.md
status: In dev
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1307
issues: [1311, 1312]
prior_decisions:
  - "ADR-0014: the Product Lead-approved PRD is the source for EARS traceability"
  - "ADR-0013: @ds/design-system components and tokens are the UI source of truth"
  - "ADR-0006 §4: bilingual requirements and flat EARS numbering"
  - "ADR-0004: the Next.js portal owns the public user-facing route"
lang: en
---

> **EN (this)** · **RU:** [013-requirements-ru.md](./013-requirements-ru.md)
> · PRD: [013-product.md](./013-product.md), US-1…US-5.

# 013 — Static public Academy home

## Scope

This slice publishes the exact merged Academy demo at public /. The page is
static. The partnership fields and submit button remain disabled, visibly state
that data is not sent, and have no endpoint. The working form is tracked
separately.

## EARS requirements

- **EARS-1** _(realizes: US-1, US-5)_ — When a visitor requests public /, the
  portal shall render the static Academy home in the exact section order, copy,
  assets, and responsive composition pinned by the PRD, without redirecting the
  visitor and without reading a CMS or API.
- **EARS-2** _(realizes: US-2, US-3, US-5)_ — The page shall render exactly six
  supplied portraits, the same two approved rows in both Project and Events,
  the exact B2B Rutube destination, the exact privacy-policy destination, and
  no invented project metrics.
- **EARS-3** _(realizes: US-4)_ — While the form follow-up is not delivered, the
  partnership preview shall keep its fieldset and submit button disabled, show
  «Демо: данные не отправляются», send no network request, and persist no
  values.
- **EARS-4** _(realizes: US-1, US-3, US-5)_ — The static page shall preserve the
  approved demo behavior at desktop and mobile breakpoints in light and dark
  themes, remain keyboard-readable, and pass the Academy Playwright and axe
  checks.

## Verification

| Requirement | Evidence                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------- |
| EARS-1      | Production-route browser test asserts HTTP 200, section order, key copy, and no dynamic fetch.     |
| EARS-2      | Browser test asserts all six portraits and both exact external destinations in both repeated rows. |
| EARS-3      | Browser test asserts disabled fieldset/button, visible no-send note, and zero form requests.       |
| EARS-4      | Playwright covers desktop/mobile and light/dark; axe reports no serious or critical violations.    |

## Explicit exclusions

No working form, JSON persistence, API, database, CMS, queue, notification,
analytics, or admin surface belongs to this release.
