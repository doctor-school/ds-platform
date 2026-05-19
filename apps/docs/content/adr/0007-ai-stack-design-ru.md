---
title: "Design Spec — AI Stack для DS Platform (Phase 0 methodology + deferred runtime) [RU]"
description: "Этот документ — реализационная детализация ADR-0007. ADR фиксирует «что и почему»; spec — «как именно»: file paths, code sketches, GH Actions YAML,..."
lang: ru
---

> **EN:** [`0007-ai-stack-design-en.md`](./0007-ai-stack-design-en.md) · **RU (this)**

# Design Spec — AI Stack для DS Platform (Phase 0 methodology + deferred runtime)

**Дата:** 2026-05-15
**Статус:** Accepted
**Связан с:** ADR-0007, Plane DSO-30 (`fce557aa-4cfd-4466-b487-5ba165501a1f`)
**Brainstorm:** superpowers:brainstorming skill, симметрично DSO-25..29 + DSO-60
**Наследует:** ADR-0001..0006

Этот документ — реализационная детализация ADR-0007. ADR фиксирует «что и почему»; spec — «как именно»: file paths, code sketches, GH Actions YAML, AGENTS.md шаблоны, скрипты bootstrap'а и reviewer-agent'а.

---

## 1. Сводка решений (cross-ref ADR-0007)

| Решение                          | Выбор                                                                                                                                                                                   | ADR-0007 §        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Scope ADR-0007                   | Phase 0 = AI-loop methodology (dev-time); runtime AI infra — deferred с triggers                                                                                                        | §1                |
| Coding agent harnesses Pre-pilot | Claude Code (primary, sync) + Codex (opt-in async). Cursor deferred.                                                                                                                    | §2                |
| Agent loop discipline            | SDD + TDD как hard rules; iteration-end checklist machine-checkable                                                                                                                     | §3                |
| Task tracking source             | GitHub Issues (per ADR-0006 §9), milestone per feature-spec                                                                                                                             | inherits ADR-0006 |
| Session bootstrap                | `tools/agent-bootstrap.ts` — детерминистический скрипт, output = live state snapshot                                                                                                    | §4                |
| Drift guards AI-specific         | 7 additional CI checks поверх ADR-0006 §7 (spec-link, TDD signal, cross-vendor review, EARS↔test linkage, и др.)                                                                        | §5                |
| Cross-vendor PR review           | GH Action triggers reviewer-bot противоположного vendor'а (explicit label `author:claude` / `author:codex`); required status check на workflow pass, approval-only-by-human сохраняется | §6                |
| Prompt-caching                   | `cache_control: ephemeral` на AGENTS.md+CLAUDE.md+active spec+ADRs; стабильный prefix order для OpenAI prefix-cache                                                                     | §7                |
| Cost observability               | Weekly `cost-ledger-sync.ts`: pull Anthropic+OpenAI usage → CSV в репо через auto-PR (не direct push в main); alert через GitHub Issue при soft-cap > $50/wk                            | §7                |
| Autonomy Phase                   | Phase 2 (chores + supervised PRs); явные trigger'ы на Phase 3                                                                                                                           | §8                |
| Runtime LLM gateway              | LiteLLM Proxy self-hosted в Zone AI (Hetzner EU) — **deferred**, trigger: first runtime AI feature deploy                                                                               | §9                |
| PII-filter / egress proxy        | Same trigger — deferred                                                                                                                                                                 | §9                |
| OTel GenAI semconv collector     | Same trigger — в Phase 0 minimal token-count logging без semconv                                                                                                                        | §9                |
| Vector DB                        | pgvector в Postgres17 (наследуется из ADR-0003), trigger на Qdrant — отдельный ADR                                                                                                      | inherits ADR-0003 |

---

## 2. AI-loop architecture — Phase 0

### 2.1 Iteration unit

Один iteration = одна feature-spec → один или несколько связанных PR. Источник intent — `apps/docs/content/specs/features/NNN-<slug>/{requirements.md, design.md, scenarios.feature}` (3 файла, ADR-0006 §4). Источник execution state — GitHub Milestone `NNN-<slug>` + Issues per EARS-handler (ADR-0006 §9). Никакого `tasks.md` файла.

### 2.2 8-step cycle (canonical, AGENTS.md следует ему)

