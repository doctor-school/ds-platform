---
title: "028 — Legal pages (documents and contacts)"
description: "Requirements for the «Документы и контакты» page on both storefronts: a shared legal-content set (personal-data policy, 021 consent texts, photo/video consent), contacts and requisites blocks, and the per-document reading page — slice 1 only, licence and R3 documents deferred."
slug: 028-legal-pages
status: Draft
issues: [1965, 1966, 1967, 1968, 1969, 1970]
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/milestone/17
prior_decisions:
  - "ADR-0013 — canvases `design-source/doctor-docs.dc.html` / `academy-docs.dc.html` are the Stage-A source of truth for both pages"
  - "ADR-0014 §2 — `realizes: US-N` traceability from `028-product.md`"
  - "ADR-0006 §4 — flat EARS numbering, triplet layout"
  - "ADR-0015 §2 — host-to-application map (doctor → apps/doctor, Academy → apps/portal)"
  - "ADR-0016 §7 — verification strategy (Vitest unit + Playwright/E2E per host + axe)"
lang: en
---

> **EN (this)** · **RU:** [`028-requirements-ru.md`](./028-requirements-ru.md)
>
> PRD source: [`028-product.md`](./028-product.md) (US-1…US-18). This is a thin, mostly-static content surface — no new engine, no CMS, no admin UI. It puts a screen in front of every visitor on both hosts, so `surface: user-facing`.

# 028 — Legal pages (Requirements)

## Outcomes

- One shared set of legal documents (Markdown, versioned in-repo), read through one shared page shell on each host — `apps/doctor` (017 shell) and `apps/portal` (008 shell) — never two forked copies of the same text.
- Every consent a doctor ticks at registration (021) opens as a real, readable page, word for word the same text, at a URL stable across future corrections.
- A visitor with no checkbox in hand can still find the same documents, the operating entity's requisites, and a working contact channel, from any page on either host.

## Scope

- The «Документы и контакты» page on `apps/doctor` and on `apps/portal`, each in its host's existing shell.
- The document reading page (one shared component, host-projected), the R1 documents list (one row: Политика персональных данных и согласия), the per-021-consent document pages, the photo/video consent document page.
- The contacts block (mailto + Telegram/ВКонтакте/YouTube chips) and the requisites line (юрлицо · ИНН · ОГРН · адрес — no licence).
- The doctor-list caption exit naming the Academy documents page (REQ-24, third placement).
- Removing every legacy-site link, including repointing `ACADEMY_PRIVACY_POLICY_URL`.

### Out of scope

- The licence block (documents-list row + licence number in the requisites line, **US-11**) — slice 2, owner 2026-09-06 ("Данных лицензии нет, не выводим её сейчас!").
- **US-5** — plain-language personal-data handling — slice 1 publishes the exact policy/consent legal text only, never a plain-language summary of it; that summary is owner/lawyer content, not an engineering deliverable.
- «Пользовательское соглашение» — slice 2, owner 2026-09-06.
- «Правила начисления очков» — slice 2; text authored and owned by feature 025, 028 only publishes it.
- R3 documents (contracts, constitution, teal-model documents) and payment/refund terms — slice 2, `blocked_by` **037** (personal-data lifecycle for retention/versioning wording).
- Admin authoring UI for documents — content ships as reviewed Markdown in this repo; no CMS.
- The legal drafting itself (policy/consent wording) — owner/lawyer input, not an engineering deliverable.

## Constraints

- No CMS, no database table, no admin screen — documents are files under `packages/legal-content/`, reviewed like code.
- A document with no approved content is absent, never a placeholder or a "coming soon" row (owner rule, 2026-08-27: hide the block until content).
- No surface may link `doctor.school/index/*` (the legacy site).

## Prior decisions

