---
title: "ADR-0006 — Documentation Framework + SSOT Strategy for DS Platform [EN]"
description: "DS Platform is a greenfield TS/Postgres/Next.js platform being built by AI agents with a small team (1–2 devs + non-technical product owner Product..."
lang: en
---

> **EN (this)** · **RU:** [`0006-documentation-and-ssot-ru.md`](./0006-documentation-and-ssot-ru.md)

# ADR-0006 — Documentation Framework + SSOT Strategy for DS Platform

**Date:** 2026-05-14
**Status:** Accepted
**Related to:** Plane DSO-60 (`55222f0b-ba97-4b2f-ac91-194fed38ea18`), milestone DSO-24
**Design spec:** `apps/docs/content/adr/0006-documentation-and-ssot-design-en.md`
**Inherits:** ADR-0001 (IdP = Zitadel, closed per §8 / DSP-209; Cerbos RBAC lives in ADR-0003 §5), ADR-0002 (NestJS+Zod+REST+openapi-typescript), ADR-0003 (Postgres17+Drizzle+drizzle-kit), ADR-0004 (Next.js 15 + 4 apps + Refine + Payload v3), ADR-0005 (RN+Expo+WatermelonDB+GlitchTip)
**Reference:** `docs/documentation-pattern/documentation-framework-final.md` (general best-practices spec; not authoritative — individual decisions here diverge from the reference doc by rationale)

---

## Context

DS Platform is a greenfield TS/Postgres/Next.js platform being built by AI agents with a small team (1–2 devs + non-technical product owner Product Lead). Documentation is the primary mechanism for passing context between AI sessions and between team members. Without disciplined doc-as-SSOT, every AI session restart loses architectural intent.

ADR-0001..0005 locked in the technologies, but did not establish:

- Where documentation lives, who edits it, how it is rendered.
- Who is Master for each type of truth (Zod / Drizzle / glossary / prose).
- How drift between a document and the code is detected.
- Which format to use for feature specs (EARS + Event Modeling + Gherkin or free-form).
- Where Product Lead (non-technical, does not write markdown in an IDE) has a UI for PRD/Vision.

Hard requirements:

- Self-host (Federal Law 152-FZ; no Cloudflare/Vercel/Notion).
- AI-friendliness: AI reads docs at session start directly from the repo, without MCP-fetch proxies.
- Modern Notion-vibe UX for Product Lead (block-based, not classical wiki).
- Two-way markdown editing: Product Lead in UI ↔ Tech Lead/AI in IDE — single source.
- Mainstream stack, large LLM corpus (continuation of the [[feedback_tech_stack_criteria_no_team_skill]] principle).

Principle [[feedback_docs_as_ssot]] (STRICT): doc-first cycle, AI session starts by reading the relevant docs, every PR updates docs, docs do not contradict code by construction where possible (via codegen).

**Inheritance caveat (for transparency).** ADR-0006 architecturally inherits the unified TS stack from ADR-0002/0004 (TypeScript on backend and frontend → one language in Keystatic config, Fumadocs, generator scripts, ESLint custom rules, drift-detection tools). ADR-0002 §1 contains argumentation mentioning existing prototypes ("3 prototypes on Next.js") — this violates [[feedback_tech_stack_criteria_no_team_skill]], which was formulated later. ADR-0004 already noted this caveat. ADR-0006 does not invalidate ADR-0002/0004 in this sense (intrinsic criteria — LLM dataset, mainstream stack, RF self-host — are satisfied independently), but when revising ADR-0002 without the "3 prototypes" argument, Node.js must pass on clean criteria alone; otherwise the documentation stack requires revision.

---

## Decision

### 1. SSOT Topology — "SSOT-per-kind"

Principle 7 of the reference doc applied literally: each type of truth has exactly one home. Full table:

