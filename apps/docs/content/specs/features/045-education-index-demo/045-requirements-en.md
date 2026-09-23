---
title: "045 — Education index demo"
description: "Requirements for two temporary, unauthenticated static demo pages on academy.doctor.school — a public education-investment leaderboard and a partner-cabinet dashboard on fictional data, deleted once features 032/035 ship."
slug: 045-education-index-demo
status: Draft
issues: [2360]
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/25
prior_decisions:
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0013 — tokens-only styling; UI vendored from design-source/academy-index-demo.dc.html (canvas fidelity source, no bespoke chart primitive)"
  - "ADR-0015 — two storefronts; this feature is track:academy, host apps/portal"
  - "F-1 — organisation vocabulary: partner / investor, never sponsor"
lang: en
---

> **EN (this)** · **RU:** [`045-requirements-ru.md`](./045-requirements-ru.md)
>
> PRD source: Issue #2360 body + design prompt [`23-a-index-demo-ru.md`](../../product/two-site-ia/design-prompts-ru/23-a-index-demo-ru.md); temporary demo, no `045-product.md`.

# 045 — Education index demo (Requirements)

## Outcomes

A potential pharma/medtech partner sees, on production, a demo of the public education-index leaderboard and a customised partner-cabinet dashboard, filled with fictional data, before features 032 (investors leaderboard) and 035 (investor cabinet) exist.

## Scope

**In:**

- Two public, unauthenticated static routes in `apps/portal`: `/education-index` (public leaderboard) and `/education-index/partner-demo` (cabinet, org Ortella Biotech).
- Deterministic fixtures reproducing the dataset in design prompt 23 (12 fictional organisations, weekly index series, cabinet metrics).
- Static bars/scales/plates built from `@ds/design-system` tokens (no chart library, no chart primitive in the design system).
- Temporary: both routes are deleted in the release that ships 032 and 035.

**Out:**

- Auth, any API/DB read, real partner accounts, real logos.
- Features 032, 035, 036 themselves.
- Loading, error and empty states (the demo is fully static).
- Per-contact / per-doctor pricing in the UI.

## Constraints

