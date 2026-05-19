# Agent Instructions — DS Platform

Universal AI-agent constitution for the DS Platform monorepo. Vendor-agnostic — readable by Claude Code, Codex, Cursor, or any future agent. Claude-Code-specific overlays live in `CLAUDE.md`.

---

## 1. What is DS Platform

DS Platform is the medical-education platform for Doctor.School (B2B pharma sponsor → B2D doctor audience). Greenfield monorepo in **Phase 0** — architectural ADRs (0001–0008) accepted, engineering scaffolding in progress. Pre-pilot target: **2026 Q3**.

Stack at a glance (see `apps/docs/content/adr/` for full reference):

- **Backend:** NestJS + Zod + REST + openapi-typescript SDK (ADR-0002)
- **Data:** Postgres 17 + Drizzle + pgvector (ADR-0003)
- **Frontend:** Next.js 15 + Refine — 4 apps (promo / portal / admin / cms-Payload-v3) (ADR-0004)
- **Mobile:** React Native + Expo + WatermelonDB (ADR-0005)
- **Docs:** Fumadocs + Keystatic + glossary.yaml (ADR-0006)

Long-form context: `README.md`.

---

## 2. Repository conventions

**Monorepo:** pnpm 10 workspaces + Turborepo 2.x. Root commands run via `pnpm <script>`; per-package via `pnpm --filter <name> <script>`.

**Apps live in `apps/<name>/`:** api (NestJS backend), promo, portal, admin, cms, docs, docs-cms, mobile. Shared code in `packages/<name>/` (schemas, api-client, db, glossary, hooks, design-system, observability, utils, eslint-config, tsconfig, llm-utils). Build/dev tooling in `tools/`.

**Branch strategy:** trunk-based. New work goes into `feat/DSO-NN-<slug>` or `fix/<N>-<slug>` short-lived branches. Squash-merge into `main`; branch deleted automatically.

**Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`). Light convention — squash-merge title is enforced via PR title, not a commit-message linter.

**Versioning:** changesets. Any user-facing PR → add a changeset via `pnpm changeset` (interactive). Bug fixes = patch, new features = minor, breaking = major. Internal-only PRs (refactor, docs, chore) — no changeset.

**Pre-commit:** simple-git-hooks runs `lint-staged` on staged files (ESLint `--fix` + Prettier). If the hook breaks a commit unexpectedly — `git commit --no-verify` is a valid escape hatch, but log the reason in the PR description.

**PR template is required** — set the correct label (feature/bug/chore/refactor/docs), link the Issue (`Closes #N`), mark the author (`author:claude` / `author:codex` / `author:human`). The author marker is retained for vendor detection in interactive-review modes (see §4).

**Branch protection:** `main` is protected. A PR requires:

- passing `ci` status check
- ≥1 human approval
- conversation resolved
- branch up-to-date with `main`
- linear history
- no force push, no branch deletion

**ADRs** live in `apps/docs/content/adr/`, rendered by Fumadocs at `/adr/<slug>`. Paired design spec — `NNNN-<slug>-design.md` alongside.

**Feature specs** live in `apps/docs/content/specs/features/NNN-<slug>/` (3 files: `requirements.md`, `design.md`, `scenarios.feature`). One spec → one GitHub Milestone → multiple Issues (one per EARS-handler). See §6 for SDD format.

---

## 3. AI loop discipline — 8-step cycle

Every implementation iteration follows this canonical cycle. Per ADR-0007 §2.4, with Steps 7–8 updated per ADR-0007 Amendment A1.4 (2026-05-19).

### Step 1 — READ (always first)

Run `pnpm bootstrap` (alias for `tsx tools/agent-bootstrap.ts`). Read its output — git state, open Issues/PRs, active spec, recommended next step. Then load:

- This file (`AGENTS.md`)
- `CLAUDE.md` if you are Claude Code
- Active feature spec at `apps/docs/content/specs/features/NNN-<slug>/` (requirements.md → design.md → scenarios.feature)
- ADRs listed in the spec's "Prior decisions" section
- `gh issue view <N>` for current Issue context and discussion history

### Step 2 — PLAN

Per ADR-0006 §9 conventions. If no parent Issue exists for the spec, create one:

```bash
gh issue create --title "Feature NNN: <name>" \
  --milestone "NNN-<slug>" --label "feature:NNN-<slug>" \
  --body-file .github/ISSUE_TEMPLATE/feature.md
```

Then one Issue per EARS-handler from `requirements.md`:

```bash
gh issue create --title "[NNN] EARS-N.M: <description>" \
  --milestone "NNN-<slug>" --label "feature:NNN-<slug>,kind:ears-handler,agent-ready" \
  --body "Spec: apps/docs/content/specs/features/NNN-<slug>/. Parent: #<parent-issue>."
```

`gh issue create` without `--body`/`--body-file` opens an editor and will hang in non-interactive contexts (CI, Codex cloud). Always provide a body.

