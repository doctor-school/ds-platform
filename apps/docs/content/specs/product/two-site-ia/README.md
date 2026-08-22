---
title: "Epic «Doctor.School relaunch — two-site IA» — discovery input package"
description: "Entry point of the epic relaunching the platform as two storefronts: doctor.school (the doctor-facing storefront) and academy.doctor.school (the backstage: experts, investors). The discovery package (REQ-1…142, OWD-1…13, glossary, expert ↔ account decision, status, review synthesis), the screens map and the clickable wireframe R4 — moved here as the master copy from the bbm repo. What must be born from it next: two-storefront architecture ADR → canvas reconciliation against the wireframe → functional map and feature slicing per ADR-0014 → build."
slug: two-site-ia-readme
milestone: https://github.com/doctor-school/ds-platform/milestone/13
parent_issue: https://github.com/doctor-school/ds-platform/issues/1430
status: "Discovery closed (DSP-252) · wireframe R4 owner-approved (DSP-251) · stage 1 (ADR) not started"
lang: en
---

> **EN (this)** · **RU:** [`README-ru.md`](./README-ru.md) — the moved documents themselves are **RU-only source material** (no EN mirrors by design; see the language note below).

> **Owner decision (Product Lead), 2026-08-22 — "go" to relaunch the platform as two storefronts:** `doctor.school` — the doctor-facing storefront; `academy.doctor.school` — the backstage (experts, investors / partners). Epic tracker: [#1430](https://github.com/doctor-school/ds-platform/issues/1430), milestone ["Doctor.School relaunch — two-site IA"](https://github.com/doctor-school/ds-platform/milestone/13).

## What this package is

The epic's input material — the output of the discovery sessions 2026-08-18 → 2026-08-22 (Plane `doctor-school`: DSP-244 → DSP-249 → DSP-252 — discovery; DSP-251 — wireframe). It is **not a spec**: a register of requirements and decisions, a glossary, a status document, and the owner-approved clickable wireframe. The epic product brief (`brief.md` / `brief-ru.md`), the feature PRDs and the EARS triplets are born from it at stage 3 (below) through the standard ADR-0014 pipeline.

**Origin.** The `bbm` repo (BBM, the holding), commit `38487fd`:

- `outputs/2026-08-18-discovery-ds-academy-vs-doctors/` — the discovery package;
- `outputs/2026-08-20-ds-wireframe/` — the wireframe and the screens map.

The master copy now lives here (Doctor.School documentation lives in `ds-platform`); `bbm` keeps stub pointers. Content was moved **verbatim** — only file names changed (the `-ru` convention for RU documents), plus a frontmatter block and a one-line provenance note at the top of each file. Paths like `outputs/…` and the former file names inside the texts are historical; the mapping is in the table below.

## Contents

| Here                                                       | Was in `bbm`                         | What it is                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`requirements-ru.md`](./requirements-ru.md)               | `…discovery…/requirements.md`        | Register **REQ-1…142**, NG, CON, Q. **REQ numbering preserved** — the wireframe is annotated by it                                                                                                                                                               |
| [`one-way-doors-ru.md`](./one-way-doors-ru.md)             | `…discovery…/one-way-doors.md`       | Irreversible decisions **OWD-1…13**                                                                                                                                                                                                                              |
| [`discovery-glossary-ru.md`](./discovery-glossary-ru.md)   | `…discovery…/glossary.md`            | Working RU discovery glossary. **Not split** into the repo's file-per-term glossary (`apps/docs/content/product/glossary/`) — that integration is a separate step                                                                                                |
| [`brainstorm-q-27-ru.md`](./brainstorm-q-27-ru.md)         | `…discovery…/brainstorm-Q-27.md`     | The expert ↔ account decision (REQ-106): "This is me" button → manual admin confirmation                                                                                                                                                                         |
| [`next-steps-ru.md`](./next-steps-ru.md)                   | `…discovery…/next-steps.md`          | Discovery status / agenda; input for the Commit lane (§7)                                                                                                                                                                                                        |
| [`review-r1-synthesis-ru.md`](./review-r1-synthesis-ru.md) | `…discovery…/review-R1-synthesis.md` | Synthesis of two independent reviews with a decision per finding                                                                                                                                                                                                 |
| [`screens-ru.md`](./screens-ru.md)                         | `…wireframe/screens.md`              | Wireframe screens ↔ REQ map, revision history R2/R3/R4, CJM rationale                                                                                                                                                                                            |
| [`wireframe.html`](./wireframe.html)                       | `…wireframe/wireframe.html`          | Clickable wireframe of both sites, **R4** (owner-approved 2026-08-22). Self-contained HTML with no external dependencies — open locally from the repo; the docs site does not render it. A structure mock-up, **not a design** and not a `design-source/` canvas |

