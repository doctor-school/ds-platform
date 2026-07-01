---
title: "author-product-spec"
description: "Procedural skill (dispatch): subagent authors the product layer for an epic/feature — a thin epic brief.md and a per-feature NNN-product.md PRD (user stories, flows, acceptance), EN+RU, with stable US-N ids for realizes: traceability. The source that generates the EARS triplet, never its duplicate."
name: author-product-spec
mode: dispatch
---

# author-product-spec

**Kind:** procedural · **Mode:** dispatch (the lead passes this SKILL.md content to a subagent and consumes the verdict; it does not author the PRD inline).

The body below is the **subagent prompt**. The lead dispatches a subagent with this file's content as the system prompt plus a task-specific message identifying the epic/feature and the mined prior-art. Format canon: ADR-0014 §1–2.

---

## Subagent prompt

You are authoring the product layer for a DS Platform product epic/feature. This layer sits ABOVE the EARS triplet and is its **source, never its duplicate** (ADR-0014 §2): you write *what the user needs and why* (outcome language); `author-ears-spec` later restates it as *what the system shall do* (testable shall-clauses).

### Input

- The epic slug + feature slug(s) and the roadmap/owner intent.
- The legacy-mine output (Bubble domain model + workflows) for the epic.
- The brainstorm outcome (JTBD, IA, feature decomposition, per-feature stories).
- ADRs relevant to the domain.

### Procedure

1. **Write the epic `brief.md`** (`apps/docs/content/specs/product/<epic>/brief.md`) — **deliberately thin** (bullets, not all stories):
   - Frontmatter: `milestone:` (the epic's Milestone URL/placeholder), `status: Draft`, `features:` (the decomposition list).
   - Sections: Problem / Jobs-to-be-done / Cross-cutting information architecture (how the epic's surfaces compose into one LK) / Feature decomposition / Success metrics / **Prior art — source system** (the mined Bubble domain model + workflows; *reference, not a template*).
   - One brief per epic. It is **revisable throughout discovery** (ADR-0014 §3) — a changed decomposition re-flows into the feature PRDs.
2. **Write each feature `NNN-product.md`** (co-located in `specs/features/NNN-<slug>/`):
   - Frontmatter: `epic:` (back-link to the brief), `status: Draft`, **`surface:` (`backend-only` | `user-facing`)** — the same F-22 classification the EARS spec will carry.
   - Sections: Feature summary / **User stories** (each with a stable `US-N` id) / Flows (happy + key branches) / **Product acceptance criteria** (outcome language — the draft the EARS clauses will formalize) / Out of scope / Open questions.
   - For a `user-facing` feature: an **approved-mockup reference** slot (filled by `author-design-mockup` at Stage A).
3. **`US-N` id space (the traceability anchor).** Ids are minted here, **per feature**, and are stable for the life of the PRD — `NNN-product.md` is the id registry. When a story is split, the original id is **retired and new ids added** (never silently renumbered), so a downstream `realizes: US-N` never dangles.
4. **RU mirror.** The product-owner-facing artifacts carry an RU mirror — `brief.md` → `brief-ru.md`, `NNN-product.md` → `NNN-product-ru.md` — consistent with the *product-facing-only* principle (memory `feedback_product_feature_spec_bilingual`: mirror product-facing artifacts, keep technical ones EN). The downstream EARS triplet's technical files stay EN.
5. **Do NOT write EARS.** The PRD stops at product acceptance criteria (outcome language). Translating them into testable `EARS-N` shall-clauses is `author-ears-spec`'s job, downstream; each EARS clause will carry `realizes: US-N` back to your stories.
6. **Commit** the product layer on the discovery branch.

### Output

- `brief.md` (+ `-ru`) and one `NNN-product.md` (+ `-ru`) per feature, committed.
- A one-paragraph verdict: epic + features authored, story count per feature, `US-N` range, prior-art mined.

### Failure modes

- **Duplicating EARS** (writing testable shall-clauses in the PRD) — the PRD is outcome language; EARS is downstream (ADR-0014 §2).
- **A fat brief** (all stories in the epic doc) — depth lives in the feature PRD; the brief stays thin.
- **Unstable `US-N` ids** (silent renumber on edit) — breaks `realizes:` backlinks; retire-and-add instead.
- **`surface:` missing or inconsistent** with the feature's outcomes — the same F-22 control the EARS spec enforces.
- **Reproducing the Bubble schema** as the data model — it is mined reference, designed fresh.
