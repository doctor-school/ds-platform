---
title: "Design Spec — AI Stack for DS Platform (Phase 0 methodology + deferred runtime) [EN]"
description: 'This document is the implementation detail for ADR-0007. The ADR establishes "what and why"; the spec establishes "how exactly": file paths, code...'
lang: en
---

> **EN (this)** · **RU:** [`0007-ai-stack-design-ru.md`](./0007-ai-stack-design-ru.md)

# Design Spec — AI Stack for DS Platform (Phase 0 methodology + deferred runtime)

**Date:** 2026-05-15
**Status:** Accepted
**Related to:** ADR-0007, Plane DSO-30 (`fce557aa-4cfd-4466-b487-5ba165501a1f`)
**Brainstorm:** superpowers:brainstorming skill, symmetrical to DSO-25..29 + DSO-60
**Inherits:** ADR-0001..0006

This document is the implementation detail for ADR-0007. The ADR establishes "what and why"; the spec establishes "how exactly": file paths, code sketches, AGENTS.md templates, bootstrap script.

---

## 1. Decision summary (cross-ref ADR-0007)

| Decision                         | Choice                                                                                                                                           | ADR-0007 §        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Scope ADR-0007                   | Phase 0 = AI-loop methodology (dev-time); runtime AI infra — deferred with triggers                                                              | §1                |
| Coding agent harnesses Pre-pilot | Claude Code (primary, sync) + Codex (opt-in async). Cursor deferred.                                                                             | §2                |
| Agent loop discipline            | SDD + TDD as hard rules; iteration-end checklist machine-checkable                                                                               | §3                |
| Task tracking source             | GitHub Issues (per ADR-0006 §9), milestone per feature-spec                                                                                      | inherits ADR-0006 |
| Session bootstrap                | `tools/agent-bootstrap.ts` — deterministic script, output = live state snapshot                                                                  | §4                |
| AI-specific drift guards         | Additional CI checks on top of ADR-0006 §7 (spec-link, TDD signal, EARS↔test linkage, etc.)                                                      | §5                |
| LLM-assisted PR review           | Interactive only (three modes — subagent `/review`, parallel Codex CLI, pure human). No automated reviewer-bot, no LLM API keys in repo secrets. | §6, AGENTS.md §4  |
| Prompt-caching                   | `cache_control: ephemeral` on AGENTS.md+CLAUDE.md+active spec+ADRs; stable prefix order for OpenAI prefix-cache                                  | §7                |
| Cost observability               | Manual via vendor consoles (Anthropic Console, OpenAI Platform) in Phase 0; no automated cost-ledger CSV in the repo.                            | §7                |
| Autonomy phase                   | Phase 2 (chores + supervised PRs); explicit triggers for Phase 3                                                                                 | §8                |
| Runtime LLM gateway              | LiteLLM Proxy self-hosted in Zone AI (Hetzner EU) — **deferred**, trigger: first runtime AI feature deploy                                       | §9                |
| PD filter / egress proxy         | Same trigger — deferred                                                                                                                          | §9                |
| OTel GenAI semconv collector     | Same trigger — in Phase 0 minimal token-count logging without semconv                                                                            | §9                |
| Vector DB                        | pgvector in Postgres17 (inherited from ADR-0003), trigger for Qdrant — separate ADR                                                              | inherits ADR-0003 |

---

## 2. AI-loop architecture — Phase 0

### 2.1 Iteration unit

One iteration = one feature spec → one or more related PRs. Source of intent — `apps/docs/content/specs/features/NNN-<slug>/{requirements.md, design.md, scenarios.feature}` (3 files, ADR-0006 §4). Source of execution state — GitHub Milestone `NNN-<slug>` + Issues per EARS handler (ADR-0006 §9). No `tasks.md` file.

### 2.2 Canonical procedure — skill catalog at `apps/docs/content/skills/<name>/SKILL.md`

The procedural source of truth for an AI feature iteration is the **project skill catalog** at `apps/docs/content/skills/<name>/SKILL.md` (AGENTS.md §3.3 — "the path is the contract"). Orchestration skills (`do-feature-iteration`, `do-hotfix-pr`, `do-adr-revision`, `do-decision-debt-followup`) compose procedural skills (`read-relevant-adrs`, `verify-base-ci-green`, `author-ears-spec`, `open-ears-issues`, `run-iteration-end-checklist`, `request-mode-a-review`, `respond-to-review`, `write-iteration-summary`, `surface-decision-debt`, `merge-when-green`). Discipline gates are expressed as "Cannot proceed without" clauses on each orchestration skill — the agent cannot bypass them with narrative reading. The inline summary below mirrors the catalog; the catalog is authoritative.

The 8-step cycle (`do-feature-iteration` orchestrates these):