Invoke `superpowers:writing-plans` skill only if the task is multi-step within a single Issue.

### Step 3 — RED (TDD: failing test first)

Per `superpowers:test-driven-development`. Write a failing test before any production code. One Vitest test per EARS:

```ts
it('EARS-3.1: when <trigger>, system shall <behavior>', () => { ... })
```

### Step 4 — GREEN

Minimum code to pass the failing test. Nothing more.

### Step 5 — REFACTOR

Clean up while staying green. Apply `superpowers:simplify`-style review if scope is non-trivial.

### Step 6 — ITERATION-END CHECKLIST (hard rules)

Before `git push`, verify all items pass (ADR-0007 §2.7):

1. `pnpm test` — green (unit + e2e where applicable)
2. `pnpm generate:all && git diff --exit-code` — no drift in generated artifacts
3. `pnpm typecheck` — green
4. `pnpm lint` — green
5. Module README updated if exports changed
6. Spec `status:` frontmatter updated (Draft → In dev → Shipped)
7. New glossary terms added if domain vocabulary grew
8. ADR created if an architectural decision was made
9. Linked Issue received a summary comment (file paths, decisions, what remains)

Failure of any item → no push. Fix it, or escalate.

### Step 7 — PR OPEN

Push the branch and open a PR with the template filled:

- Title: `<type>(<module>): <description> [#N]`
- Body: `Closes #N`, link to spec, set the type label, set the `author:*` label
- CI gates (ADR-0006 §7 drift checks + ADR-0007 §2.6 AI guards) will run; address any blocks before requesting review

### Step 8 — HUMAN-GATE MERGE (per ADR-0007 Amendment A1.4)

The human reviewer (Tech Lead) dispatches review in one of three modes — see §4 below. After any review feedback is addressed, the Tech Lead merges. **There is no automated reviewer-bot.** Merge is a single human decision based on CI status checks + (optional) LLM-assist output + human reading of the diff.

---

## 4. Review modes (replaces dropped automated reviewer-bot)

Per ADR-0007 Amendment A1.3 (2026-05-19). **Review is interactive. The human reviewer picks one mode — or combines.** LLM credentials live in the human's terminal, not in CI secrets.

### Mode (a) — same-session subagent dispatch with `/review` skill

