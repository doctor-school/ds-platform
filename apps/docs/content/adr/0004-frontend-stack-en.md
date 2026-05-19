> **EN (this)** · **RU:** [`0004-frontend-stack-ru.md`](./0004-frontend-stack-ru.md)

# ADR-0004 — Frontend Stack for DS Platform

**Date:** 2026-05-14
**Status:** Accepted
**Related to:** Plane DSO-28 (`b9b950e8-6ad2-4e50-807d-f7e74aaeed5a`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0004-frontend-stack-design-en.md`
**Inherits:** ADR-0001 (Identity/Auth/RBAC), ADR-0002 (Backend core: NestJS+TS+Zod+REST+Centrifugo+BullMQ+Timeweb storage), ADR-0003 (Postgres17+Drizzle+Cerbos+Redis, single Postgres instance)

---

## Context

DS Platform — 6 web surfaces with distinct genres:

- Promo pages (#21) — SEO-public, marketing content
- Doctor web cabinet (#17) — mobile-first auth, documents + webinar
- Expert cabinet (#18) — CMS course editor
- Clinic cabinet (#19, v3) — game map + dashboard
- Investor cabinet (#20) — ad marketplace + ROI dashboard (primary business revenue source)
- Admin/CMS (#14) — moderation, medical status verification, DPO (Continuing Professional Education) issuance, AI pipeline UI

Constraints:

- Federal Law 152-FZ — hosting in RF (Russian Federation), personal data (PD) must not leave RF
- Self-host RF — no Vercel/Cloudflare/AWS managed services
- AI agents — primary development mechanism (objective AI-friendliness criteria: LLM dataset size, mainstream status)
- Operations by a team of 1–2 people, AI-first dev
- Multi-role user (doctor → expert → clinic staff)
- ADR-0001 §7 requires CSP profile-per-zone (admin as top-tier security perimeter)
- ADR-0002 §5 fixes `openapi-typescript` codegen → single SDK for frontend
- ADR-0002 §7 fixes Centrifugo as realtime gateway
- ADR-0003 §1 fixes a single Postgres instance

[[feedback_tech_stack_criteria_no_team_skill]] — prohibits "team knows X", "prototypes on Y", "RF hiring pool" as pro-arguments. Intrinsic criteria only.

---

## Decision

### 1. Meta-framework: **Next.js 15 App Router + RSC**

One framework for all 6 surfaces. Objectively wins on the aggregate of High-weight criteria (+51 vs +36 for the nearest competitor, Split-toolchain): largest LLM dataset among React meta-frameworks, RSC provides SSR-shell + client-hydration + HttpOnly cookie on the server out of the box, RF self-host without Vercel dependency (standalone build).

Prohibition: `@vercel/*` packages, Edge Runtime with Vercel KV, Vercel Image Optimization, Vercel Cron, Vercel Analytics. ESLint rule `no-vercel-only-api` enforced.

### 2. App-split: **4 Next.js apps**

```
apps/promo/    # SSG/ISR, doctor.school
apps/portal/   # SSR auth + client-hydration, app.doctor.school
apps/admin/    # Refine + 2FA, admin.doctor.school
apps/cms/      # Payload v3 inside Next.js, cms.doctor.school
```

Cookies: **host-only `__Host-` cookie per app** (`__Host-ds_portal_session`, `__Host-ds_admin_session`, `__Host-ds_cms_session`, etc.). Cross-app SSO continuity — via OIDC silent re-auth (`prompt=none`), not via shared cookie. Fixed in ADR-0001 §6 + Amendment A2 (2026-05-18, DSO-63 #2 — supersedes A1.1). The previously accepted downgrade (shared `__Secure-ds_session` on `.doctor.school`) is reversed following external architecture validation.

Deployment v1-v2: one VPS "frontend-prod" + 4 Docker containers + nginx reverse-proxy. v3+ trigger — split at 1M MAU.

### 3. Admin framework: **Refine** + custom data/auth/access providers → NestJS+Cerbos+Authentik

Refine — admin-UI framework on top of the **existing backend** (ADR-0002 NestJS). Not a headless CMS (that would duplicate the backend). UI-agnostic — works natively with shadcn/ui (our design system).

Custom providers:

- Data provider (~100 lines) → NestJS REST API (cursor-pagination, RFC 7807, Idempotency-Key)
- Auth provider (~50 lines) → Authentik/Zitadel JWT
- Access provider (~50–100 lines) → custom adapter on top of `@cerbos/embedded` SDK. Cerbos — **documented community pattern** in Refine docs, not a packaged `@refinedev/cerbos`. Adapter is local (inherits ADR-0003 §5).

### 4. Design system: **Tailwind CSS 4 + shadcn/ui + lucide-react** (shared `packages/design-system`)

RSC-native (static CSS, no runtime CSS-in-JS workarounds), maximum LLM dataset, owned-code customization (shadcn copies components into the repo, not an npm dependency). On top: TipTap (rich-text), Tanstack Table, react-day-picker, Recharts/Tremor (charts).

User cabinets in `apps/portal` — custom React (not Refine), brand-UX requires custom flows.

### 5. Data-fetching: **Tanstack Query v5 + RSC hybrid + Server Actions selectively**

Pattern: RSC provides initial SSR with data → `HydrationBoundary` serializes state to client → Tanstack Query handles client interactivity + cache + invalidation. Centrifugo WS events call `queryClient.invalidateQueries`. Server Actions — for simple admin mutations without client cache.

Tanstack Query — unified pattern across all 4 apps (Refine is built on TQ internally). **Caveat:** Refine in `apps/admin` manages its own `QueryClient` (Refine is a client-side framework); admin app is effectively CSR with a thin SSR shell. `HydrationBoundary` is applicable in portal/promo/cms, not for Refine-managed resources in admin. See design spec §4, §5, §8.1.

### 6. Forms: **RHF + `zodResolver` + shadcn `<Form>`**

shadcn `<Form>` primitive is **built on RHF**. Refine officially uses RHF. Zod schema — single SSOT in `packages/api-client/schemas/` (NestJS backend and frontend import the same file).

### 7. Promo content source: **Payload CMS v3 content-only**

Payload v3 lives inside Next.js in `apps/cms`. Owns only marketing-content tables (`cms.*` schema namespace in the shared Postgres from ADR-0003). Does NOT own domain data (domain → NestJS+Drizzle via `public.*`).

SSOT enforcement via custom Lexical features ("Insert glossary term" button in rich-text toolbar → relation reference, not a literal) + CI-lint on canonical terms. Custom Auth Strategy → Authentik/Zitadel. MCP server for AI agents.

### 8. Image optimization: **hybrid**

- Promo SSG → Next.js static imports → build-time variants → CDN cache as static
- Portal/Admin dynamic → `next/image` Sharp on Node + Timeweb CDN cache
- Payload media library → Payload's built-in Sharp pipeline → Timeweb Object Storage → CDN serve

Single delivery layer — Timeweb CDN. Trigger: OQ-F10 (imgproxy when Node CPU >70%). Option "Timeweb CDN native transforms" dropped — feature does not exist on Timeweb (confirmed 2026-05-14).

### 9. Real-time client: **`centrifuge-js`** + custom React hooks in `packages/api-client`

From ADR-0002 §7. Hook `useCentrifugoChannel` wraps Centrifuge subscription + `queryClient.invalidateQueries` on publish events.

### 10. i18n: **`next-intl`**

App Router-native, RSC-compatible, TS-typed message keys. Messages in `messages/ru.json` of each app + shared in `packages/i18n-shared/`. i18n-ready from v1, multi-lang in v2+.

### 11. Testing: **Vitest + React Testing Library + Playwright**

Vitest (unit + integration) + RTL (component) + Playwright (E2E cross-browser).

### 12. PWA: **`serwist`** (maintained next-pwa fork) — installable manifest + service worker

In `apps/portal`. Offline lesson reading — OQ-F7 (deferred v2+, depends on DSO-29).

### 13. Lint/Format: **ESLint flat config + Prettier + plugin-tailwindcss**

Custom rules: `no-class-validator` (inherits ADR-0002 §3), `no-vercel-only-api`, `glossary-required` (for marketing content).

### 14. Monorepo: **pnpm workspaces + Turborepo**

Base layout (apps/ + packages/) fixed in design spec §17. Final layout — DSO-31.

### 15. Frontend observability: **GlitchTip** (self-hosted, Sentry API-compatible) + `@sentry/nextjs` SDK + Web Vitals tracking

GlitchTip MIT, self-host, RF-compliant. SDK is official Sentry — maximum LLM dataset.

---

## Consequences

### Positive

- AI agents write idiomatic React on the first attempt (all selected libraries are mainstream with maximum LLM datasets).
- One meta-framework for 4 apps → one mental model, one build/deploy pattern, one CI pipeline template.
- 4 apps provide independent deploy cadence + isolated security perimeters (admin/cms 2FA-zone, portal/promo SSO-zone) + AI focused on one app at a time.
- Type-safety end-to-end: Zod schemas from `packages/api-client/schemas/` flow from NestJS validation through RHF forms to RSC fetches without cross-language codegen.
- RSC + Tanstack Query hybrid gives the best of both worlds — server-fetch with HttpOnly cookie + client interactivity + real-time invalidation.
- Payload content-only resolves SSOT discipline for marketing content (inline glossary references in rich-text) without the overhead of a full headless CMS on the backend.
- Refine + Cerbos integration inherits the policy engine from ADR-0003 — admin permissions use the same `*.yaml` policies as NestJS guards.
- Sharp + Timeweb CDN hybrid delivers zero runtime CPU for promo (build-time) and cacheable transforms for dynamic content (Node CPU only on cold cache).

**Inheritance caveat (for transparency):** ADR-0004 derives the end-to-end TypeScript typing benefit from ADR-0002's choice of Node.js+TS runtime. ADR-0002 §1 contains argumentation referencing existing prototypes ("3 prototypes on Next.js") and RF hiring pool — this violates the [[feedback_tech_stack_criteria_no_team_skill]] rule that was formulated later in this ADR. This does not invalidate the Next.js choice here (it stands on objective criteria — LLM dataset, UI ecosystem, RSC), but in any future revision of ADR-0002 the Node.js choice must be verifiable on objective grounds independently. If ADR-0002 is revisited without the "3 prototypes" argument, Node.js must still pass on clean criteria; otherwise the TS end-to-end benefit inherited by ADR-0004 is in question.

- Fully self-hosted stack — no Vercel/Cloudflare/AWS dependencies; 152-FZ-compliant out of the box.

### Negative

- Vercel-bias in Next.js DX/docs requires discipline (ESLint rule + explicit prohibition list + review).
- Payload has its own migration system alongside Drizzle (two migration tools in the codebase, both in the monorepo). **Namespace separation `cms.*` vs `public.*` is insufficient as a security/operational boundary** — it is only a naming convention. Mitigation — **Postgres role-level privilege separation**: `cms_owner` has USAGE only on the `cms.*` schema, `app_owner` only on `public.*`. This is enforced at the Postgres role level, not by convention. See design spec §10.2.1 (amendment to ADR-0003 §1 — multi-role privilege).
- Payload integration with Authentik requires a custom Auth Strategy ~50 lines. Not trivial, but a straightforward pattern.
- Single VPS for 4 frontend containers v1-v2 — single point of failure for all frontend. SLO 99.0% v1 permits this. v3 — split.
- **Composite end-to-end SLO v1 ≈ 98.0%** (frontend 99.0% × backend 99.0% from ADR-0002), not the sum of individual SLOs. This is materially worse than the declared individual SLOs. Mitigation v1: Docker `restart: always` + watchdog alerts + manual failover SOP (DSO-10). v2/v3 — active-passive HA or multi-VPS split.
- **Webinar 10k concurrent failure scenario**: if the frontend-prod VPS goes down during a live webinar, all 10k viewers lose web access regardless of Centrifugo health. Mitigation v1: pre-warmed cold-standby snapshot, manual failover ≤15 min.
- Refine + custom data provider requires tests for the contract between NestJS API and Refine queries — additional testing surface.
- Custom Lexical features for Payload glossary insertion — non-trivial development (~3–5 days Phase 0).

### Architectural qualities (metrics, not declarations)

| Quality              | Metric                   | v1                      | v3     |
| -------------------- | ------------------------ | ----------------------- | ------ |
| Bundle size (portal) | gzipped JS on main route | ≤200KB                  | ≤300KB |
| LCP (promo)          | Mobile, throttled 3G     | ≤2.5s                   | ≤2.0s  |
| PageSpeed (promo)    | Mobile score             | ≥80                     | ≥90    |
| TTI (portal main)    | Mobile                   | ≤3.5s                   | ≤2.5s  |
| Deploy frequency     | Independent apps         | 4 independent pipelines | Same   |
| Web Vitals INP       | p75                      | ≤200ms                  | ≤100ms |
| Cold start (Node)    | Per-container            | ≤2s                     | ≤1s    |

---

## Open questions (deferred)

| OQ                                       | Review trigger                                                                                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-F1. Migrate promo to Astro            | Marketing ≥3 developers, promo PageSpeed <90 mobile, demand for visual-CMS workflow                                                                                                                                                                                   |
| OQ-F2. Portal split into multiple apps   | Portal bundle >500KB gzipped, expert-CMS has separate threat model                                                                                                                                                                                                    |
| OQ-F3. v3 topology scaling               | 1M MAU reached, or Centrifugo+SSR on one VPS becomes bottleneck                                                                                                                                                                                                       |
| OQ-F4. Migration Payload → Keystatic     | Marketing scope narrows to 3–5 landing pages AND inline-glossary not needed                                                                                                                                                                                           |
| OQ-F5. Auth perimeter cms vs admin merge | Threat models converge (currently separate: marketing ≠ moderators)                                                                                                                                                                                                   |
| ~~OQ-F6~~                                | ~~Timeweb CDN native image transforms~~ — closed 2026-05-14: feature does not exist on Timeweb CDN                                                                                                                                                                    |
| OQ-F7. Offline lessons in PWA web        | DSO-29 mobile sync-strategy fixes the pattern; web follows                                                                                                                                                                                                            |
| OQ-F8. Migration to Biome                | ESLint CI >5 min/PR, Prettier plugin ecosystem falls behind                                                                                                                                                                                                           |
| OQ-F9. Storybook for design system       | Team grows to ≥2 frontend, design system >20 components                                                                                                                                                                                                               |
| OQ-F10. imgproxy for image CPU           | Node CPU >70% at peak, Sharp p99 >500ms                                                                                                                                                                                                                               |
| OQ-F11. Self-hosted Plausible Analytics  | v2+ marketing analytics with RF residency                                                                                                                                                                                                                             |
| OQ-F12. Payload native auth fallback     | DSO-25 spike (Authentik vs Zitadel) showed that the headless API does not support a clean custom-strategy for Payload v3. Consequence: Payload native auth + email-mirror via webhook outbox; SSO between cms and portal/admin breaks (marketer has a separate login) |

## Delegated

- **Mobile stack** — DSO-29 (separate brainstorm session).
- **AI runtime / LLM middleware** — DSO-30.
- **Formal repo strategy** (final monorepo layout, CI/CD, versioning) — DSO-31. Basic convention here — minimum.
- **Frontend-VPS provisioning + nginx vhost + TLS certs** — DSO-10 (infra readiness).
- **Payload Auth Strategy concrete implementation** — Phase 0 implementation after DSO-25 IdP spike.
- **Specific UX flows for each cabinet** — product tasks, not a tech decision.
- **Game-map UI for DS Clinic (#19, v3)** — separate design spec closer to v3.

## Related ADRs

- ADR-0001 — Identity/Auth/RBAC (cookie strategy, JWT with two-tier validation, hybrid RBAC)
- ADR-0002 — Backend Core (NestJS API + Zod SSOT + Centrifugo + BullMQ + Timeweb storage; `openapi-typescript` codegen → SDK)
- ADR-0003 — Data Layer (Postgres + Drizzle + Cerbos; `cms.*` schema namespace for Payload tables)