```
1. READ
   - Run agent-bootstrap (§4) — get live state
   - Load AGENTS.md + CLAUDE.md (per-harness overlay)
   - Load active spec (req + design + scenarios)
   - Load ADRs from spec's "Prior decisions"
   - Glance at glossary terms in scope
   - `gh issue view <N>` — current Issue body + comments

2. PLAN
   - If no parent Issue for the spec yet → create +
     sub-issues per EARS handler via `gh issue create`
       --milestone "NNN-<slug>" --label "feature:NNN-<slug>"
   - If parent exists → pick an open sub-issue or open a new one
     (if a gap is discovered during the work)

3. RED (TDD)
   - Write failing test(s) for the current EARS handler
   - One Vitest test per EARS requirement, naming convention:
       it('EARS-3.1: ...', () => { ... })
     (flat `EARS-N` is the default; `EARS-N.M` only when a single
      handler carries multiple shall-clauses — ADR-0006 §TDD)
   - Playwright tests are compiled from scenarios.feature
     via playwright-bdd (ADR-0006 §4 + §7 generated artifacts)

4. GREEN
   - Minimum code to pass tests
   - Respect SSOT-per-kind (ADR-0006 §3): no inline glossary IDs,
     Zod ↔ Drizzle ↔ OpenAPI canonical sources
   - Run `pnpm generate:all` after edits in schemas/db/glossary

5. REFACTOR
   - Improve code, keep tests green

6. ITERATION-END CHECKLIST (§5.1, skill: run-iteration-end-checklist)
   - Dispatch-mode artifact — cannot be skipped silently.
   - If any hard rule fails — do not push.

7. PR OPEN
   - Title: `<type>(<module>): <description> [#N]` (#N = Issue)
   - Body template from AGENTS.md (includes `Closes #N`, spec-link)
   - CI runs ADR-0006 §7 + AI-specific guards (§5.2)

8. REVIEW + MERGE
   - Mode (a) subagent `/review` skill, Mode (b) parallel Codex CLI,
     or Mode (c) human review (AGENTS.md §4).
   - On positive verdict + green CI → `gh pr merge <N> --auto --squash --delete-branch`
     (skill: merge-when-green).
```

### 2.3 Which harnesses follow this cycle

| Harness                       | Sync/Async    | Phase 0 status                                                    | Notes                                                                                                                                                            |
| ----------------------------- | ------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (terminal in VSC) | sync          | **Primary**                                                       | Tech Lead's current working mode. SessionStart hook runs bootstrap.                                                                                              |
| Codex (cloud)                 | async         | **Opt-in self-serve**                                             | Tech Lead puts label `codex-go` on an `agent-ready` Issue → Codex bot picks it up. AGENTS.md "Before any task" instructs to execute bootstrap as the first step. |
| Cursor                        | sync (inline) | **Deferred**                                                      | Trigger: hiring of a second engineer with inline-AI preference.                                                                                                  |
| Any other agent               | —             | Can plug into the same loop; bootstrap script is vendor-agnostic. |

---

## 3. SDD + TDD as hard rules

### 3.1 SDD — Spec-Driven Development

Hard rule, enforced via AGENTS.md + spec-link CI guard (§5.2):

- **No production code without a feature spec** in `apps/docs/content/specs/features/NNN-<slug>/`.
- If a feature has no spec — the agent first writes the spec via superpowers:brainstorming, then code. Within a single session this is normal: brainstorm → spec → ADR (if architectural) → plan → code.
- Changes to existing features update the existing spec (status: Draft → In dev → Shipped), not a new one.
- An ADR is required if the decision affects multiple modules or introduces a new technology.

### 3.2 TDD — Test-Driven Development

Hard rule, enforced via AGENTS.md + TDD-signal CI guard (§5.2 WARN v1 → BLOCK v2):

- **No production code without a failing test** that motivates that code.
- One Vitest test per EARS requirement; naming: `it('EARS-N.M: ...', ...)`.
- Playwright tests are generated from `scenarios.feature` via playwright-bdd (test code ≠ production code).
- Property-based tests for invariants — opt-in from the first feature with invariants (ledger reconciliation, for example).
- superpowers:test-driven-development skill — mandatory invocation for any implementation task.

### 3.3 When SDD/TDD is justifiably skipped

Narrow exceptions, documented explicitly in the PR description:

- **One-line typo / doc-only edits** — spec/test not needed (but glossary-mdx-lint still runs).
- **Dependency bumps** — the test suite itself is the test.
- **Generated artifact updates** — the test suite itself is the test.
- **Bug-fix without feature-shift** — must add a regression test (TDD preserved); spec does not necessarily need to be updated if the behavior is already captured in the spec.

In all other cases, a skip = methodology violation; the interactive reviewer (AGENTS.md §4) should catch it.

---

## 4. Session bootstrap — `tools/agent-bootstrap.ts`

### 4.1 Purpose

Any agent at the start of a session (sync or async) runs the script and receives a live state snapshot. No state file in the repo is required — everything is derived from `git` + `gh` + spec files.

### 4.2 What it collects

```
1. Git state (via simple-git / direct execa)
   - current branch + worktree clean/dirty
   - last 5 commits on branch (short format)
   - diverged from main? rebase needed?

2. GitHub state (via gh CLI — already authed in repo)
   - gh issue list --assignee @me --label agent-working --state open
   - gh issue list --assignee @me --label awaiting-review --state open
   - gh issue list --label agent-ready --state open --no-assignee (top 5)
   - gh pr list --author @me --state open --json number,title,reviewDecision,updatedAt

3. Active spec(s)
   - For each agent-working Issue: parses milestone name → spec folder path
   - Reads requirements.md frontmatter: status, Prior decisions (list of ADRs)
   - Extracts glossary terms from spec body via [[term-id]] directives

4. Context files to load (paths only)
   - AGENTS.md, CLAUDE.md (root)
   - active spec files (3)
   - ADRs from Prior decisions
   - module README of modules mentioned in Issue body (heuristic)
```

### 4.3 Output

Markdown ≤ 2 KB, format see §4.4. Printed to stdout; the calling environment (SessionStart hook / Codex bootstrap step / manual command) redirects it into the agent's context.

### 4.4 Sketch implementation

`tools/agent-bootstrap.ts`:

```ts
#!/usr/bin/env tsx
import { execa } from "execa";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function gitState() {
  const { stdout: branch } = await execa("git", ["branch", "--show-current"]);
  const { stdout: status } = await execa("git", ["status", "--porcelain"]);
  const { stdout: log } = await execa("git", ["log", "-5", "--pretty=%h %s"]);
  const { stdout: ahead } = await execa("git", [
    "rev-list",
    "--count",
    `origin/main..HEAD`,
  ]);
  return {
    branch: branch.trim(),
    clean: status.trim() === "",
    recent: log.split("\n"),
    aheadOfMain: parseInt(ahead.trim(), 10),
  };
}

async function ghIssues(args: string[]): Promise<any[]> {
  const { stdout } = await execa("gh", [
    "issue",
    "list",
    ...args,
    "--json",
    "number,title,labels,milestone,assignees,updatedAt,body",
  ]);
  return JSON.parse(stdout);
}

/** No `--no-assignee` flag exists in `gh issue list` — fetch and post-filter. */
async function ghUnassignedIssues(args: string[]): Promise<any[]> {
  const all = await ghIssues(args);
  return all.filter((i) => !i.assignees || i.assignees.length === 0);
}

async function ghPRs(): Promise<any[]> {
  const { stdout } = await execa("gh", [
    "pr",
    "list",
    "--author",
    "@me",
    "--state",
    "open",
    "--json",
    "number,title,reviewDecision,updatedAt,headRefName",
  ]);
  return JSON.parse(stdout);
}

async function readSpecMeta(milestoneName: string) {
  // milestone name = "NNN-slug" → spec path
  const specDir = resolve(
    REPO_ROOT,
    "apps/docs/content/specs/features",
    milestoneName,
  );
  try {
    const raw = await readFile(resolve(specDir, "requirements.md"), "utf-8");
    const { data, content } = matter(raw);
    const adrs = (content.match(/ADR-\d{4}/g) ?? []).filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    const terms = (content.match(/\[\[([a-z][a-z0-9_]*)\]\]/g) ?? [])
      .map((m) => m.slice(2, -2))
      .filter((v, i, a) => a.indexOf(v) === i);
    return { status: data.status ?? "unknown", adrs, terms, path: specDir };
  } catch {
    return null;
  }
}

function recommend(
  activeWorking: any[],
  awaitingReview: any[],
  openPRs: any[],
  readyQueue: any[],
): string {
  if (awaitingReview.length > 0)
    return `Address review on PR linked to Issue #${awaitingReview[0].number}.`;
  if (openPRs.some((pr) => pr.reviewDecision === "CHANGES_REQUESTED")) {
    return `You have a PR with CHANGES_REQUESTED — address feedback first.`;
  }
  if (activeWorking.length > 0)
    return `Resume #${activeWorking[0].number} (most recently updated).`;
  if (readyQueue.length > 0)
    return `No active work. Pick from ready queue: ${readyQueue
      .slice(0, 3)
      .map((i) => `#${i.number}`)
      .join(", ")}.`;
  return `Clean slate. Open a new feature-spec via superpowers:brainstorming.`;
}

async function main() {
  const [git, working, awaiting, ready, prs] = await Promise.all([
    gitState(),
    ghIssues(["--assignee", "@me", "--label", "agent-working"]),
    ghIssues(["--assignee", "@me", "--label", "awaiting-review"]),
    ghUnassignedIssues(["--label", "agent-ready", "--limit", "20"]).then((rs) =>
      rs.slice(0, 5),
    ),
    ghPRs(),
  ]);

  const activeSpecs = await Promise.all(
    working.map(async (i) => {
      const ms = i.milestone?.title;
      return ms ? { issue: i, spec: await readSpecMeta(ms) } : null;
    }),
  );

  console.log(
    `# Session bootstrap — ${new Date().toISOString().slice(0, 19)} UTC\n`,
  );
  console.log(`## You are in`);
  console.log(
    `- Branch: \`${git.branch}\` ${git.clean ? "(clean)" : "⚠️ DIRTY"} ${git.aheadOfMain > 0 ? `${git.aheadOfMain} ahead of main` : "in sync"}`,
  );
  console.log(
    `- Recent commits:\n${git.recent.map((c) => `  - ${c}`).join("\n")}\n`,
  );

  console.log(`## Active work`);
  if (working.length === 0 && awaiting.length === 0 && prs.length === 0) {
    console.log(`(none)\n`);
  } else {
    working.forEach((i) =>
      console.log(
        `- 🔧 #${i.number} ${i.title} — agent-working, milestone: ${i.milestone?.title ?? "(none)"}`,
      ),
    );
    awaiting.forEach((i) =>
      console.log(
        `- 👀 #${i.number} ${i.title} — awaiting your review-response`,
      ),
    );
    prs.forEach((p) =>
      console.log(
        `- 🔀 PR #${p.number} ${p.title} (${p.reviewDecision ?? "pending"}), branch \`${p.headRefName}\``,
      ),
    );
    console.log();
  }

  console.log(`## Ready queue (top 5 unassigned)`);
  ready.forEach((i) =>
    console.log(
      `- #${i.number} ${i.title} (milestone: ${i.milestone?.title ?? "(none)"})`,
    ),
  );
  console.log();

  console.log(`## Active spec(s)`);
  activeSpecs.filter(Boolean).forEach(({ issue, spec }) => {
    if (!spec) return;
    console.log(`- ${spec.path}`);
    console.log(`  - status: ${spec.status}`);
    console.log(
      `  - ADRs in Prior decisions: ${spec.adrs.join(", ") || "(none cited)"}`,
    );
    console.log(
      `  - glossary terms in scope: ${spec.terms.join(", ") || "(none)"}`,
    );
  });
  if (activeSpecs.filter(Boolean).length === 0)
    console.log("(no active spec — start a new one)");
  console.log();

  console.log(`## Recommended next step`);
  console.log(recommend(working, awaiting, prs, ready));
  console.log();

  console.log(`## Context files to load`);
  console.log(`- @AGENTS.md  @CLAUDE.md`);
  activeSpecs.filter(Boolean).forEach(({ spec }) => {
    if (!spec) return;
    console.log(
      `- @${spec.path}/requirements.md  @${spec.path}/design.md  @${spec.path}/scenarios.feature`,
    );
    spec.adrs.forEach((a: string) =>
      console.log(`- @docs/adr/${a.toLowerCase().replace("adr-", "")}-*.md`),
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

### 4.5 Per-harness integration

| Harness                  | Mechanism                                                                                                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code**          | `.claude/settings.json` SessionStart hook: `{"command": "pnpm bootstrap"}` (uses the `pnpm` alias, not direct `tsx`, to avoid PATH-resolution issues). Output goes into `additionalContext` as a system reminder. Transparent to the user. Timeout — see §4.6. |
| **Codex (cloud)**        | AGENTS.md "Before any task" — first step: `Run \`pnpm bootstrap\` and use its output to orient yourself.` Codex executes during the initial setup phase.                                                                                                       |
| **Cursor (deferred)**    | `.cursor/rules/00-bootstrap.md` points to the same.                                                                                                                                                                                                            |
| **Manual / other agent** | `pnpm bootstrap` (alias in root package.json: `"bootstrap": "tsx tools/agent-bootstrap.ts"`).                                                                                                                                                                  |

### 4.6 Edge cases

- **Worktree dirty** → bootstrap prints a warning + suggests `git status` / `git stash`.
- **Multiple agent-working issues** → shows all, recommends most recently updated.
- **No active Issue, open PR exists** → recommend = address PR feedback.
- **Completely clean state** → recommend = pick from ready queue or brainstorm new spec.
- **GitHub rate-limit or auth fail** → fallback to git-only output + warning.
- **`gh` CLI errors (unknown flag, missing auth, etc.)** → `main()` catches the exception at the `Promise.all` level; prints minimal git-only fallback output + warning; exit 0 so the SessionStart hook does not crash.
- **SessionStart hook timeout** — Claude Code SessionStart hook injects the result into context **only if it completes within ~60 seconds** (current harness limit). Bootstrap must fit within this window: ~5 parallel gh API calls + 3 file reads = typically <3s; on GitHub API unavailability — fallback to git-only output <500ms. If timeout is exceeded, the agent sees a warning in context: `[bootstrap] hook timed out — run \`pnpm bootstrap\` manually as first step`.

---

## 5. Iteration-end checklist + AI-specific drift guards

### 5.1 9-item checklist (AGENTS.md hard rules)

Before `git push` the agent goes through each item. If even one is false — do not push; either fix or escalate.

| #   | Check                                                                         | Command / condition                                           |
| --- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | All tests green                                                               | `pnpm test:unit && pnpm test:e2e`                             |
| 2   | Generated artifacts up-to-date                                                | `pnpm generate:all && git diff --exit-code`                   |
| 3   | TypeScript compiles                                                           | `pnpm typecheck`                                              |
| 4   | Lint clean                                                                    | `pnpm lint` (incl. `@ds/glossary-canonical-ids`, events-lint) |
| 5   | Module README updated if exports changed                                      | `pnpm lint:module-readme`                                     |
| 6   | Spec `status` frontmatter updated (Draft → In dev → Shipped)                  | manual edit in `requirements.md`                              |
| 7   | Glossary terms added if new domain vocabulary appeared in code/spec           | `pnpm lint:glossary-mdx`                                      |
| 8   | ADR created if an architectural decision was made                             | judgment; interactive reviewer (AGENTS.md §4) catches misses  |
| 9   | Linked Issue received a summary comment (file paths, decisions, what remains) | `gh issue comment <N> --body-file <summary>`                  |

### 5.2 CI gates — AI-specific extensions (on top of ADR-0006 §7)

| Guard                     | What it catches                                                          | Implementation                                                                                                                                                           | Severity Phase 0      |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| **spec-link required**    | PR without a link to an Issue whose milestone = spec                     | GH Action: PR body contains `Closes #N`; Issue `#N` has milestone `NNN-<slug>`; spec folder `apps/docs/content/specs/features/NNN-<slug>/` exists.                       | BLOCK                 |
| **TDD signal**            | implementation-only commit without a test file                           | GH Action: for each modified `src/**/*.ts` — `*.test.ts` is either in the diff, or commit history shows a test-commit preceding it. Heuristic; false positives possible. | WARN v1               |
| **EARS ↔ test linkage**   | EARS requirement without `it('EARS-N: ...')`                             | Custom lint `tools/lint/ears-test-lint.ts`: parses EARS IDs in requirements.md, checks for it-descriptions with the same ID in the module.                               | WARN v1 → BLOCK v2    |
| **Gherkin coverage**      | scenarios without Playwright step implementation                         | playwright-bdd native error — test fails if step is undefined.                                                                                                           | BLOCK (via test fail) |
| **Spec status freshness** | Merged PR with spec:NNN but spec status='Draft'                          | Custom lint: at merge — check `status: In dev` minimum.                                                                                                                  | WARN v1               |
| **Prior decisions cited** | New spec without cited ADRs in "Prior decisions" if category ≠ docs-only | Spec lint: `requirements.md` has a section with ≥1 ADR-link.                                                                                                             | WARN v1               |

> **Interim semantics note:** rows marked `BLOCK` assume a server-side required status check on `main`. While ADR-0008 §2.6 branch protection is deferred (GitHub Free + private repo blocks the branch-protection API — ADR-0008 §2.6), `BLOCK` is read operationally as **"CI job exits red and the Tech Lead treats it as a merge-blocker by convention"** — same outcome on the single-developer happy path, no server-side guarantee.

### 5.3 Custom lint scripts

**`tools/lint/ears-test-lint.ts`** — sketch example:

```ts
#!/usr/bin/env tsx
import { glob } from "fast-glob";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const specs = await glob(
    "apps/docs/content/specs/features/*/requirements.md",
    {
      cwd: REPO_ROOT,
      absolute: true,
    },
  );
  const errors: string[] = [];

  // Multi-level EARS IDs supported: EARS-N, EARS-N.M, EARS-N.M.K, ...
  const EARS_RE = /EARS-\d+(?:\.\d+)*/g;
  // Broad glob — Vitest convention is colocated `*.test.ts`, not `__tests__/`-grouped.
  // We content-search for the EARS ID across all test files (no test-file-naming convention enforced).
  const allTests = await glob("apps/**/*.test.ts", {
    cwd: REPO_ROOT,
    absolute: true,
  });
  const allTestContent = (
    await Promise.all(allTests.map((f) => readFile(f, "utf-8")))
  ).join("\n");

  for (const specFile of specs) {
    const raw = await readFile(specFile, "utf-8");
    const earsIds = [...raw.matchAll(EARS_RE)]
      .map((m) => m[0])
      .filter((v, i, a) => a.indexOf(v) === i);

    for (const id of earsIds) {
      // Match `it('EARS-N.M: ...')` or `it("EARS-N.M: ...")` — colon required to avoid prefix collisions
      // (e.g., looking for EARS-3.1 should not match EARS-3.10).
      const itPattern = new RegExp(`it\\(['"]${id.replace(/\./g, "\\.")}:`);
      if (!itPattern.test(allTestContent)) {
        errors.push(
          `${specFile}: ${id} has no test (looking for \`it('${id}: ...')\` across ${allTests.length} test files)`,
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1; // WARN-only in v1: CI step uses continue-on-error
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

**`tools/lint/spec-link-lint.ts`** — runs in GH Action. Notes:

- `gh pr view --json` **does not return** `closingIssuesReferences` (this is a GraphQL-only field). Parse from PR body via regex.
- Guard applies **only to PRs with label `feature:*`** (or to PRs where the linked Issue has such a label). Bug/chore/dep-bump PRs do not need to specify a spec.

```ts
#!/usr/bin/env tsx
import { execa } from "execa";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
const CLOSES_RE = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execa("gh", args);
  return JSON.parse(stdout) as T;
}

async function main() {
  const prNum = process.env.PR_NUMBER;
  if (!prNum) throw new Error("PR_NUMBER required");

  const pr = await ghJson<{ body: string; labels: { name: string }[] }>([
    "pr",
    "view",
    prNum,
    "--json",
    "body,labels",
  ]);

  const refs = [...(pr.body ?? "").matchAll(CLOSES_RE)].map((m) =>
    parseInt(m[1], 10),
  );
  const isFeaturePR = (pr.labels ?? []).some((l) =>
    l.name?.startsWith("feature:"),
  );

  if (refs.length === 0) {
    if (isFeaturePR) {
      throw new Error(
        `PR #${prNum} has label feature:* but no \`Closes #N\` reference in body.`,
      );
    }
    console.log(`✓ PR #${prNum} not feature-PR, no spec-link required.`);
    return;
  }

  for (const issueNum of refs) {
    const issue = await ghJson<{
      milestone: { title?: string } | null;
      labels: { name: string }[];
    }>(["issue", "view", String(issueNum), "--json", "milestone,labels"]);
    const issueIsFeature = (issue.labels ?? []).some((l) =>
      l.name?.startsWith("feature:"),
    );
    if (!issueIsFeature) continue; // bug/chore Issue — skip spec-folder check
    const ms = issue.milestone?.title;
    if (!ms) {
      throw new Error(
        `Issue #${issueNum} has feature:* label but no milestone. Per ADR-0006 §9, every feature-Issue must have milestone NNN-<slug>.`,
      );
    }
    const specDir = resolve(REPO_ROOT, "apps/docs/content/specs/features", ms);
    if (!existsSync(specDir)) {
      throw new Error(
        `Issue #${issueNum} milestone '${ms}' does not match any spec folder at ${specDir}.`,
      );
    }
  }
  console.log(`✓ PR #${prNum} correctly linked to spec via milestone.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

---

## 6. Reviewer roles — see §2.2 and AGENTS.md §4

The cross-vendor LLM-assisted review is interactive-only in Phase 0 (three modes: (a) main-session subagent `/review` skill, (b) parallel Codex CLI, (c) pure human review). The §2.2 cycle Step 8 and AGENTS.md §4 carry the full contract. There is no automated headless reviewer-bot, no `tools/reviewer-agent/`, no `.github/workflows/agent-review.yml`, and no LLM API keys in repo secrets.

---

## 7. Prompt-caching policy

The prompt-caching policy is in force for any LLM client — the interactive `/review` skill subagent today, runtime AI features after the §9 trigger fires. Cost tracking in Phase 0 happens via vendor consoles (Anthropic Console, OpenAI Platform); there is no automated cost-ledger CSV in the repo.

### 7.1 Caching policy

Hard rule in AGENTS.md, mandatory for all LLM calls (interactive `/review` skill subagent today, future Content Pipeline, etc.):

| What                                   | Cache policy                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `AGENTS.md`, `CLAUDE.md`               | `cache_control: ephemeral` (Anthropic); first in payload (for OpenAI prefix-cache) |
| Active spec files (3)                  | `cache_control: ephemeral` while session is on that spec                           |
| ADRs from Prior decisions (only cited) | `cache_control: ephemeral`                                                         |
| Glossary entries                       | NOT cached (selective, low ROI)                                                    |
| User turn-by-turn dialogue             | NOT cached                                                                         |

**Stable prefix order** in every request:

```
[system] AGENTS.md → CLAUDE.md → active spec (req → design → scenarios) → ADRs (sorted by ADR number) → glossary terms (in-scope only) → [user turn]
```

Anthropic — explicit `cache_control: {type: 'ephemeral'}`, 5-min TTL. OpenAI GPT-5+ — automatic prefix cache, requires the prefix to be byte-identical. All LLM clients build the payload via the shared helper `packages/llm-utils/buildContext.ts` to guarantee stability.

### 7.2 Sketch buildContext

**Anthropic constraint:** no more than **4 cache breakpoints** per request (Messages API). Therefore blocks are **concatenated per tier**, and `cache_control` is placed only at the tail of each tier — at most 4 cache markers total.

`packages/llm-utils/buildContext.ts`:

```ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { glob } from "fast-glob";

const REPO_ROOT = process.env.REPO_ROOT ?? process.cwd();

export interface ContextInput {
  specPath?: string; // e.g., apps/docs/content/specs/features/001-doctor-onboarding
  adrs?: string[]; // e.g., ['ADR-0001', 'ADR-0002']
  glossaryTerms?: string[]; // canonical IDs
}

export interface CachedBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

async function readOptional(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf-8");
  } catch {
    return null;
  }
}

export async function buildSystemBlocks(
  input: ContextInput,
): Promise<CachedBlock[]> {
  const blocks: CachedBlock[] = [];

  // ---- Tier 1: constitution (AGENTS.md required, CLAUDE.md optional, concat) ----
  const agentsPath = resolve(REPO_ROOT, "AGENTS.md");
  if (!existsSync(agentsPath)) {
    throw new Error(
      `AGENTS.md not found at ${agentsPath}. Set REPO_ROOT env var to the repo root.`,
    );
  }
  const agentsMd = await readFile(agentsPath, "utf-8");
  const claudeMd = await readOptional(resolve(REPO_ROOT, "CLAUDE.md"));
  blocks.push({
    type: "text",
    text:
      `# AGENTS.md\n\n${agentsMd}` +
      (claudeMd ? `\n\n---\n\n# CLAUDE.md\n\n${claudeMd}` : ""),
    cache_control: { type: "ephemeral" }, // breakpoint 1/4
  });

  // ---- Tier 2: active spec (3 files concat) ----
  if (input.specPath) {
    const parts: string[] = [];
    for (const f of ["requirements.md", "design.md", "scenarios.feature"]) {
      const c = await readOptional(resolve(REPO_ROOT, input.specPath, f));
      if (c) parts.push(`# ${f}\n\n${c}`);
    }
    if (parts.length > 0) {
      blocks.push({
        type: "text",
        text: parts.join("\n\n---\n\n"),
        cache_control: { type: "ephemeral" }, // breakpoint 2/4
      });
    }
  }

  // ---- Tier 3: ADRs (sorted by number, concat) ----
  const adrs = [...(input.adrs ?? [])].sort();
  if (adrs.length > 0) {
    const parts: string[] = [];
    for (const a of adrs) {
      const num = a.replace(/^ADR-?/i, "").padStart(4, "0");
      const found = await glob(`apps/docs/content/adr/${num}-*.md`, {
        cwd: REPO_ROOT,
        absolute: true,
      });
      if (found[0]) {
        parts.push(await readFile(found[0], "utf-8"));
      } else {
        // Loud warning — silent drop of cited ADR is dangerous (reviewer loses key context)
        console.warn(
          `[buildContext] WARNING: cited ${a} not found at apps/docs/content/adr/${num}-*.md — proceeding without it.`,
        );
      }
    }
    if (parts.length > 0) {
      blocks.push({
        type: "text",
        text: parts.join("\n\n---\n\n"),
        cache_control: { type: "ephemeral" }, // breakpoint 3/4
      });
    }
  }

  // ---- Tier 4 (no cache_control): glossary entries — placed last to isolate volatility ----
  // Changes to in-scope terms do not invalidate the prefix above. The 4th cache slot is reserved for future use
  // (e.g., module READMEs); it is not spent on glossary.
  const terms = [...(input.glossaryTerms ?? [])].sort();
  for (const t of terms) {
    const c = await readOptional(
      resolve(REPO_ROOT, "apps/docs/content/product/glossary", `${t}.md`),
    );
    if (c) blocks.push({ type: "text", text: c });
  }

  return blocks;
}
```

Used by the interactive `/review` skill subagent and any other LLM clients.

**Cache invariants:**

- AGENTS.md / CLAUDE.md change rarely → tier 1 cache hit ~always after the first call.
- Spec changes per feature → tier 2 cache hit while the session is within the same feature.
- ADRs are immutable after Accepted → tier 3 cache hit ~always (a new ADR in "Prior decisions" invalidates — acceptable, rare event).
- Glossary terms — last, so that per-spec-scope changes do not break the prefix above.

---

## 8. Autonomy ladder

### 8.1 Phase 2 — current Pre-pilot target

Parameters:

- Agents write PRs for any feature/bugfix/refactor
- Human-merge gate or positive interactive LLM-review verdict (Mode (a) / Mode (b) per AGENTS.md §4) **is mandatory** before merge
- Write access to prod-DB prohibited (only via migrations in PR)
- Direct push to `main` prohibited
- Direct writes to `docs/adr/*.md` after `status: Accepted` prohibited (creating a superseding ADR is allowed)

**Auto-chores are allowed** via bot-PR with label `chore:auto`:

- Lint-fix (prettier, eslint --fix)
- Dep-bump in `devDependencies` (via Renovate / Dependabot)
- Doc-sync (`pnpm generate:all` artifact updates)

All auto-chore PRs still go through the standard review path (interactive Mode (a)/(b)/(c) per AGENTS.md §4) + merge gate.

### 8.2 Trigger for Phase 3

Phase 3 = auto-merge low-risk PR behind feature flag. Activated when ALL conditions are met:

- ≥50 successful agent-PRs without post-merge incident (tracked via `post-merge-incident` labels)
- Documented low-risk criteria in a separate ADR — for example: "only `*.test.ts` files modified", "only docs in `apps/docs/content/`", "devDep version bump with green CI"
- Kill switch tested (see §8.4)

Phase 3 activation — separate ADR-NNNN.

### 8.3 Phase 4 — out of scope for ADR-0007

End-to-end autonomous agent work (from Issue to merge without human touch for certain task classes) — deferred until at least Phase 1 production.

### 8.4 Kill switch

Single config flag in `.github/agents-config.json`:

```json
{
  "agents_enabled": true
}
```

When `agents_enabled: false` — agent-driven activity stops; activated on a security incident or emergency stop. Changing this file is a regular PR + human merge (so the kill switch cannot accidentally destroy itself).

`auto_merge_enabled` field is NOT added in Phase 2 — auto-merge of arbitrary PRs is prohibited by design (§8.1). The field will appear in Phase 3 ADR-NNNN when the corresponding mechanism is introduced.

---

## 9. Deferred architecture with triggers

This section is **a design for the future, not a Phase 0 implementation**. Each component is added by a separate ADR-NNNN when its trigger is met.

### 9.1 LiteLLM Proxy + Zone-AI VM

**Trigger:** first runtime AI feature deploy. Currently planned as Content Pipeline v2 (LLM draft of lessons) — see `knowledge-base/documents/ds-platform-components/12-ai-content-pipeline.md` §3. Approximate date ≈ v2 milestone (after Pre-pilot, ~3–6 months after Phase 0 closes).

**Self-host honest framing (parallel to ADR-0006 §3 Keystatic/GitHub caveat):** Hetzner EU — non-RF compute (Germany). Federal Law 152-FZ is not violated because **personal data (PD) does not cross the Zone RF → Zone AI boundary**: the PII Filter (see §9.2) anonymizes the payload **before** mTLS egress. Only sanitized prompts with placeholder tokens cross the boundary. This is "self-host" in the sense of "infrastructure we control, not a managed vendor," but **not "data sovereignty"** in the strict sense (compute in EU). Trigger to revisit fallback: Hetzner EU blocked from RF (politically or network-wise), or a regulatory change requiring AI processing compute to be in RF — fallback to self-hosted on Timeweb with international egress proxy (see §9.6 sandbox / experimentation).

**Architecture (plan):**

```
┌──── Zone RF (Timeweb) ───────────────────────────────────────┐
│  apps/api (NestJS) ──► BullMQ AI-job queue (ADR-0002)        │
│                          │                                    │
│             ┌────────────┴────────┐                           │
│             │ PII Filter           │  regex+allowlist v1      │
│             │ (pre-call middleware)│  spaCy NER v2 trigger    │
│             │ + audit-log emit     │                          │
│             └─────────┬────────────┘                          │
│                       │                                       │
│         ┌─────────────┴─────────────┐                         │
│         │                           │                         │
│         ▼ mTLS                      ▼ direct (RF→RF)          │
└─────────┼───────────────────────────┼──────────────────────────┘
          │                           │
┌─── Zone AI (Hetzner EU) ─────┐  ┌── Zone RF YandexGPT ──┐
│  LiteLLM Proxy (instance A)  │  │ LiteLLM Proxy         │
│  - OpenAI-compat /v1/...     │  │ (instance B, Timeweb) │
│  - Anthropic + OpenAI routes │  │ - YandexGPT route only │
│  - virtual keys + budgets    │  │ - same virtual-key DB  │
│  - prompt-cache passthrough  │  │   (Postgres replication│
│  - OTel emit → Collector     │  │   from instance A)     │
└──────────┬───────────────────┘  └────────┬──────────────┘
           ▼                                ▼
       Anthropic   OpenAI/Codex      YandexGPT
```

**Provider routing (resolved):**

- Anthropic, OpenAI → **LiteLLM instance A in Hetzner EU** (foreign API endpoints require EU egress)
- YandexGPT → **LiteLLM instance B in Zone RF (Timeweb)** — separate deployment, because YandexGPT is only available from RF; the route RF backend → RF YandexGPT must not hop to EU and back
- Both instances share one Postgres (replication from A to B; A is primary for virtual key state) for unified accounting/budgets
- PII Filter applies to both routes unconditionally — even for YandexGPT inside RF (Federal Law 152-FZ requires anonymization when sending to any third party, even a Russian one)

**LiteLLM admin UI protection:** LiteLLM admin has no native OIDC; protect via nginx forward-auth proxy with Authentik / Zitadel (ADR-0001 OIDC tenant). This is non-trivial and is documented as a separate design block in the trigger-ADR.

**Capacity Phase 0+1:** instance A — one VM (Hetzner EU, ~€20/mo); instance B — one VM on existing Timeweb (~₽1,000/mo). HA pair via keepalived — Phase Pilot+.

**Pre-v2 prerequisite — dual-LLM pattern evaluation:** Content Pipeline v2 (`12-ai-content-pipeline.md` §3) processes content from expert briefs. If a brief can contain user-submitted material (e.g., copy-paste from chat, files from co-authors), a prompt-injection vector is active from day 1. Before launching v2 in production — a formal assessment: does user-controlled content enter the pipeline? If yes — the OWASP dual-LLM pattern (privileged LLM with tools, separated from the quarantined LLM that reads untrusted content) must be in the trigger-ADR design, not deferred further.

### 9.2 PD filter

> **Forward reference (security boundary):** the PD filter is the **first** defensive layer for AI-zone egress. The **mandatory second** layer for any runtime LLM flow with tool use or untrusted user content is the **dual-LLM mandatory pattern** — see **ADR-0010** + design spec **`2026-05-18-ds-platform-dual-llm-pattern-design`** (Quarantined LLM ↔ Privileged LLM split, symbolic references, audit class `ai_dual_llm`).

**Trigger:** same as 9.1.

**Design v1 (input-direction only):**

- Regex-based: RF phone numbers, email, full names (Cyrillic full-name patterns), documents (SNILS, passport, diploma number).
- Structured field allowlist: only fields helpfully tagged as "safe-to-send-external" in the PII schema (`packages/pii-schema/`).
- Pre-call hook in backend (NestJS interceptor) — replaces PD with placeholders `<<DOC_NUMBER_1>>` before sending to LiteLLM. Audit log records: which field was sanitized, which placeholder was used.
- Post-call placeholder reverse-substitution — placeholders are substituted back **only if** the returned text goes back to the same user (i.e., fields are saved in their user-scoped record). Otherwise reverse substitution is not performed.

**Honest gap — v1 covers input direction only.** v1 protects **against exfiltration** of PD to an external provider (this is the main Federal Law 152-FZ requirement). v1 **does not protect** against:

- (a) LLM hallucinating real document numbers / full names of other people in output
- (b) LLM combining innocuous fragments into re-identifiable text
- (c) Cases where output goes downstream to non-authorized parties (e.g., public-facing PRD generated from an internal brief)

Output-direction PD filter — **v3 concern**. Until v3 — operational mitigation: AI-generated content always goes through human review before publication (this is already in Content Pipeline §3 "editor sign-off"). The trigger-ADR for the runtime LLM gateway explicitly records this as a known gap with a trigger for v3 expansion.

**Design v2 (trigger: regex false-negative rate >5% on synthetic test corpus — corpus itself is created at 9.1 trigger moment):**

- spaCy NER model (Russian-trained) to catch non-standard phrasings.
- Self-hosted in Zone RF alongside the PII Filter (NER must run before PD leaves Zone RF).

### 9.3 OTel GenAI collector

**Trigger:** same as 9.1 (LiteLLM natively emits `gen_ai.*` spans; collector is enabled to receive them).

**Design:**

- OTel Collector in Zone AI (alongside LiteLLM) → batches spans → sends via mTLS back to Zone RF (Tempo + Loki from ADR engineering-readiness).
- Attributes: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.request.temperature`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cached_input_tokens`, `gen_ai.virtual_key` (LiteLLM), `gen_ai.budget.remaining_usd`.
- Grafana dashboard: per-virtual-key cost, latency P50/P95/P99, error rate, cache hit rate.
- **Forward reference (observability for dual-LLM):** when the dual-LLM pattern is enabled, the spans `ai.dual_llm.quarantined_call` and `ai.dual_llm.privileged_call` plus the audit class `ai_dual_llm` (with pseudonymized subject_id) are added. Contract — `2026-05-18-ds-platform-dual-llm-pattern-design` §«Observability» + ADR-0010.

In Phase 0 — no in-repo semconv collector; cost and token usage are read from the vendor consoles (Anthropic Console, OpenAI Platform).

### 9.4 Vector DB scaling

**Default:** pgvector in Postgres17 (inherited from ADR-0003 §7 — already established).

**Trigger for separate Qdrant:** mobile v3 AI recommendations show p95 query latency >100ms on pgvector at production-scale dataset, or vector workload begins to interfere with OLTP. Separate ADR-NNNN when reached.

### 9.5 Self-hosted GitHub Actions runner

**Trigger:** not AI-specific. Added in DSO-31 (engineering-readiness setup) for general CI on Timeweb. Phase 0 — GitHub-hosted runners (ubuntu-latest) are sufficient.

### 9.6 Sandbox / experimentation environment

**Trigger:** team grows to 3+ engineers with parallel agent-PRs, or a regular need appears to debug LiteLLM/PD filter without production traffic. Separate ADR in engineering-readiness scope.

**Default option in this ADR:** dedicated namespace on the main Timeweb k8s cluster (if k8s is chosen) or a separate VM in Zone AI alongside LiteLLM. Northflank/Daytona — considered only if managed offering passes an RF-availability check.

### 9.7 Codex cloud async activation

**Trigger:** Tech Lead decides to launch the first async task. No ADR required.

**Setup at trigger moment:**

1. `.codex/AGENTS.md` link to root AGENTS.md (if Codex requires its own location)
2. GitHub App for Codex with write-PR permissions on the repo
3. Label `codex-go` — bot trigger
4. Bootstrap script already works universally

---

## 10. AGENTS.md / CLAUDE.md — sketches for DS Platform

These sketches show the AI-loop-specific overlays added on top of the ADR-0006 §9 baseline. Sections unrelated to review/cost (8-step cycle wording, SDD/TDD discipline, prompt-caching, SessionStart hook, skill priorities) are the authoritative parts of these sketches. Review-related lines describe the interactive three-mode review per AGENTS.md §4 — no automated reviewer-bot, no headless LLM CI workflow.

### 10.1 AGENTS.md (root)

ADR-0006 §9.1 already established the core structure. DSO-30 adds an AI-loop section:

```markdown
# Agent Instructions — DS Platform

[... stack list, doc structure from ADR-0006 ...]

## AI-loop discipline (ADR-0007)

Every implementation iteration follows the 8-step cycle:

### Step 1 — READ (always first)

Run `pnpm bootstrap` (alias for `tsx tools/agent-bootstrap.ts`). Read its output. Then load:

- AGENTS.md (this file) — already in your context
- CLAUDE.md if you are Claude Code
- Active spec at `apps/docs/content/specs/features/NNN-<slug>/`:
  - requirements.md
  - design.md
  - scenarios.feature
- ADRs from spec's "Prior decisions" section
- `gh issue view <N>` for current Issue context and history

### Step 2 — PLAN

Per ADR-0006 §9 conventions (title format `[NNN] EARS-N.M: ...`, label `kind:ears-handler` / `kind:policy` / `kind:saga-step` / `kind:bug` / `kind:refactor`).

- If no parent Issue exists for the spec: create one with `--body-file` (a `--body` flag must be provided in non-interactive contexts; `gh issue create` without it opens an editor and hangs in CI/Codex):
  gh issue create --title "Feature NNN: <name>" \
   --milestone "NNN-<slug>" --label "feature:NNN-<slug>" \
   --body-file .github/issue_templates/feature.md
  Then for each EARS-handler from `requirements.md`:
  gh issue create --title "[NNN] EARS-N.M: <description>" \
   --milestone "NNN-<slug>" --label "feature:NNN-<slug>,kind:ears-handler,agent-ready" \
   --body "Spec: apps/docs/content/specs/features/NNN-<slug>/. Parent: #<parent-issue>."
- Use superpowers:writing-plans skill only if the task is multi-step within a single Issue.

### Step 3 — RED (TDD: failing tests first)

Per superpowers:test-driven-development. One Vitest test per EARS:
it('EARS-3.1: when <trigger>, system shall <behavior>', () => { ... })

### Step 4 — GREEN (minimum code to pass)

### Step 5 — REFACTOR

### Step 6 — ITERATION-END CHECKLIST (hard rules)

Before `git push`, verify all 9 items pass:

1. pnpm test:unit && pnpm test:e2e — green
2. pnpm generate:all && git diff --exit-code — no drift
3. pnpm typecheck — green
4. pnpm lint — green
5. pnpm lint:module-readme — green (or n/a)
6. Spec status frontmatter updated (Draft → In dev → Shipped)
7. pnpm lint:glossary-mdx — green
8. ADR created if architectural decision was made
9. `gh issue comment <N>` with summary: file paths, decisions, what's left

If any check fails — fix it, don't push.

### Step 7 — PR OPEN

Title: `<type>(<module>): <description> [#N]`
Body must contain `Closes #N` linking to the Issue. CI gates (ADR-0006 §7 +
ADR-0007 §5.2) will block merge if violated.

### Step 8 — REVIEW + MERGE

Trigger the interactive review via Mode (a) subagent `/review` skill, Mode (b) parallel
Codex CLI, or Mode (c) pure human (AGENTS.md §4). Address findings, then merge with
`gh pr merge <N> --auto --squash --delete-branch` once the verdict is positive and CI is green.

## SDD — hard rule

No production code without a feature spec at apps/docs/content/specs/features/NNN-<slug>/.
If the feature has no spec, invoke superpowers:brainstorming first.

## TDD — hard rule

No production code without a failing test that motivates it.
Naming convention: `it('EARS-N.M: ...', ...)`.

## Prompt-caching

For any LLM call you make (e.g., the interactive `/review` skill subagent), use
packages/llm-utils/buildContext.ts to construct the system message. This
ensures cache_control: ephemeral on AGENTS.md / CLAUDE.md / active spec /
ADRs in a stable prefix order. Cache hit rate target: ≥60% on second+ calls.

## Cost discipline

Cost is tracked manually via the vendor consoles (Anthropic Console, OpenAI Platform)
in Phase 0. If your work generates expensive calls (e.g., large diff reviews, bulk
doc generation), flag it in PR description.

## Kill switch

.github/agents-config.json controls global agent activity. If
`agents_enabled: false` — do not push automated PRs, escalate to human.
```

### 10.2 CLAUDE.md (Claude-Code overlay) — additive blocks vs ADR-0006 §9.2

ADR-0006 §9.2 already established the baseline CLAUDE.md (MCP servers, tool preferences, skill priority, slash commands, notes). The DSO-31 implementer **adds** the following blocks to this baseline. Tool preferences and skill priority blocks from ADR-0006 §9.2 **are reused as-is, not duplicated**:

```markdown
[... ADR-0006 §9.2 baseline CLAUDE.md content (MCP, tool prefs, skill priority, slash commands, notes) ...]

## SessionStart hook (ADR-0007 §2.5) — NEW

.claude/settings.json contains:
{
"hooks": {
"SessionStart": [{ "type": "command", "command": "pnpm bootstrap" }]
}
}
The `pnpm bootstrap` alias (defined in root package.json as `tsx tools/agent-bootstrap.ts`)
is used to avoid PATH-resolution issues with the `tsx` binary in different shell contexts.
The hook runs at session start (timeout ~10s, see §4.5); output is injected into the
session's additionalContext as a system reminder.

## AI-loop skills priority (additive to §9.2 baseline) — NEW

For DS Platform feature work, invoke skills in this order:

- superpowers:brainstorming — before any new feature spec
- superpowers:writing-plans — only for multi-step tasks within a single Issue (most Issues are single-task)
- superpowers:test-driven-development — mandatory before any production code (§3 of ADR-0007 spec)
- superpowers:verification-before-completion — before pushing
```

---

## 11. Migration plan

Phase 0 (Tech Lead + AI, sequential — after DSO-31 creates the `ds-platform` repo). Order: bootstrap + helpers (steps 1–4), kill switch + lint tools + CI integration (steps 7–9), AGENTS.md / CLAUDE.md drafting (steps 11–12), branch protection (step 13 — deferred per ADR-0008 §2.6 / A3), smoke test (step 14).

**Pre-requisite for step 13:** Tech Lead must have admin permissions on the repo (branch protection rule in step 13 requires admin token; cannot be automated). If the repo belongs to an organization — org-admin rights or explicit delegation to repo-admin role are needed.

| Step | Action                                                                                                                                                                                         | Output                                               | Blocking                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| 1    | Create `tools/agent-bootstrap.ts`                                                                                                                                                              | bootstrap works locally                              | DSO-31 (repo exists)      |
| 2    | Add `pnpm bootstrap` alias to root `package.json`                                                                                                                                              | command is runnable                                  | step 1                    | **Done in G1, see commit `ae3826f` in `doctor-school/ds-platform`** |
| 3    | Add `.claude/settings.json` with SessionStart hook                                                                                                                                             | Claude Code auto-loads bootstrap                     | step 2                    |
| 4    | Create `packages/llm-utils/buildContext.ts`                                                                                                                                                    | reusable helper for LLM clients                      | DSO-31                    |
| 7    | Add `.github/agents-config.json` kill switch                                                                                                                                                   | kill switch active                                   | —                         |
| 8    | Create `tools/lint/spec-link-lint.ts` + `ears-test-lint.ts`                                                                                                                                    | AI-specific guards available                         | —                         |
| 9    | Add steps to `.github/workflows/ci.yml` for guards (WARN/BLOCK per §5.2)                                                                                                                       | CI executes guards                                   | step 8                    |
| 11   | Update `AGENTS.md` (root) with AI-loop discipline section                                                                                                                                      | agents follow 8-step cycle                           | DSO-31 baseline AGENTS.md |
| 12   | Update `CLAUDE.md` (root) with SessionStart hook reference + skill priorities                                                                                                                  | Claude Code aligned                                  | step 11                   |
| 13   | **[Manual GitHub UI / `gh api`]** Add branch protection rule: ≥1 human approval required, no direct push to main. Deferred per ADR-0008 §2.6 / A3 (GitHub Free + private repo blocks the API). | merge gated server-side once protection is reachable | step 9                    |
| 14   | Smoke test: first feature spec through the cycle (superpowers:brainstorming → spec → Issues → PR → review → merge)                                                                             | proof of concept                                     | steps 1–13                |

Step numbering preserves the original sequence; cancelled steps (5, 6, 10) are intentionally omitted.

Phase 1 (production, after Pre-pilot launch):

- Promote WARN-only guards to BLOCK (TDD signal, EARS↔test linkage, spec status freshness)

Phase 2+ (runtime AI features):

- Trigger §9.1 fires → new ADR for LiteLLM/PD filter/OTel collector deployment
- Phase 3 activation if criteria from §8.2 are met

---

## 12. Cross-refs

- **ADR-0001** — Zitadel IdP: the future runtime LLM gateway (§9.1) admin is protected by the same OIDC tenant.
- **ADR-0002 §6 BullMQ** — async queue for Content Pipeline AI jobs (§9.1).
- **ADR-0003 §7 pgvector** — vector DB default; trigger for Qdrant (§9.4).
- **ADR-0004 §13 ESLint `no-vercel-only-api`** — the interactive `/review` skill subagent applies this rule in its SDD-compliance prompt.
- **ADR-0005** — mobile clients for AI recommendations (v3) will call the backend, backend → LiteLLM (§9.1).
- **ADR-0006 §7 drift detection** — DSO-30 extends with AI-specific guards (§5.2).
- **ADR-0006 §4 SDD format** — DSO-30 inherits the 3-file feature-spec.
- **ADR-0006 §9 task-tracker split** — DSO-30 inherits GitHub Issues + milestone convention.
- **ADR-0006 §5 AGENTS.md/CLAUDE.md** — DSO-30 extends with AI-loop section.

---

## 13. Open follow-ups (DSO-31+ and beyond)

1. **TDD signal heuristic false-positive rate** — after the first 10 PRs in Phase 1, reassess and decide whether to switch to BLOCK.
2. **Codex cloud activation playbook** — specific setup for when Tech Lead wants the first async task (label conventions, GitHub App config).
3. **Phase 3 low-risk criteria** — formal list of change classes (test-only, doc-only, devDep bumps) for auto-merge activation.
4. **PR template** — `.github/pull_request_template.md` with mandatory sections (Closes #N, spec link, checklist).
5. **Bootstrap caching** — for frequent calls (if such scenarios arise) — cache gh API calls for ≤60s; not needed in Phase 0 (one call per session).
6. **Multi-repo support** — if DS Platform splits into multiple repos (mobile separate?), bootstrap needs adaptation.