Not moved (stay in `bbm`, referenced in the texts as sources): `interview-log.md`, `transcript-digest*.md`, `review-brief.md`, `review-result.md`, `review-R1-claude-agent.md`, the early `wireframe.html` of the 18.08 session. **Source of the Academy copy** — `bbm`: `outputs/2026-07-24-academy-ds-content-brief.md` (external source, not moved).

## Status

- Discovery **closed** — DSP-252 (2026-08-19): every Q and OWD is closed or routed to a Commit-lane ADR; revision [R2] from two independent reviews merged in.
- Wireframe **R4 owner-approved** — DSP-251 (2026-08-22): the team's R3 edits (REQ-116…142) and the owner's R4 edits (doctor events feed, Academy event page, evolutionary purpose verbatim) are in the wireframe and in `screens-ru.md`.
- Stage 1 (below) **not started**.

## What must be born from the package — stage order (owner decision, do not reorder)

1. **Architecture review for two storefronts — ADR.** Topology: one backend / one DB is the premise — **verify it**. Fitness of the current stack for the doctor storefront: module path with video, points economy, document verification, НМО accounting, offline events, a mobile app on the same backend. Core data model: specialties with adjacency, school / course / module, points and accruals, expert ↔ account, investor / unit, clinical base, verification. Placement — `apps/docs/content/adr/NNNN-<slug>.md` (+ `-design.md`), per `.claude/rules/repo-conventions.md` → ADRs & specs.
2. **Design: reconcile the existing `design-source/` canvases with wireframe R4** — what stays, what is reworked, what is drawn from scratch. Canvases are drawn by the owner (Product Lead); the reconciliation result is recorded here, in the epic folder.
3. **Functional map screen → REQ → feature** (based on `screens-ru.md`) and **feature slicing through the standard ADR-0014 pipeline**: `do-product-discovery` → `author-product-spec` (epic `brief.md` / `brief-ru.md` + `NNN-product.md` per feature) → `author-ears-spec` → `open-ears-issues`.
4. **Build** — iterations via `do-feature-iteration`, child Issues under #1430.

**Owner decision on in-flight features:** the Academy home page (**feature 013**, `specs/features/013-academy-home/`) is **not completed in its current edition** until the structure review (stages 1–2); **012** (`012-content-taxonomy`) and **014** (`014-event-recordings`) continue as they are. The [`academy-public`](../academy-public/brief.md) epic remains the reference for 012/014.

## Language note

The seven moved documents are RU-only by design: they are owner-facing discovery **source material**, not product-facing specs, so the ADR-0014 EN+RU mirror rule (which applies to `brief.md` / `NNN-product.md`) does not apply to them; each carries `lang: ru` and a `source:` provenance field in its frontmatter. Terminology across the package follows [`discovery-glossary-ru.md`](./discovery-glossary-ru.md): roles are **author**, **co-author**, **investor** (= **partner**), **participant**; "creator", "contributor", "sponsor", "advertiser" are not used. The fork "smart-contract investor vs Academy audience" (REQ-134) is a `TODO(Product Lead)`, see `screens-ru.md` → R3.