| Type of truth                                | Master                                                                                                   | Mechanism propagation                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API contract                                 | Zod schemas in `packages/schemas/`                                                                       | nestjs-zod → OpenAPI 3.1 → openapi-typescript → `@ds/api-client` SDK (ADR-0002 §3-5)                      |
| DB schema                                    | Drizzle TS schemas in `packages/db/schema/`                                                              | drizzle-kit generate → SQL migrations + introspect → ERD .svg (ADR-0003 §4)                               |
| Domain IDs (immutable)                       | `apps/docs/content/product/glossary/*.md` (Keystatic-managed)                                            | `pnpm generate:glossary` → `packages/glossary/src/ids.ts` TS const → ESLint enforce import                |
| Domain labels (mutable RU/EN)                | same glossary                                                                                            | i18n bundles + sync to Payload Glossary Collection                                                        |
| Business content (legal/team/marketing)      | Payload v3 collections                                                                                   | Build-time fetch / runtime API (ADR-0004 §7)                                                              |
| Architectural decisions                      | `docs/adr/NNNN-*.md` immutable Git                                                                       | Rendered in Fumadocs portal                                                                               |
| Tech specs (architectural brainstorm output) | `docs/content/specs/tech/YYYY-MM-DD-*.md`                                                                | DSO-25..29 pattern, Keystatic-editable                                                                    |
| Feature specs (SDD)                          | `docs/content/specs/features/NNN-name/` (req+design+scenarios — 3 files, no tasks.md)                    | EARS → unit tests; Gherkin → Playwright E2E; per-EARS GitHub Issues with label `feature:NNN-name`         |
| Implementation tasks (code-level)            | **GitHub Issues** in DS Platform repo (one Issue per EARS handler / bug / refactor)                      | PR-linked, auto-close on merge; AI reads `gh issue view`; cross-link `tracker:` field in spec frontmatter |
| Strategic/PM tasks (non-code)                | **Plane** workspace `doctor-school` (DSP/DSC/DSM/DSO projects)                                           | Strategic level, cross-team (product+legal+HR+marketing), Product Lead-native; cross-link via URL labels  |
| Module README                                | `apps/*/src/<module>/README.md` (module dir = direct child of `apps/<app>/src/` holding a `*.module.ts`) | Rendered Fumadocs + lint checks README presence (exports ↔ README in v2)                                  |
| Prose narrative (Vision, OKRs, PRD)          | `apps/docs/content/product/*.md`                                                                         | Keystatic UI for Product Lead + Fumadocs render                                                           |
| Operations (runbooks, monitoring)            | `apps/docs/content/operations/`                                                                          | Fumadocs render                                                                                           |
| AI constitution                              | `AGENTS.md` (root) + `CLAUDE.md` (Claude-Code overrides)                                                 | Read by AI first at session start                                                                         |

"Copying a value between Masters is forbidden" — this is the best indicator of potential drift. If a value appears in two places, the second must be an auto-generated artifact, not a manual copy.

### 2. Doc Portal: **Fumadocs (Next.js + MDX)**

The rendering layer for technical documentation. Fumadocs satisfies the full set of requirements:

- Native Next.js 15 — lives as `apps/docs/` in the monorepo, shares the `pnpm` workspace, ESLint flat config, Tailwind tokens, Turborepo cache with all other apps.
- MDX + full freedom of React components inside (Scalar/Redoc embed, Mermaid, custom glossary tooltips).
- Tailwind + shadcn-style components — visual consistency with `apps/portal`/`apps/admin`.
- Doc-specific: auto-generated sidebar, search (Orama/Algolia integration), versioning, OpenAPI rendering plugin.
- MIT license.

**Alternatives and why not chosen:**

- **Starlight (Astro):** higher doc-specialization, Pagefind search built-in, but Astro is an additional toolchain on top of Next.js. Weighted score close (181 vs 157 at equal weights), user override in favor of stack consistency.
- **Docusaurus v3:** maximum maturity and plugin ecosystem, but React+webpack separate from the Next.js monorepo — disconnect from the rest of the infrastructure.
- **Nextra v3:** Next.js-native, but a general-purpose MDX framework with a doc theme; doc-specialization weaker than Fumadocs.
- ~~MkDocs Material~~: Python toolchain in a TS shop, dropped (explicit user override: "no dinosaurs from the 2000s").

**Risk acknowledged:** Fumadocs is young (~1.5 years, active release cycle, breaking changes possible). Mitigation: content = stock MDX, portable to Docusaurus/Starlight in a day without data loss.

**Diagrams in Fumadocs:** Mermaid via `remark-mdx-mermaid` remark plugin (external dependency, not a "built-in Fumadocs plugin"), wired in Fumadocs `source.config.ts`. Performance is acceptable (lazy-load client-side).

### 3. Markdown Editor (Notion-like UX for non-developers): **Keystatic**

A UI layer on top of the same `.md` / `.mdx` / `.yaml` files in Git. Two-way workflow:

- Product Lead edits prose pages (PRD, vision, business-rules, glossary) in the Keystatic UI. On save, Keystatic commits the file to Git via GitHub App.
- Tech Lead/AI edits the same files directly in the IDE — Keystatic picks up changes on the next open.

