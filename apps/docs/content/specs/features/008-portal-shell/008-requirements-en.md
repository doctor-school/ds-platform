---
title: "008 — Portal shell & discovery front-door"
description: "Requirements: the persistent portal app-shell header (logo→/, top-nav [Эфиры · Мои события], theme toggle, avatar-icon→profile for a logged-in doctor / «Войти» for a guest) and `/` as the canonical public discovery front-door and post-login landing; retires the `/` «Каркас приложения» scaffold. Portal surface IA epic (ADR-0014)."
slug: 008-portal-shell
status: Draft
surface: user-facing
tracker: "https://github.com/doctor-school/ds-platform/milestone/9"
issues: []
prior_decisions:
  - "ADR-0014 — Two-tier product spec (§2 PRD → EARS `realizes:` traceability; §3 prior-art mining; §4 canvas is source, repo holds the built artifact)"
  - "ADR-0013 — Design system & canvas-derived UI (tokens-only, adopt-before-bespoke, vendor every canvas the surface renders, element-by-element render parity)"
  - "ADR-0004 — Frontend apps (§ four Next.js apps; the portal is `apps/portal`, Next 15 + Refine)"
  - "ADR-0006 — Documentation & SSOT (§4 feature-spec triplet + flat EARS numbering)"
lang: en
---

> **EN (this)** · **RU:** [`008-requirements-ru.md`](./008-requirements-ru.md)

# 008 — Portal shell & discovery front-door (Requirements)

Authored from the PRD [`008-product.md`](./008-product.md) (ADR-0014). Each EARS clause carries a `realizes: US-N` backlink to the PRD story it formalizes. US-6 is _Retired_ in the PRD (sign-out lives on the profile, feature 009) — no EARS is authored for it; the gap is intentional.

## Outcomes

- A **persistent app-shell header** is present across every portal route, carrying the **logo** (→ `/`), the top-nav **[Эфиры · Мои события]**, a **theme toggle**, and — for a logged-in doctor — an **avatar icon showing initials that navigates directly to the profile `/account`** (an icon, **not** a dropdown menu); a guest sees a **«Войти»** button instead. There is **no «Выйти»** in the header (sign-out lives on the profile, feature 009).
- **`/` is the canonical public discovery front-door** — the upcoming-broadcasts listing (reusing the feature-004 listing surface, vendored `webinars-listing.dc.html`), rendered **identically** to a guest and a logged-in doctor. Discovery never branches on auth state; only the header's account affordance does. There is **no separate dashboard**.
- **Post-login landing is `/`.** The auth flow (feature 003) returns the doctor to the discovery front-door, never to a scaffold.
- The header's navigation resolves only to **shipped** surfaces: «Эфиры» → `/` (this discovery front-door), «Мои события» → `/account/events` (feature 005), the avatar icon → `/account` (feature 009, the profile).
- The **`/` scaffold is retired** — the «Каркас приложения» placeholder card (whose only action is a "go to sign in" button) is no longer reachable in the portal.
- The header and `/` are **already designed** in the vendored «Doctor.School визуальный язык» canvas ([`design-source/`](../../../../../../design-source/README.md)); this feature **wires the existing shell**, it does not invent it, and is built from those canvas files (not issue-body prose) per ADR-0013.

## Scope

**In:**

