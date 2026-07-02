---
title: "author-ears-spec"
description: "Procedural skill (dispatch): subagent authors a 3-file SDD triplet (NNN-requirements.md + NNN-design.md + NNN-scenarios.feature) for a new feature."
name: author-ears-spec
mode: dispatch
---

# author-ears-spec

**Kind:** procedural · **Mode:** dispatch (the lead agent passes this SKILL.md content to a subagent and consumes the verdict; it does not author the spec inline).

The body below is the **subagent prompt**. The lead agent dispatches a subagent (`Task` tool in Claude Code; equivalent in Codex / Cursor) with this file's content as the system prompt plus a task-specific user message identifying the initiative.

---

## Subagent prompt

You are authoring a 3-file SDD triplet for a new feature in the DS Platform monorepo. The format is fixed by ADR-0006 §4.

### Input

- Initiative reference: `NNN-<slug>` (the feature number is the next free number under `apps/docs/content/specs/features/`).
  - **Reserve `NNN` before authoring (parallel-session race).** The next-free number read against `apps/docs/content/specs/features/` alone is not authoritative — a parallel spec-authoring session may have already claimed it on a branch that isn't merged yet. Before writing any file, confirm the chosen `NNN` is **not** already claimed by an open `feat/spec-NNN-*` branch/PR (`git ls-remote --heads origin 'refs/heads/feat/spec-*'`, `gh pr list --search 'spec-'`) or an existing parent Issue, then **reserve** the number by opening the parent Issue (or recording the reservation on the initiative Issue) **before** authoring begins. Two parallel sessions must never pick the same `NNN`.
- **The feature PRD `NNN-product.md`** (ADR-0014 — the "PRD section"): user stories with `US-N` ids + product acceptance criteria. A legacy roadmap-line / initiative description is still accepted for a spec with no PRD (e.g. backend-only infra).
- ADRs relevant to the feature's domain.

### Procedure