**Why Keystatic:**

- MIT, schema-as-code in TypeScript (collections, fields, blocks are typed).
- Block editor inspired by Notion 2024 — not a classical wiki, modern UX.
- Content = plain Markdown / MDX / YAML / JSON — AI reads directly without proprietary deserialization.
- Native Next.js App Router plugin (`makeRouteHandler` + `<KeystaticApp />`) — runs as `apps/docs-cms/` alongside `apps/docs/`.
- TypeScript schema enforces: typed fields, save-time validation in the UI, relationship references (cannot reference a non-existent glossary term).

**Self-host honest framing.** Keystatic `storage.kind: 'github'` uses the GitHub.com API for commits — meaning a dependency on GitHub.com (Microsoft US infrastructure) for the doc repo. The prose/specs/ADR/glossary docs **do not contain personal data (PD)** → Federal Law 152-FZ is not violated. Platform PD lives in RF-Postgres (ADR-0003) and Timeweb Object Storage (ADR-0002). Doc repo on GitHub.com is an acceptable trade-off, not "fully self-hosted." If full air-gap is required (e.g., upon loss of access to GitHub.com) — fallback to Keystatic `kind: 'local'` + self-hosted Gitea/GitLab. Trigger: GitHub.com blocked from the Russian Federation (RF), or a policy decision to move source code to RF.

**Content format (Markdoc vs MDX impedance).** Keystatic `fields.document` serializes to Markdoc-flavored markdown. Fumadocs expects MDX. For prose collections (PRD chapters, Vision, business-rules) `fields.document` is used — DSO-31 verifies on a pilot page that Markdoc output is readable by Fumadocs (via `fumadocs-mdx` or a separate markdoc→mdx transform). For glossary `definition` — short prose, format is not critical (rendered by a separate custom Fumadocs component).

**Alternatives and why not chosen:**

- **TinaCMS:** higher maturity (5+ years), live-preview of Next.js pages, but GraphQL layer adds complexity, Tina Cloud bias in out-of-box setup. Weighted score practically tied (147 vs 149). Trigger to revisit: Keystatic v1.0 release + first breaking change in Keystatic that breaks our CI.
- **Wiki.js:** classical wiki UX, not Notion-like blocks. AGPL. Bidirectional Git sync — powerful, but interval-based (not instant). Score 122.
- ~~Outline/AFFiNE/AppFlowy/HedgeDoc~~: store data in their own DB, not in Git. AI-friendliness drops (requires MCP-fetch + cron snapshot for AI), drift risk is high. Rejected.

**Risk acknowledged:** Keystatic v0.x, breaking changes possible. Mitigation: content = plain `.md` files in Git, editor swappable to TinaCMS/Pages-CMS without data loss.

### 4. Spec Format: **Hybrid B (tech-spec brainstorm + feature-spec SDD)**

Two adjacent templates, each with its own discipline:

**Tech specs** — `docs/content/specs/tech/YYYY-MM-DD-<topic>-design.md`.

- Continues the DSO-25..29 pattern: brainstorming skill → design spec → ADR.
- Use cases: tech-stack selection, infra decisions, integration patterns, migration plans.
- Free-form structure, but with mandatory sections: Context, Decision, Consequences, Alternatives, Open Questions.

**Feature specs** — `docs/content/specs/features/NNN-<feature-name>/`.

- SDD structure (3 files, no `tasks.md` — tasks live in GitHub Issues, not in Git, see §9 below). Each file inside the per-spec directory is **prefixed with the spec number** so filenames stay globally unique in IDE tabs, fuzzy file pickers, `grep -l` output, and diff views:
- `NNN-requirements.md` — frontmatter with `tracker:` (GitHub milestone URL) + Outcomes / Scope / Constraints / Prior decisions / **Event Model (Commands/Events/Read models/Policies)** / **EARS requirements** (one per handler) / Invariants / Verification.
- `NNN-design.md` — Mermaid sequence diagrams of cascades, state diagrams of lifecycles, ER fragments.
- `NNN-scenarios.feature` — Gherkin, happy path + 2–3 failure branches.
- If a feature has a long transaction with compensations — a "Saga" section is added to `NNN-requirements.md` (reference doc §5.6) with an explicit compensate-mapping per step and failure policy.
- Decomposition into atomic tasks (one EARS-handler ≈ one Issue) is done **in GitHub Issues** (see §9), not in a Git file. Git holds intent (EARS-N), GitHub Issues hold execution state (assignee, status, PR-link, comments).

