---
title: "Feature 008 — Portal shell & discovery front-door (PRD)"
description: "Product requirements for the persistent portal app-shell header + account menu and the public discovery front-door at `/`. Portal surface IA epic; source of the 008 EARS triplet (ADR-0014). Retires the `/` scaffold placeholder."
slug: portal-surface-ia-008-portal-shell-product
epic: ../../product/portal-surface-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`008-product-ru.md`](./008-product-ru.md)

> Epic: [Portal surface IA — product brief](../../product/portal-surface-ia/brief.md) · approved variant A.

## Feature summary

The spine of the personal cabinet: a **persistent app-shell header** present across the portal, carrying an **account menu** that binds the shipped surfaces into one LK — for a logged-in doctor **[Мои события · Профиль · Выйти]**, for a guest **[Войти]** — and **`/` as the canonical public discovery front-door**, the upcoming-broadcasts listing shown identically to a guest and a logged-in doctor. This feature **retires the `/` scaffold** (the «Каркас приложения» placeholder card whose only action is "go to sign in") and makes **`/` the post-login landing**. The discovery listing reuses the listing surface already vendored for feature 004; the header itself is likely a new design-system block that needs its own design mini-iteration before build.

## User stories

- **US-1** — As a **doctor**, wherever I am in the portal a persistent header gives me an account menu — **Мои события**, **Профиль**, **Выйти** — so I can navigate my personal cabinet from any page, not just by direct link.
- **US-2** — As a **guest**, that same persistent header shows a clear **Войти**, so I always have an obvious way in.
- **US-3** — As a **doctor**, after I log in I land on **`/`** — the discovery listing of upcoming broadcasts — not a placeholder card and not a dead dashboard.
- **US-4** — As a **doctor or guest**, `/` is the **public** discovery front-door listing upcoming webinars, shown the **same** way regardless of whether I am signed in — so discovery never depends on auth state.
- **US-5** — As a **doctor**, from the account menu I reach **«Мои события»** (`/account/events`) and my **profile** (`/account`) in one tap.
- **US-6** — As a **doctor**, I can **sign out** from the account menu anywhere in the portal, and I am returned to a sensible public state.

## Flows

**Persistent shell (US-1, US-2, US-5):**

1. On any portal page, the app-shell header renders. If the visitor is a logged-in doctor, the account menu offers Мои события · Профиль · Выйти; if a guest, it offers Войти.
2. The doctor opens the account menu → taps Мои события → lands on `/account/events` (feature 005); or taps Профиль → lands on `/account` (feature 009).

**Post-login landing (US-3, US-4):**

1. Doctor completes login (feature 003) → is returned to **`/`**, the public discovery listing.
2. The same `/` renders for a guest — the discovery front-door does not branch on auth state; only the header's account menu differs.

**Sign-out (US-6):**

1. Doctor opens the account menu → taps Выйти → the session ends (feature 003 logout) → the doctor is returned to a public state.

## Product acceptance criteria

- A **persistent header** is present across portal surfaces and carries the account menu: **logged-in** → **Мои события · Профиль · Выйти**; **guest** → **Войти**. The menu contents truthfully reflect auth state.
- **`/` is the canonical public discovery listing** of upcoming broadcasts, rendered **identically** for a guest and a logged-in doctor (it reuses the feature-004 listing surface). No separate dashboard exists.
- **Post-login landing is `/`.** The auth flow returns the doctor to the discovery front-door, never to a scaffold.
- The account menu's links resolve to the **shipped** surfaces: «Мои события» → `/account/events` (feature 005), «Профиль» → `/account` (feature 009), «Выйти» → logout (feature 003).
- **The `/` scaffold is retired** — the «Каркас приложения» placeholder card (whose only action is a "go to sign in" button) is no longer reachable in the portal.

## Out of scope

- **The header's visual design / component composition** — it is likely a **new design-system block** (persistent app-shell header + account-menu dropdown) not yet in `@ds/design-system`; it gets its own `research-ui-element` / DS mini-iteration and Stage-A mockup before build (ADR-0013 / ADR-0014 §4–5). This PRD fixes _what the shell must do_, not _how it looks_.
- The discovery listing's internals (cards, ordering, lifecycle signalling) — owned by feature 004.
- «Мои события» content and the room — features 005 / 006.
- Profile content — feature 009.
- Search, facets, notifications, a richer LK home — future iterations (epic brief).

## Open questions

- Header composition beyond the account menu (logo, brand lockup, any top-level nav) and its **mobile** form (inline vs. drawer) — owner taste call at the Stage-A mockup.
- Whether the guest header surfaces anything beyond **Войти** (e.g. a «Регистрация» affordance) — owner decision before the 008 EARS triplet fixes it.
- Whether the account menu is a dropdown, a slide-over, or an avatar-anchored popover — a Stage-A composition choice, delegated to the header design mini-iteration.

## Approved mockup

**Status:** Stage-A mockup pending — owner pick in [claude.ai/design](https://claude.ai) (project «Doctor.School визуальный язык»); recorded here at the discovery→delivery gate. The header being a likely new design-system block, its Stage-A runs together with the `research-ui-element` / DS mini-iteration that builds it. The discovery listing surface it wraps is already vendored for feature 004 ([`design-source/webinars-listing.dc.html`](../../../../../../design-source/webinars-listing.dc.html)).
