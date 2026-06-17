---
title: "DS Platform — Frontend Stack design [EN]"
description: "1. Meta-framework: Next.js 15 App Router + RSC, one framework for all 6 web surfaces. 2. App-split: 4 Next.js applications — apps/promo (SSG/ISR,..."
lang: en
---

> **EN (this)** · **RU:** [`0004-frontend-stack-design-ru.md`](./0004-frontend-stack-design-ru.md)

# DS Platform — Frontend Stack design

**Date:** 2026-05-14
**Author:** Tech Lead
**Related to:** Plane DSO-28 (`b9b950e8-6ad2-4e50-807d-f7e74aaeed5a`), milestone DSO-24
**Inherits:** ADR-0001 (Identity/Auth/RBAC), ADR-0002 (Backend core: NestJS+TS, Zod, REST, Centrifugo, Timeweb storage/CDN, openapi-typescript SDK), ADR-0003 (Postgres+Drizzle+Cerbos+Redis, single instance)
**Inputs:** `outputs/2026-05-12-ds-platform-tech-requirements-digest.md` §8.4/§9.x, `outputs/2026-05-12-tech-stack-brainstorm-prep.md`, `knowledge-base/documents/Doctor-School-Platform-PRD-v1.md` §5/§7/§13-21, `docs/documentation-pattern/documentation-framework-final.md`
**Output:** `apps/docs/content/adr/0004-frontend-stack-en.md` + inputs for DSO-29 (Mobile), DSO-30 (AI runtime), DSO-31 (Repo strategy)

---

## 0. TL;DR

1. **Meta-framework:** Next.js 15 App Router + RSC, one framework for all 6 web surfaces.
2. **App-split:** 4 Next.js applications — `apps/promo` (SSG/ISR, doctor.school) + `apps/portal` (SSR auth, app.doctor.school) + `apps/admin` (Refine, admin.doctor.school) + `apps/cms` (Payload v3 inside Next.js, cms.doctor.school).
3. **Deployment topology v1-v2:** one VPS "frontend-prod" + 4 Docker containers + nginx reverse-proxy. v3+ — separate VPSes at 1M MAU.
4. **Admin/CMS framework:** Refine + custom REST data provider → NestJS API + Cerbos access provider + custom Zitadel auth strategy. No headless CMS as a backend replacement.
5. **Design system:** Tailwind CSS 4 + shadcn/ui + lucide-react + Radix Primitives. Shared `packages/design-system`. Heavy compositions (TipTap rich-text, Tanstack Table, react-day-picker, Recharts/Tremor) — on top of the shadcn shell.
6. **User cabinets UI:** custom React on shadcn/ui + Tanstack Query + RHF + Zod (not Refine — brand-UX requires customization).
7. **Data-fetching:** Tanstack Query v5 + RSC hybrid (initial SSR via RSC + client interactivity via TQ) + Server Actions selectively for simple admin mutations. Tanstack Query — unified pattern across all 4 apps. **Caveat:** Refine in `apps/admin` manages its own `QueryClient` via `<Refine>` provider (Refine is client-side). This means the admin app is effectively CSR with a thin SSR shell; the RSC `HydrationBoundary` pattern applies in portal/promo/cms but not for Refine-managed resources in admin. Tanstack Query as a library is shared, but cache instances are isolated per app.
8. **Forms:** RHF + `@hookform/resolvers/zod` + shadcn `<Form>`. Zod schema — single SSOT in `packages/api-client/schemas/` (frontend + backend NestJS both use the same import).
9. **Promo content source:** Payload CMS v3 content-only in `apps/cms`, Postgres `cms.*` namespace in the shared Postgres instance from ADR-0003. Custom Lexical features for inline SSOT-glossary insertions. MCP server for AI agents. Custom Auth Strategy → Zitadel.
10. **Image optimization:** hybrid — build-time variants via Next.js static imports (promo) + `next/image` Sharp on Node (dynamic) + Payload Sharp pipeline (media library). Timeweb CDN — shared delivery cache layer.
11. **Real-time client:** `centrifuge` npm package + custom React hooks in `packages/api-client`. Tanstack Query `invalidateQueries` on WS events from Centrifugo (ADR-0002 §7).
12. **i18n:** `next-intl` (App Router-native, RSC-compatible). Messages in `messages/ru.json` of each app. i18n-ready from v1 for Russian, multi-lang in v2+.
13. **PWA:** `serwist` (maintained next-pwa fork) — installable manifest + service worker navigation cache. Offline lessons — open question (DSO-29).
14. **Testing:** Vitest (unit + integration) + React Testing Library (component) + Playwright (E2E).
15. **Lint/Format:** ESLint flat config + Prettier + `prettier-plugin-tailwindcss`. Custom rule `no-class-validator` (ADR-0002 §3).
16. **Monorepo:** pnpm workspaces + Turborepo. Minimal layout fixed here, formal layout — DSO-31.
17. **Frontend observability:** GlitchTip (self-hosted, Sentry API-compatible, MIT) + `@sentry/nextjs` SDK + Web Vitals tracking.
18. **Vercel-only APIs are prohibited** — `@vercel/*`, Edge Runtime+KV, Vercel Image Optimization, Vercel Cron, Vercel Analytics. Self-host via standalone build.

---

## 1. Scope and non-goals

### In scope DSO-28

- Meta-framework selection (Next.js / Nuxt / SvelteKit / Astro / Remix).
- App-split decision (1 / 2 / 3 / 4 apps).
- Rendering strategy per surface (SSG / SSR / RSC hybrid).
- Admin/CMS approach (headless CMS vs admin-UI framework vs custom).
- Promo content source (MDX / Decap / TinaCMS / Keystatic / Payload).
- Design system stack (styling + UI kit + icons).
- Data-fetching pattern.
- Forms pattern.
- Image optimization.
- Real-time, i18n, PWA, testing, linting, monorepo base.
- Frontend observability.
- Deployment topology v1.

### Not in scope DSO-28 (delegated)

