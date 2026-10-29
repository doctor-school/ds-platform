---
title: "032 — Organization registry and its admin (Requirements, slice 1)"
description: "Requirements for slice 1 of feature 032: one admin-managed registry of the organizations Doctor.School works with, absorbing the feature-012 partners; an open, operator-maintained list of organization roles (starting with investor, clinical base, educational licensee) of which one organization holds a set; per-organization public-display rules for the name and the logo; the draft → published → retired lifecycle with restore to draft; search and role/status filters; a non-blocking duplicate hint; the Academy home partner count computed from the registry; platform-administrator-only access with the second factor and the 010 change audit."
slug: 032-organization-registry
status: Draft
issues: [3492, 3493, 3494, 3495, 3496]
surface: user-facing
tracker: https://github.com/doctor-school/ds-platform/issues/1823
prior_decisions:
  - "ADR-0016 §2 — the organisation is a first-class entity; its kinds are an open, extensible set, starting with investor, clinical base and licensee / educational organisation; one organisation may hold several kinds; «employer» is not a kind"
  - "ADR-0016 §8 — every entity declares its storefront ownership; the organisation registry is `academy` (and the admin), the doctor storefront reads none of it"
  - "ADR-0016 §9 — feature 012 is absorbed, never rewritten: `partners` is the organisation seed (renamed + extended), `project_partners` follows the rename"
  - "ADR-0014 §2 — every EARS clause carries `realizes: US-N` of `032-product.md`"
  - "ADR-0006 §4 — triplet layout, flat EARS numbering"
  - "ADR-0013 §A1 — one capability, one owner package; ADR-0013 — admin screens from `@ds/design-system`"
  - "ADR-0002 / ADR-0003 — NestJS + Zod contract in `packages/schemas` + Drizzle schema in `packages/db`"
  - "012 EARS-13 / EARS-14 / EARS-16 / EARS-17 / EARS-23 — the taxonomy lifecycle-impact, admin-session, idempotency, precondition, audit and list contracts this registry reuses"
  - "047 — `platform_admin` in the dedicated admin session with the second factor"
lang: en
---

> **EN (this)** · **RU:** [`032-requirements-ru.md`](./032-requirements-ru.md)
>
> Product source: [`032-product.md`](./032-product.md) (slice 1). Admin UI route: approved-non-canvas, owner decision «1» of 2026-10-29 on Issue #1823 ([states](https://github.com/doctor-school/ds-platform/issues/1823#issuecomment-6490331448), [decision](https://github.com/doctor-school/ds-platform/issues/1823#issuecomment-6490439540)). The feature's screens are the «Организации» and «Роли организаций» sections of `apps/admin` — hence `surface: user-facing`.

# 032 — Organization registry and its admin (Requirements, slice 1)

## Outcomes

- One registry of organizations on the platform: the sponsor partners already entered are its rows, not a parallel list, and every project keeps the organization it had.
- One organization carries a set of roles from a list the platform administrators maintain themselves; the starting roles are «Инвестор», «Клиническая площадка», «Образовательный лицензиат».
- Each organization records whether its name and its logo may be shown publicly, and every public surface that shows organizations follows that record.
- An organization lives draft → published → retired, and a retired one is restored to draft; only published organizations reach a public surface or a public count.
- The Academy home's partner figure is the registry's count of published organizations at the moment of the request; nobody types it.
- Only a platform administrator in the admin session with the second factor changes the registry, and every change is in the edit history.

## Scope

- The admin sections «Организации» (list, full-page create/edit form, lifecycle actions) and «Роли организаций» (role list, add, rename, retire, restore) in `apps/admin`, built from the approved admin kit of `@ds/design-system`.
- The organization and organization-role endpoints in `apps/api` (the `taxonomy` module, where the absorbed partners live), their Zod contract in `packages/schemas`, and the Drizzle schema and forward migration in `packages/db`.
- The forward migration that turns `partners` into `organisations` (and `project_partners` into `project_organisations`) with every row, id, slug, lifecycle state and link preserved, and gives each absorbed row the investor role.
- The display rules applied to the public reads that already show partners today (`/v1/public/projects/{idOrSlug}/partners`, `/v1/public/partners/{idOrSlug}/projects` and the primary partner embedded in project summaries), with their wire shapes unchanged.
- The public partner-count read the Academy home of feature 029 renders.

### Out of scope

