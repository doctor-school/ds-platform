# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo — vendor-agnostic, readable by any agent. Claude-Code-specific overlays: `CLAUDE.md`.

<!-- ALWAYS-ON CORE. Budget ≤200 lines AND ≤25 KB per file, ≤30 KB across the always-on set (`pnpm lint:instruction-budget`). The always-on set is this file + CLAUDE.md: both `.claude/rules/*.md` are `paths:`-scoped (#1370) and reach the session through the §0 index. Relocate detail into a `paths:`-scoped rules file (frontmatter in the FIRST bytes, or it is not frontmatter) + a §0 row. Never inline-grow. -->

On-demand detail: `.claude/rules/repo-conventions.md` (branches/commits/versioning/Issues/PRs/merge) and `.claude/rules/dev-stand.md` (dev stand/migrations/live-verify) — both `paths:`-scoped, so READ them (§0), they do not auto-load; per-task procedure → the §3 skill; settled facts → auto-memory (`MEMORY.md` index → topic file).

---

## 0. Read-before-you-act index

Both `.claude/rules/*.md` files carry `paths:` frontmatter: they enter context only when a matching file is read, and are NOT re-injected after `/compact`. They hold hard gates, not background reference. Before the action below, `Read` the named file in full — once per session, again after a `/compact`; "I remember the rule" is not a substitute.

| Before you…                                                                                                                                          | Read first                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| name a branch; close a PR/branch; `pnpm pr:land <N>`                                                                                                 | `repo-conventions.md` → Branches                                     |
| `gh pr create` — title, kind label, `Closes #N`, `author:*` body marker, `--assignee` + `--milestone`; `pnpm changeset` + bump letter; `--no-verify` | → Commits, versioning, PRs                                           |
| `pnpm pr:preflight <N>` / `--static` / `--pre-merge`; `pnpm merge:gate <N>`; `--mode-a-exempt`; the Version-Packages bot PR                          | → Commits, versioning, PRs                                           |
| `pnpm deploy:prod` / cut a release                                                                                                                   | → Release train & prod deploy (+ skill `run-prod-deploy`)            |
| a dependency / `chore(deps)` bump                                                                                                                    | → Dependency bumps                                                   |
| `pnpm issue:create` (the ONLY creation path); Issue fields; claim comment; a `blocked_by` edge; board Status = Done on merge                         | → Issue conventions                                                  |
| resume an In Progress Issue or act on a handoff (`pnpm handoff:verify`)                                                                              | → Issue conventions                                                  |
| place an ADR, a feature triplet, or a PRD                                                                                                            | → ADRs & specs                                                       |
| any `pnpm dev:*`; read a stand endpoint (never hardcode — `~/.ds-platform/.env.local`)                                                               | `dev-stand.md` → Endpoints, DX commands                              |
| `pnpm drizzle:migrate` or any raw migration                                                                                                          | → Snapshot before migrate                                            |
| `dev:reset-db`, raw `dev:psql`, touching volume data, or writing a subagent brief with stand access                                                  | → Shared-stand discipline (ban + stand-ops log)                      |
| bind a port / start api+portal (`pnpm dev:ports`); `pnpm dev:db:branch <N>`                                                                          | → Parallel sessions                                                  |
| kill a listener you did not start                                                                                                                    | → Parallel sessions (forbidden)                                      |
| drive Playwright, live-verify UI, or hand a Stage-B URL to the owner                                                                                 | → Rules for agents (+ skill `build-ui-from-design-system` → Stage B) |

---

## 1. What is DS Platform

Medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). ADRs 0001–0008 accepted.

**Production is live with users** on Timeweb (ru-3): `academy.doctor.school` / `api.` / `id.`. Never tell the owner "there is no production". Authoritative deployed scope = the derived `## Project reality` bootstrap section (`pnpm bootstrap`) + GitHub Releases/Deployments — never inferred from these docs (static prose rots).

Stack (detail in `apps/docs/content/adr/` + `README.md`): NestJS + Zod + REST + openapi-typescript SDK (0002); Postgres 17 + Drizzle + pgvector (0003); Next.js 15 + Refine — promo / portal / admin / cms-Payload-v3 (0004); React Native + Expo + WatermelonDB (0005); Fumadocs + glossary (0006).

---

## 2. Repository conventions (detail: `.claude/rules/repo-conventions.md`)

