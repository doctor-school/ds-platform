---
title: "013 — Academy home and partnership form"
description: "Production requirements for the approved Academy home and its enabled private partnership form."
slug: 013-academy-home-requirements
product: ./013-product.md
status: In dev
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/12
parent_issue: https://github.com/doctor-school/ds-platform/issues/1307
issues: [1311, 1312]
prior_decisions:
  - "ADR-0002 §4, §5.5: explicit contracts and server-side validation"
  - "ADR-0004 §9, §14: portal route and server mutation boundary"
  - "ADR-0006 §4: bilingual requirements and flat EARS numbering"
  - "ADR-0009 §2.1, §2.6: personal-data protection"
  - "ADR-0011 §2.1–§2.4 and ADR-0012 §1, §4: data handling and fail-closed operations"
  - "ADR-0013 §4, §7: design-system controls and accessibility"
  - "ADR-0014 §1–§5: Product Lead PRD traceability"
lang: en
---

> **EN (this)** · **RU:** [013-requirements-ru.md](./013-requirements-ru.md)
> · PRD: [013-product.md](./013-product.md), US-1…US-6.

# 013 — Academy home and private partnership form

## Outcomes

The approved Academy home stays intact while visitors submit the approved contact,
role, and consent data, receive accessible feedback, and see success only after
one private record exists.

## Scope

Issue #1312 enables the existing form at public /. A Next.js Server Action writes
accepted submissions as private JSON; visitors have no read or list surface.

## Prior decisions

ADR-0002 design §4.3, §4.4, §4.6, and §5.5 fixes errors, idempotency, request
protection, and server-side validation. ADR-0004 §5, §6, and §11 plus its design
§9 and §14 fixes selective Server Actions, RHF + Zod forms, and browser tests.
ADR-0006 §4 requires flat bilingual EARS. ADR-0009 §2.1 fixes immutable,
versioned consent evidence; its Postgres-only §2.6 table matrix does not apply to
the Product Lead-mandated file store. ADR-0011 §2.1–§2.4 prohibits PD egress;
ADR-0012 §1 and §4 requires fail-closed production storage; ADR-0013 §4 and §7
requires design-system accessibility; ADR-0014 §1–§5 makes the PRD authoritative.

## Event Model

### Commands

- `SubmitAcademyPartnershipApplication`: name, optional companyOrClinic, contact,
  role, consent, and idempotency key.

### Events and read models

None. This slice has no event, read model, public query, or listing.

### Policies

Records are visitor-write-only. Raw values never enter application logs or egress.
The linked privacy policy §6.4 already sets an unlimited processing period until
withdrawal by email to `info@doctor.school`; live JSON and same-zone backup copies
follow that published rule. The immutable JSON embeds the consent purpose,
version tag, exact accepted text and its SHA-256 digest, acceptance time, and
policy URL, preserving ADR-0009 §2.1 evidence semantics without introducing its
forbidden Postgres topology.

## Field validation and mask contract

| Field             | Shared client/server rule                                                                                         | Input mask                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Name              | Trim; 1–120 Unicode characters.                                                                                   | None: human names must not be shape-restricted.      |
| Company or clinic | Trim; empty becomes absent; otherwise at most 160 Unicode characters.                                             | None: organisation names have no stable shape.       |
| Email or Telegram | Trim; either a Zod-valid email of at most 254 characters, or `^@[A-Za-z0-9_]{5,32}$`. Preserve accepted spelling. | None: one control accepts two incompatible syntaxes. |
| Role              | Exact enum in the Product Lead-approved order.                                                                    | NativeSelect, so free text is impossible.            |
| Consent           | Literal `true`; unchecked is invalid.                                                                             | Checkbox, so text masking is not applicable.         |

## EARS requirements

- **EARS-1** _(realizes: US-1, US-5)_ — When a visitor requests public /, the
  portal shall render the static Academy home in the exact section order, copy,
  assets, and responsive composition pinned by the PRD, without redirecting the
  visitor and without reading a CMS or API.
- **EARS-2** _(realizes: US-2, US-3, US-5)_ — The page shall render exactly six
  supplied portraits, the same two approved rows in both Project and Events, the
  exact B2B Rutube destination, the exact privacy-policy destination, and no
  invented project metrics.
- **EARS-3** _(realizes: US-4)_ — While the form follow-up is not delivered, the
  partnership preview shall keep its fieldset and submit button disabled, show
  `Демо: данные не отправляются`, send no network request, and persist no values.
- **EARS-4** _(realizes: US-1, US-3, US-5)_ — The static page shall preserve the
  approved demo behavior at desktop and mobile breakpoints in light and dark
  themes, remain keyboard-readable, and pass the Academy Playwright and axe checks.
- **EARS-5** _(realizes: US-6)_ — When a visitor submits the enabled partnership
  form, the portal shall render required name, optional company or clinic, one
  required combined `Email или Telegram` field with exact placeholder
  `name@company.ru или @username`, accepting a trimmed valid email or a trimmed
  Telegram handle matching `^@[A-Za-z0-9_]{5,32}$`, required roles in this exact
  order — `Эксперт`, `Партнёр`, `Участник
подкаста`, `Соавтор направления`, `Компания` — and required consent linked
  exactly to `https://doctor.school/index/privacy-pay`; it shall validate the same
  shared Zod schema in client and Server Action, show accessible inline field
  errors plus the owner-approved `FormErrorSummary` below submit and focus it for
  this over-three-field form, and reject invalid input without JSON.
- **EARS-6** _(realizes: US-6)_ — When the shared schema accepts a submission, the
  Server Action shall atomically and idempotently create exactly one private JSON
  file and then replace the form with `Спасибо! Заявка сохранена.`; its immutable
  record shall include UUID id, accepted time, form fields, and consent purpose,
  version tag, exact text, text SHA-256, accepted state/time, and policy URL,
  while exposing no raw logs, read/list, or egress.
- **EARS-7** _(realizes: US-6)_ — If transport or the private write fails, the
  portal shall preserve entered values, create no partial record, show no false
  success, and show `Не удалось сохранить заявку. Попробуйте ещё раз.` above submit.
- **EARS-8** _(realizes: US-6)_ — While the form is pending, it shall prevent double
  submission, remain keyboard-operable with visible focus, preserve the approved
  mobile and light/dark presentation, and pass axe with no serious or critical violations.

## Invariants

The portal uses no DB, CMS, Mattermost, queue, worker, CRM, notification, admin,
CAPTCHA, automated deletion, contact SLA, or retention rule beyond the linked
policy §6.4 for this flow.

## Verification

| Requirement | Evidence                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------- |
| EARS-1–4    | Existing Academy Playwright coverage preserves the shipped page.                             |
| EARS-5      | Browser test covers exact controls, client/server reject, inline errors and summary focus.   |
| EARS-6      | Browser and integration tests cover one idempotent accepted private write and record shape.  |
| EARS-7      | Browser test simulates transport/write failure and asserts preserved values and exact error. |
| EARS-8      | Playwright covers pending/double submit, keyboard, mobile, both themes, and axe.             |
