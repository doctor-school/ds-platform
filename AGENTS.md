# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo. At session entry read [portable agent discipline](apps/docs/content/agent-discipline.md): session plan, tool/model mappings, dispatch/context, authorization and memory policy. Claude-only bindings: `CLAUDE.md`; Codex roles: `.codex/agents/`.

On-demand conventions and dev-stand rules: §0; task procedure: §3.

---

## 0. Read-before-you-act index

Read the indexed reference in full before its action, once per session and after compaction; these scoped rules hold gates and load on demand only.

- `.claude/rules/repo-conventions.md`: Branches (branch naming, closure, `pr:land`); Commits, versioning, PRs (PR creation, changesets, preflight, merge gate); Release train + skill `run-prod-deploy` (prod deploy/release); Dependency bumps; Issue conventions (Issues, claims, dependencies, resume checks); ADRs & specs (ADR/spec/PRD placement).
- `.claude/rules/dev-stand.md`: Endpoints, DX commands (`dev:*`, stand endpoints); Snapshot before migrate (migration); Shared-stand discipline (DB/volume operations, stand-capable brief); Parallel sessions (ports, listeners, branch DB); Rules for agents + `build-ui-from-design-system` (browser/live UI/Stage-B handback, staging slot).

---

## 1. What is DS Platform

Medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). ADRs 0001–0008 accepted.

**Production is live with users** on Timeweb (ru-3): `academy.doctor.school` / `api.` / `id.`. Never tell the owner "there is no production". Authoritative deployed scope = the derived `## Project reality` bootstrap section (`pnpm bootstrap`) + GitHub Releases/Deployments — never inferred from these docs.

Stack (ADR-0002–0006 in `apps/docs/content/adr/` + `README.md`): NestJS + Zod + REST + openapi-typescript SDK; Postgres 17 + Drizzle + pgvector; Next.js 15 + Refine (promo/portal/admin/cms-Payload-v3); React Native + Expo + WatermelonDB; Fumadocs + glossary.

---

## 2. Repository conventions

Monorepo pnpm 10 + Turborepo; trunk-based `<prefix>/<N>-<slug>`, Conventional Commits, squash/delete on merge. `.claude/rules/repo-conventions.md` holds the mandatory required fields, changesets, native technical dependency links, board Done and canonical landing. New feature specs land before implementation; corrections to approved behavior/docs may share its code PR (repo-conventions → ADRs & specs). Prod ships only through `pnpm deploy:prod` and its release-readiness/authorization policy.

---

## 3. Work protocol

Repository changes follow the task-kind procedure below; other requests follow portable discipline.

### 3.1 Identify task kind

- feature-iteration — one EARS handler in an existing feature-spec → `do-feature-iteration`
- hotfix-pr — code-level bug, no feature-spec required → `do-hotfix-pr`
- adr-revision — edit to an existing ADR (inline rewrite) → `do-adr-revision`
- decision-debt — closing a surfaced silent-decision artifact → `do-decision-debt-followup`
- engineering-task — CI hardening, scaffold, Phase A bootstrap (DSP-160) → no skill, §3.8
- product-discovery — new product epic / user-facing feature, no PRD yet → `do-product-discovery`
- spec-authoring — new feature-spec / ADR / design-spec → `author-feature-spec`

Answers, analysis, exports and authorized standard operations → direct execution, `run-task-lifecycle` Scope gate; no repository change implied. Dependency bump → `engineering-task` + repo-conventions checks. Merged-spec Issues → `open-ears-issues`. New user-facing scope → discovery → spec → implementation (ADR-0014). Otherwise → `engineering-task` (§3.8); state the assumption, ask only if it genuinely does not fit.

### 3.2 Open with the session plan

