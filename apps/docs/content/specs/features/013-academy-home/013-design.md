---
title: "013 — Static public Academy home (Design)"
description: "Minimal technical design for moving the approved Academy demo onto the portal production route without adding form submission or dynamic data."
slug: 013-academy-home-design
requirements: ./013-requirements-en.md
status: Draft
lang: en
---

# 013 — Static public Academy home (Design)

## 1. Architecture

The release is portal-only:

Browser → Next.js portal route / → static fixtures and local image assets.

There is no server mutation path. No API application, database, filesystem
persistence, CMS, queue, worker, webhook, or new environment secret is added.

## 2. Source transfer

The implementation copies the rendered Academy unit from apps/academy-demo at
the PRD pin into apps/portal, preserving:

- fixture values and order;
- six WEBP portraits;
- shared Project/Events rows and exact URLs;
- design-system imports, tokens, theme behavior, and responsive layout;
- disabled LeadDemoFields behavior and no-send note;
- footer logo treatment and privacy-policy link.

The production page owns local portal components and assets; production must not
import code from the demo application at runtime.

## 3. Route behavior

- apps/portal/app/page.tsx renders the Academy home instead of redirecting /.
- Static rendering is preferred; the page performs no content fetch.
- Existing authenticated application routes remain unchanged.
- Every external link keeps its exact approved href and safe external-link
  attributes.

## 4. Disabled form boundary

The partnership preview is a disabled fieldset. Its controls have no change or
submit handler. The button is type button and disabled. No route handler or
server action is created. Automated tests fail if a form request occurs.

The working-form follow-up owns the approved roles:

1. Эксперт
2. Партнёр
3. Участник подкаста
4. Соавтор направления
5. Компания

This list is documentation for the next slice only and is not rendered as an
enabled control in the static release.

## 5. Verification

- A production-route Playwright spec starts the portal build and asserts EARS-1
  through EARS-4.
- Visual assertions cover desktop/mobile and both themes.
- Axe covers both themes.
- Existing portal route, auth, lint, typecheck, build, and guard suites remain
  green.
- The live stand remains available for Product Lead Stage-B confirmation before
  merge.

## 6. Follow-up seam

The disabled form is an explicit owner-approved release boundary, not an
untracked stub. Follow-up Issue #1312 owns enabling fields, the approved role
list, validation, and server-side JSON persistence immediately after this
static release.