- The public investor leaderboard and the investor page, the «Продукция» section, the annual exclusive contract as a public fact, removing the 045 education-index demo (#2367) — the late slice of 032, `blocked_by` 036.
- People inside organizations (membership, an organization's own admin, medical representatives) — 035 / 039.
- The project ↔ organization panel in the project admin, the organization's role in a project and the project cards that show organizations — 030 slice 1, which picks from this registry. Until it ships, the existing project «Партнёры» panel keeps editing `project_organisations` as it edits `project_partners` today.
- The Academy home first-screen line itself (layout, copy, placement) — 029, which renders the count this feature serves (EARS-12).
- Event-level partners and sponsorship levels, a clinic network map, a clinic or partner cabinet.
- Legal attributes of an organization (legal name, INN, contract reference — ADR-0016 design §2.3): no slice-1 story needs them; they join the form with the slice that does.

## Constraints

- The registry is the absorbed `partners` row family (ADR-0016 §9): the rename keeps every id, slug, `first_published_at`, status, `deleted_at` and `version`; no row is re-created and no link is re-pointed.
- Slugs stay system-generated and permanent over every retained row (012 authoring contract); a client slug is rejected.
- The role list is data, not code: adding, renaming or retiring a role is a row change, never a migration or a deploy (Q-40, ADR-0016 §2).
- Logo input follows the 012 media contract (one still JPEG/PNG/WebP, the shared normalizer, the retained cleanup queue); the website stays an optional absolute HTTPS URL up to 2048 characters.
- The doctor storefront (`apps/doctor`) reads no organization data (ADR-0016 §8; REQ-51).

## Prior decisions

- PRD [`032-product.md`](./032-product.md) slice 1 and its recorded lead decisions of 2026-10-28 (the role list is edited by platform administrators; absorbed partners take the investor role; the partner count counts every published organization of any role, including those whose public display is forbidden).
- Owner decision «1» of 2026-10-29 on Issue #1823: the admin screens are approved-non-canvas, composed from the approved admin kit, for the states listed in comment 6490331448.
- ADR-0016 §2, §8, §9; ADR-0014 §2; ADR-0006 §4; ADR-0013 §A1; ADR-0002 / ADR-0003 (frontmatter `prior_decisions`).
- 012 EARS-13 / EARS-14 (signed lifecycle-impact preview, retire and restore), EARS-16 / EARS-17 (admin session, CSRF, idempotency, preconditions, 010 audit), EARS-23 (immediate list search and filters).

## Event Model

**Commands** — `CreateOrganisation`, `UpdateOrganisation` (fields, roles, display rules, logo), `PublishOrganisation`, `RetireOrganisation`, `RestoreOrganisation`, `FindSimilarOrganisations`; `CreateOrganisationRole`, `RenameOrganisationRole`, `RetireOrganisationRole`, `RestoreOrganisationRole` (platform administrator).

**Events** — `OrganisationCreated`, `OrganisationUpdated`, `OrganisationRolesChanged`, `OrganisationPublished`, `OrganisationRetired`, `OrganisationRestored`; `OrganisationRoleCreated`, `OrganisationRoleRenamed`, `OrganisationRoleRetired`, `OrganisationRoleRestored` — each a 010 change-audit row under the request's actor.

**Read models** — the admin organization list (title, roles, status, updated); the admin organization detail; the role list with the count of organizations holding each role; the public partner projections (display-filtered); the public partner count.

**Policies** — «one organization is one row, whatever its roles»; «a role is a row of the list, never a constant»; «a published organization holds at least one active role»; «a role held by a draft or published organization cannot be retired»; «a hidden name keeps the organization off every public projection; a hidden logo is never served»; «only published organizations are public or counted»; «restore returns to draft».

## EARS requirements

> Flat numbering per ADR-0006 §4. Every clause realizes one or more PRD stories and is covered by `032-scenarios.feature`.

- **EARS-1** _(realizes: US-1, US-2, US-4)_ — WHEN a platform administrator creates or edits an organization on the «Организации» full-page form, THE SYSTEM SHALL persist one retained `organisations` row with a stable id, system-generated slug and version, the title (trimmed 1–160), an optional normalized logo, an optional absolute HTTPS website, an optional plain-text description (trimmed 0–1000), the set of its roles and the two display rules «Показывать название публично» and «Показывать логотип публично» (both on by default), and SHALL render that same row on the list and the detail; a refused write SHALL show its field-addressed reasons on the form and change nothing.
- **EARS-2** _(realizes: US-2)_ — WHEN a platform administrator saves an organization's roles, THE SYSTEM SHALL store them as a set over the role list — zero or more distinct roles while the organization is a draft, any combination of roles — offering on the form, as checkboxes, every active role; THE SYSTEM SHALL refuse a role id that is unknown or retired unless the organization already held it, and SHALL keep a retired role the organization already holds on its row, shown marked «Роль снята».
- **EARS-3** _(realizes: US-3)_ — WHEN a platform administrator opens «Роли организаций», THE SYSTEM SHALL list every role with its title, its status and the number of organizations holding it, on the `AdminDataList` composition; WHEN the administrator adds a role («Добавить роль») or renames one, THE SYSTEM SHALL persist one retained `organisation_roles` row with a stable id, system-generated slug, version and a title (trimmed 1–80) unique among active roles case-insensitively, and the new role SHALL be offered on every organization form at once. The list SHALL be seeded with exactly three active roles — «Инвестор» (`investor`), «Клиническая площадка» (`clinical-base`), «Образовательный лицензиат» (`educational-licensee`) — as ordinary rows the administrator can rename or retire; there SHALL be no «Работодатель» role and no role titled «Спонсор» or «Рекламодатель» in the seed.
- **EARS-4** _(realizes: US-3)_ — WHEN a platform administrator retires a role that any draft or published organization holds, THE SYSTEM SHALL refuse with `409 ORGANISATION_ROLE_IN_USE` listing those organizations and change nothing; WHEN the role is held by none of them, THE SYSTEM SHALL set it `retired`, stop offering it on the forms and filters, and keep every existing assignment row; WHEN the administrator restores a retired role, THE SYSTEM SHALL make it active again under the same id, subject to EARS-3's title uniqueness.
- **EARS-5** _(realizes: US-4)_ — WHEN any public read projects an organization — the project→partners and partner→projects relationship reads and the primary partner embedded in project summaries — THE SYSTEM SHALL omit an organization whose name rule is off from that projection entirely, and SHALL return `logoUrl: null` for an organization whose logo rule is off, with the wire shapes of these reads unchanged; an organization with no logo is a complete record and its surfaces fall back to its name.
- **EARS-6** _(realizes: US-5)_ — WHEN a platform administrator publishes a draft organization («Опубликовать»), THE SYSTEM SHALL refuse with `409 PUBLISH_REQUIREMENTS_NOT_MET` and a field error on the roles when it holds no active role, and otherwise SHALL set `first_published_at` once and transition it to `published`; an edit of a published organization that would leave it with no active role SHALL be refused with the same code.
- **EARS-7** _(realizes: US-5)_ — WHEN a platform administrator retires an organization («Снять с публикации»), the admin SHALL first show the signed lifecycle-impact preview of 012 EARS-13 listing the projects that lose its display, and on confirmation THE SYSTEM SHALL set it `retired` with `deleted_at`, keep every `project_organisations` row and its history, and remove it at once from every public read and from the public count.
- **EARS-8** _(realizes: US-5)_ — WHEN a platform administrator restores a retired organization («Вернуть»), THE SYSTEM SHALL return it to `draft` through the 012 EARS-14 restore contract, keeping its fields, roles, display rules, logo and links, and it SHALL reappear on public reads and in the count only after a later publish.
- **EARS-9** _(realizes: US-6)_ — WHEN a platform administrator opens «Организации», THE SYSTEM SHALL list the organizations with the columns «Название», «Роли», «Статус», «Обновлено» on the `AdminDataList` composition, with bounded pagination and a total, a case-insensitive search by name, and filters by role and by status, each applied immediately per 012 EARS-23; a row SHALL open the organization's full-page form.
- **EARS-10** _(realizes: US-8)_ — WHEN a platform administrator creating an organization has entered a title or a website that matches a retained organization — the trimmed title case-insensitively, or the website's host without a leading `www.` — THE SYSTEM SHALL show on the form «Похожая организация уже есть: <название>» for each match with «Открыть» (the existing organization's form) and «Всё равно создать», and SHALL NOT block the save; the match SHALL cover draft, published and retired organizations.
- **EARS-11** _(realizes: US-7)_ — WHEN the forward migration that introduces the registry runs, THE SYSTEM SHALL turn every `partners` row into an `organisations` row with the same id, slug, title, logo, website, lifecycle state, `first_published_at` and version, both display rules on and no description, SHALL give each the «Инвестор» role, and SHALL keep every `project_partners` row as a `project_organisations` row with the same id, project, organization, primary flag and status; no project SHALL lose or change its organization, and the admin «Партнёры» section SHALL be replaced by «Организации», with no second list of partners anywhere.
- **EARS-12** _(realizes: US-9)_ — WHEN a caller reads `GET /v1/public/organisations/count`, THE SYSTEM SHALL return `{ count }` — the number of published organizations of any role, including those whose display rules are off — computed from the registry at the moment of the request, with no stored or hand-entered figure; publishing, retiring or restoring an organization SHALL change the next answer. The Academy storefront is its only storefront consumer; the doctor storefront reads no organization data.
- **EARS-13** _(realizes: US-10)_ — THE SYSTEM SHALL serve the «Организации» and «Роли организаций» sections, and every organization and organization-role admin endpoint, only to a `platform_admin` in the dedicated admin session with the second factor (011, 047), with CSRF, and SHALL refuse anyone else server-side; every mutating endpoint SHALL require a canonical UUID idempotency key and the current `If-Match` version per 012 EARS-17, and every change to an organization, its roles, its display rules or a role SHALL be recorded in the 010 change audit under the acting administrator.
- **EARS-14** _(realizes: US-11)_ — WHILE the admin viewport is a phone or a narrow screen, THE SYSTEM SHALL keep the organization list, the organization form, the role list and their dialogs usable without horizontal scrolling of the page, and every one of these screens SHALL pass the platform's `playwright-axe` gate.

## Invariants

- One organization is one `organisations` row whatever its roles; there is no second list of partners (EARS-1, EARS-11).
- Every absorbed partner keeps its id, slug, lifecycle state and every project link (EARS-11).
- A published organization holds at least one active role (EARS-6).
- A role held by a draft or published organization is active (EARS-4).
- No public projection carries the name of an organization whose name rule is off, or the logo of one whose logo rule is off (EARS-5).
- Only published organizations appear on a public read or in the count; the count includes organizations whose display rules are off (EARS-5, EARS-7, EARS-12).
- Restore never publishes (EARS-8).
- Every registry write is made by a `platform_admin` with the second factor and leaves one 010 audit row (EARS-13).

## Verification

| #    | Type                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-1  | Vitest — `packages/db`   | The forward migration on a fixture of published, draft and retired partners with primary and non-primary project links yields organisations with the same ids, slugs, states, versions and links, the investor role on each, both display rules on; the three seed roles exist (EARS-3, EARS-11).                                                                                                                                                                                     |
| V-2  | Vitest e2e — `apps/api`  | Create / edit with every field and media path; title and website bounds refused with field errors and no row; roles set saved and replaced; an unknown or retired role refused unless already held; the held retired role kept (EARS-1, EARS-2).                                                                                                                                                                                                                                      |
| V-3  | Vitest e2e — `apps/api`  | Role create, rename, duplicate active title refused; retire of a held role refused with `ORGANISATION_ROLE_IN_USE` listing the holders, retire of an unheld role and its restore; a retired role offered by no form read (EARS-3, EARS-4).                                                                                                                                                                                                                                            |
| V-4  | Vitest e2e — `apps/api`  | Publish refused with no active role; publish sets `first_published_at` once; retire through the signed impact preview (stale token `412`), links kept; restore to draft; public reads and the count follow each transition (EARS-6, EARS-7, EARS-8, EARS-12).                                                                                                                                                                                                                         |
| V-5  | Vitest e2e — `apps/api`  | Public project→partners, partner→projects and the embedded primary partner: a name-hidden organization absent, a logo-hidden one with `logoUrl: null`, shapes unchanged; the count includes both hidden kinds and excludes drafts and retired rows (EARS-5, EARS-12).                                                                                                                                                                                                                 |
| V-6  | Vitest e2e — `apps/api`  | The similar-organisations read matches by case-insensitive title and by website host across draft, published and retired rows, and the create still succeeds with a match (EARS-10).                                                                                                                                                                                                                                                                                                  |
| V-7  | Vitest e2e — `apps/api`  | Every organization and role admin endpoint refuses a non-`platform_admin` and a session without the second factor; missing idempotency key and stale `If-Match` refused; each write leaves one 010 audit row with the actor (EARS-13).                                                                                                                                                                                                                                                |
| V-8  | Playwright / E2E — admin | A platform administrator opens «Организации», sees the absorbed partners with «Инвестор»; creates an organization with two roles, gets the duplicate hint on a matching name and continues; is refused publish without a role, then publishes; adds a role in «Роли организаций» and sees it on the form; is refused retiring a held role; retires an organization through the impact dialog and restores it to draft; searches and filters the list (EARS-1…EARS-4, EARS-6…EARS-11). |
| V-9  | Playwright / E2E — admin | At a 390 px viewport the list, the form, the role list and the impact dialog are usable with no horizontal page scroll (EARS-14).                                                                                                                                                                                                                                                                                                                                                     |
| V-10 | axe                      | Clean `playwright-axe` runs on the organization list, the form with the duplicate hint, the role list and the impact dialog (EARS-14).                                                                                                                                                                                                                                                                                                                                                |

## Work-package map

Each Issue is a sub-issue of #1823 and ships its UI with its backend; slices and dependencies: `032-design.md` («Delivery slices»). Issue numbers are written back by `open-ears-issues`.

| EARS                                              | Issue | Work package                                                                                                   |
| ------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| EARS-1, EARS-2, EARS-3, EARS-11, EARS-13, EARS-14 | —     | **Registry and roles** — migration and seed, organization form and list chrome, role section, access and audit |
| EARS-4, EARS-6, EARS-7, EARS-8                    | —     | **Lifecycle** — role retire/restore, publish rule, retire with impact, restore                                 |
| EARS-5, EARS-12                                   | —     | **Public projections** — display rules on the partner reads, the partner count                                 |
| EARS-9, EARS-10                                   | —     | **Find and dedupe** — search, role/status filters, duplicate hint                                              |