The agent that authored the PR (in the Tech Lead's primary Claude Code session) finishes the work → the orchestrator dispatches a subagent with the `/review` skill (or `superpowers:requesting-code-review`) → the subagent reads the PR diff + spec + ADRs and returns a review report. Tech Lead reads, dispatches a fix subagent if needed, repeats.

### Mode (b) — parallel Codex CLI session

The Tech Lead opens a second terminal, runs Codex CLI on the PR. Codex reads the diff and gives an independent review. **Cross-vendor benefit retained manually** — author = Claude, reviewer = Codex (or vice versa). Tech Lead synthesizes both reviews.

### Mode (c) — pure human review

Tech Lead reviews the PR diff in the GitHub UI without any LLM assist. Appropriate for small, well-scoped PRs.

### Merge gate

**Tech Lead's single human approval + CI green.** No automated gates beyond CI. The `author:*` label and PR-template `Author` checkbox stay in the template — they enable the human reviewer to detect vendor and pick the opposing one for mode (b) cross-vendor effect.

---

## 5. Lint guards = nudges for the human reviewer

Per ADR-0007 Amendment A1.5. The CI lint guards from ADR-0007 §2.6 are retained, but their role shifts from "input feeding the reviewer-bot" to **"signal directly visible to the human reviewer in the PR Checks UI."**

| Guard                                                                         | Severity  | What the human should do                                                                                                                                                 |
| ----------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spec-link`                                                                   | **BLOCK** | Feature-PRs without a proper `Closes #N` referencing an Issue under a matching milestone won't merge. Fix the link in the PR body.                                       |
| `ears-tests`                                                                  | WARN      | Surfaces EARS-N.M IDs from the spec that lack a matching `it('EARS-N.M: ...')` test. Treat as a checklist of missing tests; not blocking, but worth fixing before merge. |
| `tdd-signal` (stub)                                                           | WARN      | Reminds you to ship tests alongside implementation. Stub today, real check later.                                                                                        |
| `spec-status-fresh` (stub)                                                    | WARN      | Spec stuck in `Draft` after a feature PR merged? Update the frontmatter.                                                                                                 |
| `prior-decisions` (stub)                                                      | WARN      | New spec without an ADR cite? Consider linking one in "Prior decisions".                                                                                                 |
| `glossary-mdx`, `glossary-roundtrip`, `module-readme`, `events-drift` (stubs) | WARN      | Placeholders; activate when the domain layer exists.                                                                                                                     |

WARN guards appear as non-blocking checks in the PR UI. BLOCK guards prevent merge. **No guard is consumed by a bot** — the human reads them.

---

## 6. SDD format — 3-file feature spec

Per ADR-0006 §4. Each feature spec is a folder under `apps/docs/content/specs/features/NNN-<slug>/`:

### `requirements.md`

Frontmatter (`tracker:` field with GitHub Milestone URL, `status:` Draft/In dev/Shipped) + sections:

- **Outcomes** — what the user/business gets
- **Scope** — what's in, what's explicitly out
- **Constraints** — non-functional, regulatory, etc.
- **Prior decisions** — ADR cites
- **Event Model** — Commands / Events / Read models / Policies
- **EARS requirements** — one per handler, format `EARS-N.M: When <trigger>, the system shall <response>.`
- **Invariants**
- **Verification** — which tests, which scenarios cover what

### `design.md`

Mermaid sequence diagrams of cascades, state diagrams of lifecycles, ER fragments. The "how" behind the "what."

### `scenarios.feature`

Gherkin — happy path + 2–3 failure branches. Transpiled to Playwright E2E via `playwright-bdd`.

**No `tasks.md`.** Tasks live in GitHub Issues (one per EARS-handler), not in Git. Git holds intent; GitHub Issues hold execution state.

If a feature has a long transaction with compensations, add a "Saga" section to `requirements.md` with an explicit compensate-mapping per step and failure policy.

---

## 7. TDD discipline

**No production code without a failing test that motivates it.** Per `superpowers:test-driven-development`:

1. Write the failing test first (RED)
2. Write minimum code to pass (GREEN)
3. Refactor while staying green

Each EARS-N.M requirement maps to **at least one test** that references the ID in its `it()` / `test()` description:

```ts
it('EARS-3.1: when OIDC callback received, system shall create or upsert the doctor profile', () => { ... })
```

Vitest for unit; Playwright (via `playwright-bdd`) for e2e from `scenarios.feature`.

---

## 8. Roles

Per memory `reference_team_roles.md`. **Specs / ADRs / process docs use roles, not names.** Names live only in operational memory.

| Role                             | Responsibility                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Tech Lead / System Architect** | IT architecture, AI orchestration, product engineering, bizmodel; primary author of code in Phase 0        |
| **Product Lead**                 | Doctor.School owner, MBA marketer, pharma sales, domain expertise; primary author of product / PRD content |
| **Partner / Strategic**          | Strategic partner (data centers, AI wellness adjacency); not in dev loop                                   |

In **Phase 0**, Tech Lead is the **single CODEOWNERS owner** (`* @sidorovanthon`, per ADR-0008 §2.7) and the single human approver on PRs. Hire #2 expands CODEOWNERS to per-path patterns + GitHub Teams.

---

## 9. Where things live

Quick reference for AI agents orienting themselves:

| Thing                                 | Location                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| ADRs                                  | `apps/docs/content/adr/NNNN-<slug>.md`                                                |
| Companion design specs                | `apps/docs/content/adr/NNNN-<slug>-design.md` (post-G8)                               |
| Feature specs                         | `apps/docs/content/specs/features/NNN-<slug>/{requirements,design,scenarios.feature}` |
| Tech specs (brainstorm)               | `apps/docs/content/specs/tech/<topic>.md`                                             |
| Glossary                              | `apps/docs/content/product/glossary/` (file-per-term, Keystatic-managed)              |
| API contract SSOT                     | `packages/schemas/` (Zod)                                                             |
| DB schema SSOT                        | `packages/db/schema/` (Drizzle)                                                       |
| Generated SDK                         | `packages/api-client/` (do not edit by hand)                                          |
| Generated glossary IDs                | `packages/glossary/ids.ts` (do not edit by hand)                                      |
| Lint tools                            | `tools/lint/*.ts`                                                                     |
| Bootstrap script                      | `tools/agent-bootstrap.ts` (run via `pnpm bootstrap`)                                 |
| BBM strategic / cross-team work-items | Plane workspace `doctor-school` (projects DSP, DSC, DSM, DSO)                         |
| DS Platform code-level Issues         | **GitHub Issues** in this repo                                                        |

**Almost-SSOT rule for trackers** (ADR-0006 §9): in the **BBM repo** (`bbm/CLAUDE.md`) the rule is "pp-plane CLI first." In **this repo** (DS Platform) the rule inverts: **"`gh` CLI first for code-level Issues; `pp-plane` only for cross-tracker references"** (e.g., when an ADR cites a Plane DSO-XXX milestone).

---

## 10. Hard rules — summary

- **SDD:** no production code without a feature spec at `apps/docs/content/specs/features/NNN-<slug>/`. If the feature has no spec → invoke `superpowers:brainstorming` first.
- **TDD:** no production code without a failing test. Naming: `it('EARS-N.M: ...', ...)`.
- **Trackers:** code-level → GitHub Issues here; strategic / cross-team → Plane in `bbm`. Never both.
- **Roles, not names** in any spec / ADR / design doc.
- **Iteration-end checklist** (§3 Step 6) — verify all 9 items before `git push`.
- **Review:** interactive only — mode (a), (b), or (c). No automated reviewer-bot in Phase 0.
