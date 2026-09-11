# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo. At session entry read [portable agent discipline](apps/docs/content/agent-discipline.md): session plan, tool/model mappings, dispatch/context, authorization and memory policy. Claude-only bindings: `CLAUDE.md`; Codex roles: `.codex/agents/`.

<!-- ALWAYS-ON CORE. Budget ≤200 lines AND ≤25 KB per file, ≤30 KB across each effective startup set, including the mandatory shared reference (`pnpm lint:instruction-budget`). Per-harness root sets: Codex = AGENTS.md (or AGENTS.override.md); Claude = this file + CLAUDE.md: both `.claude/rules/*.md` are `paths:`-scoped (#1370) and reach the session through the §0 index. Relocate detail into a `paths:`-scoped rules file (frontmatter in the FIRST bytes, or it is not frontmatter) + a §0 row. Never inline-grow. -->

On-demand detail: `.claude/rules/repo-conventions.md` (branches/commits/versioning/Issues/PRs/merge) and `.claude/rules/dev-stand.md` (dev stand/migrations/live-verify) — both `paths:`-scoped, so READ them (§0), they do not auto-load; per-task procedure → the §3 skill; settled facts → auto-memory (`MEMORY.md` index → topic file).

---

## 0. Read-before-you-act index

Both `.claude/rules/*.md` files carry `paths:` frontmatter: they enter context only when a matching file is read, and are NOT re-injected after `/compact`. They hold hard gates, not background reference. Codex reads these references explicitly; it does not import Claude rules. Before the action below, read the named file in full — once per session, again after a `/compact`; "I remember the rule" is not a substitute.

| Before action                                   | Read reference / section                          |
| ----------------------------------------------- | ------------------------------------------------- |
| Branch naming, closure, `pr:land`               | `repo-conventions.md` → Branches                  |
| PR creation, changesets, `--no-verify`          | → Commits, versioning, PRs                        |
| Preflight, merge gate, exemptions, bot releases | → Commits, versioning, PRs                        |
| Prod deploy/release                             | → Release train; skill `run-prod-deploy`          |
| Dependency bumps                                | → Dependency bumps                                |
| Issue creation/fields/claim/dependency/status   | → Issue conventions                               |
| Resume/handoff verification                     | → Issue conventions                               |
| ADR/spec/PRD placement                          | → ADRs & specs                                    |
| `dev:*` or stand endpoints                      | `dev-stand.md` → Endpoints, DX commands           |
| Migration                                       | → Snapshot before migrate                         |
| DB/volume operations, stand-capable brief       | → Shared-stand discipline                         |
| Ports, listeners, branch DB                     | → Parallel sessions                               |
| Browser/live UI/Stage-B handback                | → Rules for agents; `build-ui-from-design-system` |

---

## 1. What is DS Platform

Medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). ADRs 0001–0008 accepted.

**Production is live with users** on Timeweb (ru-3): `academy.doctor.school` / `api.` / `id.`. Never tell the owner "there is no production". Authoritative deployed scope = the derived `## Project reality` bootstrap section (`pnpm bootstrap`) + GitHub Releases/Deployments — never inferred from these docs (static prose rots).

Stack (detail in `apps/docs/content/adr/` + `README.md`): NestJS + Zod + REST + openapi-typescript SDK (0002); Postgres 17 + Drizzle + pgvector (0003); Next.js 15 + Refine — promo / portal / admin / cms-Payload-v3 (0004); React Native + Expo + WatermelonDB (0005); Fumadocs + glossary (0006).

---

## 2. Repository conventions (detail: `.claude/rules/repo-conventions.md`)

Monorepo pnpm 10 + Turborepo (`apps/`, `packages/`, `tools/`). Trunk-based `<prefix>/<N>-<slug>`, Conventional Commits, squash/delete on merge. Read `repo-conventions.md` before branch/Issue/PR/version/release actions: required fields, changesets, native technical dependency links, board Done and canonical landing are mandatory. Specs land on main before code. Prod ships only through `pnpm deploy:prod` and its release-readiness/authorization policy.

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

Existing-text export → inline, `run-task-lifecycle` Scope gate; no repository change implied. Dependency bump → `engineering-task` + repo-conventions checks. Merged-spec Issues → `open-ears-issues`. New user-facing scope → discovery → spec → implementation (ADR-0014). Otherwise → `engineering-task` (§3.8); state the assumption, ask only if it genuinely does not fit.

### 3.2 Open with the session plan