**EARS numbering — flat by default.** EARS requirements in `NNN-requirements.md` are numbered `EARS-1`, `EARS-2`, `EARS-3`, … without a `.M` sub-component, regardless of total count. The Vitest test naming follows: `it('EARS-N: when <trigger>, system shall <behavior>', () => { … })`. Nested `EARS-N.M` is allowed **only** when a single handler genuinely carries multiple shall-clauses (e.g., an OIDC-callback handler that both upserts a doctor profile and emits a `DoctorRegistered` event — `EARS-3.1` create/upsert + `EARS-3.2` emit). The trigger for nesting is "one EARS sentence becomes hard to write without 'and' or 'while'"; if a flat number suffices, use a flat number. A test covering **two sibling requirements at once** uses the compound form `EARS-N/M:` (e.g. `EARS-25/16:`), and any EARS title may carry an issue annotation `EARS-N (#issue):`.

**Only requirement-level tests carry an EARS id.** A unit test against implementation detail — and an `#issue:`-tagged regression test — legitimately carries **no** EARS id: per the bidirectional requirements-traceability standard, forcing an id onto every test is the "high code coverage, low requirements coverage" anti-pattern. Two WARN guards enforce the contract from both ends (ADR-0007 §2.6): **`ears-tests`** (`ears-test-lint.ts`) is the **coverage + orphan** direction — every requirement id has a test title that cites it, and no test title cites a requirement no spec declares (it reads ids from `it`/`test`/`describe` titles across `*.test`/`*.spec`/`*.e2e-spec`, in flat, nested and compound shapes, and from the bilingual `NNN-requirements-en.md` split); **`ears-naming`** (`ears-naming-lint.ts`) is the **format** direction — a title that _attempts_ the EARS prefix must spell it canonically (a lowercase `ears-3:`, a hyphen-less `EARS3:`, or a missing colon is flagged; a plain non-EARS title is left untouched).

Outputs of Spec-Driven Development:

- EARS-handlers → unit tests (Vitest), one EARS ≈ one test.
- Gherkin scenarios → Playwright E2E (via `playwright-bdd` transpilation).
- Event Model → NestJS modules (Commands = controllers, Events = outbox emits, Policies = handlers).
- Invariants → property-based tests (deferred to v2+).

### 5. AI Constitution: AGENTS.md + CLAUDE.md split

`AGENTS.md` at the root of the DS-Platform repo — **universal constitution** for all AI agents (Claude/Cursor/Cody/GPT-Codex). Contains: stack list, repo doc structure, mandatory "Before any task" / "During implementation" / "After implementation" checklists, PR requirements, forbidden actions (silent arch changes, hardcoded glossary IDs, etc.). Immutable in substance — updated only when a new architecture layer is added. Structure follows reference doc §4.1.

`CLAUDE.md` — Claude-Code-specific overlay. Contains: a link to AGENTS.md as baseline, MCP server config, Claude-Code skill preferences (pp-plane CLI first), tool-allowlist, hook patterns, slash-command shortcuts. May change frequently.

`.cursor/rules/` — added when/if Cursor joins the team.

### 6. Glossary Mechanism: file-per-term glossary + 4-layer validation + roundtrip check

Described in detail in design spec §6 with code sketches. Summary:

- Master = `apps/docs/content/product/glossary/*.md` — a Keystatic file-per-term collection. Each file carries Keystatic frontmatter (`title` / `description` / `lang`) and states its **canonical id in the body** as a `**Canonical id:** \`snake_id\``marker (alongside`**Bounded context:** <ctx>`), followed by the markdown definition. The canonical id is the machine-checkable key (parsed by the glossary guards); it is not a frontmatter field.
- Generated artifact = `packages/glossary/src/ids.ts` (TS const enum) + sync to Payload Glossary Collection.
- 4 client-facing validation layers + 1 CI roundtrip check:

1.  **Keystatic UI** — typed fields, relationship references, save-blocking validators.
2.  **MDX glossary-lint** — custom AST parser scans `[[g:term-id]]` glossary directives in `apps/docs/content/**/*.{md,mdx}`; an unresolved id without a same-line `new-term: <id>` opt-out → fail.
3.  **ESLint `local/glossary-canonical-ids`** — TS literals matching a GlossaryId must be imported from `@ds/glossary/ids`, not be an inline string.
4.  **Payload Lexical glossary-ref check** — every `<GlossaryRef id="...">` in a Payload Lexical AST export exists in the glossary.

- **Roundtrip CI check** — glossary source ↔ generated TS ids ↔ Payload Glossary table consistent (runs post-sync).