- **Mobile stack** — DSO-29. v1 mobile = web-app PWA prototype; native — open in DSO-29.
- **AI runtime / LLM middleware** — DSO-30.
- **Repo strategy (formal)** — DSO-31. Basic monorepo convention fixed here as minimum, final in DSO-31.
- **Frontend-VPS provisioning, nginx vhost configs, TLS certs** — DSO-10 (infra readiness).
- **Payload Auth Strategy concrete implementation** — Phase 0 implementation against the Zitadel IdP (closed per ADR-0001 §8, DSP-209).
- **Specific UX flows for cabinets** — product tasks, not a tech decision.
- **Game-map UI for DS Clinic (#19, v3)** — separate design spec closer to v3.

---

## 2. Meta-framework: Next.js 15 App Router + RSC

### 2.1. Decision

One framework for all 6 web surfaces: Next.js 15+ with App Router and React Server Components.

### 2.2. Rationale (without bias toward existing prototypes)

Objective criteria and weights (prohibition on "team knows" and "hiring pool" — [[feedback_tech_stack_criteria_no_team_skill]]):

| Criterion                         | Weight | Next.js | Nuxt   | SvelteKit | Astro  | Remix/RR7 | Split-toolchain |
| --------------------------------- | ------ | ------- | ------ | --------- | ------ | --------- | --------------- |
| LLM dataset (AI quality)          | High   | +3      | 0      | -2        | -1     | 0         | +1              |
| RF self-host without vendor lock  | High   | +2      | +2     | +2        | +2     | +2        | +2              |
| SSG+SSR+hydration in one fw       | High   | +3      | +3     | +3        | +2     | +1        | +2              |
| UI kit ecosystem                  | High   | +3      | +1     | 0         | +2     | +3        | +3              |
| i18n maturity                     | Medium | +3      | +3     | +3        | +2     | -1        | +2              |
| Auth-cookie server-fetch          | Medium | +3      | +2     | +2        | +1     | +3        | +2              |
| Maturity (≥2 years in production) | Medium | +2      | +2     | +1        | +1     | 0         | +1              |
| Real-time agnostic                | Low    | +2      | +2     | +2        | +1     | +2        | +2              |
| **Weighted (H=3, M=2, L=1)**      |        | **51**  | **34** | **23**    | **24** | **24**    | **36**          |

A gap of +15 points between the leader and the second place — Next.js dominates on all High-weight criteria simultaneously (LLM dataset, UI ecosystem, rendering coverage, auth-cookie via RSC).

### 2.3. Vercel-bias mitigation

Prohibited in the codebase:

- `@vercel/*` packages
- Edge Runtime with Vercel KV / Vercel-managed ISR
- Vercel Image Optimization (Sharp on Node + Timeweb CDN is used instead)
- Vercel Cron (BullMQ from ADR-0002 §6 is used instead)
- Vercel Analytics (GlitchTip + Web Vitals from §18 is used instead)

Self-host via `output: 'standalone'` in `next.config.ts` → Docker image ~100MB → Node runtime in container. No Vercel-only features are used.

### 2.4. Rejected alternatives (summary)

- **Nuxt 3** (−17 points): Vue LLM dataset is ~5× smaller than React → lower AI code-gen quality. Narrower UI kit ecosystem.
- **SvelteKit** (−28): LLM dataset is ~20× smaller than React → AI substantially weaker. Narrow UI kit ecosystem.
- **Astro** (−27): SSG king, but the cabinets genre (auth-heavy, data-bound, interactive) is not its strength. Island pattern for cabinets overcomplicates.
- **Remix → React Router 7** (−27): after the merger into RR7, framework-mode is in a transitional state, SSG is weaker, i18n not built-in.
- **Split-toolchain (Astro promo + Next.js cabinets)** (−15): +1 point for promo PageSpeed, −2 points for the overhead of two toolchains for a team of 1–2. Net negative on v1. Becomes open question OQ-F1.

---

## 3. App-split: 4 Next.js applications

### 3.1. Decision

```
apps/
├── promo/    # SSG/ISR, doctor.school, public
├── portal/   # SSR auth, app.doctor.school, multi-role (doctor/expert/clinic/investor)
├── admin/    # SSR auth + 2FA + Refine, admin.doctor.school (platform moderators)
└── cms/      # Payload v3 inside Next.js, cms.doctor.school (marketing team)
```

### 3.2. Cookie / SSO topology

**Every app holds its own host-only cookie:**

- `doctor.school` (promo) — `__Host-ds_promo_session` if authenticated state is needed for CTA / lead forms (usually not — promo is anonymous by default).
- `app.doctor.school` (portal) — `__Host-ds_portal_session`, host-only, `HttpOnly`, `Secure`, `SameSite=Lax`.
- `admin.doctor.school` (admin) — `__Host-ds_admin_session`, host-only, `SameSite=Strict`, 2FA mandatory.
- `cms.doctor.school` (cms) — `__Host-ds_cms_session`, host-only, for the marketing team.
- `docs.doctor.school` (docs) — `__Host-ds_docs_session` if auth is needed (internal SSOT for the team, typically via VPN).

The full session security profile (TTL, rotation, CSRF, fingerprint binding) — **ADR-0001 §6** (single source of truth). This document is the implementation reference for Next.js-specific details only (see §3.2.1).

#### 3.2.1. Cross-app SSO via OIDC silent re-auth — frontend implementation (DSO-63 #2)

Cross-app login continuity between portal, admin, promo, docs, cms is achieved via OIDC silent re-auth (`prompt=none`) at the IdP, not via a shared cookie spanning the `.doctor.school` zone. A shared cookie was rejected per ADR-0001 §6 — same-origin XSS or subdomain takeover would compromise the admin session, and CSRF / fingerprint mitigations are bypassed by same-origin XSS. See ADR-0001 §6 for the full rationale.

**Frontend pattern per Next.js app:**

```ts
// apps/{app}/middleware.ts
import { NextResponse } from "next/server";

export async function middleware(req: NextRequest) {
  const session = req.cookies.get("__Host-ds_" + APP_NAME + "_session");
  if (session) return NextResponse.next();

  // No local session → silent re-auth attempt via IdP
  const url = new URL("https://auth.doctor.school/oauth/authorize");
  url.searchParams.set("client_id", APP_OAUTH_CLIENT_ID);
  url.searchParams.set("prompt", "none");
  url.searchParams.set("redirect_uri", `https://${APP_HOSTNAME}/auth/callback`);
  url.searchParams.set("state", generateState(req));
  return NextResponse.redirect(url);
}
```

**Auth callback handler:**

```ts
// apps/{app}/app/auth/callback/route.ts
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    // No code = IdP returned login_required → fall through to login UI
    return NextResponse.redirect(
      `https://auth.doctor.school/login?return_to=${ENCODED_RETURN}`,
    );
  }
  const tokens = await exchangeCodeForTokens(code);
  // Set host-only cookie with session reference
  const response = NextResponse.redirect(returnUrl);
  response.cookies.set("__Host-ds_" + APP_NAME + "_session", tokens.sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // 'strict' for admin/cms
    path: "/",
    maxAge: WEB_SESSION_TTL_SECONDS,
  });
  return response;
}
```

**Visible UX:** for an already logged-in user — instantaneous redirect (≤300ms), no explicit login screen. For an unauthenticated user — normal login flow at `auth.doctor.school/login`.

**Logout:**

```ts
// apps/{app}/app/auth/logout/route.ts
export async function POST() {
  // App-level logout
  const response = NextResponse.redirect("/");
  response.cookies.delete("__Host-ds_" + APP_NAME + "_session");
  return response;
}