```
1. READ
   - Run agent-bootstrap (§4) — получает live state
   - Load AGENTS.md + CLAUDE.md (per-harness overlay)
   - Load active spec (req + design + scenarios)
   - Load ADRs из spec's "Prior decisions"
   - Glance at glossary terms in scope
   - `gh issue view <N>` — current Issue body + comments

2. PLAN
   - Если parent Issue для spec'а ещё нет → создать +
     sub-issues per EARS-handler через `gh issue create`
       --milestone "NNN-<slug>" --label "feature:NNN-<slug>"
   - Если parent есть → выбрать open sub-issue или открыть новый
     (если в ходе работы обнаружен gap)
   - Use superpowers:writing-plans skill только если задача
     многошаговая внутри одного Issue. Простой Issue = TodoWrite на месте.

3. RED (TDD)
   - Write failing test(s) для текущего EARS-handler
   - One Vitest test per EARS requirement, naming convention:
       it('EARS-3.1: ...', () => { ... })
   - Playwright tests транспилируются из scenarios.feature
     через playwright-bdd (ADR-0006 §4 + §7 generated artifacts)
   - Invoke superpowers:test-driven-development

4. GREEN
   - Minimum code чтобы тесты прошли
   - Respect SSOT-per-kind (ADR-0006 §3): no inline glossary IDs,
     Zod ↔ Drizzle ↔ OpenAPI canonical sources
   - Run `pnpm generate:all` после edits в schemas/db/glossary

5. REFACTOR
   - Improve code, keep tests green

6. ITERATION-END CHECKLIST (§5.1)
   - All 9 hard rules pass. Если хоть один false — не push.

7. PR OPEN
   - Title: `<type>(<module>): <description> [#N]` (#N = Issue)
   - Body шаблон из AGENTS.md (включает `Closes #N`, spec-link)
   - CI runs ADR-0006 §7 + AI-specific guards (§5.2)
   - Cross-vendor reviewer-bot триггерится автоматически

8. HUMAN-GATE MERGE
   - Tech Lead reads diff + reviewer-bot comments
   - Merge → Issue closes → milestone progress updates
```

### 2.3 Какие harness'ы проходят этот цикл

| Harness                      | Sync/Async    | Phase 0 status                                                         | Notes                                                                                                                                                          |
| ---------------------------- | ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code (terminal в VSC) | sync          | **Primary**                                                            | Текущий рабочий режим Tech Lead. SessionStart hook запускает bootstrap.                                                                                        |
| Codex (cloud)                | async         | **Opt-in self-serve**                                                  | Tech Lead вешает label `codex-go` на `agent-ready` Issue → Codex bot подхватывает. AGENTS.md «Before any task» инструктирует выполнить bootstrap первым шагом. |
| Cursor                       | sync (inline) | **Deferred**                                                           | Trigger: наём второго инженера с inline-AI предпочтением.                                                                                                      |
| Любой другой агент           | —             | Может подключиться к тому же loop'у; bootstrap скрипт vendor-agnostic. |

---

## 3. SDD + TDD как hard rules

### 3.1 SDD — Spec-Driven Development

Hard rule, enforce'ится через AGENTS.md + spec-link CI guard (§5.2):

- **Никакого production-кода без feature-spec'а** в `apps/docs/content/specs/features/NNN-<slug>/`.
- Если фича не имеет spec'а — агент сначала пишет spec через superpowers:brainstorming, потом код. В рамках одной сессии это нормально: brainstorm → spec → ADR (если архитектурно) → план → код.
- Изменения существующих фич обновляют existing spec (status: Draft → In dev → Shipped), а не пишут новый.
- ADR требуется если решение затрагивает несколько модулей или вводит новую технологию.

### 3.2 TDD — Test-Driven Development

Hard rule, enforce'ится через AGENTS.md + TDD-signal CI guard (§5.2 WARN v1 → BLOCK v2):

- **Никакого production-кода без failing test'а**, который этот код motivates.
- One Vitest test per EARS requirement; naming: `it('EARS-N.M: ...', ...)`.
- Playwright tests генерируются из `scenarios.feature` через playwright-bdd (test code != production code).
- Property-based tests для invariants — opt-in от первой фичи с инвариантами (ledger reconciliation, например).
- superpowers:test-driven-development skill — обязательный invocation для любого implementation task.

### 3.3 Когда SDD/TDD justifiably skipped

Узкие исключения, документируются явно в PR description:

- **One-line typo / doc-only edits** — spec/test не нужны (но glossary-mdx-lint всё равно проходит).
- **Dependency bumps** — test suite сам по себе является test'ом.
- **Generated artifacts updates** — test suite является test'ом.
- **Bug-fix без feature-shift** — должен добавить regression test (TDD соблюдён), spec не обязательно обновлять если поведение и так зафиксировано в spec'е.

В остальных случаях skip = methodology violation, reviewer-bot должен это поймать.

---

## 4. Session bootstrap — `tools/agent-bootstrap.ts`

### 4.1 Назначение

Любой агент в начале сессии (sync или async) выполняет скрипт и получает живой snapshot состояния. Не требует никакого state-файла в репо — всё derived из `git` + `gh` + файлов spec'ов.

### 4.2 Что собирает

```
1. Git state (via simple-git / direct execa)
   - current branch + worktree clean/dirty
   - last 5 commits на branch (short format)
   - diverged from main? rebase needed?

2. GitHub state (via gh CLI — already authed в репо)
   - gh issue list --assignee @me --label agent-working --state open
   - gh issue list --assignee @me --label awaiting-review --state open
   - gh issue list --label agent-ready --state open --no-assignee (top 5)
   - gh pr list --author @me --state open --json number,title,reviewDecision,updatedAt

3. Active spec(s)
   - Для каждого agent-working Issue: парсит milestone name → spec folder path
   - Читает requirements.md frontmatter: status, Prior decisions (list of ADRs)
   - Извлекает glossary terms из spec body через [[term-id]] directives

4. Context files to load (paths only)
   - AGENTS.md, CLAUDE.md (root)
   - active spec files (3)
   - ADRs из Prior decisions
   - module README of модулей, упомянутых в Issue body (heuristic)
```

### 4.3 Output

Markdown ≤ 2 KB, формат см. §4.4. Печатается в stdout; вызывающая среда (SessionStart hook / Codex bootstrap step / ручная команда) перенаправляет в context агента.

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

| Harness                   | Mechanism                                                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code**           | `.claude/settings.json` SessionStart hook: `{"command": "pnpm bootstrap"}` (использует `pnpm` alias, не прямой `tsx`, чтобы избежать PATH-resolution issues). Output идёт в `additionalContext` как system-reminder. Прозрачно для пользователя. Timeout — см. §4.6. |
| **Codex (cloud)**         | AGENTS.md «Before any task» — первым шагом: `Run \`pnpm bootstrap\` and use its output to orient yourself.` Codex выполняет в initial setup phase.                                                                                                                   |
| **Cursor (deferred)**     | `.cursor/rules/00-bootstrap.md` указывает то же.                                                                                                                                                                                                                     |
| **Manual / другой агент** | `pnpm bootstrap` (alias в root package.json: `"bootstrap": "tsx tools/agent-bootstrap.ts"`).                                                                                                                                                                         |

### 4.6 Edge cases

- **Worktree dirty** → bootstrap печатает warning + suggests `git status` / `git stash`.
- **Multiple agent-working issues** → показывает все, рекомендует most recently updated.
- **No active Issue, есть open PR** → recommend = address PR feedback.
- **Полностью чистое состояние** → recommend = pick from ready queue или brainstorm new spec.
- **GitHub rate-limit или auth fail** → fallback к git-only выводу + warning.
- **`gh` CLI errors (unknown flag, missing auth, etc.)** → `main()` ловит exception на уровне `Promise.all`; печатает minimal git-only fallback output + warning; exit 0 чтобы SessionStart hook не падал.
- **SessionStart hook timeout** — Claude Code SessionStart hook кладёт результат в context **только если завершился в течение ~60 секунд** (текущий harness limit). Bootstrap должен укладываться в это окно: ~5 параллельных gh API calls + 3 file reads = типично <3s; при недоступности GitHub API — fallback к git-only output <500ms. Если timeout превышен, агент видит warning в context: `[bootstrap] hook timed out — run \`pnpm bootstrap\` manually as first step`.

---

## 5. Iteration-end checklist + AI-specific drift guards

### 5.1 9-item checklist (AGENTS.md hard rules)

Перед `git push` агент проходит каждый пункт. Если хоть один false — не push, либо чинит, либо escalate.

| #   | Check                                                                      | Команда / условие                                             |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | All tests green                                                            | `pnpm test:unit && pnpm test:e2e`                             |
| 2   | Generated artifacts up-to-date                                             | `pnpm generate:all && git diff --exit-code`                   |
| 3   | TypeScript compiles                                                        | `pnpm typecheck`                                              |
| 4   | Lint clean                                                                 | `pnpm lint` (incl. `@ds/glossary-canonical-ids`, events-lint) |
| 5   | Module README updated если exports changed                                 | `pnpm lint:module-readme`                                     |
| 6   | Spec `status` frontmatter обновлён (Draft → In dev → Shipped)              | manual edit в `requirements.md`                               |
| 7   | Glossary terms добавлены если в коде/spec появилась новая доменная лексика | `pnpm lint:glossary-mdx`                                      |
| 8   | ADR создан если было архитектурное решение                                 | judgment; reviewer-bot ловит miss'ы                           |
| 9   | Linked Issue получил summary comment (file paths, decisions, что осталось) | `gh issue comment <N> --body-file <summary>`                  |

### 5.2 CI gates — AI-specific extensions (поверх ADR-0006 §7)

| Guard                           | Что ловит                                                                   | Implementation                                                                                                                                                                                                                                                                        | Severity Phase 0              |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **spec-link required**          | PR без link на Issue, у которого milestone = spec                           | GH Action: PR body содержит `Closes #N`; Issue `#N` имеет milestone `NNN-<slug>`; spec folder `apps/docs/content/specs/features/NNN-<slug>/` существует.                                                                                                                              | BLOCK                         |
| **TDD signal**                  | implementation-only commit без test-файла                                   | GH Action: для каждого изменённого `src/**/*.ts` — `*.test.ts` либо в diff, либо commit history показывает test-commit предшествующим. Heuristic, false positives возможны.                                                                                                           | WARN v1                       |
| **cross-vendor review посещён** | Merge без agent-review run                                                  | Branch protection rule: требует прохождения GH status check `agent-review`. Workflow exits 0 в обоих случаях — successful LLM review и `[REVIEWER-UNAVAILABLE]` fallback (см. §6.5). Reviewer-bot никогда не approve'ит PR; human approval — отдельное branch protection requirement. | BLOCK (workflow run required) |
| **EARS ↔ test linkage**         | EARS-требование без `it('EARS-N.M: ...')`                                   | Custom lint `tools/lint/ears-test-lint.ts`: парсит EARS IDs в requirements.md, проверяет наличие it-описаний с тем же ID в модуле.                                                                                                                                                    | WARN v1 → BLOCK v2            |
| **Gherkin coverage**            | scenarios без Playwright step реализации                                    | playwright-bdd native error — test fails если step undefined.                                                                                                                                                                                                                         | BLOCK (через test fail)       |
| **Spec status freshness**       | Merged PR со spec:NNN, но spec status='Draft'                               | Custom lint: при merge — проверить `status: In dev` minimum.                                                                                                                                                                                                                          | WARN v1                       |
| **Prior decisions cited**       | Новый spec без указанных ADR в "Prior decisions" если категория ≠ docs-only | Spec lint: `requirements.md` имеет секцию с ≥1 ADR-link.                                                                                                                                                                                                                              | WARN v1                       |

### 5.3 Custom lint скрипты

**`tools/lint/ears-test-lint.ts`** — пример sketch:

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

**`tools/lint/spec-link-lint.ts`** — runs в GH Action. Заметки:

- `gh pr view --json` **не отдаёт** `closingIssuesReferences` (это GraphQL-only поле). Парсим из PR body через regex.
- Guard применяется **только к PR с label `feature:*`** (или к PR где linked Issue имеет такой label). Bug/chore/dep-bump PR не обязаны указывать spec.

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

## 6. Cross-vendor reviewer-agent

> **⚠️ SUPERSEDED by ADR-0007 Amendment A1 (2026-05-19):** Automated cross-vendor reviewer-bot (`tools/reviewer-agent/` + `.github/workflows/agent-review.yml`) **не реализуется в Phase 0**. Замена = interactive-only LLM-assisted review в трёх режимах (a) main-session subagent `/review` skill, (b) parallel Codex CLI session, (c) pure human review. Никаких headless CI-вызовов к LLM API; никаких repo-secret API-ключей. См. ADR-0007 §7 Amendment A1 для полного контекста. Контент ниже сохранён для исторической справки и будущего пересмотра.

### 6.1 GitHub Actions workflow

**Design intent:**

- Workflow exit code = required GitHub status check. Branch protection rule = "status check `agent-review` passes" (not "approving review from reviewer-bot account"). Это позволяет: (a) при API downtime workflow всё равно завершается с exit 0 + посылает fallback comment с `[REVIEWER-UNAVAILABLE]` маркером — human видит и принимает решение; (b) reviewer-bot никогда не "approve"-ит PR, human-gate сохраняется чисто.
- Vendor detection — **explicit label** `author:claude` / `author:codex` ставит сам агент при PR open (часть AGENTS.md PR template). Default при отсутствии label = OpenAI (Claude — primary harness в Phase 0, поэтому fallback на не-Claude).

`.github/workflows/agent-review.yml`:

```yaml
name: Agent Review
on:
  pull_request:
    types: [opened, synchronize, ready_for_review, labeled]
permissions:
  contents: read
  pull-requests: write
  issues: read

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile

      - name: Determine reviewer vendor (explicit label)
        id: vendor
        env:
          LABELS_JSON: ${{ toJson(github.event.pull_request.labels) }}
        run: |
          # Explicit label set by author-agent at PR open per AGENTS.md PR template.
          # If author:claude → reviewer=openai; if author:codex → reviewer=anthropic.
          # If no author:* label present → default reviewer=openai (Claude is Phase 0 primary).
          if echo "$LABELS_JSON" | grep -q '"author:codex"'; then
            echo "vendor=anthropic" >> $GITHUB_OUTPUT
          else
            echo "vendor=openai" >> $GITHUB_OUTPUT
          fi

      - name: Run reviewer (always exits 0; posts fallback comment on API failure)
        env:
          REVIEWER_VENDOR: ${{ steps.vendor.outputs.vendor }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: pnpm tsx tools/reviewer-agent/run.ts
```

**Failure-mode contract (`tools/reviewer-agent/run.ts`):**

- Successful LLM call → posts `gh pr review --comment` with findings, exit 0.
- LLM API error / timeout → posts `gh pr comment` (regular issue comment, not review) with body `[REVIEWER-UNAVAILABLE] Agent review skipped — API error: <message>. Human reviewer should perform manual review.`, exit 0.
- Configuration error (missing secret / context dir) → posts `[REVIEWER-CONFIG-ERROR] ...`, exit 0.
- Internal bug (uncaught exception) → workflow shows red ❌; investigated as infra incident.

Workflow exit 0 в первых трёх случаях = required check passes. Human видит pinned comment + читает diff. Branch protection rule поставленная на status check `agent-review` остаётся satisfied.

**Branch protection rule (manual setup, см. §11 migration step 8):**

- Require status check: `agent-review` to pass before merging
- Require at least 1 review approval from human collaborators (`reviewer-bot` is NOT a required approver)
- Restrict who can push to `main`: empty (only PR merges)

### 6.2 Reviewer logic

`tools/reviewer-agent/run.ts`:

1. **Загружает контекст** (стабильный порядок для prefix-cache):

- `AGENTS.md`, `CLAUDE.md`
- Linked Issue body + milestone-spec (3 файла)
- ADRs из spec's Prior decisions
- PR diff (`gh pr diff <N>`)

2. **Two-pass review:**

- **Pass A — general code review.** Промпт: bugs, security (OWASP), edge cases, performance, readability. Output — список findings с file/line refs.
- **Pass B — ADR/SDD compliance.** Промпт: does code respect cited ADRs? does code match scenarios.feature? are all EARS handlers implemented per requirements.md? does spec.status reflect реальность? are new domain terms in glossary? Output — список compliance issues.

3. **Posts review:** объединённый список → `gh pr review <N> --comment --body-file <findings.md>`. Approval НЕ ставит (human-gate сохраняется).
4. **Special markers** в выводе:

- `[BLOCKING]` finding — критичная проблема (security, явный SDD/TDD violation, ADR violation). Reviewer-bot всё равно не блокирует merge сам (это branch protection rule), но человек видит явный сигнал.
- `[NIT]` finding — style / minor.

### 6.3 Prompt templates

`tools/reviewer-agent/prompts/general.md`:

```
You are a senior code reviewer for the DS Platform monorepo. Your task: review a PR diff and produce a list of findings.

Context (in stable order for prefix caching):
1. AGENTS.md — universal AI constitution
2. CLAUDE.md — Claude-Code specific overlay (may not apply to this PR's author)
3. Linked Issue + feature spec (requirements.md, design.md, scenarios.feature)
4. Relevant ADRs

Diff follows after this block.

Find:
- Bugs and logic errors (off-by-one, null/undefined, race conditions)
- Security issues (SQL injection, auth bypass, secret leakage, prompt injection vectors)
- Edge cases the test suite likely misses
- Performance pitfalls (N+1 queries, unnecessary re-renders, missing pagination)
- Readability / naming consistency with existing codebase

For each finding:
- Mark severity: [BLOCKING] / [NIT] / [SUGGESTION]
- Cite file:line
- Explain *why* it's a problem
- Suggest specific fix when possible

Output as markdown list. Be precise; no filler.
```

`tools/reviewer-agent/prompts/sdd-compliance.md`:

```
You are an architectural compliance reviewer. Your task: verify that this PR adheres to:
1. The cited ADRs in the spec's "Prior decisions" section
2. The feature spec's EARS requirements and scenarios.feature scenarios
3. SDD/TDD methodology per AGENTS.md

Check:
- Does every EARS-N.M requirement have a corresponding `it('EARS-N.M: ...')` test in the diff?
- Does every scenario in scenarios.feature have a corresponding Playwright test?
- Does the implementation respect the architectural decisions in cited ADRs? Cite specific § when violated.
- Is `requirements.md` `status:` frontmatter updated if the implementation moves the feature forward?
- Are new domain terms added to glossary if introduced in code?
- Is the PR linked to a GitHub Issue via `Closes #N`, and does that Issue have a milestone matching a spec folder?
- **Does this PR introduce a new architectural choice (new technology, new cross-module pattern, new security boundary, new external dependency) that is NOT covered by any cited ADR?** If so, flag as [BLOCKING] — a new ADR is required before merge, not after.

Note on correlated context: you are reading the same ADRs and spec that the PR author agent read. Be especially skeptical of implementations that *exactly match* an ambiguous interpretation of an ADR — flag ambiguities as [QUESTION] for human reviewer rather than rubber-stamping.

Output as markdown list. For each violation:
- Mark severity: [BLOCKING] (clear violation) / [QUESTION] (unclear, ask author)
- Cite spec/ADR §
- Explain expected vs observed
```

### 6.4 Cost estimate

- Per PR: ~5-15K input tokens (cached ~70% после первого call в day) + ~1-2K output × 2 passes
- ~5 PRs/day × ~$0.03/PR (Claude Sonnet / GPT-5-equivalent pricing 2026) = **~$0.15/day**
- В Pre-pilot не критично

### 6.5 Failure modes

- **Reviewer API down / timeout** → reviewer-agent ловит и постит `[REVIEWER-UNAVAILABLE]` fallback comment, workflow exit 0, status check passes. Human reads comment + diff, manually verifies, merge через approval. Logging в weekly cost-ledger показывает downtime инциденты.
- **Reviewer hallucinates non-existent issues** → bot никогда не approve'ит PR (только `--comment` review), human-gate сохраняется чисто. Tech Lead фильтрует ложные срабатывания при merge approval. Метрика precision (см. §8.2 Phase 3 trigger) tracks эти случаи.
- **PR is huge** (>5K diff lines) → reviewer cuts diff to first N hunks + caveat в комментарии «truncated review, manual deep-review recommended». Threshold — config в reviewer-agent.
- **Rate-limit burst** (10+ PRs одновременно) — `@anthropic-ai/sdk` и `openai` имеют built-in exponential-backoff retry; должно справиться с типичными tier limits. При исчерпании retry budget — `[REVIEWER-UNAVAILABLE]` fallback path.

### 6.6 Limitation: correlated misinterpretation на shared context

Cross-vendor review снижает correlated **code-level** errors (разные модели имеют разные blind spots для bugs/security/edge-cases) — это основной выигрыш. Но Pass B (ADR/SDD compliance) скармливает обоим моделям **одинаковый текст** ADR'ов и spec'а. Если автор-агент misinterpreted ADR-N §M, reviewer-агент видит тот же §M и с высокой вероятностью accept'нет ту же интерпретацию. Это **honest limitation** дизайна: cross-vendor review **не заменяет** human review для архитектурно-критичных решений; human merge gate ловит этот класс ошибок.

---

## 7. Prompt-caching policy + cost observability

> **⚠️ SUPERSEDED by ADR-0007 Amendment A1 (2026-05-19) — только cost-observability subsection:** Automated cost-ledger (`tools/cost-ledger-sync.ts` + `.github/workflows/cost-ledger.yml` weekly cron + auto-PR pattern) **не реализуется в Phase 0**. Cost tracking теперь вручную через консоли vendor'ов (Anthropic Console, OpenAI Platform). **Prompt-caching policy (§7.1) остаётся в силе** для любого будущего LLM-клиента (interactive `/review` skill, runtime AI features после §9 trigger'а). См. ADR-0007 §7 Amendment A1. Cost-ledger контент ниже сохранён для исторической справки.

### 7.1 Caching policy

Hard rule в AGENTS.md, обязателен для всех runtime LLM-вызовов (reviewer-bot, future Content Pipeline и т.д.):

| Что                                    | Cache policy                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| `AGENTS.md`, `CLAUDE.md`               | `cache_control: ephemeral` (Anthropic); первым в payload (для OpenAI prefix-cache) |
| Active spec files (3)                  | `cache_control: ephemeral` пока сессия про этот spec                               |
| ADRs из Prior decisions (только cited) | `cache_control: ephemeral`                                                         |
| Glossary entries                       | НЕ кешировать (избирательно, малый ROI)                                            |
| User turn-by-turn dialogue             | НЕ кешировать                                                                      |

**Стабильный prefix order** в каждом запросе:

```
[system] AGENTS.md → CLAUDE.md → active spec (req → design → scenarios) → ADRs (sorted by ADR number) → glossary terms (только in-scope) → [user turn]
```

Anthropic — explicit `cache_control: {type: 'ephemeral'}`, 5-min TTL. OpenAI GPT-5+ — automatic prefix cache, требует чтобы префикс был byte-identical. Reviewer-agent и любые другие LLM clients строят payload через общую helper-функцию `packages/llm-utils/buildContext.ts` для гарантии стабильности.

### 7.2 Sketch buildContext

**Anthropic ограничение:** не более **4 cache breakpoints** на запрос (Messages API). Поэтому блоки **конкатенируются по tier'ам**, и `cache_control` ставится только на хвост каждого tier'а — итого ≤4 cache markers.

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

  // ---- Tier 1: constitution (AGENTS.md обязательный, CLAUDE.md optional, concat) ----
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
  // Изменения in-scope terms не инвалидируют prefix выше. 4-й cache slot оставлен под future use
  // (например, module READMEs); не расходуется на glossary.
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

Используется в reviewer-agent и любых других runtime LLM-клиентах.

**Cache invariants:**

- AGENTS.md / CLAUDE.md изменяются редко → tier 1 cache hit ~всегда после первого call.
- Spec изменяется per feature → tier 2 cache hit пока сессия в рамках одной фичи.
- ADRs immutable после Accepted → tier 3 cache hit ~всегда (новый ADR в "Prior decisions" инвалидирует — это приемлемо, редкое событие).
- Glossary terms — последние, чтобы изменения per-spec scope не ломали prefix выше.

### 7.3 Cost observability — Phase 0

Без gateway, без in-line rejection. Простой weekly pull + alert:

`tools/cost-ledger-sync.ts` (запускается через GitHub Actions cron еженедельно):

```ts
#!/usr/bin/env tsx
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = resolve(REPO_ROOT, "outputs/llm-cost-ledger.csv");
const SOFT_CAP_USD = parseFloat(process.env.SOFT_CAP_USD ?? "50");

interface Row {
  date: string;
  vendor: string;
  project: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

async function pullAnthropic(): Promise<Row[]> {
  // Anthropic Console API: GET /v1/organizations/{org_id}/usage_report
  // ANTHROPIC_ADMIN_KEY required (separate from API key for usage endpoints)
  // Returns daily usage per workspace
  // TODO: implementation depends on current Anthropic Admin API shape — verify at impl time (DSO-31 step 11)
  console.warn(
    "[cost-ledger] pullAnthropic() is not yet implemented — returning empty rows.",
  );
  return [];
}

async function pullOpenAI(): Promise<Row[]> {
  // OpenAI Usage API: GET /v1/organization/usage/completions
  // OPENAI_ADMIN_KEY required
  // TODO: implementation depends on current OpenAI Admin API shape — verify at impl time (DSO-31 step 11)
  console.warn(
    "[cost-ledger] pullOpenAI() is not yet implemented — returning empty rows.",
  );
  return [];
}

async function appendCsv(rows: Row[]) {
  await mkdir(dirname(LEDGER), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(LEDGER, "utf-8");
  } catch {
    /* first run */
  }
  const header =
    "date,vendor,project,input_tokens,cached_input_tokens,output_tokens,cost_usd\n";
  if (!existing.startsWith("date,")) existing = header;
  const lines = rows.map(
    (r) =>
      `${r.date},${r.vendor},${r.project},${r.input_tokens},${r.cached_input_tokens},${r.output_tokens},${r.cost_usd.toFixed(4)}`,
  );
  await writeFile(LEDGER, existing + lines.join("\n") + "\n");
}

async function alertIfOverCap(rows: Row[]) {
  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const weekTotal = rows
    .filter((r) => r.date >= weekStart)
    .reduce((s, r) => s + r.cost_usd, 0);
  if (weekTotal > SOFT_CAP_USD) {
    const body =
      `Weekly LLM cost reached **$${weekTotal.toFixed(2)}** (cap: $${SOFT_CAP_USD}). Breakdown:\n\n` +
      Object.entries(
        rows
          .filter((r) => r.date >= weekStart)
          .reduce<Record<string, number>>((acc, r) => {
            const k = `${r.vendor} / ${r.project}`;
            acc[k] = (acc[k] ?? 0) + r.cost_usd;
            return acc;
          }, {}),
      )
        .map(([k, v]) => `- ${k}: $${v.toFixed(2)}`)
        .join("\n");
    await execa("gh", [
      "issue",
      "create",
      "--title",
      `LLM cost alert: weekly $${weekTotal.toFixed(2)} > cap $${SOFT_CAP_USD}`,
      "--body",
      body,
      "--label",
      "cost-alert",
    ]);
  }
}

async function main() {
  const rows = [...(await pullAnthropic()), ...(await pullOpenAI())];
  if (rows.length === 0) {
    // Loud failure — silent empty rows = недели без alerts, ledger выглядит "working"
    console.error(
      "[cost-ledger] ERROR: both pullers returned empty. Either both vendors have zero usage (unlikely) or stubs are still unimplemented. Exiting non-zero so the GH Actions step shows red.",
    );
    process.exit(2);
  }
  await appendCsv(rows);
  await alertIfOverCap(rows);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

GitHub Actions cron `.github/workflows/cost-ledger.yml`. **Important:** прямой push в `main` запрещён (§8.1). Workflow создаёт ветку `chore/cost-ledger-<date>` + auto-PR, который Tech Lead мержит вручную (consistent с autonomy policy):

```yaml
name: Weekly LLM cost ledger
on:
  schedule:
    - cron: "0 9 * * 1" # каждый понедельник 09:00 UTC (12:00 MSK)
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
  issues: write
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - name: Sync usage data
        env:
          ANTHROPIC_ADMIN_KEY: ${{ secrets.ANTHROPIC_ADMIN_KEY }}
          OPENAI_ADMIN_KEY: ${{ secrets.OPENAI_ADMIN_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SOFT_CAP_USD: "50"
        run: pnpm tsx tools/cost-ledger-sync.ts
      - name: Create PR with ledger updates
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git config user.name "cost-ledger-bot"
          git config user.email "bot@bbm.academy"
          DATE=$(date -u +%Y-%m-%d)
          BRANCH="chore/cost-ledger-$DATE"
          git checkout -b "$BRANCH"
          git add outputs/llm-cost-ledger.csv
          if git diff --staged --quiet; then
            echo "No ledger changes; skipping PR."
            exit 0
          fi
          git commit -m "chore(cost): weekly ledger sync $DATE"
          git push -u origin "$BRANCH"
          gh pr create --title "chore(cost): weekly ledger sync $DATE" \
            --body "Automated weekly cost-ledger sync. See \`outputs/llm-cost-ledger.csv\` diff." \
            --label "chore:auto"
```

CSV в Git — history виден; при необходимости легко импортируется в Grafana / Excel. Auto-PR проходит через cross-vendor reviewer + human merge как обычный PR (label `chore:auto` помечает что content машинно-сгенерирован).

---

## 8. Autonomy ladder

### 8.1 Phase 2 — текущий target Pre-pilot

Параметры:

- Агенты пишут PR на любые feature/bugfix/refactor
- Human-merge gate **обязателен** (branch protection rule)
- Cross-vendor reviewer-bot **обязателен** (branch protection rule)
- Auto-merge запрещён
- Write-доступ в prod-DB запрещён (только через миграции в PR)
- Direct push в `main` запрещён
- Прямая запись в `docs/adr/*.md` после `status: Accepted` запрещена (создание superseding ADR разрешено)

**Auto-chores разрешены** через bot-PR с label `chore:auto`:

- Lint-fix (prettier, eslint --fix)
- Dep-bump в `devDependencies` (через Renovate / Dependabot)
- Doc-sync (`pnpm generate:all` artifact updates)

Все auto-chores PR'ы всё равно проходят через cross-vendor review + human-merge.

### 8.2 Trigger на Phase 3

Phase 3 = auto-merge low-risk PR за feature flag. Активируется при выполнении ВСЕХ условий:

- ≥50 успешных agent-PR без post-merge incident (отслеживается labels'ами `post-merge-incident`)
- Reviewer-bot precision ≥70% (см. measurement protocol ниже)
- Документированные low-risk criteria в отдельном ADR — например: «only `*.test.ts` files modified», «only docs in `apps/docs/content/`», «devDep version bump при green CI»
- Kill switch tested (см. §8.4)

Активация Phase 3 — отдельный ADR-NNNN.

**Measurement protocol — reviewer-bot precision/recall:**

| Term                | Definition                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TP (true positive)  | Reviewer-bot posted `[BLOCKING]` finding, и Tech Lead confirmed как valid issue **до merge** (либо fix'нул, либо явно отметил `valid-but-deferred` в PR comment). |
| FP (false positive) | Reviewer-bot posted `[BLOCKING]` finding, и Tech Lead dismissed (явный reply «not a bug» либо merge без addressing).                                              |
| FN (false negative) | Post-merge incident (label `post-merge-incident`), который reviewer-bot должен был поймать, но не поймал. Определяется в post-mortem каждого incident'а.          |
| Precision           | `TP / (TP + FP)` — % findings которые были valid. Target ≥70%.                                                                                                    |
| Recall              | `TP / (TP + FN)` — % issues которые bot поймал из всех, которые должен был. Target ≥50%.                                                                          |

**Evaluator:** Tech Lead (single judge — приемлемо для team-of-1 baseline; при росте команды → 2-3 evaluator с inter-rater check).
**Sample size:** ≥20 PR с reviewer-bot findings, накопленных в Phase 2.
**Tracking:** simple CSV `outputs/reviewer-bot-eval.csv` (PR_number, finding_id, severity, anton_verdict). Recall column заполняется при возникновении post-merge-incident.
**Cadence:** evaluator update раз в 2 недели в Phase 2; после 20 PR — формальное Phase 3 trigger assessment.

### 8.3 Phase 4 — out of scope ADR-0007

End-to-end autonomous работа агента (от Issue до merge без human touch для определённых классов задач) — отложено до Phase 1 продакшна минимум.

### 8.4 Kill switch

Single config flag в `.github/agents-config.json`:

```json
{
  "agents_enabled": true,
  "cross_vendor_review_required": true
}
```

При `agents_enabled: false` — Action `agent-review.yml` skip'ает себя, бот не отвечает. Активируется при инциденте безопасности или экстренной остановке. Изменение этого файла — обычный PR + human merge (так что нельзя случайно убить kill switch сам собой).

`auto_merge_enabled` поле НЕ добавляется в Phase 2 — auto-merge запрещён по дизайну (§8.1). Поле появится в Phase 3 ADR-NNNN когда соответствующий механизм будет введён.

---

## 9. Deferred architecture с triggers

Эта секция — **дизайн на будущее, не реализация в Phase 0**. Каждый компонент подключается отдельным ADR-NNNN при выполнении trigger'а.

### 9.1 LiteLLM Proxy + Zone-AI VM

**Trigger:** first runtime AI feature deploy. Сейчас это запланировано как Content Pipeline v2 (LLM draft уроков) — см. `knowledge-base/documents/ds-platform-components/12-ai-content-pipeline.md` §3. Конкретная дата ≈ v2 milestone (после Pre-pilot, ~3-6 месяцев после Phase 0 закрыт).

**Self-host honest framing (parallel to ADR-0006 §3 Keystatic/GitHub caveat):** Hetzner EU — non-RF compute (Германия). 152-ФЗ не нарушается потому что **ПДн не пересекают границу Zone RF → Zone AI**: PII Filter (см. §9.2) обезличивает payload **перед** mTLS egress. На границе проходят только sanitized prompts с placeholder-токенами. Это "self-host" в смысле «инфраструктура контролируется нами, не managed-vendor'ом», но **не "data sovereignty"** в строгом смысле (compute в EU). Trigger to revisit fallback: блокировка Hetzner EU из РФ (политически или сетево), или regulatory изменение требующее compute в РФ для AI-обработки — fallback к self-hosted в Timeweb с международным egress proxy (см. §9.6 sandbox / experimentation).

**Архитектура (план):**

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
│  - OpenAI-compat /v1/...     │  │ (instance B, в Timeweb)│
│  - Anthropic + OpenAI routes │  │ - YandexGPT route only │
│  - virtual keys + budgets    │  │ - same virtual-key DB  │
│  - prompt-cache passthrough  │  │   (Postgres replication│
│  - OTel emit → Collector     │  │   from instance A)     │
└──────────┬───────────────────┘  └────────┬──────────────┘
           ▼                                ▼
       Anthropic   OpenAI/Codex      YandexGPT
```

**Provider routing (resolved):**

- Anthropic, OpenAI → **LiteLLM instance A в Hetzner EU** (foreign API endpoints требуют EU egress)
- YandexGPT → **LiteLLM instance B в Zone RF (Timeweb)** — отдельный deployment, потому что YandexGPT доступен только из РФ; маршрут RF backend → RF YandexGPT не должен делать hop в EU и обратно
- Обе instance делят один Postgres (replication из A в B; A — primary для virtual key state) для unified accounting/budgets
- PII Filter applies к обоим маршрутам unconditionally — даже для YandexGPT внутри РФ (152-ФЗ требует обезличивания при отправке третьему лицу, даже российскому)

**LiteLLM admin UI protection:** LiteLLM admin не имеет native OIDC; protect через nginx forward-auth proxy с Authentik / Zitadel (ADR-0001 OIDC tenant). Это не trivial и оформляется отдельным дизайн-блоком в trigger-ADR.

**Capacity Phase 0+1:** instance A — одна VM (Hetzner EU, ~€20/мес); instance B — одна VM в существующем Timeweb (~₽1000/мес). HA-пара через keepalived — Phase Pilot+.

**Pre-v2 prerequisite — dual-LLM pattern evaluation:** Content Pipeline v2 (`12-ai-content-pipeline.md` §3) processes content из brief'ов от экспертов. Если brief может содержать user-submitted material (e.g., копипаст из чата, файлы от соавторов), prompt-injection vector активен с дня 1. Перед запуском v2 в production — формальная оценка: входит ли user-controlled content в pipeline? Если да — OWASP dual-LLM pattern (privileged LLM с tools отделена от quarantined LLM читающей untrusted content) должен быть в дизайне trigger-ADR, не deferred дальше.

### 9.2 PII filter

> **Forward-ref (security boundary):** PII-filter — **первый** слой защиты egress'а в AI-zone. **Второй обязательный** слой для любого runtime LLM-flow с tool-use или untrusted user content — **dual-LLM mandatory pattern**: см. **ADR-0010** + design spec **`2026-05-18-ds-platform-dual-llm-pattern-design`** (Quarantined LLM ↔ Privileged LLM split, symbolic references, audit class `ai_dual_llm`).

**Trigger:** same as 9.1.

**Design v1 (input-direction only):**

- Regex-based: РФ phone, email, ФИО (Cyrillic full-name patterns), документы (СНИЛС, паспорт, диплом-номер).
- Structured field allowlist: только поля helpfully-tagged как «safe-to-send-external» в PII-schema (`packages/pii-schema/`).
- Pre-call hook в backend (NestJS interceptor) — заменяет PII на placeholders `<<DOC_NUMBER_1>>` перед отправкой в LiteLLM. Audit log записывает: какой field был sanitized, какой placeholder использован.
- Post-call placeholder reverse-substitution — placeholders заменяются обратно **только если** возвращаемый text идёт обратно тому же пользователю (т.е. поля сохраняются в его user-scoped record). Иначе reverse не выполняется.

**Honest gap — v1 covers только input direction.** v1 защищает **от exfiltration** ПДн на external provider (это main 152-ФЗ requirement). v1 **не защищает** от:

- (a) LLM hallucinating чужие реальные document numbers / ФИО в output
- (b) LLM комбинирования innocuous fragments в re-identifiable текст
- (c) Случаев когда output идёт downstream non-authorized parties (e.g., public-facing PRD generated from internal brief)

Output-direction PII filter — **v3 concern**. До v3 — operational mitigation: AI-generated content всегда проходит human review перед публикацией (это уже есть в Content Pipeline §3 «утверждение редактором»). Trigger-ADR на runtime LLM gateway фиксирует это явно как known gap с trigger'ом на v3 expansion.

**Design v2 (trigger: regex false-negative rate >5% на synthetic test corpus — corpus сам создаётся в момент 9.1 trigger):**

- spaCy NER модель (Russian-trained) для catch'а нестандартных формулировок.
- Self-hosted в Zone RF рядом с PII Filter (NER должен работать до того как PII покинут Zone RF).

### 9.3 OTel GenAI collector

**Trigger:** same as 9.1 (LiteLLM нативно эмитит `gen_ai.*` spans; коллектор включается чтобы их принять).

**Design:**

- OTel Collector в Zone AI (рядом с LiteLLM) → batch'ит spans → отправляет через mTLS обратно в Zone RF (Tempo + Loki из ADR engineering-readiness).
- Атрибуты: `gen_ai.system`, `gen_ai.request.model`, `gen_ai.request.temperature`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.cached_input_tokens`, `gen_ai.virtual_key` (LiteLLM), `gen_ai.budget.remaining_usd`.
- Grafana dashboard: per-virtual-key cost, latency P50/P95/P99, error rate, cache hit rate.
- **Forward-ref (observability для dual-LLM):** при включении dual-LLM pattern добавляются spans `ai.dual_llm.quarantined_call` и `ai.dual_llm.privileged_call` + audit-класс `ai_dual_llm` (subject_id pseudonymized). Контракт — `2026-05-18-ds-platform-dual-llm-pattern-design` §«Observability» + ADR-0010.

В Phase 0 — minimal token-count logging без semconv: reviewer-agent просто пишет в stderr строку `[cost] tokens=in:5000 cached:3500 out:1200 cost_usd=0.018`, парсится CI workflow → агрегируется weekly в cost-ledger (§7.3).

### 9.4 Vector DB scaling

**Default:** pgvector в Postgres17 (наследуется из ADR-0003 §7 — уже зафиксирован).

**Trigger на отдельный Qdrant:** mobile v3 AI-рекомендации показывают p95 query latency >100ms на pgvector с production-scale dataset, или vector workload начинает мешать OLTP. Отдельный ADR-NNNN при достижении.

### 9.5 Self-hosted GitHub Actions runner

**Trigger:** не AI-specific. Подключается в DSO-31 (engineering-readiness setup) для общего CI на Timeweb. Phase 0 — GitHub-hosted runners (ubuntu-latest) достаточно.

### 9.6 Sandbox / experimentation environment

**Trigger:** команда вырастает до 3+ инженеров с параллельными agent-PR, или появляется регулярная потребность отлаживать LiteLLM/PII-filter без production traffic. Отдельный ADR в engineering-readiness scope.

**Default option в этом ADR:** dedicated namespace на основном Timeweb k8s cluster (если k8s выбран) или отдельный VM в Zone AI рядом с LiteLLM. Northflank/Daytona — рассматривается только если managed offering пройдёт RF-доступность check.

### 9.7 Codex cloud async activation

**Trigger:** Tech Lead решает запустить первую async-задачу. Не требует ADR.

**Setup на момент trigger:**

1. `.codex/AGENTS.md` link на root AGENTS.md (если Codex requires its own location)
2. GitHub App для Codex с правами write-PR в репо
3. Label `codex-go` — bot trigger
4. Bootstrap скрипт уже работает универсально

---

## 10. AGENTS.md / CLAUDE.md — sketches для DS Platform

> **⚠️ SUPERSEDED by ADR-0007 Amendment A1 (2026-05-19) — только review-tooling portions:** Любые ссылки в скетчах AGENTS.md / CLAUDE.md ниже на automated reviewer-bot, флаг kill-switch `cross_vendor_review_required`, status check `agent-review` или weekly cost-ledger PR — **больше не authoritative**. Эти overlay'и должны быть переписаны в G7 (AGENTS.md / CLAUDE.md drafting) чтобы описать новые interactive-review режимы (a)/(b)/(c) из ADR-0007 Amendment A1 §A1.3. Секции, не относящиеся к review/cost (8-step cycle wording, SDD/TDD discipline, prompt-caching, SessionStart hook, skill priorities), остаются authoritative. См. ADR-0007 §7 Amendment A1.

### 10.1 AGENTS.md (root)

ADR-0006 §9.1 уже зафиксировал основную структуру. DSO-30 добавляет AI-loop секцию:

```markdown
# Agent Instructions — DS Platform

[... stack list, doc structure из ADR-0006 ...]

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

### Step 8 — HUMAN-GATE MERGE

Wait for the Tech Lead to review and merge. Cross-vendor reviewer-bot will post review
comments — read them, address before re-requesting review.

## SDD — hard rule

No production code without a feature spec at apps/docs/content/specs/features/NNN-<slug>/.
If the feature has no spec, invoke superpowers:brainstorming first.

## TDD — hard rule

No production code without a failing test that motivates it.
Naming convention: `it('EARS-N.M: ...', ...)`.

## Prompt-caching

For any LLM call you make (e.g., reviewer-agent), use
packages/llm-utils/buildContext.ts to construct the system message. This
ensures cache_control: ephemeral on AGENTS.md / CLAUDE.md / active spec /
ADRs in a stable prefix order. Cache hit rate target: ≥60% on second+ calls.

## Cost discipline

LLM token usage logged to outputs/llm-cost-ledger.csv weekly. Soft cap: $50/week.
If your work generates expensive calls (e.g., large diff reviews, bulk doc generation),
flag it in PR description.

## Kill switch

.github/agents-config.json controls global agent activity. If
`agents_enabled: false` — do not push automated PRs, escalate to human.
```

### 10.2 CLAUDE.md (Claude-Code overlay) — additive blocks vs ADR-0006 §9.2

ADR-0006 §9.2 уже зафиксировал baseline CLAUDE.md (MCP servers, tool preferences, skill priority, slash commands, notes). DSO-31 implementer **добавляет** к этому baseline следующие блоки. Tool preferences и skill priority блоки из ADR-0006 §9.2 **переиспользуются как есть, не дублируются**:

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

Phase 0 (Tech Lead + AI, sequential — после того как DSO-31 создаст репо `ds-platform`). Порядок переупорядочен: lint-tools (step 9) и CI integration (step 10) идут **до** branch protection rule (step 13), чтобы при первой активации защиты все guards уже работают и нет окна между «protection on» и «guards wired».

**Pre-requisite:** Tech Lead должен иметь admin permissions на репо (branch protection rule в step 13 требует admin token; cannot be automated). Если репо принадлежит организации — нужны org-admin права или явное delegation на репо-admin role.

| Step | Action                                                                                                                                                                                                                                   | Output                                                             | Blocking                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------- |
| 1    | Создать `tools/agent-bootstrap.ts`                                                                                                                                                                                                       | bootstrap работает локально                                        | DSO-31 (репо exists)      |
| 2    | Добавить `pnpm bootstrap` alias в root `package.json`                                                                                                                                                                                    | команда runnable                                                   | step 1                    | **Done в G1, см. commit `ae3826f` в `doctor-school/ds-platform`** |
| 3    | Добавить `.claude/settings.json` с SessionStart hook                                                                                                                                                                                     | Claude Code auto-loads bootstrap                                   | step 2                    |
| 4    | Создать `packages/llm-utils/buildContext.ts`                                                                                                                                                                                             | reusable helper для LLM-clients                                    | DSO-31                    |
| 5    | ~~Создать `tools/reviewer-agent/{run.ts, prompts/}`~~                                                                                                                                                                                    | ~~reviewer-bot работает~~                                          | ~~step 4~~                | **Cancelled per ADR-0007 Amendment A1**                           |
| 6    | ~~Добавить `.github/workflows/agent-review.yml`~~                                                                                                                                                                                        | ~~bot триггерится на PR open~~                                     | ~~step 5~~                | **Cancelled per ADR-0007 Amendment A1**                           |
| 7    | Добавить `.github/agents-config.json` kill switch                                                                                                                                                                                        | kill switch active                                                 | —                         |
| 8    | Создать `tools/lint/spec-link-lint.ts` + `ears-test-lint.ts`                                                                                                                                                                             | AI-specific guards available                                       | —                         |
| 9    | Добавить шаги в `.github/workflows/ci.yml` для guards (WARN/BLOCK per §5.2)                                                                                                                                                              | CI выполняет guards                                                | step 8                    |
| 10   | ~~Создать `tools/cost-ledger-sync.ts` + `.github/workflows/cost-ledger.yml` cron~~                                                                                                                                                       | ~~weekly cost tracking active (auto-PR pattern)~~                  | ~~—~~                     | **Cancelled per ADR-0007 Amendment A1**                           |
| 11   | Обновить `AGENTS.md` (root) с секцией AI-loop discipline                                                                                                                                                                                 | агенты следуют 8-step cycle                                        | DSO-31 baseline AGENTS.md |
| 12   | Обновить `CLAUDE.md` (root) с SessionStart hook reference + skill priorities                                                                                                                                                             | Claude Code aligned                                                | step 11                   |
| 13   | **[Manual GitHub UI / `gh api`]** Добавить branch protection rule: status check `agent-review` required, ≥1 human approval required, no direct push to main. **Requires repo admin permissions; cannot be done by regular CI workflow.** | merge блокируется без CI green + reviewer-bot run + human approval | steps 6, 9                |
| 14   | Smoke test: first feature spec через цикл (superpowers:brainstorming → spec → Issues → PR → review → merge)                                                                                                                              | proof of concept                                                   | steps 1-13                |

Phase 1 (продакшн, после Pre-pilot launch):

- Перевести WARN-only guards в BLOCK (TDD signal, EARS↔test linkage, spec status freshness)
- Калибровать reviewer-bot precision на 20+ PR; принять решение Phase 3 activation если ≥70%
- Запустить cost-ledger-sync еженедельно, проверить что alerting работает

Phase 2+ (runtime AI features):

- Trigger §9.1 fires → новый ADR для LiteLLM/PII-filter/OTel collector deployment
- Phase 3 activation если criteria из §8.2 met

---

## 12. Cross-refs

- **ADR-0001** — Authentik/Zitadel: reviewer-bot не требует OIDC (использует GitHub App token). Future runtime LLM gateway (§9.1) — gateway admin protected тем же OIDC tenant.
- **ADR-0002 §6 BullMQ** — async queue для Content Pipeline AI jobs (§9.1).
- **ADR-0003 §7 pgvector** — vector DB default; trigger на Qdrant (§9.4).
- **ADR-0004 §13 ESLint `no-vercel-only-api`** — reviewer-bot включает этот rule в SDD-compliance pass.
- **ADR-0005** — mobile clients для AI-рекомендаций (v3) будут вызывать backend, backend → LiteLLM (§9.1).
- **ADR-0006 §7 drift detection** — DSO-30 расширяет 7 AI-specific guards (§5.2).
- **ADR-0006 §4 SDD format** — DSO-30 наследует 3-file feature-spec.
- **ADR-0006 §9 task-tracker split** — DSO-30 наследует GitHub Issues + milestone convention.
- **ADR-0006 §5 AGENTS.md/CLAUDE.md** — DSO-30 расширяет AI-loop section.

---

## 13. Open follow-ups (DSO-31+ и beyond)

1. **Anthropic Admin API vs Console API shape** — на момент impl tooling (Phase 0 step 11) уточнить актуальные endpoint paths для usage report. Тот же для OpenAI.
2. **Reviewer-bot calibration metric** — формальный protocol измерения precision/recall на sample 20+ PR. Кто отбирает sample, как маркируются false positives/negatives.
3. **TDD signal heuristic false-positive rate** — после первых 10 PR в Phase 1 переоценить, переключать ли на BLOCK.
4. **Codex cloud activation playbook** — конкретный setup в момент когда Tech Lead захочет первую async-задачу (label conventions, GitHub App config).
5. **Phase 3 low-risk criteria** — формальный список classes изменений (test-only, doc-only, devDep bumps) для auto-merge активации.
6. **Vendor detection в reviewer-agent** — улучшить heuristic с commit message на explicit label `author:claude` / `author:codex` (агенты сами ставят при PR open).
7. **PR template** — `.github/pull_request_template.md` с обязательными секциями (Closes #N, spec link, checklist).
8. **Glossary auto-population из reviewer-bot** — если bot замечает «потенциально новый доменный термин», открывает draft glossary PR.
9. **Bootstrap caching** — для частых вызовов (если будут такие сценарии) — кешировать gh API calls на ≤60s; в Phase 0 не нужно (один вызов на сессию).
10. **Multi-repo support** — если DS Platform разделяется на multiple repos (mobile отдельно?), bootstrap нужно адаптировать.

---

## Amendments

### Amendment SD1 — Reviewer-bot + cost-ledger sections SUPERSEDED (2026-05-19, follow-up to ADR-0007 Amendment A1)

**Контекст:** ADR-0007 Amendment A1 (2026-05-19) drop'ает automated cross-vendor reviewer-bot и automated cost-ledger. Замена = interactive-only LLM-assisted review в трёх режимах (subagent `/review`, parallel Codex CLI, pure human). Design-level контент этого spec'а для drop'нутых компонентов сохранён (для исторической справки и будущего пересмотра) но больше не authoritative.

**Затронутые секции данного spec'а:**

- **§6 (Cross-vendor reviewer-agent)** — вся секция SUPERSEDED. GitHub Actions workflow, prompts, vendor-detection label scheme, two-pass review structure, status check semantics — всё не реализуется в Phase 0. SUPERSEDED callout prepended в §6 body.
- **§7 (Prompt-caching policy + cost observability)** — **cost-observability подсекция** (cost-ledger script, cron, auto-PR, soft-cap alert через Issue) SUPERSEDED. **Prompt-caching policy (§7.1) остаётся в силе** для любого будущего LLM-клиента (interactive `/review` skill subagent, runtime AI features после §9 trigger'а). SUPERSEDED callout prepended в §7 body.
- **§10 (AGENTS.md / CLAUDE.md sketches)** — review-tooling-related portions SUPERSEDED. Скетчи нужно переписать в G7 чтобы описать новые interactive-review режимы (a)/(b)/(c). Секции, не относящиеся к review/cost (8-step cycle wording, SDD/TDD discipline, prompt-caching, SessionStart hook, skill priorities), остаются authoritative. SUPERSEDED callout prepended.
- **§11 (Migration plan) Steps 5, 6, 10** — cancelled (применён strikethrough + cancellation note). Step 2 помечен done в G1 (commit `ae3826f`). Остальные шаги без изменений.

**См.:** ADR-0007 §7 Amendment A1 для полного контекста, решений A1.1–A1.7, consequences и revisit triggers.

**Почему не удалить original content?** Будущие читатели (включая будущего Tech Lead'а, пересматривающего automated review когда OQ-A1 trigger сработает) должны видеть, что было исходно спроектировано. SUPERSEDED callouts маркируют status; исходная архитектура остаётся как design baseline для возможного будущего re-introduction.