### 7. Drift Detection Stack

Full v1 list (all block merge except those marked warn-only):

| Check                                                                      | Tool                                                    | What it verifies                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS compile                                                                 | `tsc --noEmit`                                          | Basic type safety                                                                                                                                 |
| ESLint                                                                     | `eslint` flat config                                    | Custom rules incl. `local/glossary-canonical-ids`, `no-class-validator`, `no-vercel-only-api` (ADR-0004 §13)                                      |
| Prettier                                                                   | `prettier --check`                                      | Code style                                                                                                                                        |
| Unit tests                                                                 | Vitest                                                  | Per-handler coverage                                                                                                                              |
| E2E                                                                        | Playwright + `playwright-bdd`                           | Gherkin scenarios pass                                                                                                                            |
| **API drift**                                                              | Spectral + `openapi.snapshot.json` diff                 | NestJS-generated OpenAPI vs committed snapshot                                                                                                    |
| **DB schema drift**                                                        | `drizzle-kit check`                                     | TS schema ↔ migrations consistent                                                                                                                 |
| **Events drift**                                                           | Custom AST (`tools/lint/events-lint.ts`)                | `@OutboxEmit` calls ↔ spec's `events.md`                                                                                                          |
| **Glossary lint (3 CI checks; layer 1 = Keystatic UI runtime, not in CI)** | custom MDX-lint + ESLint custom rule + Payload AST scan | See §6 above                                                                                                                                      |
| **Generated artifacts**                                                    | `pnpm generate:all --check`                             | openapi-typescript SDK + glossary IDs + ERD up-to-date                                                                                            |
| **Markdown links**                                                         | `lychee`                                                | No broken links cross-docs                                                                                                                        |
| **Module README**                                                          | `tools/lint/module-readme-lint.ts`                      | Every top-level NestJS module dir (direct child of `apps/<app>/src/` holding a `*.module.ts`) has a README (warn-only v1; exports ↔ README in v2) |
| **Docs build**                                                             | `apps/docs` next build                                  | Fumadocs builds without errors                                                                                                                    |

**Module-README location.** A _module_ is a top-level NestJS module directory — a direct child of `apps/<app>/src/` that contains at least one `*.module.ts` file (e.g. `apps/api/src/auth/`); its README lives at that directory's root (`apps/<app>/src/<module>/README.md`). NestJS modules nest directly under `src/` — there is no intermediate `modules/` wrapper directory. The app-root composition module (`apps/<app>/src/app.module.ts`, no subdirectory) is out of scope, and a nested sub-module rides its parent module's README. `module-readme-lint.ts` asserts README presence only in v1 (warn-only); the exports ↔ README cross-check is the v2 tightening.

**Not v1 (deferred):**

- AsyncAPI — no external event bus (outbox/Centrifugo internal do not require AsyncAPI v1).
- Pact contract testing — after first external integration (ADR-0002 OQ8).
- Property-based invariant tests — after the first product-complex feature.
- Coverage thresholds — after 3 months in production.

### 8. Diagrams: Mermaid only in v1

Sequence / state / ER / C4Context — all Mermaid in MDX. Rendering — Fumadocs built-in Mermaid plugin. C4 modeling via Mermaid v10+ `C4Context` shape.

**Trigger to revisit:** 10+ components in an architecture diagram, or 3+ stakeholders regularly reading arch docs — switch to Structurizr DSL (text-based C4, multiple views) or d2.

### 9. Task-tracker split: Plane (strategic) + GitHub Issues (code-level)

To avoid false-SSOT in Git (`tasks.md`), task execution state lives in task trackers. **Two trackers — two distinct zones of responsibility**, cross-linked via URL.

| What we track                                                                          | Where                                             | Why                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack ADRs, infra milestones, product/PM decisions, hiring, fundraising                | Plane workspace `doctor-school` (DSP/DSC/DSM/DSO) | Strategic level, cross-team, Product Lead works in Plane natively, CLAUDE.md pp-plane-first rule                                                            |
| Implementation tasks for DS Platform code (EARS handlers, bugs, refactors, deps, perf) | **GitHub Issues** in DS Platform repo             | PR-native (auto-close, mention, sub-issues, GitHub Projects v2), AI works with `gh` CLI in the repo, `feature:NNN-<slug>` labels bind Issues to their specs |
| Cross-cutting initiatives (release planning, infrastructure milestone)                 | Plane parent + GitHub Milestone children          | Strategic owner = Plane, implementation details = GitHub                                                                                                    |

