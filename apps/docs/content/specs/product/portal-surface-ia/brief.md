---
title: "Portal surface IA epic — product brief"
description: "Thin product brief for the Portal surface IA epic: the personal-cabinet (LK) shell and information architecture wrapped around the already-shipped webinar surfaces (epic 004–007). JTBD, discovery-first cross-cutting IA, feature decomposition (008 portal shell + discovery front-door, 009 doctor profile), success metrics, and condensed prior art. Source layer for the per-feature PRDs and their EARS triplets (ADR-0014)."
slug: portal-surface-ia-brief
milestone: https://github.com/doctor-school/ds-platform/milestone/9
parent_issue: https://github.com/doctor-school/ds-platform/issues/779
status: Draft
features:
  - 008-portal-shell
  - 009-doctor-profile
lang: en
---

> **EN (this)** · **RU:** [`brief-ru.md`](./brief-ru.md)

> **Scope (owner decision, brainstorm 2026-07-12).** This epic covers **only the portal shell / information architecture** that binds the already-product-grade webinar surfaces (epic 004–007, shipped) into one coherent personal cabinet (LK): a persistent app-shell header with an account menu, the public discovery front-door at `/`, and a read-only doctor profile. Profile **editing**, notifications, and any new content surface are **explicitly out** — each is a future iteration. This is an IA / wrapper epic, not a new content vertical.

---

## Problem

- The webinar surfaces shipped as product-grade rooms and pages (epic 004–007), but the portal **around** them is still scaffold. `/` is a placeholder «Каркас приложения» card whose only action is a "go to sign in" button (`apps/portal/app/page.tsx`); `/account` is a raw **session-claims debug dump** — it renders the caller's `sub` in monospace, a `roles[]` array, and an `mfa` boolean straight from `GET /v1/auth/session` (`apps/portal/app/account/page.tsx`). Both are testers' surfaces, not a product LK.
- A logged-in doctor has **no home**: no persistent header, no account menu, no way to reach «Мои события» (`/account/events`, feature 005) or a profile from anywhere in the portal. The shipped webinar surfaces float unbound — reachable only by direct link.
- **Post-login lands nowhere meaningful** — the auth flow returns to a scaffold, not to anything a doctor would use.
- The legacy Doctor.School LK proved a doctor needs a single account home tying together event discovery, «мои события», and a profile; today the new platform has the pieces but no IA that composes them.

## Jobs-to-be-done

- **Doctor:** after login, land somewhere useful — the discovery listing of upcoming broadcasts; from any page, reach «мои события» and my profile through a persistent account menu; see my own account details (name, email, phone, security state) as readable copy; sign out.
- **Guest:** open the same public discovery front-door and, from a persistent header, get a clear way in («Войти»).

## Cross-cutting information architecture

- **Discovery-first, one front-door.** `/` is the **public** upcoming-broadcasts discovery listing — the **same surface** for a guest and a logged-in doctor. There is **no separate dashboard**. **Post-login landing = `/`.**
- **A persistent app-shell header binds the portal.** It carries the logo (→ `/`, the discovery front-door), the top-nav **[Эфиры · Школы · Мои события]**, a theme toggle, and — for a logged-in doctor — an **avatar icon showing initials that navigates directly to the profile `/account`** (just an icon → profile, not a dropdown menu); a guest sees a **«Войти»** button instead. Sign-out lives on the profile screen (feature 009), not in the header. This header is the spine that binds the shipped surfaces into one LK.
- **The LK is composed from surfaces that already exist plus this shell:** the public event page `/webinars/:slug` (feature 004), «Мои события» at `/account/events` (feature 005), the webinar room (feature 006), and — new in this epic — the profile at `/account` (feature 009). The discovery listing reuses the listing surface already vendored for feature 004.
- **The profile is read-only in v1** — the doctor sees their identity and security state as product copy and can sign out; editing is a tracked future iteration, never a silent stub.
- **This is a vertical slice, not a re-skin.** Feature 009 needs its own authenticated read endpoint for the caller's own profile fields — those fields exist in data but no endpoint exposes them today (see the 009 PRD). The persistent shell — its header (logo→`/`, nav, theme toggle, avatar-icon→profile for a logged-in doctor / «Войти» for a guest) **and** the discovery front-door `/` — is **already designed** in the «Doctor.School визуальный язык» canvas and vendored (the header is present across every vendored portal canvas; `/` is `webinars-listing.dc.html` = canvas `Эфиры.dc.html`). This epic **builds on** that existing shell — it does not invent it. The one surface with no canvas — the read-only profile — is composed from the established neo-brutalist design language (owner decision 2026-07-12).

## Feature decomposition

Two `user-facing` features, approved variant **A**, each with a co-located PRD; each gets an owner-approved Stage-A mockup before its EARS triplet:

| #   | Feature                                                              | One-liner                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 008 | [`portal-shell`](../../features/008-portal-shell/008-product.md)     | A persistent app-shell header across the portal — logo→`/`, nav, theme toggle, and an avatar icon that opens the profile `/account` for a logged-in doctor (guest: «Войти») — and `/` as the canonical public discovery front-door; retires the `/` scaffold. |
| 009 | [`doctor-profile`](../../features/009-doctor-profile/009-product.md) | `/account` becomes a read-only doctor profile — name, email, phone as product copy, MFA as a product state, and sign-out; retires the session-claims debug dump. Needs a new authenticated own-profile read endpoint.                                         |

**Future iterations** (not in this epic's PRD folders):

- Profile editing (name / phone / notification preferences).
- Guest-facing discovery beyond the minimal listing (search, facets — tracked under the webinars epic wave 2).
- Richer LK home (activity, NMO progress, recommendations).

**Out of the epic entirely:** any new content vertical, notifications delivery, paid tiers.

## Success metrics

- A logged-in doctor **lands on `/` discovery after login** and can reach «Мои события» and their profile from **any** portal page via the persistent account menu.
- **No scaffold or debug surface remains reachable in the portal** — the `/` «Каркас приложения» placeholder and the `/account` session-claims dump are both retired.
- The profile shows the doctor's **real name, email, phone, and security state as product copy** — never raw claims — served by a real authenticated endpoint.

## Prior art — source system

The legacy Doctor.School Bubble stack was mined read-only for the Webinars epic; the full functional evidence lives in [`../webinars/legacy-recon.md`](../webinars/legacy-recon.md) — this epic reuses that mining rather than re-running it. In one paragraph: the legacy LK proved the doctor needs a **single account home** that ties together event **discovery**, **«мои события»**, and a **profile**; it did so with the legacy scatter (booleans, a sprawling event aggregate, surfaces reachable only by luck). We rebuild that same IA cleanly and **discovery-first** — one public front-door at `/`, a persistent account menu binding «мои события» and profile, and a read-only profile — without inheriting the legacy scatter or its UI. The recon is a look-and-take-the-domain reference, never a target schema or layout (ADR-0014 §3).

---

_This brief is the epic layer of ADR-0014's two-tier product spec: it decomposes, the co-located `NNN-product.md` PRDs carry the user stories, and the EARS triplets are authored from those PRDs — never the other way around._