Monorepo pnpm 10 + Turborepo (`apps/`, `packages/`, `tools/`). Trunk-based branches `<prefix>/<N>-<slug>` (prefixes `feat|fix|chore|refactor|docs|tooling`), squash-merge, delete branch on merge/close. Conventional Commits; PR title = squash title. Changesets on user-facing PRs (unsure → major). The agent ships prod via `pnpm deploy:prod`, which cuts the `release-*` tag + Release at the deployed SHA (`/deploy` skill). PR template: kind label + `Closes #N` + author marker in the body (`author:*` is not a `gh --label`). Issues: native sub-issue + blocked-by/blocking links mandatory, not prose; on merge, set board Status = Done by hand. One spec → many Issues (paths: §8); code PRs only after the spec is on `main`.

---

## 3. Work protocol

Every session, any vendor: **identify task kind → open with the session plan → load skill**.

### 3.1 Identify task kind

- feature-iteration — one EARS handler in an existing feature-spec → `do-feature-iteration`
- hotfix-pr — code-level bug, no feature-spec required → `do-hotfix-pr`
- adr-revision — edit to an existing ADR (inline rewrite) → `do-adr-revision`
- decision-debt — closing a surfaced silent-decision artifact → `do-decision-debt-followup`
- engineering-task — CI hardening, scaffold, Phase A bootstrap (DSP-160) → no skill, §3.8
- product-discovery — new product epic / user-facing feature, no PRD yet → `do-product-discovery`
- spec-authoring — new feature-spec / ADR / design-spec → `author-feature-spec`

Not in the list? Dependency bump → `engineering-task` + the two checks in `repo-conventions.md` → Dependency bumps. Opening Issues from a merged spec → skill `open-ears-issues`. User-facing epic/feature with no PRD → `product-discovery` → `spec-authoring` → `feature-iteration` (ADR-0014). Still unmapped → `engineering-task` (§3.8), state the assumption, proceed; ask Tech Lead only if that genuinely doesn't fit.

### 3.2 Open with the session plan