**GitHub Issues convention for feature implementation:**

- **Milestone = product theme** (e.g., `Doctor onboarding v1`) — a long-lived theme that may span several feature specs (AGENTS.md §2). A Milestone is **not** a spec folder; the spec an Issue implements is bound by its `feature:NNN-<slug>` label.
- **One Issue per EARS-handler** — title `[001] EARS-3: When OIDC callback received, the system shall ...`, body contains a link to the specific EARS-ID in `NNN-requirements.md`.
- **Labels** — `feature:NNN-<slug>` (binds the Issue to `apps/docs/content/specs/features/NNN-<slug>/`), `kind:ears-handler` / `kind:bug` / `kind:refactor` / `kind:dep-upgrade`.
- **GitHub Project v2** — "DS Platform Implementation" board with swimlanes by feature.

**Cross-linking:**

- Plane Issue → GitHub: URL in description or comment.
- GitHub Issue → Plane: URL in body, optional label `plane:DSO-N`.
- Feature spec → its product-theme GitHub Milestone: frontmatter field `tracker: <github-milestone-url>` in `NNN-requirements.md` (several specs under one theme share the URL).

**AI agent workflow:**

- Start of session in DS Platform repo: `gh issue view N` → read linked feature spec → implement → PR auto-close on merge.
- AI agent does NOT open Plane for code-level work — that would create friction. Plane is opened only for strategic context (e.g., reading a DSO-ADR when referenced).

**Plane CLI rule:** `AGENTS.md` / `CLAUDE.md` fix the rule: "`gh` CLI first for code-level Issues; pp-plane — for cross-tracker references only (Plane DSO-XXX from an ADR/spec)."

### 10. Repository Topology in the Monorepo

```
ds-platform/
├── AGENTS.md
├── CLAUDE.md
├── apps/
│   ├── docs/                      # Fumadocs portal (Next.js)
│   │   └── content/
│   │       ├── adr/
│   │       ├── architecture/
│   │       ├── data/
│   │       ├── operations/
│   │       ├── product/
│   │       │   ├── vision.md
│   │       │   ├── prd/           # PRD chapters per Keystatic collection
│   │       │   ├── business-rules.md
│   │       │   ├── user-journeys.md
│   │       │   └── glossary/      # file-per-term
│   │       ├── specs/
│   │       │   ├── tech/          # brainstorm-style
│   │       │   └── features/      # SDD-style (NNN-name/)
│   │       └── user-guides/       # Diátaxis
│   ├── docs-cms/                  # Keystatic editor (Next.js)
│   │   └── keystatic.config.ts
│   ├── portal/                    # student app (ADR-0004)
│   ├── admin/                     # Refine (ADR-0004)
│   ├── promo/                     # marketing (ADR-0004)
│   ├── cms/                       # Payload v3 (ADR-0004)
│   └── mobile/                    # Expo RN (ADR-0005)
├── packages/
│   ├── schemas/                   # Zod (API SSOT)
│   ├── api-client/                # generated SDK
│   ├── db/                        # Drizzle schema (DB SSOT)
│   ├── glossary/
│   │   ├── src/ids.ts             # GENERATED — never edit
│   │   └── loader.ts              # YAML reader for scripts
│   ├── hooks/, design-system/, observability/, utils/, eslint-config/
│   └── ...
└── tools/lint/
    ├── events-lint.ts
    ├── glossary-mdx-lint.ts
    ├── module-readme-lint.ts
    └── generated-artifacts-check.ts
```

---

## Consequences

### Positive

- **Single Git Master for all prose+tech** — no drift between Notion/Outline and the code; AI reads directly.
- **Keystatic over Git** gives Product Lead a Notion-like UX without a separate prose store: edit in UI = commit to Git = visible to AI in the next session.
- **Fumadocs as a Next.js app** — unified toolchain (Turborepo cache, shared ESLint/Tailwind/TS config) for docs+portal+admin+promo+cms.
- **SSOT-per-kind table** — a formal map of who is Master for what, codegen where possible, automatically catches drift.
- **EARS+Event Model in feature specs** gives AI a structured prompt for generating NestJS handlers + Vitest tests + Playwright E2E — one source, three artifacts.
- **AGENTS.md split** allows adding Cursor/Codex without rewriting CLAUDE.md.
- **Drift detection across 12 checks** catches divergences at PR time; development does not drift from the specification.
- **Self-hosted runtime stack** (Keystatic admin, Fumadocs portal, lint tools) — all compute within the RF zone. Documentation in Git on GitHub.com is an acceptable trade-off (no PD in doc repo), Federal Law 152-FZ is not violated. Trigger to revisit: GitHub.com blocked or a policy decision to move source code to RF (Gitea/GitLab self-host).
- **Content portability**: content = stock `.md`/`.mdx`/`.yaml` — editor and portal are swappable without data loss.

