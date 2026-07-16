# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo — vendor-agnostic, readable by any agent. Claude-Code-specific overlays: `CLAUDE.md`.

<!-- ALWAYS-ON CORE. Per-file budget ≤200 lines AND ≤25 KB (`pnpm lint:instruction-budget`). Always-on set = this file + CLAUDE.md + every .claude/rules/*.md without `paths:` frontmatter — all auto-load at session start. Relocate detail; a task-scoped rules file gets `paths:` frontmatter. Never inline-grow. -->

On-demand detail: branches/commits/versioning/Issues/PRs/merge → `.claude/rules/repo-conventions.md` (auto-loaded); dev stand/migrations/live-verify → `.claude/rules/dev-stand.md` (auto-loaded); per-task procedure → the §3 skill (read on demand); settled facts → auto-memory (`MEMORY.md` index → topic file, on demand).

---

## 1. What is DS Platform

Medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). ADRs 0001–0008 accepted.

**Production is live with users** on Timeweb (ru-3): `app.doctor.school` / `api.` / `id.`. Never tell the owner "there is no production". Authoritative deployed scope = the derived `## Project reality` bootstrap section (`pnpm bootstrap`) + GitHub Releases/Deployments — never inferred from these docs (static prose rots).

Stack (reference `apps/docs/content/adr/`; long-form `README.md`): NestJS + Zod + REST + openapi-typescript SDK (ADR-0002); Postgres 17 + Drizzle + pgvector (ADR-0003); Next.js 15 + Refine — promo / portal / admin / cms-Payload-v3 (ADR-0004); React Native + Expo + WatermelonDB (ADR-0005); Fumadocs + Keystatic + glossary.yaml (ADR-0006).

---

## 2. Repository conventions (one-liners — detail in `.claude/rules/repo-conventions.md`)

Monorepo pnpm 10 + Turborepo (`apps/`, `packages/`, `tools/`). Trunk-based branches `<prefix>/<N>-<slug>` (prefixes `feat|fix|chore|refactor|docs|tooling`), squash-merge, delete branch on merge/close. Conventional Commits; PR title = squash title. Changesets on user-facing PRs (unsure → major). The agent ships prod via `pnpm deploy:prod`, which cuts the `release-*` tag + Release at the deployed SHA (`/deploy` skill). PR template: kind label + `Closes #N` + author marker in the body (`author:*` is not a `gh --label`). Issues: native sub-issue + blocked-by/blocking links mandatory, not prose; on merge, set board Status = Done by hand. ADRs in `apps/docs/content/adr/`; feature specs (triplet) in `apps/docs/content/specs/features/NNN-<slug>/`; one spec → many Issues; code PRs only after the spec is on `main`.

---

## 3. Work protocol

Every session, any vendor: **identify task kind → open with the session plan → load skill**.

### 3.1 Identify task kind

Skills live at `apps/docs/content/skills/<name>/SKILL.md`.

- feature-iteration — one EARS handler in an existing feature-spec → `do-feature-iteration`
- hotfix-pr — code-level bug, no feature-spec required → `do-hotfix-pr`
- adr-revision — edit to an existing ADR (inline rewrite) → `do-adr-revision`
- decision-debt — closing a surfaced silent-decision artifact → `do-decision-debt-followup`
- engineering-task — CI hardening, scaffold, Phase A bootstrap (DSP-160) → no skill, §3.8
- product-discovery — new product epic / user-facing feature, no PRD yet → `do-product-discovery`
- spec-authoring — new feature-spec / ADR / design-spec → `author-feature-spec`

Not in the list? Dependency bump → `engineering-task` + the two checks in `repo-conventions.md` → Dependency bumps. Opening Issues from a merged spec → skill `open-ears-issues`. User-facing epic/feature with no PRD → `product-discovery` → `spec-authoring` → `feature-iteration` (ADR-0014). Still unmapped → `engineering-task` (§3.8), state the assumption, proceed; ask Tech Lead only if that genuinely doesn't fit.

### 3.2 Open with the session plan

First reply opens with the owner-facing «План сессии» block (RU, ≤6 lines; format: CLAUDE.md → Session plan), then: kind, active artifact (Issue #N / spec path / ADR section), skill dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly. No vendor auto-discovery — the path is the contract.

### 3.4 Superpowers whitelist (single exception)

`superpowers:brainstorming` is the only `superpowers:*` skill allowed for project work, and only as the step-2 implementation vehicle of `author-feature-spec` (and its `do-product-discovery` upstream) — never as the orchestrator (that is the catalog skill, §3.3). Do not chain into `superpowers:writing-plans` — the requirements/design triplet is the plan (ADR-0007 §2.4). Every other `superpowers:*` skill, and any chain one initiates internally, is disallowed for project work; referencing them as patterns inside project SKILL.md content is fine.

### 3.5 Bootstrap

`pnpm bootstrap` (alias `tsx tools/agent-bootstrap.ts`) gives git/Issue/PR/spec state (Claude Code: automatic on SessionStart). Its ready/working/awaiting rollup is a derived view, not ground truth — read the actual open board (`gh issue list` + Projects v2) and triage every item; never conclude "nothing to do" from a `ready: none` rollup. After a slice ships, drain the matured debt/ops backlog before the next product feature.

### 3.6 Permission-mode disclosure

With `--dangerously-skip-permissions` the agent assumes the discipline responsibility CI guards would enforce; broken CI guards + bypass mode amplify each other.

### 3.7 Plane lifecycle entry (if applicable)

Plane work-item (DSP-XXX / DSO-XXX) → first action after identifying kind: (1) move to `In Progress`, (2) post a start comment with the planned approach — before any edit. Completion counterpart (`Done` + result comment) is a §6 Hard rule. Reads AND writes via `plane-pp-cli` (`projects issues …`); Plane MCP is an equivalent alternative.

### 3.8 Engineering-task discipline (no orchestration skill)

The §6 discipline gates still apply, run by the lead:

- `surface-decision-debt` (inline) — mandatory before the result comment; output `[]` or a list.
- `request-mode-a-review` (dispatch) — mandatory before merge for any PR touching runtime/product code or a CI-gating guard; pure docs / test-only / generated-regen PRs may merge on green CI — except the skill's §Scope carve-outs (spec artifacts incl. product-layer brief/PRDs; merge/CI-procedure docs; infra/IaC security-posture claims): dispatch Mode (a) even with no runtime code.
- `run-iteration-end-checklist` is not dispatched (CI covers test/typecheck/lint/drift); its remaining items (module README, architecture/operations docs, glossary terms) are an inline self-check before opening the PR.

---

## 4. Review modes & merge gate

Per ADR-0007 §2.10. Mode (a) — same-session subagent dispatch via `request-mode-a-review` (structured APPROVE / REQUEST_CHANGES verdict). Mode (b) — parallel Codex CLI session. Mode (c) — pure human review. LLM credentials live in the human's terminal, not CI; no automated reviewer-bot.

**Merge gate.** Positive Mode (a)/(b) verdict + green CI suffices: `gh pr merge <N> --squash --delete-branch`; human-merge not required (Mode (c) stays human). CI is a manual gate in Phase 0 — confirm `gh pr checks` green by hand before merging (`--auto` is dropped on Free). Procedure: skills `request-mode-a-review` + `merge-when-green`.

---

## 5. Lint guards

CI lint guards (ADR-0007 §2.6) surface as PR Checks. Authoritative list + severity: `.github/workflows/ci.yml` + `pr-body-guards.yml` (re-runs on body edits); WARN→BLOCK criterion + sweep cadence: ADR-0007 §2.6. `spec-link` / `endpoint-authz` / `playwright-axe` / `prod-surface` are BLOCK; the rest WARN in Phase 0 (baseline drift/glossary are separate hard-red checks).

---

## 6. Hard rules

- **SDD.** No production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`; absent → `author-feature-spec` (§3.1) first.
- **Vertical slices over horizontal layers (F-22).** Every feature-spec declares `surface: backend-only | user-facing` in `NNN-requirements.md` frontmatter. Backend-only is verified by Vitest e2e alone; `user-facing` owns its UI deliverable in the same WBS as its backend; backend-first only as an explicit tracked deferral named in the spec. A UI surface in any EARS trigger forbids `backend-only`. Enforced by `author-ears-spec`, `open-ears-issues` 3a, `run-iteration-end-checklist` item 12.
- **No untracked seam / scaffold (F-22).** A scaffold/stub/fake/fail-closed seam standing in for a real deliverable is decision-debt; a code comment is not a tracked obligation. Significance threshold: an Issue with a real-dependency done-criterion ONLY when it blocks a product deliverable, is user-visible or a prod risk (security/data), or must precede the next release; else a `DEBT.md` line. Detail: `open-ears-issues` 3a.
- **Orchestration is the default execution mode.** Implementation/execution dispatches to subagents; inline requires naming a sanctioned carve-out — an unnamed inline edit is a visible violation. Closed list (the `#700-M1` dispatch-guard hook's WARN set): (i) read-only recon/scope framing; (ii) ≤2 consecutive lead main-tree mutations (hook WARNs at 3); (iii) a skill's declared `mode:inline` step within its size cap (`do-feature-iteration` RED/GREEN/REFACTOR share the ≤2 cap). Nothing else: an impl-heavy/to-merge session opens with a dispatch.
- **No workarounds, no patches, no temporary hacks.** Monkey-patch, local edit "just to make it run", manual one-off step, hardcoded stand-in for missing config — forbidden, in code and process. Prerequisite not ready → STOP, fix it properly first as its own tracked Issue wired `blocked_by`. (a) Never rush a UI/integration layer ahead of its backend; (b) verification counts only against clean committed code; (c) "just get it working now" signals re-sequence, not patch.
- **Live-infra destructive actions — pre-flight, don't thrash.** On live paid infra, before ANY irreversible/destructive provider call (reinstall/replace/delete/network change/write-`action` API): (1) action + params confirmed in provider docs/schema first — fire-an-unknown-action-and-read-the-error is banned; (2) the prior hypothesis excluded with read-only evidence before the next state-change — a reboot/reinstall/recreate is not a free probe; (3) blast radius = the failing resource only — a "fix" that also mutates a working box is a stop-and-confirm signal; (4) anything irreversible needs an explicit owner "go" — a rhetorical owner question is not consent, and an owner/vendor recommendation is binding; deviation needs explicit sign-off.
- **UI from the design system — adopt before bespoke.** All UI from `@ds/design-system`: tokens-only styling (arbitrary Tailwind values lint-blocked, §5); interactive elements + hover/active/focus states from its primitives, never hand-assembled from token utilities. Before any bespoke page/form/element: run the `build-ui-from-design-system` gate — inventory the package, search the approved registry whitelist (official shadcn · Origin UI · Intent·Jolly · Kibo), report the result; bespoke = recorded last resort. Product code is `UNLICENSED`: adopt MIT/permissive freely (preserve notices); proprietary/paid registries need a license + private repo, else pattern-only. Canvas-derived UI: vendor every rendered canvas (incl. composed units) into `design-source/` first (DesignSync), build from the files, not issue prose; before Stage-B the lead runs the eyes-on render + interaction-state parity check (both breakpoints × both themes). Canon: ADR-0013 + the skill.
- **UI design is approved before it's built — and re-confirmed live before merge.** For a `user-facing` surface (notification emails/SMS included) look + behavior changes are product decisions, not lead calls. Stage A: design proposal with research findings + 2-3 concrete options → explicit product-owner choice before implementation. Stage B: rendered result re-confirmed by the owner on the LIVE stand before merge — stand stays up until the verdict; an unanswered Stage-B question BLOCKS the merge. Carve-outs (exact recorded forms: `repo-conventions.md` pre-merge gates + the skill): batched — an owner-designated Stage-B gate Issue defers live Stage-B (stands stay up; child PRs merge on Mode-a + green CI, body naming `Stage-B: batched at #<gate>`; silent deferral = violation); lead self-cert — behavioral-only, NO new/changed visual surface, ONLY with explicit owner autonomous-merge auth AND a recorded lead live-verify, never to bypass a pending design question. Canon: skill `build-ui-from-design-system` → Design-approval gate.
- **Verify UI live before "done".** Drive any UI-checkable feature in the actual running UI (Playwright, live dev-stand) — build/typecheck/lint/Mode-a are necessary, not sufficient. Every field kind × surface, reject + accept, error language + timing; a user-facing dev placeholder is a banned stub.
- **PR lifecycle runs to completion.** "PR open" ≠ "done". Autonomously: Mode (a) → `gh pr checks` green by hand → merge (§4) → Issue closed → board Status = Done → re-sweep branches/PRs; do not stop midway. Exception: a `user-facing` PR merges only after the recorded owner Stage-B "go" — never merge past a pending design question or tear down the stand before the owner verified.
- **TDD.** No production code without a failing test. `it('EARS-N: ...')`; flat numbering per ADR-0006 §4; nested `N.M` only for a handler with multiple shall-clauses.
- **Trackers.** Code-level → GitHub Issues here; strategic/cross-team → Plane `doctor-school`. Never both.
- **Plane lifecycle.** `In Progress` + start comment before work; on completion `Done` + result comment (artifacts, what was done, open questions, what is unblocked); incomplete → a "where we stopped / what remains" comment, never silent.
- **Roles, not names** in any spec / ADR / design doc.
- **Direct push to `main` is forbidden.** Single merge command (Phase 0): `gh pr merge <N> --squash --delete-branch`.
- **Worktree-per-session when parallel.** Sessions run concurrently here. If any other session may touch the repo, isolate in a git worktree as the FIRST action of a code/doc task — including the analysis reads that inform the design: `pnpm task:worktree <N>` → `EnterWorktree path:.claude/worktrees/<N>` → `pnpm install` before the first commit (a PreToolUse hook warns on main-tree source reads until then). Never `git checkout -b` in the shared main tree. Carve-out — orchestration-lead, read-only: a lead dispatching ALL deliverable edits to worktree'd subagents, zero main-tree writes, may stay read-only in main; the read-guard re-arms on the first main-tree WRITE — isolate before it. Merge/teardown: skill `merge-when-green`.
- **Project skill catalog.** Only `apps/docs/content/skills/` (§3.3 — the path is the contract).
- **Discipline gates.** `run-iteration-end-checklist` and `request-mode-a-review` produce artifacts the lead cannot bypass; without their outputs, merge is forbidden (ADR-0007 §2.4).
- **Decision-debt.** Silent deviation from documented convention MUST surface via `surface-decision-debt` before the summary/result comment; route by the significance threshold — Issue (one `source:*` label) or `DEBT.md` line.
- **Amendment vs inline rewrite.** A decision not yet running in production gets NO amendment block in ADR/spec/design docs — amendments only once it is live in production. Everywhere else: inline rewrite, the body reading as if the current decision were always the decision; history lives in `git log`. Applies to these instruction files too: replace a section, don't append.

---

## 7. Roles

Specs / ADRs / process docs use roles, not names.

- Tech Lead / System Architect — IT architecture, AI orchestration, product engineering, bizmodel; primary code author.
- Product Lead — Doctor.School owner, MBA marketer, pharma sales, domain expertise; primary product/PRD author.
- Partner / Strategic — data centers, AI wellness adjacency; not in dev loop.

In Phase 0, Tech Lead is the single CODEOWNERS owner (ADR-0008 §2.7) and the single human approver on PRs.

---

## 8. Where things live

- ADRs / companion design specs: `apps/docs/content/adr/NNNN-<slug>.md` / `…-design.md`
- Feature specs (triplet): `apps/docs/content/specs/features/NNN-<slug>/`
- Tech specs (brainstorm): `apps/docs/content/specs/tech/<topic>.md`
- Project skill catalog: `apps/docs/content/skills/<name>/SKILL.md`
- Glossary: `apps/docs/content/product/glossary/` (file-per-term, Keystatic-managed)
- API contract SSOT / DB schema SSOT: `packages/schemas/` (Zod) / `packages/db/schema/` (Drizzle)
- Generated — never edit by hand: `packages/api-client/`, `packages/glossary/src/ids.ts`
- Lint tools / bootstrap: `tools/lint/*.ts` / `tools/agent-bootstrap.ts` (`pnpm bootstrap`)
- Strategic / cross-team work-items: Plane `doctor-school` (DSP, DSC, DSM, DSO); code-level Issues → GitHub here

Tracker rule (ADR-0006 §9): `gh` CLI first for code-level Issues; `pp-plane` only for cross-tracker references.

---

## 9. Local Dev Stand

Docker Compose stack driven by `pnpm dev:*`; read endpoints from `~/.ds-platform/.env.local`, never hardcode. Operating rules, DX cheat sheet, migration safety, failure modes: `.claude/rules/dev-stand.md`.
