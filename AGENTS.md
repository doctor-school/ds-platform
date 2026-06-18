# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo. Vendor-agnostic — readable by Claude Code, Codex, Cursor, or any future agent. Claude-Code-specific overlays live in `CLAUDE.md`.

<!-- ALWAYS-ON CORE. Per-file budget: ≤200 lines AND ≤25 KB (epic #247 / #250; grounded in
     Anthropic's CLAUDE.md "target under 200 lines" + the 200-line/25 KB auto-memory
     cutoff + the "smallest set of high-signal tokens" context-engineering guidance).
     The always-on context = this file + CLAUDE.md + every .claude/rules/*.md — ALL auto-load
     at session start (a rules file WITHOUT `paths:` frontmatter is always-on, not lazy).
     Keep each file lean and relocate detail; a NEW always-on rules file adds to the window,
     so give it `paths:` frontmatter if it is genuinely task-scoped. Never inline-grow.
     `/wrap` runs `pnpm lint:instruction-budget` each session; over budget ⇒ compact. -->

This file is the slim core. The full always-on set auto-loads at session start: this file (via CLAUDE.md's `@AGENTS.md` import), CLAUDE.md, and every `.claude/rules/*.md`. Genuinely on-demand detail lives in skills and memory topic files:

- Branches / commits / versioning / Issues / PRs / merge mechanics → `.claude/rules/repo-conventions.md` _(auto-loaded)_
- Dev stand, migrations, live-verify plumbing → `.claude/rules/dev-stand.md` _(auto-loaded)_
- Per-task procedure → the skill named in §3 (`apps/docs/content/skills/<name>/SKILL.md`) _(read on demand)_
- Settled facts / past decisions → auto-memory (`MEMORY.md` index → topic file) _(topic file read on demand)_

---

## 1. What is DS Platform

DS Platform is the medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). Greenfield monorepo in **Phase 0** — architectural ADRs (0001–0008) accepted, engineering scaffolding in progress. Pre-pilot target: **2026 Q3**.

Stack at a glance (full reference in `apps/docs/content/adr/`): **Backend** NestJS + Zod + REST + openapi-typescript SDK (ADR-0002); **Data** Postgres 17 + Drizzle + pgvector (ADR-0003); **Frontend** Next.js 15 + Refine — 4 apps: promo / portal / admin / cms-Payload-v3 (ADR-0004); **Mobile** React Native + Expo + WatermelonDB (ADR-0005); **Docs** Fumadocs + Keystatic + glossary.yaml (ADR-0006). Long-form context: `README.md`.

---

## 2. Repository conventions (one-liners — detail in `.claude/rules/repo-conventions.md`)

- **Monorepo:** pnpm 10 + Turborepo. Apps `apps/<name>/`, shared `packages/<name>/`, tooling `tools/`.
- **Branches:** trunk-based, `<prefix>/<N>-<slug>`, squash-merge. Prefixes `feat|fix|chore|refactor|docs|tooling`. Delete branch on merge/close; re-sweep `gh pr list` after merging CI/dep/security PRs.
- **Commits:** Conventional Commits; PR title = squash title.
- **Versioning:** changesets; user-facing PR → `pnpm changeset`; when unsure minor-vs-major, pick **major**.
- **PR template required:** kind label + `Closes #N` + author marker **in the body** (`author:*` is not a `gh --label`).
- **Issues:** native sub-issue + blocked-by/blocking links are mandatory, not prose. On merge, set board **Status = Done** by hand.
- **ADRs** in `apps/docs/content/adr/`; **feature specs** (triplet) in `apps/docs/content/specs/features/NNN-<slug>/`. One spec → many Issues; code PRs start only after the spec is on `main`.

---

## 3. Work protocol

Every agent session, regardless of vendor, follows this three-step entry — **identify task kind → cite entry point → load skill**.

### 3.1 Identify task kind

| Kind              | Trigger                                                       | Skill                                                         |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| feature-iteration | One EARS handler inside an existing feature-spec              | `apps/docs/content/skills/do-feature-iteration/SKILL.md`      |
| hotfix-pr         | Code-level bug; no feature-spec required                      | `apps/docs/content/skills/do-hotfix-pr/SKILL.md`              |
| adr-revision      | Edit to an existing ADR (inline rewrite by default)           | `apps/docs/content/skills/do-adr-revision/SKILL.md`           |
| decision-debt     | Closing a silent-decision artifact surfaced earlier           | `apps/docs/content/skills/do-decision-debt-followup/SKILL.md` |
| engineering-task  | Phase A bootstrap (DSP-160 sub-issue), CI hardening, scaffold | No skill — follow the task spec directly (see §3.8)           |
| spec-authoring    | New feature-spec / new ADR / new design-spec                  | `superpowers:brainstorming` (sole allowed exception, §3.4)    |

Not in the table? **Dependency bump** → `engineering-task`; first run the two checks in `.claude/rules/repo-conventions.md` → _Dependency bumps_. **Opening Issues from an already-merged spec** → skill `open-ears-issues`. Anything still unmapped → default to `engineering-task` (§3.8), state the assumption, and proceed; stop and ask Tech Lead only if that genuinely doesn't fit.

### 3.2 Cite the entry point

In the first user-facing reply, state: kind, active artifact (Issue #N / spec path / ADR section), skill being dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly. Do not rely on vendor-specific auto-discovery — **the path is the contract**.

### 3.4 Superpowers whitelist (single exception)

`superpowers:brainstorming` is the only `superpowers:*` skill allowed for project work, and only for spec-authoring. After brainstorming concludes, **do not chain into `superpowers:writing-plans`** — the `NNN-requirements.md` / `NNN-design.md` triplet is the plan (ADR-0007 §2.4 via `do-feature-iteration`). All other `superpowers:*` skills, and any chain initiated internally by a superpowers skill, are explicitly disallowed for project work. They may be referenced as implementation patterns inside project SKILL.md content, but not as the orchestrator.

### 3.5 Bootstrap

Run `pnpm bootstrap` (alias `tsx tools/agent-bootstrap.ts`) for git/Issue/PR/spec state. Claude Code does this via SessionStart hook (`.claude/settings.json`) automatically.

### 3.6 Permission-mode disclosure

If the session is launched with `--dangerously-skip-permissions`, the agent assumes the discipline responsibility that CI guards would otherwise enforce. If CI guards are themselves broken, bypass mode amplifies the gap.

### 3.7 Plane lifecycle entry (if applicable)

If the active task is a Plane work-item (DSP-XXX / DSO-XXX), the first action after identifying task kind is the Plane lifecycle entry: (1) move the task to `In Progress`, (2) post a start comment describing the planned approach — before any code or doc edit. The end-of-session counterpart (move to `Done` + result comment) is a §6 Hard rule. **Tooling:** `plane-pp-cli` reads work-items but is read-only for them — state changes and comments go through the Plane MCP (`mcp__plane-pp-mcp__*`).

### 3.8 Engineering-task discipline (no orchestration skill)

`engineering-task` is the only kind with no orchestration skill — but the §6 discipline gates still apply, run directly by the lead:

- **`surface-decision-debt`** (inline) — mandatory before the result comment. Output `[]` or a list.
- **`request-mode-a-review`** (dispatch) — mandatory before merge, same gate as any PR (§4).
- **`run-iteration-end-checklist`** is **not** dispatched (CI runs test/typecheck/lint/drift); its remaining items (module README, architecture/operations docs, glossary terms) are an inline self-check before opening the PR.

---

## 4. Review modes & merge gate

Per ADR-0007 §2.10. **Mode (a)** — same-session subagent dispatch via `request-mode-a-review` (lead finishes → dispatches reviewer subagent → structured APPROVE / REQUEST_CHANGES verdict). **Mode (b)** — parallel Codex CLI session. **Mode (c)** — pure human review. LLM credentials live in the human's terminal, not CI; **no automated reviewer-bot**.

**Merge gate.** A positive Mode (a) or (b) verdict **+ green CI** is sufficient to merge via `gh pr merge <N> --auto --squash --delete-branch`; human-merge is **not** required (Mode (c) stays human). **CI is a manual gate in Phase 0 — `--auto` does NOT block on CI here, so confirm `gh pr checks` green by hand before merging** (memory `feedback_phase0_merge_gate_manual`). Procedure: skills `request-mode-a-review` + `merge-when-green`.

---

## 5. Lint guards

CI lint guards (ADR-0007 §2.6) surface as PR Checks for the reviewer and author-agent. Full table in **ADR-0007 §2.6**. `spec-link` is BLOCK; others WARN in Phase 0.

---

## 6. Hard rules

- **SDD.** No production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`. If absent, invoke `superpowers:brainstorming` (§3.4) to author one.
- **Vertical slices over horizontal layers (F-22).** Every feature-spec declares `surface: backend-only | user-facing` in `NNN-requirements.md` frontmatter; a genuine backend-only spec is verified by Vitest e2e alone, but a `user-facing` feature owns its UI deliverable in the **same** WBS as its backend. Backend-first is allowed only as an explicit, tracked out-of-scope deferral named in the spec — never a silent default. A UI surface in any EARS _trigger_ forbids `surface: backend-only`. Enforced by `author-ears-spec`, `open-ears-issues` step 3a, `run-iteration-end-checklist` item 12.
- **No untracked seam / scaffold (F-22).** A scaffold, stub, fake, or fail-closed seam standing in for a real deliverable is decision-debt: it MUST be a tracked open Issue with an explicit "done against the real dependency" criterion — a code comment is not an obligation the tracker can see. A `user-facing` theme's DoD is "a vertical slice is completable end-to-end", not "all backend handlers merged". Detail: `open-ears-issues` step 3a.
- **No workarounds, no patches, no temporary hacks — build it right the first time.** A workaround, monkey-patch, local source edit "just to make it run", manual one-off step, hardcoded value standing in for missing config, or any "temporary" measure is **forbidden** — in code _and_ process. If a prerequisite is not ready, **STOP and fix the prerequisite properly first**, as its own tracked Issue wired as a blocking dependency (`blocked_by`). Corollaries: (a) **never rush a UI/integration layer ahead of the backend it depends on** — if the live path isn't ready, the slice isn't ready; (b) **verification only counts against clean, committed code** — a green observed against a patched/hacked/locally-mutated state is not a real green; (c) the urge to "just get it working now" is the signal to re-sequence, not to patch. Detail: memory `feedback_no_workarounds_build_clean`.
- **UI from the design system — adopt before bespoke.** All UI is built from `@ds/design-system`: styling **only** via tokens (arbitrary Tailwind values are lint-blocked, §5), and before writing **any** bespoke page / form / element you run the `build-ui-from-design-system` gate — inventory the package, then **search the approved registry whitelist** (official shadcn · Origin UI · Intent·Jolly · Kibo) and report the result; bespoke is a last resort, recorded in the PR. Our product code is **proprietary** (`UNLICENSED`) at any repo visibility — adopt MIT/permissive third-party freely (preserve notices); proprietary/paid registries need a license **and** a private repo, else pattern-only. Canon: ADR-0013; memory `feedback_registry_research_before_bespoke_ui`.
- **Verify UI live before "done".** Any feature checkable in the UI MUST be driven in the **actual running UI** (Playwright on the live dev-stand) before it is called done — build/typecheck/lint/Mode-a are necessary but **not** sufficient, and live-gated E2E that doesn't run in CI is not a substitute. Drive **every field kind on every surface** (reject + accept, watching rendered error language + timing). A user-facing dev placeholder is a banned stub, not an affordance. Detail: memory `feedback_verify_ui_on_live_stand`, `feedback_verify_every_field_kind_every_surface`.
- **PR lifecycle runs to completion.** "PR open" is not "done". The author-agent autonomously: dispatch Mode (a) review → confirm `gh pr checks` green by hand → merge (§4) → confirm Issue closed → **set board Status = Done** → re-sweep branches/PRs. Do not stop at any intermediate step waiting for the human.
- **TDD.** No production code without a failing test. Naming `it('EARS-N: ...')`; flat numbering per ADR-0006 §4; nested `N.M` only when one handler carries multiple shall-clauses.
- **Trackers.** Code-level → GitHub Issues here; strategic / cross-team → Plane workspace `doctor-school`. Never both.
- **Plane lifecycle.** When the task is a Plane work-item: `In Progress` + start comment before work; on completion `Done` + result comment (artifacts, what was done, open questions, what is unblocked). If incomplete, leave a "where we stopped / what remains" status comment — never drop it silently.
- **Roles, not names** in any spec / ADR / design doc.
- **Direct push to `main` is forbidden.** Single merge command: `gh pr merge <N> --auto --squash --delete-branch`.
- **Project skill catalog.** Only `apps/docs/content/skills/`. Vendor-specific auto-discovery is not used to dispatch project work. The path is the contract.
- **Discipline gates.** `run-iteration-end-checklist` and `request-mode-a-review` produce artifacts the lead cannot bypass. Without their outputs, merge is forbidden (ADR-0007 §2.4).
- **Decision-debt.** Any silent deviation from a documented convention MUST surface via `surface-decision-debt` before the iteration summary (or, for an engineering-task, before the result comment).
- **Amendment vs inline rewrite.** In pre-pilot (paper-architecture, no production code) there are NO amendment blocks in ADR / spec / design docs — an amendment is justified only when the original decision is running in production. Everywhere else: inline rewrite, the body reading as if the current decision were always the decision. The history of paper-architecture evolution lives in `git log`, not the document body. **(This rule applies to these instruction files too: replace a section, don't append an amendment — the anti-bloat budget depends on it.)**

---

## 7. Roles

Per memory `reference_team_roles`. **Specs / ADRs / process docs use roles, not names.**

| Role                             | Responsibility                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Tech Lead / System Architect** | IT architecture, AI orchestration, product engineering, bizmodel; primary author of code in Phase 0        |
| **Product Lead**                 | Doctor.School owner, MBA marketer, pharma sales, domain expertise; primary author of product / PRD content |
| **Partner / Strategic**          | Strategic partner (data centers, AI wellness adjacency); not in dev loop                                   |

In **Phase 0**, Tech Lead is the **single CODEOWNERS owner** (ADR-0008 §2.7) and the single human approver on PRs.

---

## 8. Where things live

| Thing                                      | Location                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| ADRs / companion design specs              | `apps/docs/content/adr/NNNN-<slug>.md` / `…-design.md`                                                     |
| Feature specs (triplet)                    | `apps/docs/content/specs/features/NNN-<slug>/`                                                             |
| Tech specs (brainstorm)                    | `apps/docs/content/specs/tech/<topic>.md`                                                                  |
| **Project skill catalog**                  | **`apps/docs/content/skills/<name>/SKILL.md`**                                                             |
| Glossary                                   | `apps/docs/content/product/glossary/` (file-per-term, Keystatic-managed)                                   |
| API contract SSOT / DB schema SSOT         | `packages/schemas/` (Zod) / `packages/db/schema/` (Drizzle)                                                |
| Generated SDK / glossary IDs               | `packages/api-client/`, `packages/glossary/ids.ts` (do not edit by hand)                                   |
| Lint tools / bootstrap                     | `tools/lint/*.ts` / `tools/agent-bootstrap.ts` (`pnpm bootstrap`)                                          |
| Always-on instruction detail (auto-loaded) | `.claude/rules/*.md` (repo-conventions, dev-stand)                                                         |
| Strategic / cross-team work-items          | Plane workspace `doctor-school` (projects DSP, DSC, DSM, DSO); code-level Issues → **GitHub** in this repo |

**Tracker rule** (ADR-0006 §9): `gh` CLI first for code-level Issues; `pp-plane` only for cross-tracker references.

---

## 9. Local Dev Stand

Compose stack (Postgres, Redis, MinIO, `idp`, Centrifugo, Cerbos, Mailpit) — two-layer model: portable contract in git (`infra/dev-stand/`) + per-developer recipe outside git (`~/.ds-platform/.env.local`). **Read endpoints from `.env.local`, never hardcode.** Driven by `pnpm dev:*`. Full operating rules, DX cheat sheet, migration safety, and failure modes: **`.claude/rules/dev-stand.md`**.