- ADR-0013 §A1 — cross-front capability reuse: canvases `design-source/doctor-docs.dc.html` / `academy-docs.dc.html` are the Stage-A source of truth for both pages, and the one-shared-set decision below implements ADR-0013 §A1's canonical-core rule.
- Canvas fork 1 (`docsVariant: Б`) — each host lists its own projection of one shared legal set; canonical logic and content live once, per-host route projection only (AGENTS.md §6 cross-front reuse).
- Canvas fork, prompt 21 (`tocVariant: А`) — sticky left ToC at 1440, collapsed list above the text at 390.
- Canvas fork 2, prompt 21 (`doc: короткий`) — every 021 consent and the photo/video consent is its own short-variant document page, never an extra index row.
- REQ-24 amended (same PR as this spec's PRD commit) to name the doctor→Academy documents-list caption as its third allowed placement, alongside the footer link and «Стать экспертом».

## Content model (design-level; detail in `028-design.md`)

Documents are Markdown files in the new shared package `packages/legal-content/`, frontmatter `slug` / `title` / `edition` (ISO date) / `kind: policy | consent`. One shared reading component in `packages/design-system` renders any document; `apps/doctor` and `apps/portal` each add only a thin route + index-list projection. No app-to-app imports.

## EARS requirements

- **EARS-1** (`realizes: US-3, US-6`) — WHEN a visitor requests the doctor storefront's «Документы и контакты» page, THE SYSTEM SHALL render it in the 017 shell with the documents list, the contacts block and the requisites line.
- **EARS-2** (`realizes: US-3, US-6`) — WHEN a visitor requests the Academy's «Документы и контакты» page, THE SYSTEM SHALL render it in the 008 shell with the same three blocks, sourced from the same shared document set.
- **EARS-3** (`realizes: US-2`) — WHERE slice 1 is in force, THE SYSTEM SHALL list exactly one entry on both hosts' documents list — «Политика персональных данных и согласия» — and SHALL NOT list the licence, «Пользовательское соглашение» or «Правила начисления очков» rows drawn on the canvases.
- **EARS-4** (`realizes: US-12`) — THE SYSTEM SHALL render the contacts block with `support@doctor.school` (doctor) or `academy@doctor.school` (Academy) as a `mailto:` link plus Telegram/ВКонтакте/YouTube chips, each caption exactly as drawn on that host's canvas.
- **EARS-5** (`realizes: US-9, US-10`) — THE SYSTEM SHALL render one requisites line on both hosts reading «ООО «Ивекскон» · ИНН <…> · ОГРН <…> · <юридический адрес>», with no licence number in R1.
- **EARS-6** (`realizes: US-3`) — THE SYSTEM SHALL close the doctor documents list with the caption «Полный набор документов платформы — на странице документов Академии.», linking to the Academy documents page (REQ-24, third placement); the Academy list SHALL carry no counterpart caption.
- **EARS-7** (`realizes: US-4, US-13, US-14`) — WHEN a visitor opens a document's own URL, THE SYSTEM SHALL render its title, «редакция от <дата>», a table of contents (sticky left column at ≥1440px, collapsed above the body at ≤390px — `tocVariant: А`), the body, a back link to the documents list, and a «Другие документы» list of the remaining published documents.
- **EARS-8** (`realizes: US-1, US-2, US-7`) — WHEN a doctor opens a consent link next to a 021 registration checkbox, THE SYSTEM SHALL open that specific consent's document page (short `doc` variant) in the same host, word for word the checkbox's text, without discarding the doctor's in-progress registration form.
- **EARS-9** (`realizes: US-2`) — THE SYSTEM SHALL publish each of the three 021 consent texts (medical-worker declaration, partner-data-sharing consent, marketing consent) and the photo/video distribution consent as its own document page, never as an index row.
- **EARS-10** (`realizes: US-16, US-17`) — WHEN a document's text is corrected and republished, THE SYSTEM SHALL keep its URL unchanged, so links from consent copy, the registration form and stored consent references keep resolving to the same document.
- **EARS-11** (`realizes: US-4, US-16`) — WHEN a document is republished with a new edition date, THE SYSTEM SHALL show an «обновлено» chip on its documents-list row; THE SYSTEM SHALL NOT show a numeric version number anywhere on the surface.
- **EARS-12** (`realizes: US-18`) — WHERE a document has no owner-approved content, THE SYSTEM SHALL omit its row and its page entirely — no placeholder, no «coming soon» state.
- **EARS-13** (`realizes: US-8, US-15`) — THE SYSTEM SHALL point `ACADEMY_PRIVACY_POLICY_URL` and every consent/footer link at this surface's own documents, and SHALL NOT reference `doctor.school/index/*` anywhere.
- **EARS-14** (`realizes: US-13`) — THE SYSTEM SHALL render every document and index page legibly at 390px and 1440px, in light and dark, using `packages/design-system` primitives and typography only.
- **EARS-15** (`realizes: US-14`) — THE SYSTEM SHALL pass the `playwright-axe` gate on the documents list and the document page, with real heading structure and links that name their destination.

## Invariants

- One shared document set, read by both hosts — never a forked per-host copy of the same text (US-6, AGENTS.md §6).
- A document's URL is stable across text corrections (EARS-10); only the edition date and the «обновлено» chip change.
- No document with unapproved content is ever rendered (EARS-12) — a dev placeholder on this surface is a defect, not an acceptable stand-in.

## Verification

| #   | Kind                     | What it exercises                                                                                                     |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| V-1 | Vitest unit              | `packages/legal-content` loader resolves a `slug` to its frontmatter + body; a `kind`/`edition` mismatch is rejected. |
| V-2 | Vitest unit              | The shared reading component renders ToC variant А at both breakpoints from the same document data (EARS-7).          |
| V-3 | Playwright/E2E — doctor  | Index → open «Политика персональных данных и согласия» → back → «Другие документы» link resolves (EARS-1, EARS-7).    |
| V-4 | Playwright/E2E — Academy | Index → open the same policy document via the Academy's own route projection → same body renders (EARS-2, US-6).      |
| V-5 | Playwright/E2E — doctor  | Registration (021) consent checkbox link opens its own consent document without losing form state (EARS-8).           |
| V-6 | axe                      | `playwright-axe` clean run on the documents list and one document page, both hosts (EARS-15).                         |