1. **Read sources** — PRD section + listed ADRs + any prior feature-spec in the same domain (for tone and structure precedent).
2. **Write `NNN-requirements.md`** (filename prefixed with the spec number per ADR-0006 §4):
   - **Bilingual split — PRODUCT specs only.** A **product** feature spec (one derived from a `NNN-product.md` PRD / with a user-facing surface) ships its requirements as a mirrored pair **`NNN-requirements-en.md` + `NNN-requirements-ru.md`** — both product-owner-facing, so both languages. `NNN-design.md` and `NNN-scenarios.feature` stay **EN-only** even for a product spec (engineer-facing artifacts). A **tech / backend-only infra** spec is **EN-only throughout** — a single `NNN-requirements.md`, no `-ru` mirror. Worked precedent: spec 003 (`003-requirements-en.md` / `003-requirements-ru.md`, with `003-design.md` + `003-scenarios.feature` EN-only). The `-en`/`-ru` requirements must stay semantically equivalent; the `spec-link` guard accepts either `NNN-requirements.md` or `NNN-requirements-en.md`.
   - Frontmatter: `tracker:` (GitHub Milestone URL placeholder if the milestone isn't created yet), `status: Draft`, **`surface:`** (required — see below).
   - Sections: Outcomes / Scope / Constraints / Prior decisions (cite ADRs) / Event Model (Commands / Events / Read models / Policies) / **EARS requirements** / Invariants / Verification.
   - **EARS numbering: flat (`EARS-1`, `EARS-2`, …) per ADR-0006 §4** (closing G11 finding F-5). Use nested `N.M` **only** when a single handler genuinely carries multiple shall-clauses (rare).
   - **Traceability `realizes:`** — when the spec derives from a `NNN-product.md`, each EARS clause carries a `realizes: US-N` backlink to the PRD story it formalizes (ADR-0014 §2), giving the trace `US-N → EARS-N → test`. Omit for a legacy spec with no PRD.
   - **Frontmatter `surface:` (required): `backend-only` | `user-facing`.** Declares whether the feature ships a user-facing deliverable (a screen in portal / admin / promo / mobile). The classification is **explicit and review-checked** — a silent backend-only default is exactly the **F-22** failure (003 shipped auth login as backend-only EARS-handlers, leaving the portal forms unowned and no flow completable in a browser). There is no third `mixed` value — a feature with both backend and UI work is `user-facing` (any UI deliverable makes it so) and fires the four user-facing rules below. UI is **not** required of every spec — a genuine backend-only spec (internal API, webhook, pipeline, reconcile sweep) declares `backend-only` and the user-facing rules are N/A.
     - **The explicit classification is the primary control** — `surface:` is set by the author and confirmed at spec-review against the feature's actual outcomes/scope, not inferred. The author and reviewer ask "does this feature put a screen in front of a user?" and answer it deliberately.
     - **Anti-hide guard** (heuristic backstop, not the primary control). If any EARS _trigger_ references a UI surface (form, page, button, link — e.g. "when a visitor submits the registration form…"), `surface: backend-only` is **invalid → return error**. A UI in the trigger means a user-facing deliverable exists; it cannot be classified away. This is necessary but **not sufficient**: an author could phrase every EARS purely server-side and omit the UI from the trigger text, evading the scan — so spec-review must still confirm the `surface:` value matches the Outcomes/Scope, never rely on the trigger scan alone.
   - **User-journey completeness — `surface: user-facing` only** (N/A for `backend-only`). For every EARS whose trigger references a UI surface, the spec must EITHER carry a requirement that owns the UI behaviour **and** its wiring to the backend, OR name the deferral explicitly in Scope → Out of scope (e.g. "portal wiring → F7"). A UI surface that appears only in a trigger, with no owning requirement and no named deferral, is a defect → **return error**.
   - **Verification matrix — `surface: user-facing` only** (N/A for `backend-only`). The matrix must carry ≥1 browser / E2E row (Playwright / playwright-bdd) exercising the user journey end-to-end. "Translated once the runner exists / out of scope here" is acceptable ONLY when it points to a named, tracked out-of-scope Issue — never as a bare footnote (003's `all → Gherkin` row was a bare footnote, and that is the F-22 amplifier). Absence of a browser/E2E row given a user-facing deliverable → **return error**. For `backend-only`, Vitest e2e against `apps/api` plus unit tests is complete coverage — do **not** add a browser row.
3. **Write `NNN-design.md`** — Mermaid sequence diagrams of cascades, state diagrams of lifecycles, ER fragments.
4. **Write `NNN-scenarios.feature`** — Gherkin, happy path + 2–3 failure branches.
5. **Issue body** — when the lead agent opens the parent Issue, the body must explicitly list the scope of any **stub packages** being graduated (e.g., "this feature graduates `packages/foo` from stub to first concrete export"). Closing G11 finding F-20. Issue creation itself is handled by [`open-ears-issues`](../open-ears-issues/SKILL.md), which **must** wire the native sub-issue hierarchy and blocked-by graph (its step 4) — not just record dependencies as prose.
6. **Commit the triplet** to a feature branch `feat/spec-NNN-<slug>`.
7. **Sequence the spec PR and the child Issues (ordering B — the contract).** After the subagent returns, the lead agent ships the triplet as a **single docs-PR** off `feat/spec-NNN-<slug>`. On that **same branch, before the PR merges**, run [`open-ears-issues`](../open-ears-issues/SKILL.md): open the parent + child Issues, wire the native graph (its step 4), and write the numbers back into the `issues:` frontmatter of `NNN-requirements*.md`. The spec PR therefore carries the triplet **and** the `issues:` refs together, and merges on a Mode (a) verdict + green CI. Per-iteration **code** PRs begin only **after** the spec is on `main` — the `spec-link` guard is **BLOCK** (AGENTS.md §5 / ADR-0007 §2.6), so a code PR cannot link to a spec that is not yet merged. Ordering A (merge the bare spec first, open Issues afterwards) is **rejected**: `open-ears-issues` writes the `issues:` block on the branch, so it must run pre-merge — a post-merge run would strand that write-back in a second PR. Worked precedent: 003 (`issues: [81…90]` landed inside spec PR #91).

### Output

- Triplet committed.
- Subagent returns a one-paragraph verdict: spec authored, EARS count, ADRs cited, stub-packages-graduated list.

### Failure mode

- EARS numbering inconsistent with the flat convention — return an error and let the lead agent decide whether to fix or accept (nested `N.M` is allowed but must be justified).
- Triplet missing a file — return error.
- A **product** spec whose requirements shipped monolingual (a lone `NNN-requirements.md` / `NNN-requirements-en.md` with no `NNN-requirements-ru.md` mirror) — return error (product requirements are product-owner-facing → EN+RU mandatory). Conversely, a `-ru` mirror added to a tech / backend-only spec is also wrong — return error.
- `NNN` collides with an already-claimed number (open `feat/spec-NNN-*` branch/PR or existing parent Issue) and was not reserved before authoring — return error; the lead agent re-picks the next genuinely free number.
- `surface:` frontmatter missing or not one of `backend-only` / `user-facing` — return error (F-22).
- `surface: backend-only` while an EARS trigger references a UI surface (anti-hide guard) — return error (F-22).
- `surface: user-facing` with a UI-triggered EARS that has no owning requirement and no named out-of-scope deferral — return error (F-22).
- `surface: user-facing` with no browser/E2E row in the Verification matrix (and no named, tracked deferral Issue) — return error (F-22).