- Compliance (REQ-D5, EAPM code): no patients, saved lives, help to relatives, sales linkage or drug trade names anywhere on either page; only "awareness" / "education" wording, never a stronger medical claim.
- Vocabulary (F-1 / REQ-D6): organisations are "partner" / "investor", never "sponsor", "advertiser", "contributor".
- The word "mining" (namined data) never appears on the public screen (owner decision, #2360).
- Fictional data only (REQ-D8): organisation names and generated SVG emblems are fictional; no real logo, no real organisation or person is ever reachable through the fixture data.

## Prior decisions

- "ADR-0006 §4 — flat EARS numbering"
- "ADR-0013 — tokens-only UI, canvas-derived, design-source/academy-index-demo.dc.html is the fidelity source"
- "ADR-0015 — academy host, track:academy"
- "Owner call 2026-09-23 — demo ships to production as two static pages, no separate environment (Issue #2360)"

## Event Model

Trivial — no commands, no events, no write path. The read model is a static fixture module (`apps/portal`) returning the 12-organisation dataset and the weekly series; both routes render synchronously from it. No API call, no DB query.

## EARS requirements

- **EARS-1** — THE SYSTEM SHALL serve `/education-index` and `/education-index/partner-demo` in `apps/portal` as public routes reachable without authentication and without any session check.
- **EARS-2** — THE SYSTEM SHALL render the public leaderboard from a static fixture module carrying exactly the 12 organisations of design prompt 23, with no network, API or DB call.
- **EARS-3** — THE SYSTEM SHALL display, per organisation, the composite index (average of investment share and doctor-attention share, rescaled to the leader of that week as 100), week-over-week rank delta, investment amount and share (REQ-D2, REQ-D7), doctors trained, lessons created and events held, per REQ-D1 through REQ-D3.
- **EARS-4** — THE SYSTEM SHALL render the leaderboard WITHOUT a top-3 podium above the table (fork podium = canvas default A), the market-wide table being the whole leaderboard.
- **EARS-5** — THE SYSTEM SHALL show investment as both the absolute ruble amount and its percentage share (fork money = canvas default A), never share alone.
- **EARS-6** — WHEN the visitor expands the Ortella Biotech row, THE SYSTEM SHALL reveal the two sub-metric bars (education investment share 15 percent, doctor attention share 19 percent) that compose its index of 72.
- **EARS-7** — THE SYSTEM SHALL render index dynamics for the top-3 organisations as 4 weekly bars starting at the index launch date (1 September 2026), captioned as the launch being the baseline, and SHALL NOT render any value before that date.
- **EARS-8** — THE SYSTEM SHALL render the /education-index/partner-demo cabinet from the same fixture module: plan/fact progress scale, 4 KPI tiles (doctors trained, lessons created, average funnel depth out of 7, events held), an awareness before/after block using the two-bar variant (fork awareness = canvas default A) across the 4 fixed topics, the 7-step engagement funnel in the exact order series to micro-learning to webinar to podcast to club to practical school to mentorship, weekly attention dynamics, and the research-request unit with one already-submitted request.
- **EARS-9** — THE SYSTEM SHALL render the audience table on the cabinet page with a header naming the project audience and the total of 1240 doctors, exactly the 5 fixture rows of design prompt 23, and a caption stating 5 of 1240 are shown and the full list is in the reporting export.
- **EARS-10** — THE SYSTEM SHALL render the show-more and export-for-reporting controls on the cabinet audience table in a disabled state carrying a label stating the control is unavailable in the demo, and SHALL NOT wire either control to any further data.
- **EARS-11** — THE SYSTEM SHALL render a sticky demo plaque under the header on both pages naming the data as demonstration data, with page-specific wording for the public leaderboard versus the partner cabinet.
- **EARS-12** — THE SYSTEM SHALL render both pages correctly in light and dark theme and at the 1440 and 390 viewports, per the vendored canvas.
- **EARS-13** — THE SYSTEM SHALL emit a noindex robots directive on both routes, because the pages are a temporary demo that must never be indexed.
- **EARS-14** — WHEN the release that ships features 032 and 035 lands, THE SYSTEM SHALL remove both routes and their fixture module; no route under /education-index survives that release.

## Invariants

- Neither route ever issues a network request beyond the initial page load (no API, no DB, no telemetry endpoint specific to the demo).
- No forbidden compliance word (patient, saved life, drug trade name, sponsor, advertiser, contributor, mining) ever renders on either page.
- The audience table never renders more than the 5 fixture rows; the show-more control never becomes enabled.
- Investment shares across all 12 organisations sum to 100 percent; attention shares sum to 100 percent (fixture-level invariant, carried from design prompt 23).

## Verification

| #   | Kind                                              | What it exercises                                                                                                                   |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| V-1 | Playwright e2e — apps/portal                      | Anonymous visitor reaches /education-index and /education-index/partner-demo, no login redirect, no session (EARS-1).               |
| V-2 | Playwright e2e — apps/portal                      | Leaderboard renders 12 organisations, expand reveals sub-bars, dynamics chart starts at week 1 (EARS-2, EARS-3, EARS-6, EARS-7).    |
| V-3 | Playwright e2e — apps/portal                      | Cabinet renders KPI tiles, awareness bars, funnel order, audience table 5 of 1240 with disabled controls (EARS-8, EARS-9, EARS-10). |
| V-4 | Canvas-parity drive — build-ui-from-design-system | Light/dark, 1440/390 render matches vendored canvas forks podium=A, money=A, awareness=A (EARS-4, EARS-5, EARS-8, EARS-12).         |
| V-5 | playwright-axe                                    | Both routes pass automated accessibility scan.                                                                                      |
| V-6 | Static lint                                       | no-primitive-style-override — tokens-only styling, no bespoke chart primitive introduced outside the gate report.                   |
| V-7 | Static grep                                       | Neither route response HTML contains a forbidden compliance word, and both carry the noindex directive (EARS-13, Invariants).       |

## Work-package map

| Work package | Scope                                               |
| ------------ | --------------------------------------------------- |
| Issue #2360  | Step 4 — build the two pages from this spec triplet |