- The **persistent app-shell header** mounted on every portal route: logo (→ `/`), top-nav **[Эфиры · Мои события]**, theme toggle, and the auth-state account affordance (avatar-icon→`/account` for a logged-in doctor / **«Войти»** for a guest).
- **Nav route resolution** to the shipped surfaces (logo & «Эфиры» → `/`; «Мои события» → `/account/events`, feature 005; avatar icon → `/account`, feature 009).
- **Theme toggle** (light/dark, persisted — the vendored canvas keys `localStorage['ds-theme']`).
- **Auth-state branch** in the header: logged-in → avatar icon (initials, not a dropdown, no «Выйти»); guest → «Войти». The header truthfully reflects the session state read from `GET /v1/auth/session` (feature 003).
- **Post-login landing = `/`** — the feature-003 auth flow returns the authenticated doctor to the discovery front-door.
- **`/` as the public discovery listing**, reusing the feature-004 listing surface (vendored `webinars-listing.dc.html`), rendered identically for guest and doctor.
- **Retiring the `/` scaffold** — the «Каркас приложения» placeholder card is removed and no longer reachable.
- **Mobile collapse** — the top-nav collapses into a `≡` dropdown carrying the same [Эфиры · Мои события].
- **RU-primary header copy** sourced from the message catalog (no hardcoded user-facing strings), consistent with feature-003 EARS-21.

**Explicitly out** (each a documented deferral, not a silent stub):