For repository-changing work, first reply opens with the «План сессии» block (format: agent-discipline → Session plan), then: kind, track (`track:*`), active artifact (Issue #N / spec path / ADR section), skill dispatched.

### 3.3 Load the skill

`Read` `apps/docs/content/skills/<name>/SKILL.md` directly — the path is the contract; no vendor auto-discovery.

### 3.4 Vendor skill packs are off

Project execution uses only `apps/docs/content/skills/`. The vendored `brainstorming` is a scoped step of the project orchestrators, never a replacement. The SDD triplet is the plan (ADR-0007 §2.4); do not chain into a global plan-writing skill.

### 3.5 Bootstrap

`pnpm bootstrap` gives git/Issue/PR/spec state (Claude Code: automatic on SessionStart); portable discipline governs how far to trust its rollup. Board triage belongs to requested backlog/continuing-wave work; a named task starts from its own linked state. In an authorized continuing wave, drain matured debt/ops before the next product feature; otherwise finish the requested scope and stop.

### 3.6 Permission-mode disclosure

State the actual harness permission mode when relevant (Claude flags never govern Codex); hook enforcement and telemetry: `tools/hooks/README.md`.

### 3.7 Plane lifecycle entry (if applicable)

Plane work-item (DSP-XXX / DSO-XXX) → first action after identifying kind: `In Progress` + a start comment with the planned approach, before any edit (§6 Plane lifecycle owns the completion counterpart). Reads and writes via `plane-pp-cli` (`projects issues …`); Plane MCP is an equivalent alternative.

### 3.8 Engineering-task discipline (no orchestration skill)

The §6 discipline gates still apply, run by the lead:

- `surface-decision-debt` (inline) — mandatory before the result comment; output `[]` or a list.
- `request-mode-a-review` (dispatch) — mandatory before merge for any PR touching runtime/product code or a CI-gating guard; pure docs / test-only / generated-regen PRs may merge on green CI, minus the carve-outs enumerated in that skill's §Scope (dispatch Mode (a) there even with no runtime code).
- `run-iteration-end-checklist` is not dispatched (CI covers test/typecheck/lint/drift); its remaining items (module README, architecture/operations docs, glossary terms) are an inline self-check before opening the PR.

---

## 4. Review modes & merge gate

Per ADR-0007 §2.10. Mode (a) — same-session subagent dispatch via `request-mode-a-review` (structured APPROVE / REQUEST_CHANGES verdict). Mode (b) — parallel Codex CLI session. Mode (c) — pure human review. LLM credentials live in the human's terminal, not CI; no automated reviewer-bot.

**Merge gate.** Positive Mode (a)/(b) verdict + green CI suffices; human-merge not required (Mode (c) stays human). Close out from the main tree, never from a worktree: the `ds-lander` agent runs `pnpm pr:land <N>` — the single entry point for the complete tail (the lead by hand only after resolving a reason the lander returned); `pnpm merge:when-green <N>` only when that tail is intentionally completed separately. Refusal (exit `4`), recovery and exceptions: repo-conventions → Branches; procedure: `request-mode-a-review` + `merge-when-green` (never `--auto`).

---

## 5. Lint guards

Guards surface as PR Checks. Authoritative list/severity: `.github/workflows/ci.yml` + `pr-body-guards.yml` (re-runs on body edits); WARN→BLOCK criterion + cadence: ADR-0007 §2.6. `spec-link` / `endpoint-authz` / `playwright-axe` / `prod-surface` / `no-primitive-style-override` are BLOCK; the rest WARN in Phase 0 (baseline drift/glossary: separate hard-red).

---

## 6. Hard rules

- New feature behavior requires an approved spec at `apps/docs/content/specs/features/NNN-<slug>/` (SDD); absent → `author-feature-spec` first. Maintenance/hotfixes restoring approved behavior need no new spec; update existing docs in the same PR. New product/architecture decisions keep their approval/spec gates.
- Vertical slices over horizontal layers (F-22): every feature declares `surface: backend-only | user-facing` in requirements frontmatter. A UI deliverable/trigger requires `user-facing` with UI and backend in one WBS; backend-first needs a named tracked spec deferral. Backend-only uses Vitest e2e; user-facing owns browser verification. Enforced by `author-ears-spec`, `open-ears-issues` 3a and checklist item 12.
- No untracked seam / scaffold (F-22): a stub/fake/fail-closed seam replacing a deliverable is decision-debt; a comment is not tracking. Open an Issue only when it blocks a product deliverable, is user-visible/prod-risk, must precede release, or blinds a CI guard; otherwise use DEBT.md. Closing it means delivering and wiring the real dependency. Canon: `open-ears-issues` 3a.
- The lead authors briefs and reviews and dispatches implementation, small hotfixes included; it does not author inline. Start a new environment or operation from the running production mechanism; add a component only when a named requirement needs it. Scope, reuse, context budget and returns: agent-discipline → Dispatch, models and context; return the conclusion, details go to the PR or scratchpad.
- No workarounds, patches or temporary hacks: fix the responsible mechanism; never mask failures with manual data, stand-ins, bypasses or weakened checks. One-off actions need no new subsystem or automation. A blocker must prevent acceptance or leave a concrete material risk; a WARN or adjacent improvement is not one. Resolve genuine prerequisites before dependent work; track them with `blocked_by` only when they need separate delivery. Reversible diagnosis may precede the fix; final verification uses real behavior on committed code.
- **Live-infra destructive actions — pre-flight, don't thrash.** On live paid infra, before ANY irreversible/destructive provider call (reinstall/replace/delete/network change/write-`action` API): (1) confirm action + params in provider docs/schema first — firing an unknown action to read the error is banned; (2) exclude the prior hypothesis with read-only evidence before the next state-change — a reboot/reinstall/recreate is not a free probe; (3) blast radius = the failing resource only — a "fix" that also mutates a working box is a stop-and-confirm signal; (4) anything irreversible needs an explicit owner "go" — a rhetorical owner question is not consent; an owner/vendor recommendation is binding and deviation needs sign-off.
- UI comes from `@ds/design-system`, adopted before bespoke: tokens-only styling (arbitrary Tailwind values lint-blocked, §5), interactive elements and their states from its primitives. Anything bespoke runs the `build-ui-from-design-system` gate first (inventory → approved whitelist → report; bespoke = recorded last resort); canvas-derived UI is vendored into `design-source/` and built from those files, not from issue prose. Licensing, whitelist, canvas + parity procedure: ADR-0013 + the skill.
- Cross-front capability reuse before invention: one canonical shared-package core per cross-front behavior (feed/card/calendar/filter/query/live/room). Apps add only thin defaults/authz/envelope/route/copy projections — no app-to-app imports, copied state/query logic or fork UI. Canon: ADR-0013 A1; registry `specs/product/two-site-ia/capability-ownership.md`; Issue `Reuse:` + cross-front-reuse guard.
- UI is approved, then driven by the agent, then re-confirmed live by the owner. `user-facing` look + behavior (emails/SMS too) are product decisions, not lead calls. Stage A: reuse a valid recorded approval; anything new/unresolved needs research + options + an owner choice before implementation. Drive any UI-checkable feature live (Playwright; build/typecheck/lint/Mode-a are not sufficient): journeys + dependent states, reject + accept, error language/timing; a user-facing dev placeholder is a banned stub. Stage B: a per-PR slot (§9), never localhost, raised only with a Stage-B request (PR comment + same chat message, not a handoff prompt), kept until the verdict; unanswered, it blocks the merge; deferral ⇒ down now + «re-raise after X»; new head ⇒ a new request. Only the batched/behavioral-self-cert routes in `build-ui-from-design-system` apply; markers: repo-conventions → pre-merge gates.
- Finish the PR tail — required review → green CI → canonical merge (§4) → Issue/board Done → re-sweep — then any remaining authorized work; report per `report-task-outcome`. Stage B still gates user-facing merge and stand teardown; blocker and pause rules: agent-discipline.
- TDD: no production code without a failing test. `it('EARS-N: ...')`; flat numbering per ADR-0006 §4; nested `N.M` only for a handler with multiple shall-clauses.
- Trackers: code-level → GitHub Issues here; strategic/cross-team → Plane `doctor-school`; never both. Plane lifecycle: `In Progress` + start comment before work; on completion `Done` + result comment (artifacts, what was done, open questions, what is unblocked); incomplete → a "where we stopped / what remains" comment.
- Roles, not names, in any spec / ADR / design doc.
- Worktree-per-session when parallel: every branch lives in its own worktree (`pnpm task:worktree <N>`; `pnpm install` before its first commit); the main tree stays on `main` and takes changes only through the §4 merge command. Workers isolate themselves as their first code/doc action, reads included; the lead keeps its cwd in the main tree and dispatches into `.claude/worktrees/<N>`, reaching it via absolute paths and `git -C`. Why, closeout and teardown: repo-conventions → Closeout, `merge-when-green`.
- Discipline gates: record applicable checklist evidence (inline or dispatched per its skill); keep independent review where `request-mode-a-review` §Scope requires it. Required verdicts and green CI cannot be bypassed (ADR-0007 §2.4).
- Decision-debt: silent deviation from documented convention surfaces via `surface-decision-debt` before the summary/result comment, routed by the significance threshold — Issue (one `source:*` label) or `DEBT.md` line.
- Amendment vs inline rewrite: a decision not yet running in production gets no amendment block in ADR/spec/design docs — amendments only once it is live in production. Everywhere else, including these instruction files, rewrite inline so the body reads as if the current decision were always the decision; history lives in `git log`.

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

## 9. Stands

Local dev stand — Compose via `pnpm dev:*`; endpoints from `~/.ds-platform/.env.local` (never hardcode); the AGENT's loop. Rules, DX, migrations, failures: `.claude/rules/dev-stand.md`. Owner-facing Stage-B stand = a per-PR slot on `stage.doctor.school` (`pnpm stage:slot up pr-<N>`): `tools/staging/README.md`.