// apps/{app}/app/auth/logout-global/route.ts — for "logout from all"
export async function POST() {
  // Local cookie delete + redirect to IdP global logout endpoint
  const response = NextResponse.redirect(
    "https://auth.doctor.school/oidc/logout",
  );
  response.cookies.delete("__Host-ds_" + APP_NAME + "_session");
  return response;
}
```

**CSRF protection:** double-submit pattern (cookie + header) on all state-changing endpoints. Implemented via NestJS middleware on the API side (see identity-auth-rbac-design §7.5).

**Mobile native (RN+Expo):** does not use the cookie flow; it works with token-based auth + Keychain/Keystore directly against the API. Documented in `mobile-stack-design`, unchanged by DSO-63.

### 3.3. Rationale

Matrix (−3…+3):

| Criterion                    | Weight | A. 1 app | B. 2 apps (admin isolated) | C. 3 apps + cms (=4)   |
| ---------------------------- | ------ | -------- | -------------------------- | ---------------------- |
| Security perimeter isolation | High   | -2       | +2                         | **+3**                 |
| Bundle performance per zone  | High   | -2       | 0                          | **+2**                 |
| Multi-role UX                | High   | +3       | +3                         | +2                     |
| Deploy cadence               | Medium | -2       | +1                         | **+3**                 |
| Operational complexity       | Medium | +3       | +1                         | -1                     |
| AI mental boundary           | Medium | -1       | +1                         | **+2**                 |
| Code-sharing overhead        | Medium | +2       | 0                          | -1 (requires monorepo) |
| **Weighted**                 |        | +1       | +19                        | **+24**                |

The `cms` app was added after Payload was fixed as the promo content source (see §10) — Payload v3 is a Next.js app, added to the shared topology without additional runtimes.

### 3.4. Deployment topology v1-v2

One VPS "frontend-prod" (Timeweb, 2–4 vCPU / 4–8 GB RAM):

```
nginx (reverse-proxy + TLS termination)
  ├─ doctor.school        → promo container
  ├─ app.doctor.school    → portal container
  ├─ admin.doctor.school  → admin container
  └─ cms.doctor.school    → cms container (Payload v3)
