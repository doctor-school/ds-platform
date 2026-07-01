---
title: "ADR-0014 — Product Design & Delivery Lifecycle for DS Platform [EN]"
description: "A two-tier product layer (thin epic brief + per-feature PRD) sits above the existing EARS triplet; discovery mines the legacy Bubble system and co-evolves PRD stories with a Claude Design mockup before EARS formalizes them; the repo design-system stays token/component SoT and Claude Design is a fed design surface. The dual-track lifecycle is executed by three new skills that plug into the existing run-task-lifecycle machinery."
lang: en
---

> **EN-only** — process/tech ADR, no RU companion (consistent with ADR-0013; RU is reserved for product specs, memory `feedback_product_feature_spec_bilingual`).

# ADR-0014 — Product Design & Delivery Lifecycle

**Date:** 2026-07-01
**Status:** Accepted
**Related to:** GitHub #418 (this regiment); first application — the **Webinars** epic (events showcase + calendar + webinar room in the LK)
**Brainstorm / design source:** interactive brainstorm session 2026-07-01 (dual-track agile + spec-driven development + Anthropic skill-authoring + ADR practice); the executable mechanics live in the three skills this ADR introduces
**Inherits:** ADR-0006 (documentation & SSOT — EARS numbering §4, the SDD triplet), ADR-0007 (AI stack — the verdict-gated orchestrated iteration cycle §2.4), ADR-0013 (design-token SoT + block-adoption methodology), ADR-0004 (frontend stack), AGENTS.md §3 (work protocol) + §6 (F-22 vertical slices)

---

## Context

