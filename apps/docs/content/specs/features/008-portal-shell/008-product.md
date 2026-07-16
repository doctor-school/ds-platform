---
title: "Feature 008 — Portal shell & discovery front-door (PRD)"
description: "Product requirements for the persistent portal app-shell header (logo, nav, theme toggle, avatar-icon→profile) and the public discovery front-door at `/`. Portal surface IA epic; source of the 008 EARS triplet (ADR-0014). Retires the `/` scaffold placeholder."
slug: portal-surface-ia-008-portal-shell-product
epic: ../../product/portal-surface-ia/brief.md
status: In dev
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`008-product-ru.md`](./008-product-ru.md)

> Epic: [Portal surface IA — product brief](../../product/portal-surface-ia/brief.md) · approved variant A.

## Feature summary

The spine of the personal cabinet: a **persistent app-shell header** present across the portal — carrying the logo (→ `/`), the top-nav **[Эфиры · Мои события]**, a theme toggle, and, for a logged-in doctor, an **avatar icon (initials) that navigates directly to the profile `/account`**; a guest sees a **«Войти»** button instead — and **`/` as the canonical public discovery front-door**, the upcoming-broadcasts listing shown identically to a guest and a logged-in doctor. The header is **already designed in the «Doctor.School визуальный язык» canvas and vendored across all portal screens**; this feature wires it as the persistent portal shell, makes **`/`** (the vendored `Эфиры.dc.html` = [`design-source/webinars-listing.dc.html`](../../../../../../design-source/webinars-listing.dc.html)) both the **discovery front-door** and the **post-login landing**, and **retires the `/` scaffold** (the «Каркас приложения» placeholder card whose only action is "go to sign in"). The account entry is an **avatar icon → `/account`** (profile), not a dropdown menu; sign-out lives on the profile screen (feature 009).

## User stories

- **US-1** — As a **doctor**, wherever I am in the portal a persistent header carries the logo (→ `/`), the top-nav **Эфиры · Мои события**, and a theme toggle — so I can navigate my personal cabinet from any page, not just by direct link («Мои события» → `/account/events`, feature 005).
- **US-2** — As a **guest**, that same persistent header shows a clear **Войти** button, so I always have an obvious way in.
- **US-3** — As a **doctor**, after I log in I land on **`/`** — the discovery listing of upcoming broadcasts — not a placeholder card and not a dead dashboard.
- **US-4** — As a **doctor or guest**, `/` is the **public** discovery front-door listing upcoming webinars, shown the **same** way regardless of whether I am signed in — so discovery never depends on auth state.
- **US-5** — As a **doctor**, the header shows an **avatar icon with my initials** that takes me straight to my **profile `/account`** (feature 009) in one tap — an icon, not a dropdown menu.
- **US-6** — _Retired._ Sign-out is not a header affordance; it lives on the profile screen (feature 009, US-3). Id kept to preserve numbering.

## Flows

**Persistent shell (US-1, US-2, US-5):**

1. On any portal page, the app-shell header renders: logo (→ `/`), top-nav **Эфиры · Мои события**, theme toggle, and — for a logged-in doctor — an avatar icon with the doctor's initials; for a guest, a **Войти** button.
2. The doctor taps **Мои события** in the nav → lands on `/account/events` (feature 005); or taps the **avatar icon** → lands on the profile `/account` (feature 009).

**Post-login landing (US-3, US-4):**

1. Doctor completes login (feature 003) → is returned to **`/`**, the public discovery listing.
2. The same `/` renders for a guest — the discovery front-door does not branch on auth state; only the header's account affordance differs (avatar icon vs. «Войти»).

## Product acceptance criteria

- A **persistent header** is present across portal surfaces and carries: the **logo** (→ `/`), the top-nav **Эфиры · Мои события**, a **theme toggle**, and — **logged-in** → an **avatar icon (initials) that navigates to `/account`** (the profile); **guest** → a **«Войти»** button. This is explicitly **not a dropdown menu**, and there is **no «Выйти» in the header** (sign-out lives on the profile, feature 009). The header truthfully reflects auth state.
- **`/` is the canonical public discovery listing** of upcoming broadcasts, rendered **identically** for a guest and a logged-in doctor (it reuses the feature-004 listing surface, the vendored `webinars-listing.dc.html`). No separate dashboard exists.
- **Post-login landing is `/`.** The auth flow returns the doctor to the discovery front-door, never to a scaffold.
- The header's navigation resolves to the **shipped** surfaces: «Мои события» → `/account/events` (feature 005), the avatar icon → `/account` (feature 009, the profile).
- **The `/` scaffold is retired** — the «Каркас приложения» placeholder card (whose only action is a "go to sign in" button) is no longer reachable in the portal.

## Out of scope

- **«Школы»** — **not rendered in the v1 nav** (owner decision 2026-07-15). It has no feature or canvas destination yet; rather than a deferred/inert placeholder, the nav omits it entirely until its own feature exists, at which point «Школы» re-enters via that feature's discovery. This epic does not expand into it.
- The discovery listing's internals (cards, ordering, lifecycle signalling) — owned by feature 004.
- «Мои события» content and the room — features 005 / 006.
- Profile content and sign-out — feature 009.
- Search, facets, notifications, a richer LK home — future iterations (epic brief).

## Open questions

None — the shell is fully designed in the vendored canvas: the persistent header is present across all portal canvases (logo→`/`, top-nav [Эфиры · Мои события], theme toggle, avatar-icon→profile for a logged-in doctor / «Войти» for a guest), and mobile collapses the nav into a `≡` dropdown [Эфиры · Мои события].

## Approved mockup

Vendored canvas source (byte-verbatim from the Claude Design project «Doctor.School визуальный язык» — build to these files, see [`design-source/README.md`](../../../../../../design-source/README.md)):

- [`design-source/webinars-listing.dc.html`](../../../../../../design-source/webinars-listing.dc.html) — the discovery front-door `/` (canvas `Эфиры.dc.html`), shown identically to a guest and a logged-in doctor and used as the post-login landing.
- The **persistent app-shell header** is the vendored-canvas header present across **all** portal screens — [`design-source/my-events.dc.html`](../../../../../../design-source/my-events.dc.html), [`design-source/webinars-listing.dc.html`](../../../../../../design-source/webinars-listing.dc.html), [`design-source/webinar-page.dc.html`](../../../../../../design-source/webinar-page.dc.html) — carrying logo→`/`, top-nav [Эфиры · Мои события], a theme toggle, and the avatar-icon→profile (logged-in) / «Войти» (guest); mobile collapses the nav into a `≡` dropdown. The avatar-icon→profile behaviour is per the owner clarification 2026-07-12.

**Status:** composition authored by the product owner on the Claude Design canvas (project «Doctor.School визуальный язык»); Stage-B live-verify on the running stand before merge.