```

4 Next.js standalone builds, each ~150–300 MB image, ~150–300 MB RAM. Total ~1–2 GB RAM for 4 containers. 2–4 vCPU handles v1-v2 easily (≤tens of thousands MAU).

v3+ trigger (OQ-F3): 1M MAU target, or Centrifugo+SSR on one VPS becomes a bottleneck → split to separate VPSes.

---

## 4. Rendering strategy per surface

| Surface                  | Genre                                               | Mode                                                                 |
| ------------------------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| Promo (#21)              | Public SEO, PageSpeed ≥80, marketing content        | **SSG/ISR**                                                          |
| Doctor web cabinet (#17) | Auth-only, mobile-first, webinar viewing, documents | **SSR (RSC) first paint + client-hydration + SPA-like internal nav** |
| Expert cabinet (#18)     | Auth-only, CMS course editor                        | SSR shell + client-rich rich-text                                    |
| Investor cabinet (#20)   | Auth-only, ad marketplace + ROI dashboard           | SSR shell + client-rich dashboard                                    |
| Clinic cabinet (#19, v3) | Auth-only, canvas/WebGL map + dashboard             | SSR shell + client + canvas-mount                                    |
| Admin (#14)              | Auth-only + 2FA, Refine CRUD                        | **Effective CSR with thin SSR shell** (see below)                    |
| CMS (Payload)            | Auth-only (marketing), admin UI                     | Payload-native SSR + admin SPA                                       |

The pattern "SSR-default first paint + client-hydration + SPA-like internal navigation" is out-of-box Next.js App Router. No pure SPAs, no MPA-without-routing. Promo — SSG/ISR (static, no runtime CPU).

⚠️ **Caveat for admin:** Refine is a client-side framework (requires `<Refine>` provider behind a `"use client"` boundary). This means:

- SSR shell for admin is limited to the outer layout (auth guard, theme)
- All Refine-managed pages inside are CSR (no RSC server-fetch with HttpOnly cookie for resource data)
- The `HydrationBoundary` pattern of Tanstack Query is only applicable in portal/promo/cms; in admin, Refine manages its own `QueryClient` (cache instance isolated per app)

For an internal admin tool (moderators, ≤tens of users) this is an acceptable trade-off — performance is less critical than for the public-facing portal. AI pipeline UI v3 (when it appears) — ordinary React routes inside Refine, the same CSR pattern.

---

## 5. Admin/CMS framework: Refine

### 5.1. Decision

In `apps/admin` we use the Refine framework for CRUD operations (moderation, medical status verification, DPO (Continuing Professional Education) issuance, user management). Custom React pages on top of Refine for specifics (AI pipeline UI v3).

Stack:

- **Refine core** + `@refinedev/nextjs-router` + `@refinedev/react-hook-form` + `@refinedev/react-table`
- **Data provider:** custom REST adapter (~100 lines) → NestJS API from ADR-0002. Convention: cursor-pagination (not offset), RFC 7807 errors, Idempotency-Key headers, path-versioning `/v1/`.
- **Auth provider:** custom (~50 lines) → Zitadel JWT with two-tier validation (JWT fast-path + introspect for high-stakes, inherits ADR-0001 §6).
- **Access provider:** custom adapter (~50–100 lines) on top of `@cerbos/embedded` SDK (ADR-0003 §5 — embedded mode in v1). Refine provides a generic `accessControlProvider` interface; Cerbos is a **documented community pattern** in Refine docs, not a packaged `@refinedev/cerbos`. Implementation is local.
- **UI:** Refine is UI-agnostic, we use shadcn/ui (`Your UI` option in Refine — components in `packages/design-system`).

### 5.2. Rationale

| Criterion                              | Weight | Refine                 | React Admin      | AdminJS             | Custom shadcn |
| -------------------------------------- | ------ | ---------------------- | ---------------- | ------------------- | ------------- |
| OSS license without cap                | High   | +3                     | +3               | +3                  | +3            |
| Drizzle/ADR-0003 compatibility         | High   | +3 (BYOA)              | +3               | -1 (custom adapter) | +3            |
| NestJS/ADR-0002 compatibility          | High   | +3 (BYOA)              | +3               | -1                  | +3            |
| Zitadel/ADR-0001 integration           | High   | +3 (auth provider)     | +3               | +2                  | +3            |
| Admin UI auto-gen                      | High   | +2                     | +2               | +3                  | -3            |
| Custom AI pipeline UI v3 extensibility | Medium | +3 (just React routes) | +3               | 0                   | +3            |
| shadcn/ui native fit                   | High   | +3 (UI-agnostic)       | -1 (MUI default) | -1                  | +3            |
| LLM dataset                            | Medium | +2                     | +2               | +1                  | +3            |
| **Weighted**                           |        | **68**                 | 61               | 33                  | 60            |

Refine wins because it is UI-agnostic (works natively with shadcn/ui — our design system) + its generic `accessControlProvider` interface is compatible with a custom Cerbos adapter (~50–100 lines, documented community pattern). This is still significantly less work than reinventing CRUD UI from scratch (Custom shadcn baseline).

### 5.3. What is NOT Refine

User cabinets (`apps/portal` — doctor/expert/clinic/investor) do not use Refine. Brand-UX requires custom flows (CMS course editor for the expert, clinic game map, investor marketplace), not generic CRUD. In portal — pure React on shadcn/ui + Tanstack Query + RHF + Zod.

The separation is clean: an AI agent in `apps/admin` sees Refine conventions (`<List resource="users">`); in `apps/portal` — ordinary React. Two clear mental models, not one mixed one.

### 5.4. Rejected alternatives

- **Headless CMS as admin** (Payload-as-full-admin / Strapi / Directus / Keystone): duplicates the backend (own API + own ORM + own auth) alongside the already-chosen ADR-0002 NestJS. Not a "wrapper over the backend" but a parallel backend. Not suitable.
- **React Admin**: −7 points. Native fit with MUI, conflicts with the shadcn/ui design system.
- **AdminJS**: −35 points. Tight ORM coupling, no Drizzle adapter.
- **Low-code (Retool / Appsmith / ToolJet / Budibase)**: drag-and-drop incompatible with AI-first dev (LLMs do not write drag-drop configs).
- **Custom shadcn without framework**: −8 points. Every CRUD flow must be written by hand — a lot of upfront work for moderation, audit-log UI, and role management.

---

## 6. Design system: Tailwind + shadcn/ui + lucide-react

### 6.1. Decision

Shared `packages/design-system` workspace package, consumed by all 4 apps:

- **Styling engine:** Tailwind CSS 4 (new Oxide engine, ~10× faster v3 build, CSS output ~5 KB after purge)
- **UI kit:** shadcn/ui — owned-code components (Tailwind + Radix UI primitives), copied into the repo via `npx shadcn add <component>`, not an npm dependency
- **Icons:** lucide-react (~1.5k icons, MIT, tree-shakable, shadcn default)
- **Additional on top of shadcn shells:**
- Rich-text editor (expert cabinet #18 + Payload Lexical) → TipTap + custom extensions
- Data table (admin) → Tanstack Table + shadcn `<Table>` shell
- Charts (investor #20, analytics) → Recharts or Tremor (shadcn-flavored)
- Date picker → react-day-picker + shadcn `<Calendar>` primitive
- Calendar (#17 v3) → react-big-calendar or FullCalendar in a shadcn wrapper

### 6.2. Rationale

| Criterion             | Weight | Tailwind+shadcn     | Tailwind+Mantine | CSS Modules+Radix | Panda+Park | Emotion+MUI | Tailwind+Ant |
| --------------------- | ------ | ------------------- | ---------------- | ----------------- | ---------- | ----------- | ------------ |
| LLM dataset           | High   | **+3**              | +2               | -1                | -2         | +3          | +2           |
| RSC compatibility     | High   | **+3**              | +2               | +3                | +3         | **-3**      | -2           |
| Customization scope   | High   | **+3** (owned-code) | +1               | +3                | +2         | -1          | -2           |
| Bundle / runtime cost | High   | **+3**              | 0                | +3                | +3         | -1          | -2           |
| Component coverage    | Medium | +1                  | +3               | -3                | 0          | +3          | +3           |
| Tree-shaking          | Medium | +3                  | +2               | +3                | +3         | +1          | +1           |
| Maturity              | Medium | +2                  | +3               | +3                | 0          | +3          | +3           |
| License               | Medium | +3                  | +3               | +3                | +3         | +2          | +3           |
| **Weighted**          |        | **+44**             | +34              | +24               | +27        | +9          | +15          |

Tailwind + shadcn/ui — RSC-native (static CSS, no runtime CSS-in-JS workarounds), maximum LLM dataset, owned-code customization without fighting UI kit opinions.

### 6.3. AI-friendly customization for DS brand

> **Revised by ADR-0013** (design-token SoT & theming + block-adoption methodology). The original promise here — "DS tokens in `packages/design-system/tokens.json` → Tailwind theme config" — never materialised; the mechanism below supersedes it.

For the medical brand and future gamification:

- **Tokens are the single source of truth** in DTCG format (`packages/design-system/tokens/*.json`, three tiers primitive → semantic → component), compiled by **Style Dictionary** to a Tailwind v4 `@theme` block + `:root`/`.dark` CSS variables — **not** a hand-authored `tokens.json` nor a `tailwind.config` theme object. Components reference only semantic/component tokens; one semantic change re-themes the app. (ADR-0013 §1–2; design-system-foundation tech-spec §2.)
- **Block adoption before bespoke:** UI is composed by adopting ready blocks/components from a fixed registry whitelist (the `build-ui-from-design-system` gate), re-skinned to tokens and owned in `src/blocks`/`src/primitives`. (ADR-0013 §4.)
- Mascot integration, Lottie/Rive for game-card animations (see PRD §15 — gamification); the `game.*` token namespace is reserved.
- Con/Pul/Au cards — custom shadcn-extended components on top of the token shell.

---

## 7. User cabinets UI: Custom React + shadcn/ui

### 7.1. Decision

`apps/portal` (doctor / expert / clinic / investor) is implemented with custom React code on:

- shadcn/ui components (from `packages/design-system`)
- Tanstack Query for server state (see §8)
- React Hook Form + Zod resolver for forms (see §9)
- Tanstack Table for data grids
- React Context for cross-component theme/auth/locale state
- Zustand for cross-component non-server state (if needed — e.g., expert draft course before submit)

### 7.2. What we do NOT use

- Redux Toolkit — overkill; Tanstack Query covers server state, useState/Context covers client state
- MobX / Recoil / Jotai — niche, smaller LLM datasets

---

## 8. Data-fetching: Tanstack Query v5 + RSC hybrid

### 8.1. Decision

```
┌─────────────────────────────────────────────────────────────┐
│  RSC server component (Next.js App Router)                  │
│   - Initial data fetch to NestJS API via HttpOnly cookie    │
│   - Streaming SSR, server-only auth-flow                    │
│   - HydrationBoundary serializes query state to client      │
└────────────────────┬────────────────────────────────────────┘
                     │ dehydrate → hydrate
┌────────────────────▼────────────────────────────────────────┐
│  Client Component (Tanstack Query v5)                        │
│   - useQuery / useMutation / useInfiniteQuery                │
│   - Optimistic updates                                       │
│   - Cache invalidation from Centrifugo WS events            │
└─────────────────────────────────────────────────────────────┘
                     ↑
                     │ queryClient.invalidateQueries
┌────────────────────┴────────────────────────────────────────┐
│  Centrifugo WS handler → invalidate cache → re-fetch        │
└─────────────────────────────────────────────────────────────┘
```

Server Actions are used selectively for simple admin mutations without client cache (e.g., "reject course" — Server Action + `revalidatePath`).

### 8.2. Rationale

| Criterion               | Weight | Tanstack Query                     | SWR        | RSC-only |
| ----------------------- | ------ | ---------------------------------- | ---------- | -------- |
| LLM dataset             | High   | +3                                 | +1         | 0        |
| Feature richness        | High   | +3                                 | +1         | -2       |
| RSC integration         | High   | +3 (HydrationBoundary)             | +2         | +3       |
| Consistency with Refine | High   | +3 (Refine BUILDS on TQ)           | -3         | -3       |
| Real-time invalidation  | High   | +3 (queryClient.invalidateQueries) | +2         | -3       |
| Bundle                  | Medium | +1 (~12 KB)                        | +3 (~5 KB) | +3       |
| TS quality              | Medium | +3                                 | +2         | +3       |
| Maturity                | Medium | +3                                 | +3         | +1       |
| **Weighted**            |        | **+59**                            | +25        | -1       |

Deciding factor: Refine is built on top of Tanstack Query → using SWR in portal would result in two different server-state engines in the codebase. Also, real-time invalidation via `queryClient.invalidateQueries` is a one-liner with TQ, and a workaround with RSC-only (`revalidatePath` re-renders the entire page).

---

## 9. Forms: RHF + Zod resolver + shadcn `<Form>`

### 9.1. Decision

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@ds/design-system/form";
import { courseCreateSchema, type CourseCreateInput } from "@ds/api-client";

function CreateCourseForm() {
  const form = useForm<CourseCreateInput>({
    resolver: zodResolver(courseCreateSchema),
    defaultValues: { title: "", description: "" },
  });

  const mutation = useMutation({
    mutationFn: api.courses.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["courses"] }),
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(mutation.mutate)}>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Course title</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}
```

Zod schema — single SSOT in `packages/api-client/schemas/course.ts`:

- Backend NestJS imports it and validates request bodies
- Frontend imports it and uses it via `zodResolver`
- TypeScript type is inferred once via `z.infer`

### 9.2. Rationale

The shadcn/ui `<Form>` primitive is **built on RHF**. Refine officially uses RHF in its form helpers. This is not a competing choice — it is the built-in pattern of already-adopted decisions.

| Criterion             | Weight | RHF + Zod         | Conform | Native FormData | Formik |
| --------------------- | ------ | ----------------- | ------- | --------------- | ------ |
| LLM dataset           | High   | +3                | 0       | +1              | +1     |
| Zod integration       | High   | +3                | +3      | -1              | +2     |
| Refine integration    | High   | +3                | -2      | -3              | -2     |
| shadcn `<Form>`       | High   | +3 (built on RHF) | -3      | -3              | -3     |
| Feature richness      | High   | +3                | +1      | -2              | +3     |
| Server Actions compat | Medium | +2                | +3      | +3              | +1     |
| TS quality            | Medium | +3                | +3      | +1              | +2     |
| Maturity              | Medium | +3                | +1      | +3              | +3     |
| **Weighted**          |        | **+61**           | +11     | -10             | +15    |

---

## 10. Promo content source: Payload CMS v3 content-only

### 10.1. Decision

Payload CMS v3 lives inside Next.js in `apps/cms`. Owns ONLY marketing-content tables (`pages`, `blocks`, `glossary`, `media`) in the Postgres `cms.*` schema namespace. **Does not own DS Platform domain data** (that is NestJS+Drizzle via `public.*`).

### 10.2. Architecture

```
apps/cms/ (Next.js app + Payload v3 plugin)
  ├── payload.config.ts          # Schema-as-code TS — SSOT for collections
  ├── collections/
  │   ├── pages.ts                # Marketing pages
  │   ├── blocks.ts               # Reusable page-blocks
  │   ├── glossary.ts             # Domain term registry (label + aliases + def)
  │   └── media.ts                # Image/video uploads → Timeweb S3
  └── lexical-features/
      └── glossary-term-feature.ts  # Custom Lexical editor toolbar "Insert glossary term"

Postgres (shared with domain):
  - public.*   ← Drizzle, domain tables (users, courses, etc.)
  - cms.*      ← Payload, content tables (cms_pages, cms_glossary, etc.)
```

### 10.2.1. Postgres privilege separation (security boundary)

⚠️ **Intentional hardening:** namespace separation `cms.*` vs `public.*` is insufficient as a security boundary. It is a **naming convention** at the level of query patterns, not privilege enforcement. Without role-level separation, the Payload migration runner (or a misconfigured test) could accidentally operate outside `cms.*`.

Decision — **dedicated Postgres roles** (recorded as a requirement for DSO-10; ADR-0003 §1 is updated inline to mandate multi-role privilege separation alongside the single-instance topology):

```sql
-- DDL for Postgres (executed at provisioning, DSO-10 / DSO-27 follow-up)
CREATE ROLE app_owner LOGIN PASSWORD '...';
CREATE ROLE cms_owner LOGIN PASSWORD '...';

CREATE SCHEMA public AUTHORIZATION app_owner;
CREATE SCHEMA cms    AUTHORIZATION cms_owner;

-- app_owner: USAGE only on public
GRANT USAGE  ON SCHEMA public TO app_owner;
GRANT CREATE ON SCHEMA public TO app_owner;
REVOKE ALL   ON SCHEMA cms    FROM app_owner;

-- cms_owner: USAGE only on cms
GRANT USAGE  ON SCHEMA cms TO cms_owner;
GRANT CREATE ON SCHEMA cms TO cms_owner;
REVOKE ALL   ON SCHEMA public FROM cms_owner;
```

**Connection strings:**

- NestJS (`apps/api`, Drizzle) → `postgresql://app_owner:.../ds_platform`
- Payload (`apps/cms`) → `postgresql://cms_owner:.../ds_platform`

This guarantees:

- The Payload migration runner physically **cannot** DROP/ALTER a table in `public.*` (Drizzle domain) even with a misconfigured setup
- The Drizzle migration runner physically **cannot** touch Payload `cms.*` tables
- Postgres-level audit log (`pg_audit`) shows a clear separation of agent ↔ schema

**Cross-schema reads (if needed):** the portal may SELECT from `cms.pages` for rendering promo content → add `GRANT SELECT ON ALL TABLES IN SCHEMA cms TO app_owner;` selectively. Write — never cross-schema.

This requirement extends ADR-0003 §1: the single Postgres instance now mandates **multi-role privilege separation** with the introduction of the `cms.*` namespace. ADR-0003 §1 is updated inline to reflect this.

### 10.3. SSOT enforcement via Glossary

The marketer in the Payload admin UI:

1. Edits a promo page in the Lexical rich-text editor.
2. Wants to mention a brand → clicks the "📚 Insert glossary term" button in the toolbar.
3. Sees a dropdown of terms from the Glossary collection (brand_name, product_orthobio_school, currency_au, …).
4. Selects `brand_name` → a reference `{ type: 'glossary-ref', termId: 'brand_name' }` is inserted into the content JSON structure.
5. When rendering in Next.js promo, it is replaced with `glossary.brand_name.label` ("Doctor.School").

When the glossary is updated ("Doctor.School" → "DS.RU") → all promo pages automatically pick up the change on the next ISR revalidation. No search-and-replace.

**CI-lint (drift detection):** checks the rendered HTML of promo pages for free-standing literals of canonical terms. Blocks publish if found (e.g., "Doctor.Scool" with a typo → blocked).

### 10.4. Auth integration

Payload v3 has its own auth system — we override it with a custom Auth Strategy:

- The marketer logs in via Zitadel (same as everywhere in DS Platform).
- JWT token is verified in Payload via a custom strategy (~50 lines TS).
- Payload session is mapped to the user from Zitadel (Payload local user mirror via webhook outbox from ADR-0002 §5).
- Permissions within Payload (who can edit what) → mapping to roles from JWT.

### 10.5. AI-agent integration

Payload v3 has an **MCP server** — an AI agent (Claude Code, Cursor) can via MCP:

- Read page content
- See Glossary terms
- See collection schemas (which are schema-as-code in TS — also in git)

This gives AI full visibility of marketing content without write access.

### 10.6. Decision rationale (without doc-bias)

| Criterion                                 | Weight | MDX inline | Decap CMS | TinaCMS | Keystatic | **Payload content-only** |
| ----------------------------------------- | ------ | ---------- | --------- | ------- | --------- | ------------------------ |
| SSOT enforcement (placeholders/relations) | High   | +1         | +1        | +3      | +2        | **+3**                   |
| AI-friendliness                           | High   | +3         | +3        | +2      | +3        | +2 (MCP)                 |
| UI quality for marketer                   | High   | -3         | -2        | +3      | +2        | **+3**                   |
| Modern, AI-native                         | High   | +1         | -2        | +2      | +3        | **+3**                   |
| Marketer without git                      | High   | -3         | +3        | +3      | +3        | **+3**                   |
| Schema-as-code in git                     | Medium | +3         | 0         | +2      | +3        | **+3**                   |
| Self-host RF                              | High   | +3         | +3        | +2      | +3        | +3                       |
| MIT license without cap                   | Medium | +3         | +3        | +2      | +3        | +3                       |
| Operational complexity                    | Medium | +3         | +2        | 0       | +2        | **-1**                   |
| **Weighted (H=3, M=2)**                   |        | **21**     | 25        | 51      | 61        | **64**                   |

Payload wins because it closes 5 strict requirements simultaneously:

- SSOT enforcement via relations + custom Lexical features + CI-lint
- Git replacement — admin UI instead of PR flow
- Modern AI-native paradigm
- Polished UI (Payload v3 admin)
- Marketer without git knowledge

Trade-off — operational complexity (−1): Payload is a new Next.js app (`apps/cms`) + Payload migrations alongside Drizzle (in different schema namespaces) + custom Zitadel Auth Strategy ~50 lines. This is the price for the other 5 wins.

### 10.7. Review trigger

OQ-F4: if the marketing scope narrows to 3–5 static landing pages AND there is no need for inline-glossary references in rich-text → migrate to Keystatic (git-based, no server). Trigger: the marketing team consciously gives up a polished admin UI in favor of zero ops overhead.

---

## 11. Image optimization

### 11.1. Decision — hybrid

| Use case                                                     | Solution                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Promo SSG (marketing illustrations, mascot, hero images)     | Next.js static imports → **build-time variants** → `_next/static/` → Timeweb CDN cache as static |
| Portal user-uploaded (avatars, course covers, lesson images) | `next/image` + Sharp on Node + Timeweb CDN cache by transformed URL                              |
| Admin user-uploaded (diploma certificates)                   | Same, low frequency                                                                              |
| Payload media library                                        | Payload's built-in Sharp pipeline → variants in Timeweb Object Storage → CDN serve               |

All assets — shared delivery layer Timeweb CDN.

### 11.2. Rationale

| Criterion              | Weight | Sharp Node | Pre-build | imgproxy | **Hybrid** |
| ---------------------- | ------ | ---------- | --------- | -------- | ---------- |
| CPU load on Node       | High   | -1         | +3        | +3       | +1         |
| Cache hit rate / LCP   | High   | +2         | +3        | +3       | +3         |
| Operational complexity | High   | +3         | +2        | -1       | +2         |
| User-uploaded support  | High   | +3         | -3        | +3       | +3         |
| AI-friendliness        | Medium | +3         | +2        | +1       | +3         |
| Cost                   | Medium | +3         | +3        | -1       | +3         |
| **Weighted**           |        | +43        | +27       | +39      | **+50**    |

(Option "Timeweb CDN native transforms" dropped — feature does not exist on Timeweb CDN, confirmed 2026-05-14.)

The hybrid wins because each use case gets the optimal solution.

### 11.3. Migration triggers

- **OQ-F6 closed (2026-05-14):** Timeweb CDN does not have native image transforms (confirmed by Timeweb support). Sharp on Node remains the primary path for dynamic transforms in v1.
- **OQ-F10: imgproxy sidecar** — trigger: Node CPU >70% on image transforms at peak, or Sharp p99 latency >500 ms. This is now a more likely trigger given OQ-F6 was closed without an upgrade.

---

## 12. Real-time: centrifuge-js + Tanstack Query invalidation

### 12.1. Decision

```ts
// packages/api-client/hooks/useCentrifugoChannel.ts
import { Centrifuge } from "centrifuge";
import { useQueryClient } from "@tanstack/react-query";

export function useCentrifugoChannel(
  channel: string,
  onPub?: (data: any) => void,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const sub = centrifuge.newSubscription(channel);
    sub.on("publication", (ctx) => {
      // By default invalidate the corresponding cache
      const queryKey = channelToQueryKey(channel); // e.g. ['leaderboard'] for 'leaderboard:global'
      queryClient.invalidateQueries({ queryKey });
      onPub?.(ctx.data);
    });
    sub.subscribe();
    return () => sub.unsubscribe();
  }, [channel]);
}
```

Channels from ADR-0002 §7: `user:<uuid>`, `webinar:<id>`, `leaderboard:global`, `admin:moderation-queue`.

### 12.2. Real-time scope

| Channel                                    | App               | Version |
| ------------------------------------------ | ----------------- | ------- |
| `webinar:<id>` (chat + presence)           | portal (#17)      | v1      |
| `leaderboard:global` (live reordering)     | portal (#17, #23) | v2      |
| `investor:<id>` (real-time metrics)        | portal (#20)      | v2-v3   |
| `admin:moderation-queue` (new submissions) | admin (#14)       | v1      |

---

## 13. i18n: next-intl

### 13.1. Decision

`next-intl` in each app:

- Messages: `messages/ru.json` per app (isolated namespaces — promo, portal, admin, cms)
- Shared messages (glossary terms, forms) — `packages/i18n-shared/`
- Locale routing built-in (`[locale]/...`); single locale `ru` for now, ready for `en` in v2+
- Server Components compatible (RSC-native)
- TS-typed message keys

### 13.2. Glossary integration

Glossary terms from Payload (see §10) can be injected into i18n messages via build-time fetch or ISR. This synchronizes the SSOT glossary with client-side messages.

---

## 14. Testing

### 14.1. Stack

| Layer              | Tool                                                                              |
| ------------------ | --------------------------------------------------------------------------------- |
| Unit + integration | **Vitest** (Vite-native, Jest-compatible API, parallel by default)                |
| Component          | **React Testing Library** + Vitest                                                |
| E2E                | **Playwright** (cross-browser, RSC-aware, network-mocking, screenshot regression) |
| Visual regression  | Deferred v2+ (OQ-F9 — Chromatic / Percy)                                          |

### 14.2. Coverage targets

- Critical paths (auth, payments, audit) — mandatory E2E coverage
- Component unit-coverage minimum — deferred v2 (OQ from ADR-0002 OQ7)
- Property-based for invariants — where applicable

---

## 15. PWA: serwist

### 15.1. Decision

`serwist` (maintained next-pwa fork with active maintenance, MIT) in `apps/portal`:

- `manifest.json` — installable ("Add to Home Screen" on iOS Safari, Android Chrome, desktop)
- Service worker — navigation cache for offline-fallback UI shell
- Push notifications via Web Push API (for notifications from ADR-0002 §6)
- Icons 192/512 + apple-touch-icon (mascot + brand)

### 15.2. Offline scope in v1

- Cached: shell, design system assets, fonts, logos
- NOT cached: lessons, video, course data (require freshness)
- Offline lesson reading — **OQ-F7**, deferred v2+ (depends on DSO-29 mobile sync strategy and PRD §15 OQ4)

---

## 16. Lint/Format

### 16.1. ESLint flat config

```
packages/eslint-config/
├── base.js          # @typescript-eslint, eslint-plugin-import
├── next.js          # eslint-config-next + base
├── refine.js        # next + refine-specific
└── payload.js       # next + payload-specific
```

Custom rules:

- `no-class-validator` — prohibits `class-validator` decorators and `@ApiProperty` (enforces Zod-only from ADR-0002 §3)
- `no-vercel-only-api` — prohibits `@vercel/*` imports
- `glossary-required` — for marketing content (see §10.3 CI-lint)

### 16.2. Prettier + plugin-tailwindcss

- `prettier-plugin-tailwindcss` — auto-sorts utility classes in canonical order
- Dual role with ESLint: ESLint = correctness, Prettier = formatting

### 16.3. Migration trigger

OQ-F8: Biome migration — trigger: ESLint CI >5 min/PR or Prettier plugin ecosystem falls behind Biome.

---

## 17. Monorepo: pnpm + Turborepo

### 17.1. Layout

```
ds-platform/
├── apps/
│   ├── promo/
│   ├── portal/
│   ├── admin/
│   ├── cms/
│   └── api/                    # NestJS from ADR-0002
├── packages/
│   ├── design-system/          # Tailwind config, shadcn components, tokens
│   ├── api-client/             # openapi-typescript codegen + Zod schemas
│   ├── auth-shared/            # Zitadel JWT integration, JWKS, two-tier validation
│   ├── i18n-shared/            # Shared messages, glossary integration
│   ├── eslint-config/          # Shared ESLint presets
│   └── tsconfig/               # Shared tsconfig.base.json
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### 17.2. Rationale

- **pnpm vs npm/yarn:** content-addressable cache, saves ~10× disk space, faster install, mainstream 2024–2025
- **Turborepo vs Nx:** Turborepo is lighter (Vercel-backed but MIT, self-host without vendor lock), sufficient for our scope. Nx — for enterprise (overhead).

### 17.3. Delegated to DSO-31

Final contents of each package, build pipeline, CI/CD config, versioning convention — DSO-31.

---

## 18. Observability frontend

### 18.1. Stack

- **GlitchTip** (self-hosted, Sentry API-compatible, MIT) — error tracking
- `@sentry/nextjs` SDK in each frontend app (thinks it is talking to Sentry, actually → GlitchTip endpoint)
- **Web Vitals** tracking (LCP, FID, CLS, INP) → GlitchTip performance dashboard
- Source maps uploaded on deploy via GlitchTip CLI

### 18.2. Hosting

GlitchTip in infra (DSO-10), separate VPS or container on observability-prod (TBD in DSO-10).

### 18.3. What we do NOT use

- Sentry SaaS — US-hosted, violates RF residency policy
- Vercel Analytics — Vercel-only API is prohibited
- Google Analytics — third party, Federal Law 152-FZ risk; we use self-hosted (Plausible Analytics — open question OQ-F11 in v2+)

---

## 19. Vercel-only API enforcement

Custom ESLint rule `no-vercel-only-api` blocks the following imports:

- `@vercel/*` (any packages from the @vercel namespace)
- `next/og` — optional, Sharp-based, self-host works (exception)

Documentation:

- Prohibited features: Edge Runtime with Vercel KV/Vercel Postgres, Vercel Image Optimization, Vercel Cron, Vercel Analytics
- Alternatives from ADR-0002 are used (BullMQ for cron, Centrifugo for realtime, Timeweb Object Storage)

---

## 20. Inheritance from other ADRs (cross-reference)

### 20.1. ADR-0001 (Identity/Auth/RBAC)

- JWT auth flow via Zitadel (closed per ADR-0001 §8, DSP-209).
- **Host-only `__Host-` cookie per app** (portal, admin, promo, docs, cms) — each app has its own scope. Full security profile — ADR-0001 §6.
- **Cross-app SSO continuity** — via OIDC silent re-auth (`prompt=none`), not via shared cookie. Implementation details — §3.2.1.
- Two-tier validation: JWT fast-path for ≥99% of requests, IdP `/introspect` for high-stakes (payments, AU withdrawal, role change, admin mutations, PD export).
- Hybrid RBAC: IdP coarse roles in JWT, backend fine-grained via Cerbos.

### 20.2. ADR-0002 (Backend core)

- `openapi-typescript` codegen from NestJS Zod schemas → `@ds/api-client` npm package
- Refine data provider consumes this SDK
- Zod schemas SSOT in `packages/api-client/schemas/` — backend NestJS and frontend RHF use the same import
- Centrifugo via `centrifuge-js` (see §12)
- BullMQ orthogonal to frontend (async backbone of the backend)
- Idempotency-Key headers are mandatory for mutating requests from frontend
- RFC 7807 Problem Details for errors — Refine data provider maps to error formats

### 20.3. ADR-0003 (Data layer)

- Postgres single instance with `public.*` (domain) + `cms.*` (Payload) schemas
- Cerbos embedded via `@cerbos/embedded` SDK — Refine access provider uses the same policies as NestJS guards
- pgvector for AI recommendations (v3) — orthogonal to frontend choice

---

## 21. Open Questions (recorded in ADR with triggers)

| OQ        | Description                                                                                                                                    | Review trigger                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-F1     | Migrate `apps/promo` to Astro                                                                                                                  | Marketing ≥3 developers, promo PageSpeed <90 on mobile, demand for visual-CMS workflow                                                                                                                                                                                                                                                                                                                                                                |
| OQ-F2     | Portal split into multiple apps (doctor/expert/clinic/investor)                                                                                | Portal bundle >500 KB gzipped, or expert-CMS gets a separate security threat model                                                                                                                                                                                                                                                                                                                                                                    |
| OQ-F3     | v3 topology scaling                                                                                                                            | 1M MAU reached, or Centrifugo+SSR on one VPS becomes bottleneck                                                                                                                                                                                                                                                                                                                                                                                       |
| OQ-F4     | Migration Payload → Keystatic                                                                                                                  | Marketing scope narrows to 3–5 static landing pages AND inline-glossary not needed                                                                                                                                                                                                                                                                                                                                                                    |
| OQ-F5     | Auth perimeter cms vs admin                                                                                                                    | Resolved as split: marketing ≠ moderators. Revisit if threat models converge                                                                                                                                                                                                                                                                                                                                                                          |
| ~~OQ-F6~~ | ~~Timeweb CDN native image transforms~~ — **closed 2026-05-14:** feature does not exist on Timeweb CDN. Sharp on Node remains the primary path | —                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| OQ-F7     | Offline lessons in PWA web                                                                                                                     | DSO-29 mobile sync-strategy fixes the pattern; web follows                                                                                                                                                                                                                                                                                                                                                                                            |
| OQ-F8     | Migration to Biome                                                                                                                             | ESLint CI bottleneck >5 min/PR, Prettier plugin ecosystem falls behind                                                                                                                                                                                                                                                                                                                                                                                |
| OQ-F9     | Storybook for design system                                                                                                                    | Team grows to ≥2 frontend, design system >20 components                                                                                                                                                                                                                                                                                                                                                                                               |
| OQ-F10    | imgproxy for image CPU                                                                                                                         | Node CPU >70% on image transforms at peak, Sharp p99 >500 ms                                                                                                                                                                                                                                                                                                                                                                                          |
| OQ-F11    | Self-hosted Plausible Analytics                                                                                                                | v2+ when marketing analytics with RF residency is needed                                                                                                                                                                                                                                                                                                                                                                                              |
| OQ-F12    | **Payload native auth fallback**                                                                                                               | Trigger: if a Zitadel-backed custom auth strategy for Payload v3 proves infeasible during Phase 0 implementation (ADR-0001 §8 closed Zitadel; DSP-209). Consequence: Payload uses native auth (separate user store for the marketing team), SSO between cms and portal/admin **breaks** — the marketer has a separate login/password. Mitigation: email-mirror to Zitadel users via webhook outbox (ADR-0002 §5), 2FA enforced in Payload native auth |

---

## 22. Delegated

- **Mobile stack** (DSO-29): v1 — web-app PWA (current prototype pattern), native (Swift+Kotlin / React Native / Flutter / KMP) — separate brainstorm session.
- **AI runtime, LLM middleware, AI providers** (DSO-30): backend-side AI pipeline, frontend only consumes via NestJS API.
- **Formal repo strategy** (DSO-31): final monorepo layout, versioning, CI/CD, build pipeline. Basic convention here — minimum.
- **Frontend-VPS provisioning + nginx vhost configs + TLS certs** (DSO-10).
- **Payload Auth Strategy concrete implementation** — Phase 0 implementation against the Zitadel IdP (closed per ADR-0001 §8, DSP-209).
- **Game-map UI for DS Clinic #19** — design spec closer to v3.
- **Specific UX flows for each cabinet** — product tasks.

---

## 23. Architectural qualities (metrics, not declarations)

| Quality                           | Metric                                   | v1                                                 | v3                      |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------- | ----------------------- |
| Bundle size (portal)              | gzipped JS on main route (initial route) | ≤200KB\*                                           | ≤300KB                  |
| LCP (promo)                       | Mobile, throttled 3G                     | ≤2.5s                                              | ≤2.0s                   |
| PageSpeed (promo)                 | Mobile score                             | ≥80                                                | ≥90                     |
| TTI (portal main)                 | Mobile                                   | ≤3.5s                                              | ≤2.5s                   |
| AI code-gen accuracy (subjective) | % first-shot working                     | ≥80% (Tailwind+shadcn+RHF+Zod+TQ — all mainstream) | ≥90%                    |
| Deploy frequency                  | Independent apps                         | 4 independent pipelines                            | Same                    |
| Cold start (Node)                 | Per-container                            | ≤2s                                                | ≤1s                     |
| Image-transform CPU load          | Node CPU at peak                         | ≤50%                                               | ≤30% (imgproxy trigger) |
| Web Vitals INP                    | p75                                      | ≤200ms                                             | ≤100ms                  |

\* **Bundle ≤200 KB is achieved only with code-splitting discipline:** route-based dynamic imports (`next/dynamic`) are mandatory for heavy components — TipTap rich-text (~80 KB), Recharts/Tremor (~60–100 KB), react-big-calendar / FullCalendar (~50–80 KB), Lottie player for game cards. The main chunk contains only React+Next runtime (~100 KB) + shadcn primitives initial set (~30 KB) + Tanstack Query (~12 KB) + RHF+Zod (~25 KB) + Centrifuge (~13 KB) + next-intl (~3 KB). Bundle analyzer is mandatory in CI (`@next/bundle-analyzer`) — the threshold `≤200 KB gzipped initial route` is enforced automatically. Setting up CI bundle budget — DSO-31.

---

## 24. Risks

| Risk                                                                               | Severity                    | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel-bias will tempt use of `@vercel/*` API                                      | Medium                      | Custom ESLint rule `no-vercel-only-api` + explicit list in §19 + PR review                                                                                                                                                                                                                                                                                                                                        |
| Payload + Drizzle dual migration tool causes confusion or touches the wrong schema | High                        | **Postgres role-level privilege separation** (see §10.2.1): `cms_owner` has USAGE only on `cms.*`, `app_owner` only on `public.*`. Namespace-naming convention is reinforced by privilege enforcement. README in `apps/cms` explains the boundary                                                                                                                                                                 |
| **Composite SLO mismatch (single-VPS frontend × single-VPS backend)**              | **High**                    | Backend SLO v1 = 99.0% (ADR-0002), frontend SLO v1 = 99.0% (this ADR). Composite end-to-end availability v1 ≈ **98.0%** (two independent single-node systems in series). This is materially worse than the declared individual SLOs. Mitigation: Docker `restart: always` policy + watchdog alert on each VPS + manual failover SOP documented in DSO-10. v3 trigger — split to separate VPSes with auto-failover |
| **Webinar 10k concurrent on frontend-prod VPS failure**                            | **Medium-High**             | If the frontend-prod VPS goes down during a live webinar, all 10k viewers lose web experience regardless of Centrifugo health (ADR-0002 §7). Mitigation v1: pre-warmed cold-standby snapshot VPS (manual failover ≤15 min), per-app monitoring alert. v2 trigger — active-passive HA                                                                                                                              |
| Payload auth integration with Zitadel is more complex than planned                 | Medium                      | Phase 0 implementation (~2 days) validates feasibility; fallback — Payload native auth + email-mirror to portal users                                                                                                                                                                                                                                                                                             |
| Refine does not cover custom admin flows (AI pipeline UI v3)                       | Medium                      | Custom React routes on top of Refine — standard pattern; noted in §5.3                                                                                                                                                                                                                                                                                                                                            |
| RSC + Tanstack Query hydration is bug-prone                                        | Low                         | Canonical pattern (`HydrationBoundary`) is documented; covered by E2E Playwright                                                                                                                                                                                                                                                                                                                                  |
| AI writes class-validator instead of Zod out of habit                              | Low (mitigated in ADR-0002) | ESLint rule `no-class-validator` blocks it                                                                                                                                                                                                                                                                                                                                                                        |
| GlitchTip falls behind Sentry API features                                         | Low                         | We use core features (errors, releases, Web Vitals), not bleeding-edge                                                                                                                                                                                                                                                                                                                                            |
| Timeweb CDN goes down / out of scope                                               | Medium                      | Fallback to direct S3 serve without CDN (degraded perf, not downtime); v3 — multi-CDN trigger                                                                                                                                                                                                                                                                                                                     |

---

## 25. Acceptance criteria for DSO-28 closure

- [x] Brainstorm conducted, design spec written
- [x] ADR-0004 written (see `apps/docs/content/adr/0004-frontend-stack-en.md`)
- [x] Selected: meta-framework, app-split, admin/CMS, design system, data-fetching, forms, promo content, image optimization, real-time, i18n, PWA, testing, monorepo, observability, build tooling
- [x] Justified: SSR vs SPA vs SSG mix per surface, deployment topology
- [x] Considered: RF-CDN, Vercel-only API prohibition, 152-FZ-compliant
- [x] Open questions with triggers recorded
- [x] Inheritance from ADR-0001/0002/0003 is explicit
- [x] Acceptance criteria from DSO-28 issue description covered
