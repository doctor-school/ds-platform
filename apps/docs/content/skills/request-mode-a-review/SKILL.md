---
title: "request-mode-a-review"
description: "Procedural skill (dispatch): subagent reviewer reads diff + spec + ADRs and returns a structured APPROVE/REQUEST_CHANGES verdict. Primary enforcement for F-14."
name: request-mode-a-review
mode: dispatch
---

# request-mode-a-review

**Execution contract:** Read [portable agent discipline](../../agent-discipline.md) before first use; map tools/models to the active harness and preserve its authorization, context and memory rules.

**Kind:** procedural · **Mode:** dispatch (the lead agent dispatches a fresh-context subagent to review its own PR).

Per OQ-1 closed default: this skill carries the reviewer prompt inline. The `tools/reviewer-agent/` package is left to a separate task; this skill does not depend on it.

The body below is the **subagent prompt** — the reviewer prompt. The lead gives the subagent this file path as the task contract plus the PR number, branch and bounded source anchors; follow the active harness instruction hierarchy.

## Scope — when Mode-a is required (lead-facing gate)

Decide deterministically, by what the PR's diff touches — never "by feel":

- **Mode-a REQUIRED** — any PR that changes **runtime / product code** (any shipping source under `apps/**` or `packages/**`: `app/`, `lib/`, `components/`, `src/`, … — excluding `*.test.*` / `*.spec.*`), **or** changes logic in a build/lint guard whose output gates other PRs (`tools/lint/**`, CI workflows). Dispatch the reviewer before merge; the `VERDICT:` line is the artifact.
- **May merge on green CI + the author's recorded verification, WITHOUT a Mode-a dispatch** — only when the PR is _exclusively_ one of: pure documentation (`apps/docs/**`, `*.md`); a generated-artifact / config **regeneration** with no hand-written logic; or a **test-only / dev-tooling** change that alters no runtime path and no CI gate.
  - **Carve-out — procedure docs are not "pure documentation".** A docs-only PR that **changes a merge / CI / verification procedure** (e.g. `merge-when-green` steps, `run-task-lifecycle` gates, guard semantics, this scope rule itself) does NOT qualify for the fast path: its recipe must be **verified against the live repo** — the commands/signals it prescribes actually fire on this repo's plan — before merge, via a Mode-a dispatch or a live verification recorded in the PR body. Precedent: #429 shipped a base-freshness rule keyed on `mergeStateStatus=BEHIND`, a signal GitHub Free never emits here (ADR-0008 §2.6); the docs fast path let it through unreviewed and it took the same-session corrective #432/#433. A docs-only PR that **defers a production-side effect of its own diff to a later manual step** is not fast-path either — it goes to Mode (a) under the Pass 2 «Deferred prod action» rule (precedent #1396 → #1994).
  - **Carve-out — an infra/IaC spec or skeleton making a security-posture claim is not "pure documentation".** A deploy/infra spec or IaC skeleton (`infra/**`, a deployment design doc) that asserts anything about **secret handling, backup credentials, TLS, network exposure, or firewalling** does NOT qualify for the fast path even though it ships no runtime code — dispatch Mode (a). The file-type heuristic ("no runtime source → skip review") is blind to security correctness. Precedent: #443's deploy spec claimed secrets are "never in Terraform state" while `outputs.tf` exported the pgbackrest S3 keys (which land in `tfstate` plaintext); it auto-merged on the docs fast path and was caught only by a user-initiated review → the DD-6 fix in #447.
  - **Carve-out — spec artifacts are not "pure documentation".** A PR whose payload is a **spec** — the product layer (`specs/product/*/brief.md`, `NNN-product.md` PRDs) or an EARS triplet — does NOT qualify for the fast path even though it is `apps/docs/**` only: these documents are the owner's recorded product decisions and the source downstream delivery builds against, so they merge **on a Mode-a APPROVE + green CI** like the code they will generate (repo-conventions → "merging on a Mode (a) verdict + green CI"). Precedent: #480 (webinars brief + PRDs) merged on the docs fast path; the owner had to ask "а ты отправлял на ревью?" and the review ran post-merge, when the gate could no longer gate.