First reply opens with the «План сессии» block (format: CLAUDE.md → Session plan), then: kind, track (`track:*`), active artifact (Issue #N / spec path / ADR section), skill dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly. No vendor auto-discovery — the path is the contract.

### 3.4 Vendor skill packs are off

No vendor skill pack is enabled for project work — the catalog is the only source (§3.3). The one skill this project used from the superpowers pack, `brainstorming`, is VENDORED at `apps/docs/content/skills/brainstorming/SKILL.md` (MIT, attribution in the file) and dispatched by catalog path like any other; the pack itself is disabled in `.claude/settings.json`. It is the step-2 vehicle of `author-feature-spec` (and its `do-product-discovery` upstream), never the orchestrator. Do not chain into a plan-writing skill: the requirements/design triplet is the plan (ADR-0007 §2.4). Citing an external skill as a pattern source inside project SKILL.md content is fine.

### 3.5 Bootstrap

`pnpm bootstrap` gives git/Issue/PR/spec state (Claude Code: automatic on SessionStart). Its ready/working/awaiting rollup is a derived view, not ground truth — read the actual open board (`gh issue list` + Projects v2) and triage every item; never conclude "nothing to do" from a `ready: none` rollup. After a slice ships, drain the matured debt/ops backlog before the next product feature.

### 3.6 Permission-mode disclosure

With `--dangerously-skip-permissions` the agent assumes the discipline responsibility CI guards would enforce; broken CI guards + bypass mode amplify each other.

### 3.7 Plane lifecycle entry (if applicable)

Plane work-item (DSP-XXX / DSO-XXX) → first action after identifying kind: `In Progress` + a start comment with the planned approach, before any edit (§6 Plane lifecycle owns the completion counterpart). Reads AND writes via `plane-pp-cli` (`projects issues …`); Plane MCP is an equivalent alternative.

### 3.8 Engineering-task discipline (no orchestration skill)

The §6 discipline gates still apply, run by the lead:

- `surface-decision-debt` (inline) — mandatory before the result comment; output `[]` or a list.
- `request-mode-a-review` (dispatch) — mandatory before merge for any PR touching runtime/product code or a CI-gating guard; pure docs / test-only / generated-regen PRs may merge on green CI, minus the carve-outs enumerated in that skill's §Scope (dispatch Mode (a) there even with no runtime code).
- `run-iteration-end-checklist` is not dispatched (CI covers test/typecheck/lint/drift); its remaining items (module README, architecture/operations docs, glossary terms) are an inline self-check before opening the PR.

---

## 4. Review modes & merge gate

Per ADR-0007 §2.10. Mode (a) — same-session subagent dispatch via `request-mode-a-review` (structured APPROVE / REQUEST_CHANGES verdict). Mode (b) — parallel Codex CLI session. Mode (c) — pure human review. LLM credentials live in the human's terminal, not CI; no automated reviewer-bot.

**Merge gate.** Positive Mode (a)/(b) verdict + green CI suffices; human-merge not required (Mode (c) stays human). **Close out from the MAIN tree, never from a worktree**, then run `pnpm pr:land <N>` — the single entry point for the complete tail; `pnpm merge:when-green <N>` only when that tail is intentionally completed separately. Closeout refusal (exit `4`), recovery, the `merge:when-green` split and the raw-`gh pr merge` exception: `repo-conventions.md` → Branches; the never-`--auto` rule: skill `merge-when-green`. Procedure: skills `request-mode-a-review` + `merge-when-green`.

---

## 5. Lint guards

CI lint guards surface as PR Checks. Authoritative list + severity: `.github/workflows/ci.yml` + `pr-body-guards.yml` (re-runs on body edits); WARN→BLOCK criterion + sweep cadence: ADR-0007 §2.6. `spec-link` / `endpoint-authz` / `playwright-axe` / `prod-surface` are BLOCK; the rest WARN in Phase 0 (baseline drift/glossary are separate hard-red checks).

---

## 6. Hard rules

- **SDD.** No production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`; absent → `author-feature-spec` (§3.1) first.
- **Vertical slices over horizontal layers (F-22).** Every feature-spec declares `surface: backend-only | user-facing` in `NNN-requirements.md` frontmatter. Backend-only is verified by Vitest e2e alone; `user-facing` owns its UI deliverable in the same WBS as its backend; backend-first only as an explicit tracked deferral named in the spec. A UI surface in any EARS trigger forbids `backend-only`. Enforced by `author-ears-spec`, `open-ears-issues` 3a, `run-iteration-end-checklist` item 12.
- **No untracked seam / scaffold (F-22).** A scaffold/stub/fake/fail-closed seam standing in for a real deliverable is decision-debt; a code comment is not a tracked obligation. Significance threshold: an Issue ONLY when it blocks a product deliverable, is user-visible or a prod risk, must precede the next release, or blinds a CI guard gating other PRs; else a `DEBT.md` line. Detail (incl. the real-dependency done-criterion): `open-ears-issues` 3a.
- **Orchestration is the default execution mode.** Implementation dispatches to subagents; inline needs a named carve-out — an unnamed inline edit is a visible violation. Closed list (`#700-M1` dispatch-guard hook WARN set): (i) read-only recon/scope framing; (ii) ≤2 consecutive lead main-tree mutations (WARN at 3); (iii) a skill's declared `mode:inline` step within its size cap (`do-feature-iteration` RED/GREEN/REFACTOR share the ≤2 cap). An impl-heavy/to-merge session opens with a dispatch.
- **Subagent context budget.** The hook rotates a subagent at 150K (`ROTATE: <checkpoint>` on line 1) and denies non-git tools at 200K; on `ROTATE:` the lead re-dispatches a FRESH agent from the checkpoint, never SendMessage-continues — as it also must once the child's `<subagent_tokens>` passes 120K, impl and reviewer alike. One dispatch ≤ 2 layers, each returning a checkpoint; briefs carry spec anchors / line ranges, never «read NNN-design.md whole». One wave (≤4–5 parallel Issues) per lead session. A subagent >200K or lead >300K is a retro finding (`pnpm retro:tokens`). Detail: CLAUDE.md → Subagent context economy.
- **No workarounds, no patches, no temporary hacks.** Monkey-patch, local edit "just to make it run", manual one-off step, hardcoded stand-in for missing config — forbidden, in code and process. Prerequisite not ready → STOP and fix it first as its own Issue wired `blocked_by`. (a) Never rush a UI/integration layer ahead of its backend; (b) verification counts only against clean committed code; (c) "just get it working now" signals re-sequence, not patch.
- **Live-infra destructive actions — pre-flight, don't thrash.** On live paid infra, before ANY irreversible/destructive provider call (reinstall/replace/delete/network change/write-`action` API): (1) confirm action + params in provider docs/schema first — firing an unknown action to read the error is banned; (2) exclude the prior hypothesis with read-only evidence before the next state-change — a reboot/reinstall/recreate is not a free probe; (3) blast radius = the failing resource only — a "fix" that also mutates a working box is a stop-and-confirm signal; (4) anything irreversible needs an explicit owner "go" — a rhetorical owner question is not consent; an owner/vendor recommendation is binding and deviation needs sign-off.
- **UI from the design system — adopt before bespoke.** All UI from `@ds/design-system`: tokens-only styling (arbitrary Tailwind values lint-blocked, §5), interactive elements and their states from its primitives, never hand-assembled. Anything bespoke runs the `build-ui-from-design-system` gate first (inventory → approved whitelist → report; bespoke = recorded last resort); canvas-derived UI is vendored into `design-source/` and built from those files, never from issue prose. Licensing, whitelist, canvas + parity procedure: ADR-0013 + the skill.
- **Cross-front capability reuse before invention.** Every cross-front behaviour (feed, card, calendar, filter, query/URL codec, live-state resolution, room-entry policy, state machine, …) has **one canonical core implementation** in a shared package; each app adds only a thin host projection (defaults, authorization, envelope, route, copy). App-to-app imports, copied query/state logic and fork UI are forbidden; divergence needs an ADR-backed reason. Canon: ADR-0013 A1 + `build-ui-from-design-system`.
- **UI design is approved before it's built — and re-confirmed live before merge.** On a `user-facing` surface (notification emails/SMS included) look + behavior are product decisions, not lead calls. Stage A: research + 2–3 concrete options → explicit owner choice before implementation. Stage B: the rendered result re-confirmed by the owner on the LIVE stand before merge — stand up until the verdict, an unanswered question BLOCKS the merge. Two carve-outs only, batched gate Issue and behavioral-only lead self-cert, usable solely in their exact recorded body forms. Canon: skill `build-ui-from-design-system` → Design-approval gate; markers: `repo-conventions.md` → pre-merge gates.
- **Verify UI live before "done".** Drive any UI-checkable feature in the actual running UI (Playwright, live dev-stand) — build/typecheck/lint/Mode-a are necessary, not sufficient. Every field kind × surface, reject + accept, error language + timing; a user-facing dev placeholder is a banned stub.
- **PR lifecycle runs to completion.** "PR open" ≠ "done". Autonomously: Mode (a) → `gh pr checks` green by hand → merge (§4) → Issue closed → board Status = Done → re-sweep branches/PRs; do not stop midway. Exception: a `user-facing` PR merges only after the recorded owner Stage-B "go" — never merge past a pending design question or tear down the stand before the owner verified.
- **TDD.** No production code without a failing test. `it('EARS-N: ...')`; flat numbering per ADR-0006 §4; nested `N.M` only for a handler with multiple shall-clauses.
- **Trackers.** Code-level → GitHub Issues here; strategic/cross-team → Plane `doctor-school`. Never both.
- **Plane lifecycle.** `In Progress` + start comment before work; on completion `Done` + result comment (artifacts, what was done, open questions, what is unblocked); incomplete → a "where we stopped / what remains" comment, never silent.
- **Roles, not names** in any spec / ADR / design doc.
- **Direct push to `main` is forbidden.** Land via the single §4 merge command.
- **Worktree-per-session when parallel.** Sessions run concurrently here; if any other session may touch the repo, isolate as the FIRST action of a code/doc task, the analysis reads included: `pnpm task:worktree <N>` → `EnterWorktree path:.claude/worktrees/<N>` → `pnpm install` before the first commit. Never `git checkout -b` in the shared main tree. Carve-out — a lead dispatching ALL deliverable edits to worktree'd subagents may stay read-only in main; isolate before the first main-tree WRITE. Merge/teardown: skill `merge-when-green`.
- **Project skill catalog.** Only `apps/docs/content/skills/` (§3.3 — the path is the contract).
- **Discipline gates.** `run-iteration-end-checklist` and `request-mode-a-review` produce artifacts the lead cannot bypass; without their outputs, merge is forbidden (ADR-0007 §2.4).
- **Decision-debt.** Silent deviation from documented convention MUST surface via `surface-decision-debt` before the summary/result comment; route by the significance threshold — Issue (one `source:*` label) or `DEBT.md` line.
- **Amendment vs inline rewrite.** A decision not yet running in production gets NO amendment block in ADR/spec/design docs — amendments only once it is live in production. Everywhere else: inline rewrite, the body reading as if the current decision were always the decision; history lives in `git log`. Applies to these instruction files too: replace a section, don't append.

---

## 7. Roles

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
- Glossary: `apps/docs/content/product/glossary/` (file-per-term)
- API contract SSOT / DB schema SSOT: `packages/schemas/` (Zod) / `packages/db/schema/` (Drizzle)
- Generated — never edit by hand: `packages/api-client/`, `packages/glossary/src/ids.ts`
- Lint tools / bootstrap: `tools/lint/*.ts` / `tools/agent-bootstrap.ts` (`pnpm bootstrap`)
- Strategic / cross-team work-items: Plane `doctor-school` (DSP, DSC, DSM, DSO)

---

## 9. Local Dev Stand

Docker Compose stack driven by `pnpm dev:*`; read endpoints from `~/.ds-platform/.env.local`, never hardcode. Operating rules, DX cheat sheet, migration safety, failure modes: `.claude/rules/dev-stand.md`.