### Negative

- **Keystatic v0.x maturity risk** — breaking changes possible every 3–6 months. Mitigation: content-portable; pin minor version; CI smoke-test after Keystatic upgrade.
- **Fumadocs young (~1.5 years)** — smaller plugin ecosystem than Docusaurus, OpenAPI integration requires manually embedding a Scalar/Redoc React component. Mitigation: content-portable.
- **Product Lead learning Keystatic** — block editor is simpler than an IDE, but still a new environment; first month + tutorial.
- **Glossary 4-layer validation** requires writing ~3 custom lint scripts in `tools/lint/` (~300 lines of TS). Not trivial, but a straightforward pattern.
- **Custom ESLint rule `local/glossary-canonical-ids`** — one more thing to maintain. Mitigation: standalone package, tested separately.
- **EARS + Event Modeling + Gherkin discipline** requires training; the first feature spec is written more slowly. Mitigation: payoff on codegen tests from the second feature onward.
- **Sync glossary.yaml → Payload Glossary Collection** — one more CI script, idempotency required.
- **Mermaid-only — render is limited** for complex C4. Trigger to revisit is recorded.

### Risks

- **Keystatic + Fumadocs combined youth** — both are young; theoretically possible for both to break simultaneously on a major Next.js upgrade. Mitigation: pin major Next.js, run upgrades through a canary branch.
- **Product Lead continues writing in Notion despite Keystatic** — a social risk. Mitigation: explicitly state that Notion is no longer Master for DS Platform docs"; deactivate the corresponding Notion pages (or make them a read-only mirror via CI).
- **AI agent writes to `apps/docs/content/` directly, breaking Keystatic schema** — e.g., adds a `.md` file without required frontmatter. Mitigation: CI schema-validation for Keystatic collections — fail if a file does not conform to the schema.

---

## Alternatives considered (rejected or deferred)

| Alternative                                            |  Score  | Reason                                                                                                                           |
| ------------------------------------------------------ | :-----: | -------------------------------------------------------------------------------------------------------------------------------- |
| Notion-as-Master for prose                             |   n/a   | Federal Law 152-FZ vendor compliance; AI must fetch via MCP — slower context build; markdown ↔ Notion-blocks lossy serialization |
| Outline self-hosted                                    |   n/a   | Storage = Postgres (not Git) → AI reads a snapshot, drift risk; bidirectional sync with Git non-trivial                          |
| TinaCMS                                                |   147   | Close to Keystatic (149) — GraphQL layer adds complexity; revisit trigger recorded                                               |
| Wiki.js                                                |   122   | Classical wiki UX, not Notion-blocks; AGPL acceptable but restrictive; sync interval-based                                       |
| Pages CMS / Sveltia CMS                                | 102-110 | Very young, schema power weaker, GitHub OAuth bias                                                                               |
| Outline / AFFiNE / AppFlowy / HedgeDoc                 |   n/a   | Store data in their own DB, not Git → drift risk + AI fetch overhead                                                             |
| Docusaurus v3 (portal)                                 |   157   | Webpack build separate from the Next.js monorepo; ecosystem more mature but stack-disconnect                                     |
| Starlight (Astro) portal                               | 161/181 | Tied/wins on weighted; explicit user override in favor of Next.js fit (Fumadocs)                                                 |
| Nextra v3                                              |   173   | Native Next.js, but doc-specialization weaker than Fumadocs                                                                      |
| ~~MkDocs Material~~                                    |   n/a   | Dropped by user override ("no dinosaurs from the 2000s")                                                                         |
| Structurizr DSL for C4                                 |   n/a   | Overhead vs Mermaid in Phase 0; trigger for revisit recorded                                                                     |
| Full SDD (EARS+Event+Gherkin) for all specs incl. tech |   n/a   | Retrofitting DSO-25..29 into EARS impractical; hybrid (option B) chosen                                                          |
| Spec-Kit (GitHub) CLI                                  |   n/a   | Addresses the same use case; adds an external CLI tool; our hybrid pattern is proven on DSO-25..29                               |
| AsyncAPI v1                                            |   n/a   | No external event bus; trigger v2+                                                                                               |
| Atlas migrations                                       |   n/a   | drizzle-kit covers this (ADR-0003 §4) — no point in a second migration tool                                                      |
| DBML + dbdocs.io                                       |   n/a   | Drizzle introspect → ERD render covers this (ADR-0003 §4)                                                                        |
| AGENTS.md only (no CLAUDE.md)                          |   n/a   | Lose Claude-specific MCP / skills / hooks config                                                                                 |
| CLAUDE.md only                                         |   n/a   | Does not scale to multi-agent (Cursor, Codex)                                                                                    |