- **«Школы».** «Школы» is **not rendered in the v1 nav** (owner decision 2026-07-15). It has no feature and no canvas destination yet; rather than shipping a visibly-inert nav item, the nav omits it entirely until its own feature exists. «Школы» re-enters the nav via that feature's own discovery, not as a placeholder here. (PRD → Out of scope.)
- **Discovery listing internals** (cards, ordering, lifecycle signalling, empty/error states of the listing itself) — owned by **feature 004**; `/` reuses that surface, it does not re-specify it.
- **«Мои события» content and the webinar room** — features **005 / 006**. This feature only wires the nav target.
- **Profile content and sign-out** — the profile at `/account` is **already shipped** (feature 009 superseded by [#770](https://github.com/doctor-school/ds-platform/issues/770); `/account` is a real doctor profile, not a debug dump). The avatar icon only navigates there; this feature does not build the profile screen.
- **Search, facets, notifications, a richer LK home** — future iterations (epic brief).

## Constraints

- **UI from the design system (ADR-0013).** The header and `/` are built from `@ds/design-system`, styled **only** via tokens (arbitrary Tailwind values are lint-blocked). Every canvas the surface renders is vendored under [`design-source/`](../../../../../../design-source/README.md) and built from the files, not from prose. The persistent header is the vendored-canvas header present across `webinars-listing.dc.html`, `my-events.dc.html`, and `webinar-page.dc.html`; where prose and the canvas disagree, the canvas wins.
- **No hardcoded origin / routes-as-config.** Route targets (`/`, `/account`, `/account/events`, the login route) are resolved through the portal's routing layer, not string-duplicated across components. The portal origin is read from configuration (mirrors feature-003 Constraints).
- **Discovery does not branch on auth.** `/` renders one surface for both guest and doctor; the only auth-dependent element is the header's account affordance (EARS-4 / EARS-5). A per-auth-state `/` variant is forbidden.
- **The header owns no sign-out and no dropdown.** The account affordance is an icon-link to `/account`, never a menu; «Выйти» is a feature-009 profile affordance. This is a product decision (PRD acceptance), not an implementation liberty.
- **Session as read-only input.** This feature consumes the feature-003 session state (`GET /v1/auth/session`) to pick the header branch; it introduces **no new backend auth primitive** and mints no session (post-login landing is a redirect target handed to the existing feature-003 flow).
- **Stack (ADR-0004).** `apps/portal` — Next.js 15 + Refine; the shell is composed as the app-level layout so the header is present on every route by construction.

## Prior decisions

- **ADR-0014** Two-tier product spec — the PRD [`008-product.md`](./008-product.md) is the source; every EARS carries `realizes: US-N` (§2). The canvas is _source_, the repo holds the _built artifact_ (§4). Prior art (legacy LK) is mined read-only via the epic brief (§3), never a target layout.
- **ADR-0013** Design system & canvas-derived UI — tokens-only, adopt-before-bespoke, vendor every canvas the surface renders, element-by-element render parity across both breakpoints × both themes (Stage-B).
- **ADR-0004** Frontend apps — the portal is `apps/portal` (Next.js 15 + Refine); the shell mounts as the app-shell layout.
- **ADR-0006 §4** Documentation & SSOT — feature-spec triplet structure + flat EARS numbering.

## Event Model

This is a **UI-composition / IA feature**, not a new backend aggregate. It introduces no command that mutates server state and owns no new persisted read model; it composes shipped surfaces and reads the feature-003 session. The model below is therefore expressed in the frontend's terms.

### Commands (client navigations / UI intents — no server mutation)

`RenderShell` (mount the persistent header on a route) · `NavigateNav` (resolve a top-nav item to its shipped route) · `ToggleTheme` · `OpenProfile` (avatar-icon → `/account`) · `GoToLogin` (guest «Войти») · `LandAfterLogin` (feature-003 auth flow returns to `/`).

### Events

| Event                    | Owner                    | Notes                                                        |
| ------------------------ | ------------------------ | ------------------------------------------------------------ |
| `ShellRendered`          | `apps/portal`            | The app-shell header is present on the current route.        |
| `ThemePreferenceChanged` | `apps/portal`            | Persisted to `localStorage['ds-theme']` (canvas convention). |
| `PostLoginLanded`        | feature 003 → this shell | Auth flow lands the doctor on `/`.                           |

### Read models

- **`AuthState`** — derived from `GET /v1/auth/session` (feature 003): `{ authenticated, initials? }`. Drives the header's account-affordance branch (avatar icon vs «Войти»); the doctor's initials render the avatar. Nothing here is persisted by this feature.
- **`DiscoveryListing`** — the feature-004 upcoming-broadcasts listing surface, reused verbatim at `/`; owned by feature 004, consumed here.

### Policies

- **On any portal route render** → the app-shell header is mounted (`ShellRendered`) — the header is a layout invariant, not a per-page opt-in.
- **On a successful feature-003 login** → land the doctor on `/` (`PostLoginLanded`).
- **On `AuthState.authenticated` true/false** → render the avatar-icon→`/account` affordance vs the «Войти» button; never a per-auth `/` content variant.

## EARS requirements

> **Numbering convention:** flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4. Each clause carries a `realizes: US-N` PRD backlink (ADR-0014 §2). EARS-1…9 + EARS-11 are the functional handlers (each a candidate child Issue); EARS-10 is _Retired_ (see below); EARS-12…13 are cross-cutting ubiquitous requirements enforced across the surface.

**Persistent app-shell header**

- **EARS-1** (realizes **US-1**): On every portal route, the system shall render a persistent app-shell header carrying the logo (a link to `/`), the top-nav **[Эфиры · Мои события]**, and a theme toggle — so the header is present from any page, not only by direct link. The header is composed from the vendored canvas via `@ds/design-system` (Constraints).
- **EARS-2** (realizes **US-1**): When a user activates a header navigation target, the system shall resolve it to its **shipped** surface: the logo and «Эфиры» → `/` (the discovery front-door), «Мои события» → `/account/events` (feature 005). Every nav target resolves to a shipped surface — there is no deferred or inert target.
- **EARS-3** (realizes **US-1**): When a user activates the theme toggle, the system shall switch the portal between light and dark and persist the preference (the vendored canvas keys `localStorage['ds-theme']`), so the choice survives navigation and reload.

**Auth-state account affordance**

- **EARS-4** (realizes **US-2**): While the caller is a guest (no authenticated session per `GET /v1/auth/session`, feature 003), the system shall render a **«Войти»** button in the header that routes to the login surface — so a guest always has an obvious way in. The header shows no avatar and no «Выйти».
- **EARS-5** (realizes **US-5**): While the caller is a logged-in doctor, the system shall render in the header an **avatar icon showing the doctor's initials** — an icon, **not** a dropdown menu — and shall render **no «Выйти»** in the header (sign-out lives on the profile, feature 009).
- **EARS-6** (realizes **US-5**): When a logged-in doctor activates the avatar icon, the system shall navigate to the profile `/account` (feature 009) — a single tap, one destination, no intermediate menu.

**Discovery front-door & post-login landing**

- **EARS-7** (realizes **US-3**): When a doctor completes login (feature 003), the system shall return them to **`/`** — the discovery listing of upcoming broadcasts — as the post-login landing, never to a placeholder card or a dead dashboard.
- **EARS-8** (realizes **US-4**): The system shall render `/` as the **public** discovery listing of upcoming broadcasts, reusing the feature-004 listing surface (vendored `webinars-listing.dc.html`), **identically** for a guest and a logged-in doctor; `/` shall not branch its content on auth state — only the header's account affordance differs (EARS-4 / EARS-5).
- **EARS-9** (realizes **US-3**): The system shall retire the `/` «Каркас приложения» scaffold — the placeholder card whose only action is a "go to sign in" button shall no longer be reachable in the portal, `/` serving the discovery listing (EARS-8) in its place.

**Deferred nav target & mobile**

- **EARS-10** — _Retired._ «Школы» removed from the nav (owner 2026-07-15); no inert target is rendered. The v1 nav is [Эфиры · Мои события] and every target resolves to a shipped surface (EARS-2). Id kept to preserve flat numbering (repo pattern, cf. US-6); no handler is authored. «Школы» re-enters via its own feature's discovery when it exists (Scope → Out).
- **EARS-11** (realizes **US-1**): While the viewport is at the mobile breakpoint (the canvas `≤900px`), the system shall collapse the top-nav into a `≡` dropdown carrying the same **[Эфиры · Мои события]**, preserving every nav target's resolution (EARS-2).

**Cross-cutting (ubiquitous)**

- **EARS-12** (realizes **US-1**): The system shall build the persistent header and `/` from the vendored «Doctor.School визуальный язык» canvas via `@ds/design-system` tokens (ADR-0013) — no bespoke element without the registry-research gate, no arbitrary Tailwind values — and the rendered result shall match the canvas element-by-element across **both breakpoints × both themes** (the Stage-B render-parity check).
- **EARS-13** (realizes **US-1**): The header shall carry **no hardcoded user-facing strings** — the nav labels («Эфиры», «Мои события»), the «Войти» button, and the theme-toggle / avatar accessible labels are sourced from the RU-primary message catalog (consistent with feature-003 EARS-21), so a future locale is additive without re-touching the shell components.

## Invariants

- The app-shell header is present on **every** portal route (EARS-1) — a route without it is a defect.
- `/` renders **one** surface regardless of auth state (EARS-8); the only auth-dependent header element is the account affordance (EARS-4 / EARS-5). No per-auth `/` content variant exists.
- The header contains **no sign-out affordance and no dropdown menu** (EARS-5) — the account affordance is an icon-link to `/account` only.
- Every header navigation target resolves to a **shipped** surface (EARS-2) — no inert or deferred nav target exists.
- The `/` «Каркас приложения» scaffold is **unreachable** after this feature (EARS-9).
- This feature mints no session and writes no new persisted state; it reads the feature-003 session as its only auth input (Constraints).

## Verification

| EARS | Test type                                        | File (indicative)                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Playwright (component/route)                     | `apps/portal/e2e/shell/header-present.spec.ts`        | The app-shell header (logo, nav, theme toggle) renders on a sample of routes (`/`, `/account`, `/account/events`).                                                                                                                                                                                                                                                                                            |
| 2    | Playwright                                       | `apps/portal/e2e/shell/nav-routes.spec.ts`            | Logo & «Эфиры» → `/`; «Мои события» → `/account/events`. Asserts resolved URLs against shipped surfaces.                                                                                                                                                                                                                                                                                                      |
| 3    | Playwright                                       | `apps/portal/e2e/shell/theme-toggle.spec.ts`          | Toggle flips light↔dark; `localStorage['ds-theme']` persists across reload.                                                                                                                                                                                                                                                                                                                                   |
| 4    | Playwright                                       | `apps/portal/e2e/shell/guest-header.spec.ts`          | Guest (no session) sees «Войти» → login route; no avatar, no «Выйти».                                                                                                                                                                                                                                                                                                                                         |
| 5–6  | Playwright                                       | `apps/portal/e2e/shell/doctor-header.spec.ts`         | Logged-in doctor sees the initials avatar icon (not a dropdown); activating it lands on `/account`; header shows no «Выйти».                                                                                                                                                                                                                                                                                  |
| 7    | Playwright                                       | `apps/portal/e2e/shell/post-login-landing.spec.ts`    | Completing feature-003 login lands on `/` (discovery), not a scaffold.                                                                                                                                                                                                                                                                                                                                        |
| 8    | Playwright                                       | `apps/portal/e2e/shell/discovery-parity.spec.ts`      | `/` renders the feature-004 listing identically for guest and doctor; content does not branch on auth.                                                                                                                                                                                                                                                                                                        |
| 9    | Playwright                                       | `apps/portal/e2e/shell/scaffold-retired.spec.ts`      | The «Каркас приложения» placeholder is not reachable; `/` serves the listing.                                                                                                                                                                                                                                                                                                                                 |
| 11   | Playwright (mobile viewport)                     | `apps/portal/e2e/shell/mobile-nav.spec.ts`            | At `≤900px` the nav collapses into a `≡` dropdown carrying [Эфиры · Мои события]; targets still resolve.                                                                                                                                                                                                                                                                                              |
| 12   | Manual Stage-B render check                      | (Stage-B live-verify, epic gate)                      | Element-by-element parity with the vendored canvas across both breakpoints × both themes (ADR-0013); tokens-only, no arbitrary Tailwind (lint-gated).                                                                                                                                                                                                                                                         |
| 13   | ESLint + unit                                    | `apps/portal` (no-raw-string gate) + catalog snapshot | Header copy sourced from the RU catalog; no hardcoded user-facing strings (feature-003 EARS-21 precedent).                                                                                                                                                                                                                                                                                                    |
| all  | **Playwright (browser E2E, end-to-end journey)** | `apps/portal/e2e/shell/journey.spec.ts`               | **Required user-facing deliverable.** Doctor logs in (feature 003) → lands on `/` → uses the nav (→ `/account/events`) → the avatar icon (→ `/account`); a guest sees «Войти» and the **same** `/`. Maps to [`008-scenarios.feature`](./008-scenarios.feature) via `playwright-bdd`. This is a live-gated E2E owned in this feature's WBS (F-22: a `user-facing` slice owns its browser E2E, not a footnote). |

## Dependencies & sequencing

- **Depends on shipped surfaces.** `/` reuses the **feature-004** listing surface (vendored `webinars-listing.dc.html`); «Мои события» → **feature 005** (`/account/events`); the avatar icon → **feature 009** (`/account`). Features 004/005 are shipped (epic 004–007); the avatar target resolves to the **feature-009** profile, authored in the same portal-surface-IA epic — the two features are co-sequenced (008 wires the header entry, 009 builds the profile it points to). If 009's `/account` profile is not yet on `main` when 008 ships, the avatar still resolves to `/account` (the route exists — 009 retires only the debug dump there), so 008 has no hard blocker on 009.
- **Design source (canvas) is vendored.** The header + `/` canvases (`webinars-listing.dc.html`, `my-events.dc.html`, `webinar-page.dc.html`) are already under `design-source/` (ADR-0013). No DesignSync pull is a prerequisite for authoring; Stage-B render-parity (EARS-12) verifies against them.
- **Stage-B live-verify.** As a `user-facing` surface, the branded render is re-confirmed by the product owner on the running stand before merge (or under the epic's batched Stage-B gate, if one is designated). The stand stays up until that verdict.
- **«Школы» is not a seam.** The v1 nav omits «Школы» entirely (EARS-10 _Retired_) — there is no inert placeholder and therefore no decision-debt seam to track. «Школы» becomes a nav target only when its own feature is specced and built, via that feature's discovery.
