---
"@ds/admin": minor
---

feat(admin): 007 admin integration + full-arc browser E2E (#595)

The `apps/admin` app (Next.js 16 + **Refine** CSR shell, ADR-0004 §3/§5) now
carries the **feature 007** event-admin surface end-to-end — the operator/director
tooling that authors the webinar aggregate the rest of the epic reads. This is the
`user-facing` vertical-slice deliverable no single EARS handler owns (requirements
Verification `all` row): the Refine admin↔API wiring plus the browser run of the
full arc.

- **Refine wiring** — a custom REST **data provider** over `/v1/admin/events`
  (list / detail / multipart create+edit with program-PDF upload / stream config /
  the named lifecycle transitions), an **auth provider** over the shipped 003 BFF
  (`/v1/auth/*`, same-origin `__Host-ds_session` proxy — 007 adds no auth
  primitive), and an **access-control provider** gating on `platform_admin`.
- **Event surface** — a list (all states, lifecycle badge, air time in МСК), a
  create/edit form (full aggregate + ordered free-text speakers + replaceable
  program PDF), the stream config (closed enum `rutube | youtube` + embed ref), and
  a lifecycle action bar whose offered actions derive **only** from the
  server-supplied `validTransitions` (the UI offers only valid moves; the api guard
  is the authority — EARS-7).
- **EARS-8** — the surface bounces a non-`platform_admin`; the api `AuthzGuard`
  refuses `doctor_guest`/public on every write regardless of the UI.
- **EARS-9** — one source of truth asserted across every lifecycle state against
  the 004 read models (`apps/api/test/admin/state-single-source.e2e-spec.ts`): the
  state 007 writes is exactly what the public page + listing resolve; the aggregate
  carries one lifecycle field, no legacy boolean visibility scatter.
- **EARS-10** — RU admin surface, no hardcoded user-facing string (the
  `no-hardcoded-display-string` ESLint gate now covers `apps/admin`); every absolute
  time renders in МСК from the canonical instant (asserted with a Playwright
  `timezoneId` override).
- **EARS-11** — stock Refine + `@ds/design-system` (adopt-before-bespoke recorded;
  no admin canvas exists — Stage-A gap), token-lint green.
- **Browser E2E** — `apps/admin/e2e/` translates `007-scenarios.feature` via
  **playwright-bdd**: the full arc (create → publish → configure stream → open →
  close → archive) plus invalid-transition / closed-provider-enum / МСК-no-drift /
  non-admin refusal, on the live dev stand (real Postgres + Zitadel + MinIO). A
  manual, dev-stand-gated gate (not CI), mirroring the portal e2e tier.
