---
title: "Feature 032 — Organization registry and its admin (PRD, slice 1)"
description: "Product requirements for slice 1 of feature 032: one admin-managed registry of the organizations Doctor.School works with — investors, clinical bases, educational licensees — where one organization carries a flexible set of roles. The registry is the single source every later surface reads (project partner attribution, the Academy home partner count, and later the investor leaderboard, the marketplace and the investor cabinet). Feature 032 of the two-site IA epic; source of the 032 slice-1 EARS triplet (ADR-0014)."
slug: two-site-ia-032-organization-registry-product
epic: ../../product/two-site-ia/brief.md
status: Draft
surface: user-facing
lang: en
---

> **EN (this)** · **RU:** [`032-product-ru.md`](./032-product-ru.md)

> Epic: [Doctor.School relaunch — two-site IA — product brief](../../product/two-site-ia/brief.md) · Scope of record: [functional map](../../product/two-site-ia/functional-map-ru.md) §B row 032, slice 1 · Domain decision: ADR-0016 §2 · Tracker: [#1799](https://github.com/doctor-school/ds-platform/issues/1799) «Discovery decisions» (cascade item 1, owner-approved 2026-10-28).

## Feature summary

Doctor.School works with organizations, not just people: pharma companies and medical-equipment manufacturers that invest in doctors' attention, clinics and the institutes on their base that host practical training, and educational organizations that may issue certificates under contract. Today the platform knows only a thin "partner" record — a name, a logo and a site attached to projects as a sponsor. Nothing says what an organization _is_ to Doctor.School, one organization cannot be both a clinic and a licensee, and the Academy home has no honest source for the number of partners it states in its first screen.

Feature 032 is delivered in two slices. **Slice 1 (this PRD)** builds the **organization registry and its admin**: an operator registers an organization once, gives it one or several **roles** from an open, extensible set (starting with _investor_, _clinical base_, _educational licensee_ — Q-40), records what of it may be shown publicly, and publishes or retires it. The partner records that already exist on the platform become organizations of this registry rather than a second list next to it. Two consumers read the registry in this wave: the **project admin and project cards** of feature 030 slice 1 (which organization stands behind a project) and the **Academy home** of feature 029 (the partner count in the first screen is computed from the registry, never typed in by hand — the owner's no-temporary-crutches principle, #1799).

The public **investor leaderboard and the investor page** are the late slice, because the leaderboard ranks by attention share and investment volume, which only the accruals ledger (036) can supply. The folder slug `032-investors-leaderboard` predates this slicing: slice 1 is the organization registry, and the leaderboard is the late slice.

## User stories

- **US-1** — As an **operator**, I register an organization once — its name, logo, website and a short description — and every surface of the platform that names it uses that one record.
- **US-2** — As an **operator**, I give one organization **several roles at once** (for example a clinic that is both a clinical base and an educational licensee), so the registry describes how we actually work with it instead of forcing a single label.
- **US-3** — As an **operator**, I maintain the **list of organization roles** myself — add a new role when a new kind of cooperation appears, retire one nobody uses — without waiting for a development cycle. Q-40 fixes that the role set is open and extensible; platform administrators edit it from the admin, per the owner's «админку для ведения справочников» principle. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-4** — As an **operator**, I record per organization **what may be shown publicly** — its name, its logo — because each partner's compliance rules differ (REQ-70), and the site must follow them without anyone re-checking every page.
- **US-5** — As an **operator**, I keep an organization in **draft** until its record is complete, **publish** it, and **retire** it when cooperation ends; a retired organization disappears from everything public and from every count, and I can restore it later without re-entering it.
- **US-6** — As an **operator**, I find an organization in the registry by name and narrow the list by role, so a growing registry stays manageable.
- **US-7** — As an **operator**, the sponsor partners already entered on the platform appear in the registry as organizations with the _investor_ role, with their projects still attached — nothing is re-typed and no project loses its partner. Q-40 reduces «partner» as the holder of money to «investor», so every existing record moves with that role; where one is in fact a clinic or an institute, I correct its roles after the move. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **US-8** — As an **operator**, I am warned when I start registering an organization that looks like one already in the registry (same name or same website), so the registry does not split one company into two. _(agent-proposed — UNCONFIRMED.)_
- **US-9** — As a **visitor of the Academy home**, the number of partners I see in the first screen is the real number of organizations Doctor.School works with today, so the first claim the Academy makes about itself is true.
- **US-10** — As the **product owner**, I know that only platform administrators, signed in to the admin with their second factor, can create or change organizations, and that every change is kept in the edit history, so the registry that feeds public numbers and, later, money reports is trustworthy.
- **US-11** — As an **operator on a phone or a narrow screen**, the registry list and the organization form remain usable.

## Flows

**Register an organization (US-1, US-2, US-4, US-8):**

1. A platform administrator opens the organization registry in the admin and starts a new organization.
2. They enter the name, an optional logo, an optional website and a short description, and tick one or several roles.
3. If the name or the website matches an organization already in the registry, the admin says so and offers to open the existing one; the operator may still continue. _(agent-proposed — UNCONFIRMED.)_
4. They set what may be shown publicly — the name, the logo.
5. They save: the organization exists as a draft — not visible anywhere public and not counted.
6. They publish: the organization is now counted and can be attached to projects.

**Maintain roles (US-3):**

1. The administrator opens the list of organization roles, sees the starting three (investor, clinical base, educational licensee).
2. They add a role with its name; it becomes available on every organization form at once.
3. A role still held by any organization cannot be removed until it is taken off them; a retired role disappears from the forms but keeps its history. _(agent-proposed — UNCONFIRMED.)_

**Retire and restore (US-5):**

1. The administrator retires an organization → it leaves every public surface and every count at once; projects keep the history of the link but no longer show the organization.
2. Restoring it returns it to draft; it reappears only after a deliberate publish. _(agent-proposed — UNCONFIRMED: mirrors the restore-to-draft behavior the platform already uses for projects and partners.)_

**Partner count on the Academy home (US-9):**

1. A visitor opens `academy.doctor.school`.
2. The first-screen line «N партнёров» shows the count the registry gives at that moment — all published organizations, whatever their roles, including those whose compliance forbids public display (the number identifies no one). _(lead decision 2026-10-28; owner sees it at Stage A)_
3. When an operator publishes or retires an organization, the number on the home follows without anyone editing the home.

**Branches:**

- **An organization without a logo** → it is still a complete record; surfaces that show it fall back to its name.
- **An organization whose compliance forbids showing its name or logo** → it is still in the registry and can be attached to projects; it is counted in the home partner figure, while public surfaces do not display its name or logo. _(lead decision 2026-10-28; owner sees it at Stage A)_
- **An organization with no role ticked** → cannot be published: an organization Doctor.School works with always works with it in some capacity. _(agent-proposed — UNCONFIRMED.)_

## Product acceptance criteria

- There is **one organization registry** on the platform; the existing partner records are part of it, not a parallel list, and every project that had a partner still has that organization attached (ADR-0016 §9 «absorb, never rewrite»).
- An organization carries a **set of roles**, not one type: one organization may hold any combination of the roles in the list, and the list of roles is **open** — adding or retiring a role changes no page and no other organization. The starting roles are exactly _investor_, _clinical base_, _educational licensee_; «employer» is not a role (Q-38), and the words «спонсор» / «рекламодатель» are never used for the investor role (Q-40).
- An organization has a **draft → published → retired** life, with restore back to draft. Only published organizations appear on any public surface or in any public count.
- **What may be shown publicly** is recorded per organization and is respected by every public surface that shows organizations, starting with project cards (030).
- The **Academy home partner count is computed from the registry** at request time as the number of all published organizations of any role, including those whose public display is forbidden; no one types or edits that number, and publishing or retiring an organization changes it.
- Only **platform administrators** in an admin session with the second factor (existing staff access 047, admin 2FA 011) can create, edit, publish, retire or restore organizations and roles; every such change is recorded in the platform's edit history (010).
- The organization registry is one platform registry for every storefront (ADR-0016 §8): the leaderboard and the organization cabinets are on the **Academy** and in the admin, and the doctor storefront reads the same registry wherever it shows an organization — the partner attribution at doctor registration — never a copy of its own; the doctor sees no leaderboard and no backstage (REQ-51).
- The registry list and the form work on a narrow screen and pass the platform's accessibility gate.

## Out of scope

- **The public investor catalog-leaderboard and the public investor page** (REQ-129, REQ-63, REQ-70 logos on those pages) — late slice of 032, `blocked_by` **036** (ranking by attention share and investment volume needs the accruals ledger).
- **People inside organizations** — membership as a revocable link, an organization's own admin, medical representatives with personal attribution (OWD-8, REQ-88, REQ-114) — delivered with the investor cabinet **035** (`blocked_by` **036**, **037**) and the role model **039**; slice 1 models organizations only.
- **The annual exclusive contract as a public fact** (REQ-90) — late slice of 032 with the marketplace 034.
- **The «Продукция» section of an investor page** (REQ-130) — deferred by the map; nothing of it in slice 1.
- **Clinic network as a public map or catalog** (REQ-19) — slice 1 lets a clinic exist as an organization with the clinical-base role; showing the network publicly is a later surface.
- **Event-level partners and sponsorship levels** (REQ-140) — a relation of an event to an organization, owned by 030's later slice / the event features, not by the registry.
- **The project ↔ organization link itself** — managed in the project admin of 030 slice 1; 032 supplies the organizations it picks from.
- **A clinic or partner cabinet** — NG-6.
- **Removing the 045 education-index demo** ([#2367](https://github.com/doctor-school/ds-platform/issues/2367)) — belongs to the late (leaderboard) slice of 032, which replaces it; slice 1 leaves it in place.

## Open questions

_None for slice 1._ The partner-count rule, counting organizations that forbid public display, who extends the role list and the existing records' role are recorded lead decisions above; the owner sees them at Stage A.

## Approved mockup

_Empty — Stage A pending._ The admin registry and form have no canvas yet; the only public trace of slice 1 is the partner line in the hero of `design-source/academy-home.dc.html` («14 партнёров · прозрачная модель»), which belongs to feature 029.