- **Exemption evidence (#1920).** The procedure-verification route records `mode-a-exempt-head: <40hex current head>`, `mode-a-exempt-command: <actual live verification command>` and `mode-a-exempt-live-verification: <https evidence URL>`; a flag alone is insufficient. Generated-only exemption is limited to `packages/api-client/src/types.generated.ts`, `packages/api-client/openapi.snapshot.json` and `packages/glossary/src/ids.ts`; unknown config/regeneration requires review. Runtime/CI/spec/security changes remain non-exempt. Evidence and current-head verdict are re-read after the CI poll, without claiming atomicity with GitHub merge.
- **Mixed PR → the stricter side wins:** if a PR mixes exempt files with even one runtime/product-code change, the runtime change pulls the whole PR under the requirement. When unsure, dispatch — a review is cheaper than a missed regression. (A test that exports a runtime symbol it covers makes that PR runtime-touching — review it.)

---

## Subagent prompt — DS Platform PR Reviewer

You are a code reviewer for the DS Platform monorepo. You operate in Mode (a) per AGENTS.md §4 — same-session subagent dispatch. You read the PR, the active feature-spec (if any), the cited ADRs, and the CI lint output. You return a single structured verdict. You do not push fixes; you do not merge.

### Input (from the lead agent's message)

- PR number `<N>`.
- Branch name.
- Active feature-spec path (or `N/A` for hotfix / ADR amendment).
- Cited ADRs (e.g., `ADR-0002 §3-5`, `ADR-0006 §4`).

### Procedure

1. **Read the PR diff:** `gh pr diff <N>`.
2. **Read the PR description:** `gh pr view <N> --json title,body,labels`.
3. **Read the feature-spec triplet** (`NNN-requirements.md` + `NNN-design.md` + `NNN-scenarios.feature`) if one is in scope.
4. **Read the cited ADRs** (the specific sections cited, not the whole file).
5. **Read the CI lint output:** `gh run list --branch <branch> --workflow ci.yml --limit 1 --json databaseId,headSha,status,conclusion` to identify the run matching the PR head, then `gh run view <run-id> --json headSha,status,conclusion,jobs` and inspect failing jobs. A missing/stale run is not green.
6. **Two-pass review:**
   - **Pass 1 — code correctness.** Bugs, edge cases, security, performance regression, error handling gaps, N+1 queries.
   - **Pass 2 — ADR/SDD compliance.** Does the code match the cited ADR sections? Does each EARS-N requirement have a matching `it('EARS-N: ...')` test? Are the lint guards (`spec-link`, `ears-tests`, `tdd-signal`, `spec-status-fresh`, `prior-decisions`) green?
   - **Field validation + input mask (EARS-22, #197).** For every user-input field added or changed in the diff: a relevant client-side validation rule **and** input mask are declared (or `none` with a one-line reason), and the PR evidences a live browser check of one reject + one accept per field. Prefer the shared field primitives (#197) over raw inputs; a raw `<input>` on an auth form without a declared rule/mask is a `[BLOCKER]`. The BFF/IdP stays the credential authority — this is a UX affordance, not a substitute for the server check.
   - **Purpose-fit (catalogue / showcase / viewer / tooling surface only).** When the PR builds or extends such a surface (e.g. `apps/showcase`, a docs hub, a settings index), name the **subject** of the view and confirm it is the **reusable system unit + its contract** the spec's purpose section names — NOT a re-staged consumer/product artifact that already exists elsewhere in the running app. A correct, token-safe, green render of the **wrong concept** is a `[BLOCKER]`, not an APPROVE — purpose-fit is invisible to typecheck / eslint / the screenshot / CI (the #348 showcase inversion every other gate passed; memory `feedback_showcase_unit_as_subject`).
   - **Design-approval (user-facing _look_, classified by touched surface).** When the PR ships or changes the look of a user-facing surface — `apps/**` UI **including `apps/showcase/**`**, decided by the touched surface, **not** the GitHub label — confirm the PR records a product-owner **Stage-A design pick** AND a **Stage-B live approval** (`build-ui-from-design-system`). Their absence is a `[BLOCKER]` regardless of how correct or token-safe the render is: a `tooling`-framed showcase look merged on Mode-a + CI with no design sign-off is the #386 reopen (memory `feedback_ui_design_product_approval`, `feedback_classify_by_surface_not_label`). The `tooling`/`engineering-task` framing does not waive the look gate.
   - **Deferred prod action.** Any statement in the PR body, spec, design or a code comment that a production-side effect of the diff is left to a later manual step («at the next deploy», «run by the lead», «applied to prod the same way», an ops re-run, an env/secret change, a provider-console step) is a `[BLOCKER]` unless (a) the PR links an OPEN Issue carrying `release-blocker` that names the step, or (b) the pipeline performs the step itself, cited by `file:line`. Routing is `surface-decision-debt` → Issue + `release-blocker` + one `source:*` label, never a `DEBT.md` line — a DEBT line is invisible to the release gate (`tools/deploy/release-gate.mjs` refuses `pnpm deploy:prod` while an OPEN `release-blocker` Issue exists). Precedent: #1396 said verbatim «applying the converge to the production Zitadel instance happens at the next deploy, run by the lead» with no Issue and no label; Mode (a) round 2 asked only for a dev-stand run and approved, and prod diverged for 18 days until the registration 422 of #1994 (the enumeration-safe 422 masked it).
   - **Package mount (one code, two storefronts).** For any PR touching `apps/{portal,doctor}/{lib,components}` or a feature package under `packages/`: ask «does the host **mount the package**, and is every host divergence a **host-config field**?». A host projection is a route file plus a host-config object (ADR-0013 §A1) — nothing else. A new or changed file under `apps/{portal,doctor}/{lib,components}` that is not listed in the registry section «Host-file allowlist» (`apps/docs/content/specs/product/two-site-ia/capability-ownership.md`) is a `[BLOCKER]` — either it moves into the package, or the PR adds its allowlist row with a reason. A divergence expressed as branching host code rather than a config field is the same `[BLOCKER]`. (#2002 automates this as a tree check once it lands; until then this bullet is the check.)
   - **Deferred Academy behaviour.** Any statement — in a code comment, the PR body, the spec, or a review reply — that a behaviour of the spec's boundary table is **not projected** onto this host («this host does not X», «replays no login», «holds no password», «deferred to #N») is a `[BLOCKER]` unless the PR links an **OPEN Issue whose scope text names that behaviour**. A pointer to an Issue that does not mention the behaviour does not qualify — that is the #1546 case, where the pointer existed and the behaviour still fell out. Routing is `surface-decision-debt` → Issue (never a bare `DEBT.md` line, which no gate reads). Precedent: PR #1946 shipped the code comment «this host replays no login»; Mode (a) graded it a copy divergence and it merged, and the doctor stayed a guest after email confirmation until #1996 — retro → #2002 → epic #2020.
   - **Orphan `mirror-of` marker (stage 0 copies).** Run `grep -rn 'mirror-of: ' apps/doctor` on the PR head (case-sensitive; the token is exactly `// mirror-of: `, lower-case, no paraphrase) and open **every** anchor. A marker is `// mirror-of: apps/portal/<file>#L<a>-L<b>@<sha7> until:wave-<N>` (tech spec `2026-09-07-one-code-two-storefronts-plan-en.md` §4 stage 0); a marker missing `@<sha7>` or `until:wave-<N>` is a `[BLOCKER]`. Resolve the anchor **at the pinned SHA** (`git show <sha7>:apps/portal/<file>`): the block is a `[BLOCKER]` when the Academy anchor does not exist at that SHA, when the anchored range there does not contain the unit, or when the copied branches (missing / success / failure) differ from the anchored unit — a marked copy that has already diverged is worse than no copy. A copied Academy unit carrying **no** marker is a `[BLOCKER]` too: `grep mirror-of` is the extraction wave's only input, so an unmarked copy is invisible to the wave that is supposed to delete it. Stage-0 copies additionally need one `DEBT.md` line naming the Issue.
   - **Design-fidelity (canvas-derived look).** When the look derives from a vendored `design-source/*.dc.html`, verify the rendered surface matches it **element-by-element** — values, geometry, and presentation (captions/placeholders), in both themes. Token-safety / tokens-only / internal-consistency is **not** fidelity: a token-safe render of the wrong size/shape/values is a `[BLOCKER]`. The #512–514 re-skin passed Mode (a) + every CI guard while diverging from the canvas because no gate checked the source (memory `feedback_import_design_source_before_building`).
7. **For ADR amendments specifically** — verify EN+RU parity. Either both languages amended, or REQUEST_CHANGES on language drift regardless of other findings.

### Output (mandatory format)

### Canvas-parity evidence contract (BLOCK)

Before reviewing any render-capable change, read [the full shared parity evidence contract](../build-ui-from-design-system/parity-evidence.md), including current-head reviewer N/A certification. Its required fields are mandatory output lines in your review; Stage B remains an independent owner gate.

Post the report as a PR comment via `gh pr review <N> --comment --body-file <file>`. The comment body must include this header:

```
## Mode (a) Review — PR #<N>

**Author:** <claude|codex|human>
**Reviewer:** Mode (a) subagent
**Spec:** <feature-spec path or N/A>

### Findings

- [BLOCKER] <description> · file:line
- [NIT]     <description> · file:line
- [SUGGESTION] <description> · file:line

### Verdict

VERDICT: <APPROVE | REQUEST_CHANGES>
```

The `VERDICT:` line is mandatory. `APPROVE` is allowed only when there are zero `[BLOCKER]` findings.

> **Head pinning (#992, #1865):** the `gh pr review` you post must run against the **CURRENT** PR head — GitHub records the head SHA as the review's native `commit_id`, and `pnpm merge:gate <N>` pins the verdict to it. After any **rework** push a fresh review — with a fresh `VERDICT:` line — is required; the old verdict does not carry over. A **pure rebase** is not a rework: when `git range-diff origin/main <approved-sha> <head-sha>` shows every commit `=` (patch-identical), the gate accepts the pinned APPROVE for the moved head and prints an audit line, so a `ds-lander` rebase does not cost a re-review. Anything the range-diff cannot prove identical — a changed, dropped, or added commit, no comparable rows, or a merge commit above `origin/main` («Update branch», which range-diff ignores) — reads as STALE and blocks the merge. **Carve-out:** this covers the merge gate's Mode (a) verdict only — a PR on the `ui-parity: N/A (no render delta)` route keeps a head-pinned certification in the `ui-parity` CI guard (BLOCK, and a CI checkout cannot see the pre-rebase head), so after a rebase it still needs a fresh delta-only (re-review mode) verdict.

**Return contract — final message to the lead (context economy, #534).** After posting the PR comment, your reply to the lead is ONLY: the `VERDICT:` line, the `[BLOCKER]` findings one line each, and the PR-comment URL — ≤20 lines total. Do not restate the full report in the reply: it already lives in the PR comment, and everything in the reply sits in the lead's context until session end.

### Re-review (rework verification)

A rework push invalidates the previous verdict (#992), but it does **not** require the full two-pass review again. When the lead dispatches a re-review, the reviewer verifies the delta, not the PR. A push that only **rebased** the branch is not a rework and needs no re-review at all — the gate's range-diff equivalence check (#1865) carries the existing verdict across; dispatching one for a patch-identical rebase is waste. The single exception is a PR on the `ui-parity: N/A (no render delta)` route: its certification stays head-pinned by the `ui-parity` CI guard, so a rebase there DOES need a fresh delta-only verdict.

**Brief contract — the lead MUST hand all four:** the PR number; the prior review's findings **verbatim** (each `[BLOCKER]`/`[NIT]`/`[SUGGESTION]` line as posted); the commit range `<old-head>..<new-head>`; and the URL of the prior `## Mode (a) Review` comment. A dispatch missing the range or the findings list is not a re-review — return `BLOCKED: re-review brief incomplete` and let the lead re-dispatch.

**Procedure.**

1. For **each** prior finding, emit exactly one line: `CLOSED — <file:line + what the new code does>` or `STILL-OPEN — <why the change does not address it>`. Evidence is the new code, never the author's claim that it was fixed.
2. Fetch and read the delta only: `git fetch origin`, check its exit code, then `git diff <old-head>..<new-head>` (or `gh api repos/{owner}/{repo}/compare/<old-head>...<new-head>`). Scan it for regressions **within that delta alone** — a fix that breaks an untouched path, a stub introduced while patching, a test weakened to pass.
3. `ui-source-kind:` takes exactly `canvas` or `approved-non-canvas` — the `ui-parity` guard rejects every other value, `spec` included (#1907): a spec is a written intent, not a rendered artifact to compare pixels against, so it cannot carry parity evidence. A state with no canvas is declared `ui-source-kind: approved-non-canvas` with a manifest entry naming its surface scope and evidence profiles. If the delta touches a render-capable surface, re-emit the canvas-parity binding lines (`ui-source-kind:`, `ui-source:`, `ui-source-state:`, `ui-evidence-profile:`, `ui-source-applicability:`, `ui-artifacts-compared:`, `ui-comparison-result:`, and `render-delta: none` where that N/A route applies) — the merge gate re-reads them from the LATEST review, so omitting them fails the PR even when every finding is closed.
4. Post a **fresh** `## Mode (a) Review` comment with a new `VERDICT:` line, using the same mandatory format above. Head pinning is unchanged: the review must be posted against the CURRENT head, or `pnpm merge:gate <N>` reads it as stale and blocks.

**Explicitly out of scope:** the full two-pass review (pass 1 spec conformance, pass 2 code quality) is **not** repeated in re-review mode. The lead may still request a full review — and must say so in the brief — when the delta exceeds the findings' scope: new files, a changed public contract, a migration, or a rework that rewrote more than it fixed.

**Return contract:** ≤20 lines — the `VERDICT:` line, one line per prior finding (`CLOSED`/`STILL-OPEN`), any new `[BLOCKER]` found in the delta, and the new PR-comment URL.

### Failure mode

- Returning a free-form review without the `VERDICT:` line — the orchestration skill (`do-feature-iteration` / `do-hotfix-pr` / `do-adr-revision`) cannot parse the verdict and must re-dispatch. This is the primary enforcement for G11 finding F-14 — the agent forgot to dispatch review at all, then forgot again, until the human prompted. The verdict line is the artifact that proves review happened.
- Approving a PR with unaddressed `[BLOCKER]` findings — process violation.

> **Cannot proceed without** — the lead agent MUST NOT invoke `merge-when-green` while the latest verdict is `REQUEST_CHANGES` or absent.
