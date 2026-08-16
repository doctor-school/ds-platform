---
title: "013 — Academy home and partnership form (Design)"
description: "Minimal portal design for the private JSON-backed Academy partnership form."
slug: 013-academy-home-design
requirements: ./013-requirements-en.md
status: Draft
lang: en
---

# 013 — Academy home and partnership form (Design)

## Architecture

The portal route `/` keeps the shipped Academy composition. Its client form uses
React Hook Form and `@ds/design-system` controls with a shared Zod schema. The
role selector uses the Stage-A-approved official shadcn `NativeSelect`
recommendation. A Next.js Server Action repeats schema validation and calls the
private JSON writer; no API route, database, CMS, queue, worker, CRM,
Mattermost, notification, or admin surface is introduced.

```mermaid
sequenceDiagram
  participant V as Visitor
  participant F as RHF + shared Zod
  participant A as Portal Server Action
  participant W as Private JSON writer
  V->>F: submit(idempotency key, form values)
  F->>A: valid command only
  A->>A: validate shared Zod schema
  A->>W: exclusive UUID JSON create
  W-->>A: created or existing same key
  A-->>F: success after record exists
  F-->>V: Спасибо! Заявка сохранена.
```

## Form and validation states

The enabled controls are required name, optional company or clinic, required
combined `Email или Telegram`, required NativeSelect role in the PRD order, and
required consent linked exactly to the policy URL. Invalid client or server
input stays in the form, creates no file, and shows inline errors plus the DS
`FormErrorSummary` below submit; because this form has over three fields, focus
moves to that summary. Pending disables repeated submissions without losing
values. Write or transport failure preserves all values and renders the exact
approved error above submit. Success replaces the form only after persistence.

## Private persistence boundary

The production Docker named volume is writable only by the portal. Its directory
is configured by environment, fails closed if unavailable or unsafe, and is
`0700`; each UUID-named JSON file is exclusively created atomically with `0600`.
The record contains id, acceptedAt, form fields, consent `{ accepted: true,
acceptedAt, policyUrl }`, and idempotency key. The writer performs no outbound
call, logging of raw values, read/list API, or partial-file recovery. A transient
in-memory no-egress abuse limit protects the action; there is no CAPTCHA and no
automated deletion.

## Failure and idempotency

An exclusive create makes a retry for the same idempotency key resolve to the
single already-created record, never a duplicate. Any validation, volume,
serialization, or transport failure returns failure without success and without
a partial record. The implementation must not surface raw submitted data in
errors or logs.

## Verification

Browser coverage drives rejection, accept, idempotent retry, write failure,
pending/double-submit, keyboard, mobile, light/dark, and axe. Integration tests
exercise exclusive creation and exact record shape. This design follows ADR-0002
§4/§5.5, ADR-0004 §9/§14, ADR-0006 §4, ADR-0009 §2.1/§2.6, ADR-0011 §2.1–§2.4,
ADR-0012 §1/§4, ADR-0013 §4/§7, and ADR-0014 §1–§5.