---

## Open questions (deferred)

| ID       | Q                                                                                                                             | Where resolved                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-Doc1  | Versioning documentation in Fumadocs (per-release docs vs unversioned)                                                        | First breaking change in the public API after v1                                                                                                                                                                                                                                                |
| OQ-Doc2  | Add AsyncAPI                                                                                                                  | When the first product event bus exposed externally appears                                                                                                                                                                                                                                     |
| OQ-Doc3  | AI-powered search (Mintlify / Orama Cloud)                                                                                    | If organic Fumadocs search proves insufficient after 6 months                                                                                                                                                                                                                                   |
| OQ-Doc4  | Additional glossary fields beyond v1 (synonyms with weight, related-terms graph, deprecation flag)                            | As terminology grows — DSO-31+                                                                                                                                                                                                                                                                  |
| OQ-Doc5  | Keystatic → TinaCMS migration trigger                                                                                         | At the first breaking Keystatic v0.x → v1.0 change                                                                                                                                                                                                                                              |
| OQ-Doc6  | Pact contract testing                                                                                                         | First external integration after v1                                                                                                                                                                                                                                                             |
| OQ-Doc7  | Property-based invariant tests                                                                                                | First product-complex feature with mathematical invariants (ledger reconciliation, etc.)                                                                                                                                                                                                        |
| OQ-Doc8  | AI-powered hosted doc search (Mintlify / similar)                                                                             | Only upon explicit pain — self-hosted Fumadocs Orama search insufficient after 6 months AND ops overhead of self-hosted alternative is significant. Hosted doc search does not contain PD (only public docs metadata), Federal Law 152-FZ trade-off is acceptable. Default — stay on self-host. |
| OQ-Doc9  | Structurizr DSL for C4                                                                                                        | 10+ components in arch diagram or 3+ stakeholders                                                                                                                                                                                                                                               |
| OQ-Doc10 | i18n EN documentation of the portal                                                                                           | If hiring of English-speaking developers begins                                                                                                                                                                                                                                                 |
| OQ-Doc11 | §-reference linter — CI guard, parses `ADR-NNNN §X` / `spec §X` and validates existence of the section in the target document | Phase 1 enhancement; trigger — repeated discovery of wrong-section citations during code review (issue recorded in DSO-61, 11 wrong refs found in the DSO-24 batch)                                                                                                                             |

---

## Related ADRs / Delegated

**Inherited from:**

- ADR-0001 — single OIDC tenant: Zitadel (closed per ADR-0001 §8, DSP-209) for Keystatic admin login, same tenant as Refine admin (`apps/admin`)
- ADR-0002 — Zod schemas + nestjs-zod + openapi-typescript → SDK
- ADR-0003 — Drizzle schemas + drizzle-kit
- ADR-0004 — Payload v3 Glossary Collection, Next.js 15 + Tailwind + shadcn for all apps
- ADR-0005 — Module README pattern reused in `apps/mobile/src/<module>/`

**Delegated to other tasks:**

- **DSO-31 (Repo strategy / Engineering readiness):** monorepo tooling finalization (Turborepo); CI workflow.yml; Fumadocs setup; Keystatic setup; AGENTS.md/CLAUDE.md draft; first glossary YAML scaffold; lint-tools package; sync-glossary-to-payload script; deployment domain `docs.doctor.school` + `docs-cms.doctor.school`.
- **Phase 0.5 after DSO-31:** first feature spec in SDD format as acceptance proof.
- **DSO-32 (Legal):** status of DS Platform Notion pages after migration — read-only mirror or deprecation.

**Impacts (downstream blockers):**

- **DSO-31** — structure of `apps/docs/`, `apps/docs-cms/`, `packages/glossary/`, `tools/lint/`.
- **Payload Phase 0 implementation** — Payload Glossary Collection requires canonical glossary as SSOT.
- **Feature specs DS Platform code** — spec format is locked, work can begin on `docs/content/specs/features/001-*/` for the first product feature.