First reply opens with the «План сессии» block (format: `apps/docs/content/agent-discipline.md` → Session plan), then: kind, track (`track:*`), active artifact (Issue #N / spec path / ADR section), skill dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly. No vendor auto-discovery — the path is the contract.

### 3.4 Vendor skill packs are off

Project execution uses only `apps/docs/content/skills/`; vendor packs are disabled. The vendored `brainstorming` is a scoped step of the project orchestrators, never a replacement. The SDD triplet is the plan (ADR-0007 §2.4); do not chain into a global plan-writing skill.

### 3.5 Bootstrap

`pnpm bootstrap` gives git/Issue/PR/spec state (Claude Code: automatic on SessionStart). Its ready/working/awaiting rollup is a derived view, not ground truth — read the actual open board (`gh issue list` + Projects v2) and triage every item; never conclude "nothing to do" from a `ready: none` rollup. After a slice ships, drain the matured debt/ops backlog before the next product feature.

### 3.6 Permission-mode disclosure

State the actual harness permission mode when relevant; never imply Claude flags govern Codex. Configured hooks are not proof of trusted or observed enforcement. Follow `apps/docs/content/agent-discipline.md` and `tools/hooks/README.md`; missing telemetry is unavailable, never zero.

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

**Merge gate.** Positive Mode (a)/(b) verdict + green CI suffices; human-merge not required (Mode (c) stays human). **Close out from the MAIN tree, never from a worktree**: the `ds-lander` agent runs `pnpm pr:land <N>` — the single entry point for the complete tail (the lead by hand only after resolving a reason the lander returned); `pnpm merge:when-green <N>` only when that tail is intentionally completed separately. Closeout refusal (exit `4`), recovery, the `merge:when-green` split and the raw-`gh pr merge` exception: `repo-conventions.md` → Branches; the never-`--auto` rule: skill `merge-when-green`. Procedure: skills `request-mode-a-review` + `merge-when-green`.

---

## 5. Lint guards

CI lint guards surface as PR Checks. Authoritative list + severity: `.github/workflows/ci.yml` + `pr-body-guards.yml` (re-runs on body edits); WARN→BLOCK criterion + sweep cadence: ADR-0007 §2.6. `spec-link` / `endpoint-authz` / `playwright-axe` / `prod-surface` are BLOCK; the rest WARN in Phase 0 (baseline drift/glossary are separate hard-red checks).

---

## 6. Hard rules

- **SDD.** No production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`; absent → `author-feature-spec` (§3.1) first.
- **Vertical slices over horizontal layers (F-22).** Every feature declares `surface: backend-only | user-facing` in requirements frontmatter. Any UI deliverable/trigger requires `user-facing` with UI and backend in one WBS; backend-first needs a named tracked spec deferral. Backend-only uses Vitest e2e; user-facing owns browser verification. Enforced by `author-ears-spec`, `open-ears-issues` 3a and checklist item 12.
- **No untracked seam / scaffold (F-22).** A stub/fake/fail-closed seam replacing a deliverable is decision-debt; a comment is not tracking. Open an Issue only when it blocks a product deliverable, is user-visible/prod-risk, must precede release, or blinds a CI guard; otherwise use DEBT.md. The real dependency must be delivered and wired to close it. Canon: `open-ears-issues` 3a.
- **Orchestration is the default execution mode.** Dispatch implementation; name any inline carve-out. Closed list: read-only recon; ≤2 consecutive lead main-tree mutations; a skill-declared inline step within its cap (feature RED/GREEN/REFACTOR share ≤2). Implementation-heavy/to-merge sessions open with dispatch. Missing capabilities follow portable discipline, never silent self-review.
- **Subagent context budget.** Use observed effective input/window and the active adapter tiers, not cumulative usage or fabricated `<subagent_tokens>`. On ROTATE return a checkpoint and re-dispatch a fresh agent. One wave ≤4–5 independent Issues, ≤2 dispatch layers, returns ≤30 lines. Missing telemetry is advisory. Model routing, measured tiers and checkpoint contract: `apps/docs/content/agent-discipline.md` → Dispatch, models and context.
- **No workarounds, no patches, no temporary hacks.** Fix the responsible mechanism; never mask failures with manual data, stand-ins, bypasses or weakened checks. Solve the requested task fully and reliably; one-off actions need no new subsystem or automation. Missing prerequisite → STOP, fix first as its own Issue wired `blocked_by`; never rush UI/integration ahead of its backend. Verify real behavior on clean committed code.
- **Live-infra destructive actions — pre-flight, don't thrash.** On live paid infra, before ANY irreversible/destructive provider call (reinstall/replace/delete/network change/write-`action` API): (1) confirm action + params in provider docs/schema first — firing an unknown action to read the error is banned; (2) exclude the prior hypothesis with read-only evidence before the next state-change — a reboot/reinstall/recreate is not a free probe; (3) blast radius = the failing resource only — a "fix" that also mutates a working box is a stop-and-confirm signal; (4) anything irreversible needs an explicit owner "go" — a rhetorical owner question is not consent; an owner/vendor recommendation is binding and deviation needs sign-off.
- **UI from the design system — adopt before bespoke.** All UI from `@ds/design-system`: tokens-only styling (arbitrary Tailwind values lint-blocked, §5), interactive elements and their states from its primitives, never hand-assembled. Anything bespoke runs the `build-ui-from-design-system` gate first (inventory → approved whitelist → report; bespoke = recorded last resort); canvas-derived UI is vendored into `design-source/` and built from those files, never from issue prose. Licensing, whitelist, canvas + parity procedure: ADR-0013 + the skill.
- **Cross-front capability reuse before invention.** One canonical shared-package core per cross-front behavior (feed/card/calendar/filter/query/live/room). Apps add only thin defaults/authz/envelope/route/copy projections. No app-to-app imports, copied state/query logic or fork UI. Canon: ADR-0013 A1; registry `specs/product/two-site-ia/capability-ownership.md`; Issue `Reuse:` + cross-front-reuse guard.
- **UI design is approved before it's built — and re-confirmed live before merge.** On a `user-facing` surface (notification emails/SMS included) look + behavior are product decisions, not lead calls. Stage A: research + 2–3 concrete options → explicit owner choice before implementation. Stage B: the rendered result re-confirmed by the owner on the LIVE stand before merge — stand up until the verdict, an unanswered question BLOCKS the merge. Two carve-outs only, batched gate Issue and behavioral-only lead self-cert, usable solely in their exact recorded body forms. Canon: skill `build-ui-from-design-system` → Design-approval gate; markers: `repo-conventions.md` → pre-merge gates.
- **Verify UI live before "done".** Drive any UI-checkable feature in the actual running UI (Playwright, live dev-stand) — build/typecheck/lint/Mode-a are necessary, not sufficient. Every field kind × surface, reject + accept, error language + timing; a user-facing dev placeholder is a banned stub.
- **PR lifecycle runs to completion.** Autonomously: Mode (a) → `gh pr checks` green → merge (§4) → Issue closed → board Status = Done → re-sweep branches/PRs → owner-facing report per skill `report-task-outcome`, read at report time; never stop midway. Exception: a `user-facing` PR needs the recorded owner Stage-B "go" — no merge, no stand teardown before that verdict.
- **TDD.** No production code without a failing test. `it('EARS-N: ...')`; flat numbering per ADR-0006 §4; nested `N.M` only for a handler with multiple shall-clauses.
- **Trackers.** Code-level → GitHub Issues here; strategic/cross-team → Plane `doctor-school`. Never both.
- **Plane lifecycle.** `In Progress` + start comment before work; on completion `Done` + result comment (artifacts, what was done, open questions, what is unblocked); incomplete → a "where we stopped / what remains" comment, never silent.
- **Roles, not names** in any spec / ADR / design doc.
- **Direct push to `main` is forbidden.** Land via the single §4 merge command.
- **Worktree-per-session when parallel.** Isolate as the first code/doc action, including analysis reads: `pnpm task:worktree <N>` → explicit `.claude/worktrees/<N>` cwd → `pnpm install` before first commit. Never branch in the shared main tree. A lead delegating ALL edits to isolated workers may stay read-only in main; isolate before its first write. Merge/teardown: `merge-when-green`.
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
- API contract SSOT / DB schema SSOT: `packages/schemas/` (Zod) / `packages/db/src/schema/` (Drizzle)
- Generated — never edit by hand: `packages/api-client/`, `packages/glossary/src/ids.ts`
- Lint tools / bootstrap: `tools/lint/*.ts` / `tools/agent-bootstrap.ts` (`pnpm bootstrap`)
- Strategic / cross-team work-items: Plane `doctor-school` (DSP, DSC, DSM, DSO)

---

## 9. Local Dev Stand

Docker Compose stack driven by `pnpm dev:*`; read endpoints from `~/.ds-platform/.env.local`, never hardcode. Operating rules, DX cheat sheet, migration safety, failure modes: `.claude/rules/dev-stand.md`.