Phase 0 shipped the engineering **floor** — auth (feature 003), the design-system foundation (#231, ADR-0013), and the showcase (#340). Delivery of a feature is a solved, gated pipeline: an EARS triplet (`NNN-requirements.md` / `NNN-design.md` / `NNN-scenarios.feature`) → one Issue per EARS-handler → `do-feature-iteration` (RED→GREEN→REFACTOR + block adoption + Mode-a review + merge), all orchestrated by `run-task-lifecycle`.

The platform now pivots to **product features**, beginning with the Webinars epic. Every prior feature-spec (001/002/003) was infrastructure or auth — authored directly from an ADR or roadmap line. There is **no upstream product-design layer**: nothing captures *what a user needs and why* before EARS captures *what the system shall do*. `author-ears-spec` already names a "PRD section" as its input, but that artifact has never existed. Three gaps follow:

1. **No product intent artifact.** Product decisions (jobs-to-be-done, user stories, information architecture, flows, scope) are settled implicitly by the lead, on best-architecture grounds — exactly the class of decision AGENTS.md §6 says is the *product owner's*, not the lead's.
2. **No screen-composition design step.** The **element-class** design cycle exists — the design constitution + `research-ui-element` + `build-ui-from-design-system` settle what each button/field/card is, owner-approved and encoded. But nothing designs and approves how those classes are *composed into a whole surface* (an events showcase, a calendar, a webinar room) before EARS references concrete UI states — that composition is settled mid-implementation today, forcing the layout to be re-litigated against an already-built PR (the #237 design-approval inversion, one altitude up).
3. **No legacy-mining path.** A working prior system exists — the Doctor.School **Bubble** app (`doctor-school-bubble-app`: entities, `directual` data, screen exports). It is a functional reference to mine (domain model + workflows), never to reproduce. No procedure routes that knowledge into a spec.

This ADR records the decision to add a **two-tier product layer** above the EARS triplet and a **dual-track discovery→delivery lifecycle** that produces it, executed by three new skills that plug into — and do not re-implement — the existing lifecycle machinery. It is grounded in three converging bodies of practice: **dual-track agile** (discovery and delivery as parallel tracks; the validated prototype is the spec for delivery), **spec-driven development** (GitHub Spec Kit's layered `spec → plan → tasks → code`, where the PRD is the source that *generates* implementation), and **design-system SoT** practice (code/Git is the token source of truth; a design tool consumes from it).

---

## Decision

### 1. A two-tier product layer above the EARS triplet

The product intent lives in its own layer, above the existing engineering triplet, split across two tiers calibrated to scope (the modern practice narrows a PRD from "the whole product" to a single feature; a thin epic doc carries only the cross-cutting picture):

- **Epic tier — a thin `brief.md`** (`apps/docs/content/specs/product/<epic>/brief.md`): the problem area, jobs-to-be-done, cross-cutting information architecture (how the epic's surfaces compose into one LK), the feature decomposition, and success metrics. Deliberately short (bullets, not all stories). One brief per epic; the epic maps to a **Milestone**.
- **Feature tier — a per-feature `NNN-product.md`** (co-located inside the feature-spec folder, `specs/features/NNN-<slug>/`): the detailed PRD for one feature — user stories, flows, and product-level acceptance criteria. Depth lives here so the epic brief never bloats.

The layer is **A, scale-calibrated**: a full `NNN-product.md` for a feature inside a product epic; for a small standalone feature the PRD collapses to a half-page brief (the practice's "combine when small / separate as it grows"). The mapping onto existing machinery is exact and introduces nothing new: **Milestone = epic (brief) · feature-spec = feature (PRD + triplet) · EARS-issue = story.**

### 2. The PRD is the source of EARS, never its duplicate

`NNN-product.md` answers *what the user sees and why* (product language, outcome-oriented). `NNN-requirements.md` (EARS) answers *what the system shall do and how it is verified* (testable shall-clauses, the TDD anchor). They are two altitudes of one requirement, not two copies: a PRD story ("a doctor sees upcoming webinars and registers in one tap", `US-3`) is restated as a precise EARS clause ("when the user taps Register on an open event, the system shall create an enrollment and show confirmation"). This is the purpose EARS was designed for — disambiguating natural-language intent into verifiable form. **EARS is unchanged and stays exactly where it is**; the only addition is a `realizes: US-N` backlink on each EARS clause, giving an unbroken trace **brief → story → EARS → test → Issue → PR**.

### 3. Dual-track discovery→delivery sequencing

Work runs on two tracks. The handoff between them is a hard gate: a feature enters delivery only when **both** a validated design mockup **and** the product acceptance criteria are ready (the dual-track contract — the prototype is the spec for delivery).

- **Discovery track.** (a) **Legacy-mine** the Bubble app for the epic — extract the domain model (entities + attributes + inferred workflows) and screen flows into the epic `brief.md`; this is the foundational first step, *look-and-take-the-domain, never reproduce the UI*. (b) Author the `brief.md`, then the feature `NNN-product.md`. (c) The PRD's stories and draft acceptance criteria **co-evolve** with a **Claude Design mockup** — the mockup sharpens the criteria, the criteria constrain the mockup.
- **Delivery track.** At the handoff, `author-ears-spec` formalizes the draft criteria into EARS, referencing the approved mockup; then `NNN-design.md`, TDD, and the build proceed through `do-feature-iteration` as they do today.

Discovery is a **loop, not a one-way pipeline**: mining and mockup co-evolution can invalidate the `brief.md` feature decomposition. `brief.md` (and the epic Milestone that mirrors it) is revisable throughout discovery, and a changed decomposition re-flows into the affected feature-PRDs before the handoff.

A genuine `surface: backend-only` feature (internal API, webhook, pipeline) **skips the design step** — there is no mockup, and `author-ears-spec` runs from the PRD directly. A UI surface in any EARS trigger forbids `backend-only` (the existing F-22 anti-hide guard).

### 4. Design in Claude Design — repo stays SoT, the canvas is fed

Per ADR-0013, `packages/design-system` (DTCG tokens → Style Dictionary; primitives; blocks) is the **single source of truth** and remains so. **Claude Design** (the `DesignSync` tool + `/design-sync`) is a **consuming design surface**, not a second authority — matching design-system practice ("Git is the source of truth; a design tool consumes from it; a change flows back as a PR"):

- The repo's tokens + primitives + blocks are **pushed up** to a claude.ai design-system project ("DS Platform") as preview cards, so new screens are composed from **real** components.
- A **missing primitive** surfaced during design is **built in `@ds/design-system` + showcase first** (its own tracked delivery mini-iteration — AGENTS.md §6 "build the prerequisite first, no untracked seam"), then pushed up. The repo always wins; the canvas never originates a component that bypasses the repo.
- The showcase and Claude Design are complementary, not duplicative: **showcase** is the local live-rendered verification of *built* components; **Claude Design** is the cloud canvas for exploring *new* screens. One component set, two surfaces, repo feeds both.

The approved mockup is the **screen-composition Stage-A artifact** (§5), recorded in `NNN-product.md`. It composes on top of — and reuses — the existing **element-class** design-system-first cycle (the design constitution + `research-ui-element` + `build-ui-from-design-system`), never a parallel design authority.

### 5. Skill topology — three new skills plugging into the existing lifecycle

The lifecycle is executed by skills that follow the catalog pattern and Anthropic's progressive-disclosure guidance (metadata = when to load; body = how; concise, single-purpose). The three new skills **reuse, and do not re-implement,** the existing machinery:

- **`do-product-discovery`** (orchestration, inline) — the entry point for the new task kind **`product-discovery`**. It slots into **`run-task-lifecycle` step 2** exactly as `do-feature-iteration` does; it invokes `superpowers:brainstorming` for the product exploration, legacy-mines Bubble, and drives `brief.md` + `NNN-product.md` + the mockup to the discovery→delivery handoff. It does **not** re-own Issue creation, branching, review, or merge (`run-task-lifecycle` owns those).
- **`author-product-spec`** (procedural, dispatch — mirrors `author-ears-spec`) — the format and recipe for `brief.md` + `NNN-product.md`. It owns: the **RU-mirror rule** — the product-owner-facing PRD artifacts (`brief.md`, `NNN-product.md`) carry an RU mirror, consistent with the *product-facing-only* principle of memory `feedback_product_feature_spec_bilingual` (which mirrors only product-facing artifacts and keeps technical ones EN); the **`US-N` story-id space and its stability rule** (where ids are minted and what a `realizes:` backlink does when a story is split or renumbered); the `realizes:` traceability contract; and the collapse-to-brief rule for small features. Its output **is** the "PRD section" `author-ears-spec` already names as input.
- **`author-design-mockup`** (procedural) — the Claude Design / DesignSync macro at the **screen-composition** altitude: compose a surface layout from real components, get the owner's layout pick, and **delegate any uncovered element class DOWN to the existing `research-ui-element` cycle** (never invent a primitive). It composes on top of the element-class cycle; it does not replace it.

**Two altitudes of design approval, not two competing gates.** The existing design-system-first cycle (`build-ui-from-design-system` + the design constitution + `research-ui-element`) owns the **element-class** Stage A — the owner's rendered-option pick per element class (button, field, card), encoded in the constitution and built into `@ds/design-system` + showcase. That cycle is **unchanged**. `author-design-mockup` adds the **screen-composition** Stage A — the owner's pick on how those covered classes are *arranged* into a surface — and delegates any uncovered element class down into the element-class cycle. A `user-facing` feature that enters delivery **without** a prior `product-discovery` simply has no screen-composition mockup; its element-class cycle (with that Stage A) still runs in-band via `build-ui-from-design-system`. Neither altitude leaves a surface ungated, and neither duplicates the other. **Stage B** (live-verify on the running stand before merge) is unchanged and mandatory at delivery.

### 6. Task-kind flow for a product epic

`product-discovery` (brief + PRD + approved mockups) → `spec-authoring` (EARS triplet per feature, via `author-ears-spec` + `open-ears-issues`) → `feature-iteration` (`do-feature-iteration` per handler). The new kind is wired by **two independent hooks**: a row in the AGENTS.md §3.1 kind→skill table (which maps kind→skill directly — it does *not* route through `run-task-lifecycle`), and a per-kind branch in `run-task-lifecycle` step 2. A `product-discovery` task produces docs (brief/PRD/mockup), not an EARS-handler set, so it rides `run-task-lifecycle`'s **generic step-1 Issue creation** (kind label, milestone, board Status) — **not** `open-ears-issues`, which is EARS-specific and belongs to the downstream `spec-authoring` step.

### 7. Form & enforcement

This ADR records the **decision**; the three skills carry the **procedure**; AGENTS.md §3.1 + `.claude/rules/repo-conventions.md` carry the **thin dispatch hooks** (kind row, two-tier product-spec location, `product:` / `realizes:` frontmatter). This is the established repo pattern (ADR-0007 §2.4 decision → `do-feature-iteration` procedure). Pre-pilot, the instruction-file edits are **inline rewrites, not amendment blocks** (AGENTS.md §6). The existing gates continue to enforce discipline unchanged: `spec-link` (BLOCK), `surface:` classification (F-22), Mode-a review, and the instruction-budget lint.

---

## Rejected alternatives

- **Fold product requirements into `NNN-requirements.md` (single artifact, "option B").** Rejected: mixing product intent with testable shall-clauses blurs ownership and bloats the file — the exact anti-pattern the PRD-vs-spec practice warns against. The two-altitude split (§2) keeps each document single-purpose.
- **One fat PRD per epic (the classic whole-product PRD).** Rejected: a single document with every feature's stories becomes unmanageable, and the practice explicitly narrows PRD scope to a feature. The two-tier split (thin brief + per-feature PRD) is the calibrated form.
- **EARS-before-design for user-facing features.** Rejected for UI-heavy work: EARS cannot reference UI states that do not yet exist, so the shall-clauses are guesses. Design and acceptance co-evolve in discovery (§3); EARS formalizes at the handoff. (Backend-only work has no design step, so the ordering is moot there.)
- **Claude Design as the primary design authority (components originate there, flow back).** Rejected: it contradicts ADR-0013's token/component SoT and design-system practice ("the design tool is not the source of truth"). The repo stays SoT; the canvas is fed (§4).
- **A new orchestration skill that re-implements Issue/branch/review/merge.** Rejected: `run-task-lifecycle` already owns the outer loop; `do-product-discovery` plugs into it as a per-kind handler. Restating that procedure would drift out of sync (the `run-task-lifecycle` failure mode).
- **An `author-design-mockup` that re-runs the element-class cycle** (re-researches covered classes, re-decides a button, or originates primitives in Claude Design). Rejected: it would duplicate the design constitution + `research-ui-element`. The skill is **screen-composition altitude only** — it composes covered classes and delegates element gaps down to `research-ui-element` (§5).

---

## Consequences

### Positive

- Product intent becomes an explicit, owner-approved artifact with an unbroken trace to code (`brief → US-N → EARS-N → test → Issue → PR`).
- The look of a user-facing surface is settled **before** implementation, on a rendered mockup — ending the #237 "approve the finished PR" design-approval inversion.
- Legacy knowledge (Bubble domain model + workflows) enters specs through a defined mining step, once per epic, without reproducing the old UI.
- The lifecycle reuses the entire delivery apparatus unchanged; the net new surface area is three skills + thin dispatch hooks.
- The design tool integration honors the token SoT — no design-vs-code drift, mockups are built from real components.

### Negative

- One more artifact tier (`brief.md` + `NNN-product.md`) per product epic — mitigated by the collapse-to-brief rule for small features and the deliberately-thin brief.
- Claude Design requires a one-time claude.ai design-project setup and an initial push of the component library.
- Discovery adds an explicit up-front phase before delivery starts on a product epic — the intended cost of not settling product/design decisions implicitly.

### Architectural qualities (metrics, not declarations)

| Quality | Metric | Target |
| --- | --- | --- |
| Traceability | EARS clauses with a `realizes: US-N` backlink (user-facing features) | 100% |
| Design-first | User-facing surfaces with a recorded owner design pick before implementation | 100% (screen-composition Stage A on the mockup + element-class Stage A via the constitution) |
| Reuse | New orchestration procedure re-implemented from `run-task-lifecycle` | 0 (plug-in only) |
| SoT integrity | Components originating in Claude Design that bypass the repo | 0 |
| Net surface area | New skills · edited existing skills · edited instruction files | 3 new · 4 skill edits · 2 instruction-file edits |

---

## Cross-references

- **ADR-0006 §4** — EARS numbering + the SDD triplet (the delivery layer this sits above).
- **ADR-0007 §2.4** — the verdict-gated orchestrated iteration cycle (decision → skill pattern reused here).
- **ADR-0013** — design-token SoT + block adoption (§4 inherits its SoT; §5 moves its Stage A upstream).
- **AGENTS.md §3.1** — task-kind dispatch table (gains the `product-discovery` row).
- **AGENTS.md §6** — F-22 vertical slices, the design-approval gate, "build the prerequisite first".
- **`.claude/rules/repo-conventions.md`** — feature-spec location + Issue conventions (gain the two-tier product-spec location + `product:` / `realizes:` traceability).
- **Skills** — `do-product-discovery`, `author-product-spec`, `author-design-mockup` (new procedure); `run-task-lifecycle`, `author-ears-spec`, `build-ui-from-design-system`, `do-feature-iteration` (edited); `research-ui-element` + the [design constitution](../design/constitution.md) (reused unchanged — the element-class cycle `author-design-mockup` composes on top of).
- **First application** — the Webinars epic (`specs/product/webinars/brief.md`, forthcoming).
