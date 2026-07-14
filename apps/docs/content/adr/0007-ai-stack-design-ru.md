---
title: "Design Spec — AI Stack для DS Platform (Phase 0 methodology + deferred runtime) [RU]"
description: "Этот документ — реализационная детализация ADR-0007. ADR фиксирует «что и почему»; spec — «как именно»: file paths, code sketches, AGENTS.md шаблоны, bootstrap-скрипт."
lang: ru
---

> **EN:** [`0007-ai-stack-design-en.md`](./0007-ai-stack-design-en.md) · **RU (this)**

# Design Spec — AI Stack для DS Platform (Phase 0 methodology + deferred runtime)

**Дата:** 2026-05-15
**Статус:** Accepted
**Связан с:** ADR-0007, Plane DSO-30 (`fce557aa-4cfd-4466-b487-5ba165501a1f`)
**Brainstorm:** superpowers:brainstorming skill, симметрично DSO-25..29 + DSO-60
**Наследует:** ADR-0001..0006

Этот документ — реализационная детализация ADR-0007. ADR фиксирует «что и почему»; spec — «как именно»: file paths, code sketches, AGENTS.md шаблоны, bootstrap-скрипт.

---

## 1. Сводка решений (cross-ref ADR-0007)

| Решение                          | Выбор                                                                                                                                                                         | ADR-0007 §        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Scope ADR-0007                   | Phase 0 = AI-loop methodology (dev-time); runtime AI infra — deferred с triggers                                                                                              | §1                |
| Coding agent harnesses Pre-pilot | Claude Code (primary, sync) + Codex (opt-in async). Cursor deferred.                                                                                                          | §2                |
| Agent loop discipline            | SDD + TDD как hard rules; iteration-end checklist machine-checkable                                                                                                           | §3                |
| Task tracking source             | GitHub Issues (per ADR-0006 §9), сгруппированы под product-тема milestones                                                                                                    | inherits ADR-0006 |
| Session bootstrap                | `tools/agent-bootstrap.ts` — детерминистический скрипт, output = live state snapshot                                                                                          | §4                |
| Drift guards AI-specific         | Дополнительные CI checks поверх ADR-0006 §7 (spec-link, TDD signal, EARS↔test linkage, и др.)                                                                                 | §5                |
| LLM-assisted PR review           | Только интерактивный (три режима — subagent `/review`, параллельный Codex CLI, чистый human). Никакого автоматического reviewer-bot'а, никаких LLM API-ключей в repo secrets. | §6, AGENTS.md §4  |
| Prompt-caching                   | `cache_control: ephemeral` на AGENTS.md+CLAUDE.md+active spec+ADRs; стабильный prefix order для OpenAI prefix-cache                                                           | §7                |
| Cost observability               | Вручную через консоли vendor'ов (Anthropic Console, OpenAI Platform) в Phase 0; никакого автоматического cost-ledger CSV в репо.                                              | §7                |
| Autonomy Phase                   | Phase 2 (chores + supervised PRs); явные trigger'ы на Phase 3                                                                                                                 | §8                |
| Runtime LLM gateway              | LiteLLM Proxy self-hosted в Zone AI (Hetzner EU) — **deferred**, trigger: first runtime AI feature deploy                                                                     | §9                |
| PII-filter / egress proxy        | Same trigger — deferred                                                                                                                                                       | §9                |
| OTel GenAI semconv collector     | Same trigger — в Phase 0 minimal token-count logging без semconv                                                                                                              | §9                |
| Vector DB                        | pgvector в Postgres17 (наследуется из ADR-0003), trigger на Qdrant — отдельный ADR                                                                                            | inherits ADR-0003 |

---

## 2. AI-loop architecture — Phase 0

### 2.1 Iteration unit

Один iteration = одна feature-spec → один или несколько связанных PR. Источник intent — `apps/docs/content/specs/features/NNN-<slug>/{NNN-requirements.md, NNN-design.md, NNN-scenarios.feature}` (3 файла, ADR-0006 §4). Источник execution state — Issues per EARS-handler, каждый с лейблом `feature:NNN-<slug>` (он привязывает Issue к его спеке), сгруппированные под долгоживущим product-тема GitHub Milestone (ADR-0006 §9; AGENTS.md §2 — Milestone это тема, не spec-папка). Никакого `tasks.md` файла.

### 2.2 Каноническая процедура — skill-каталог в `apps/docs/content/skills/<name>/SKILL.md`

Источником истины для процедуры AI-итерации служит **проектный skill-каталог** в `apps/docs/content/skills/<name>/SKILL.md` (AGENTS.md §3.3 — «the path is the contract»). Оркестрационные skill'ы (`do-feature-iteration`, `do-hotfix-pr`, `do-adr-revision`, `do-decision-debt-followup`, `author-feature-spec`) собирают процедурные (`read-relevant-adrs`, `verify-base-ci-green`, `author-ears-spec`, `open-ears-issues`, `run-iteration-end-checklist`, `request-mode-a-review`, `respond-to-review`, `write-iteration-summary`, `surface-decision-debt`, `merge-when-green`). Discipline-gate'ы оформлены как «Cannot proceed without» на каждом orchestration skill — агент не может молча их пропустить, прочитав narrative. Inline-резюме ниже зеркалит каталог; каталог — авторитетный.

orchestrated iteration cycle (`do-feature-iteration` оркеструет эти шаги):

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
       --milestone "<product theme>" --label "feature:NNN-<slug>"
   - Если parent есть → выбрать open sub-issue или открыть новый

3. RED (TDD)
   - Write failing test(s) для текущего EARS-handler
   - One Vitest test per EARS requirement, naming convention:
       it('EARS-3.1: ...', () => { ... })
     (плоская нумерация `EARS-N` по умолчанию; `EARS-N.M` только если
      один handler несёт несколько shall-выражений — ADR-0006 §TDD)
   - Playwright tests транспилируются из NNN-scenarios.feature
     через playwright-bdd (ADR-0006 §4 + §7 generated artifacts)

4. GREEN
   - Minimum code чтобы тесты прошли
   - Respect SSOT-per-kind (ADR-0006 §3): no inline glossary IDs,
     Zod ↔ Drizzle ↔ OpenAPI canonical sources
   - Run `pnpm generate:all` после edits в schemas/db/glossary

5. REFACTOR
   - Improve code, keep tests green

6. ITERATION-END CHECKLIST (§5.1, skill: run-iteration-end-checklist)
   - Dispatch-mode artifact — пропустить молча нельзя.
   - Если какой-то hard-rule не пройден — не push.

7. PR OPEN
   - Title: `<type>(<module>): <description> [#N]` (#N = Issue)
   - Body шаблон из AGENTS.md (включает `Closes #N`, spec-link)
   - CI runs ADR-0006 §7 + AI-specific guards (§5.2)

8. REVIEW + MERGE
   - Mode (a) subagent `/review` skill, Mode (b) параллельный Codex CLI,
     или Mode (c) human review (AGENTS.md §4).
   - Положительный verdict + зелёный CI → `gh pr merge <N> --auto --squash --delete-branch`
     (skill: merge-when-green).
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
- One Vitest test per EARS requirement; naming: `it('EARS-N: ...', ...)`.
- Playwright tests генерируются из `NNN-scenarios.feature` через playwright-bdd (test code != production code).
- Property-based tests для invariants — opt-in от первой фичи с инвариантами (ledger reconciliation, например).
- superpowers:test-driven-development skill — обязательный invocation для любого implementation task.

### 3.3 Когда SDD/TDD justifiably skipped

Узкие исключения, документируются явно в PR description:

- **One-line typo / doc-only edits** — spec/test не нужны (но glossary-mdx-lint всё равно проходит).
- **Dependency bumps** — test suite сам по себе является test'ом.
- **Generated artifacts updates** — test suite является test'ом.
- **Bug-fix без feature-shift** — должен добавить regression test (TDD соблюдён), spec не обязательно обновлять если поведение и так зафиксировано в spec'е.

В остальных случаях skip = methodology violation, интерактивный reviewer (AGENTS.md §4) должен это поймать.

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
   - Для каждого agent-working Issue: читает лейбл feature:NNN-<slug> → spec folder path
   - Читает NNN-requirements.md frontmatter: status, Prior decisions (list of ADRs)
   - Извлекает glossary terms из spec body через [[g:term-id]] directives

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

async function readSpecMeta(featureSlug: string) {
  // feature:NNN-<slug> label slug = "NNN-slug" → spec path (NOT the milestone,
  // which is a product theme; AGENTS.md §2)
  const specDir = resolve(
    REPO_ROOT,
    "apps/docs/content/specs/features",
    featureSlug,
  );
  try {
    const numMatch = featureSlug.match(/^(\d{3})-/);
    if (!numMatch) return null;
    const raw = await readFile(
      resolve(specDir, `${numMatch[1]}-requirements.md`),
      "utf-8",
    );
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
      const slug = (i.labels ?? [])
        .map(
          (l: { name: string }) =>
            l.name.match(/^feature:(\d{3}-[\w-]+)$/)?.[1],
        )
        .find(Boolean);
      return slug ? { issue: i, spec: await readSpecMeta(slug) } : null;
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
      `- @${spec.path}/${spec.prefix}-requirements.md  @${spec.path}/${spec.prefix}-design.md  @${spec.path}/${spec.prefix}-scenarios.feature`,
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

### 5.1 14-item checklist (AGENTS.md hard rules)

Перед `git push` агент проходит каждый пункт. Если хоть один false — не push, либо чинит, либо escalate. **Авторитетный, всегда-актуальный список пунктов — сам skill** — `apps/docs/content/skills/run-iteration-end-checklist/SKILL.md` — а не таблица, дублированная здесь (каталог авторитетен; §2.2). На момент написания 14 пунктов: (1) tests green, (2) generated artifacts up-to-date, (3) TypeScript compiles, (4) lint clean, (5) module README updated если exports changed, (6) spec `status` frontmatter advanced, (7) glossary terms added если выросла доменная лексика, (8) ADR created если было архитектурное решение, (9) `architecture/` обновлён для структурных изменений, (10) `operations/` runbook добавлен для новых операционных concern'ов, (11) linked Issue получил summary comment, (12) vertical-slice DoD (conditional, F-22), (13) field validation + input mask (conditional), (14) registry-research marker (conditional). Точная команда / условие и правило N/A каждого пункта — в skill.

### 5.2 CI gates — AI-specific extensions (поверх ADR-0006 §7)

| Guard                     | Что ловит                                                                   | Implementation                                                                                                                                                                                                                                | Severity Phase 0        |
| ------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| **spec-link required**    | PR с лейблом `feature:NNN-<slug>`, не связанный со своей спекой как надо    | GH Action: PR body содержит `Closes #N`; каждый связанный Issue несёт (product-тема) milestone; spec folder лейбла `feature:NNN-<slug>` — `apps/docs/content/specs/features/NNN-<slug>/` — существует с `NNN-requirements.md` (или `-en.md`). | BLOCK                   |
| **TDD signal**            | implementation-only commit без test-файла                                   | GH Action: для каждого изменённого `src/**/*.ts` — `*.test.ts` либо в diff, либо commit history показывает test-commit предшествующим. Heuristic, false positives возможны.                                                                   | WARN v1                 |
| **EARS ↔ test linkage**   | EARS-требование без `it('EARS-N: ...')`                                     | Custom lint `tools/lint/ears-test-lint.ts`: парсит EARS IDs в `NNN-requirements.md`, проверяет наличие it-описаний с тем же ID в модуле.                                                                                                      | WARN v1 → BLOCK v2      |
| **Gherkin coverage**      | scenarios без Playwright step реализации                                    | playwright-bdd native error — test fails если step undefined.                                                                                                                                                                                 | BLOCK (через test fail) |
| **Spec status freshness** | Merged PR со spec:NNN, но spec status='Draft'                               | Custom lint: при merge — проверить `status: In dev` minimum.                                                                                                                                                                                  | WARN v1                 |
| **Prior decisions cited** | Новый spec без указанных ADR в "Prior decisions" если категория ≠ docs-only | Spec lint: `NNN-requirements.md` имеет секцию с ≥1 ADR-link.                                                                                                                                                                                  | WARN v1                 |

> **Interim semantics note:** строки `BLOCK` предполагают server-side required status check на `main`. Пока branch protection (ADR-0008 §2.6) отложен (GitHub Free + private repo блокирует branch-protection API — ADR-0008 §2.6), `BLOCK` читается операционально как **«CI job выходит red, и Tech Lead трактует это как merge-blocker по convention'у»** — тот же outcome на single-developer happy path, без server-side гарантии.

Таблица выше — стартовый набор; авторитетный живой список guard'ов + per-guard severity — `.github/workflows/ci.yml` + `.github/workflows/pr-body-guards.yml` (семейство body-parsing guard'ов, перезапускается при правке тела PR — #651). Жизненный цикл severity — posture нового guard'а (WARN), критерий WARN→BLOCK promotion, demotion и каденция sweep'ов — живёт в нарративном ADR-0007 §2.6.

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
    "apps/docs/content/specs/features/*/*-requirements.md",
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
    // Milestone должен присутствовать (product-тема — любой title; только
    // группировка, ADR-0006 §9 / AGENTS.md §2). Его title — НЕ путь.
    if (!issue.milestone?.title) {
      throw new Error(
        `Issue #${issueNum} has feature:* label but no milestone. Every feature-Issue sits under a product-theme milestone.`,
      );
    }
    // Spec-папка — это slug лейбла feature:NNN-<slug>.
    const slug = issue.labels
      .map((l) => l.name.match(/^feature:(\d{3}-[\w-]+)$/)?.[1])
      .find(Boolean);
    if (!slug) {
      throw new Error(
        `Issue #${issueNum} has a feature:* label but no valid feature:NNN-<slug> area label.`,
      );
    }
    const specDir = resolve(
      REPO_ROOT,
      "apps/docs/content/specs/features",
      slug,
    );
    if (!existsSync(specDir)) {
      throw new Error(
        `Issue #${issueNum} label feature:${slug} does not match any spec folder at ${specDir}.`,
      );
    }
  }
  console.log(
    `✓ PR #${prNum} correctly linked to spec via feature:NNN-<slug> label.`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
```

---

## 6. Reviewer roles — см. §2.2 и AGENTS.md §4

Cross-vendor LLM-assisted review в Phase 0 — только интерактивный (три режима: (a) main-session subagent `/review` skill, (b) параллельный Codex CLI, (c) чистый human review). §2.2 cycle Step 8 и AGENTS.md §4 несут полный контракт. Никакого автоматического headless reviewer-bot'а, никакого `tools/reviewer-agent/`, никакого `.github/workflows/agent-review.yml`, никаких LLM API-ключей в repo secrets.

---

## 7. Prompt-caching policy

Prompt-caching policy действует для любого LLM-клиента — интерактивного subagent'а `/review` сегодня, runtime AI features после §9 trigger'а. Cost tracking в Phase 0 происходит через консоли vendor'ов (Anthropic Console, OpenAI Platform); никакого автоматического cost-ledger CSV в репо нет.

### 7.1 Caching policy

Hard rule в AGENTS.md, обязателен для всех LLM-вызовов (интерактивный subagent `/review` сегодня, future Content Pipeline и т.д.):

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

Anthropic — explicit `cache_control: {type: 'ephemeral'}`, 5-min TTL. OpenAI GPT-5+ — automatic prefix cache, требует чтобы префикс был byte-identical. Все LLM clients строят payload через общую helper-функцию `packages/llm-utils/buildContext.ts` для гарантии стабильности.

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
    const dirName = input.specPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
    const numMatch = dirName.match(/^(\d{3})-/);
    const prefix = numMatch?.[1];
    const files = prefix
      ? [
          `${prefix}-requirements.md`,
          `${prefix}-design.md`,
          `${prefix}-scenarios.feature`,
        ]
      : [];
    for (const f of files) {
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

Используется интерактивным subagent'ом `/review` и любыми другими LLM-клиентами.

**Cache invariants:**

- AGENTS.md / CLAUDE.md изменяются редко → tier 1 cache hit ~всегда после первого call.
- Spec изменяется per feature → tier 2 cache hit пока сессия в рамках одной фичи.
- ADRs immutable после Accepted → tier 3 cache hit ~всегда (новый ADR в "Prior decisions" инвалидирует — это приемлемо, редкое событие).
- Glossary terms — последние, чтобы изменения per-spec scope не ломали prefix выше.

---

## 8. Autonomy ladder

### 8.1 Phase 2 — текущий target Pre-pilot

Параметры:

- Агенты пишут PR на любые feature/bugfix/refactor
- Human-merge gate или положительный verdict интерактивного LLM-review (Mode (a) / Mode (b) по AGENTS.md §4) **обязателен** перед merge
- Write-доступ в prod-DB запрещён (только через миграции в PR)
- Direct push в `main` запрещён
- Прямая запись в `docs/adr/*.md` после `status: Accepted` запрещена (создание superseding ADR разрешено)

**Auto-chores разрешены** через bot-PR с label `chore:auto`:

- Lint-fix (prettier, eslint --fix)
- Dep-bump в `devDependencies` (через Renovate / Dependabot)
- Doc-sync (`pnpm generate:all` artifact updates)

Все auto-chores PR'ы всё равно проходят через стандартный review path (интерактивный Mode (a)/(b)/(c) по AGENTS.md §4) + merge gate.

### 8.2 Trigger на Phase 3

Phase 3 = auto-merge low-risk PR за feature flag. Активируется при выполнении ВСЕХ условий:

- ≥50 успешных agent-PR без post-merge incident (отслеживается labels'ами `post-merge-incident`)
- Документированные low-risk criteria в отдельном ADR — например: «only `*.test.ts` files modified», «only docs in `apps/docs/content/`», «devDep version bump при green CI»
- Kill switch tested (см. §8.4)

Активация Phase 3 — отдельный ADR-NNNN.

### 8.3 Phase 4 — out of scope ADR-0007

End-to-end autonomous работа агента (от Issue до merge без human touch для определённых классов задач) — отложено до Phase 1 продакшна минимум.

### 8.4 Kill switch

Single config flag в `.github/agents-config.json`:

```json
{
  "agents_enabled": true
}
```

При `agents_enabled: false` — agent-driven активность останавливается; активируется при инциденте безопасности или экстренной остановке. Изменение этого файла — обычный PR + human merge (так что нельзя случайно убить kill switch сам собой).

`auto_merge_enabled` поле НЕ добавляется в Phase 2 — auto-merge произвольных PR запрещён по дизайну (§8.1). Поле появится в Phase 3 ADR-NNNN когда соответствующий механизм будет введён.

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

**LiteLLM admin UI protection:** LiteLLM admin не имеет native OIDC; protect через nginx forward-auth proxy с Zitadel (ADR-0001 OIDC tenant, закрыто по §8 / DSP-209). Это не trivial и оформляется отдельным дизайн-блоком в trigger-ADR.

**Capacity Phase 0+1:** instance A — одна VM (Hetzner EU, ≈€20/мес); instance B — одна VM в существующем Timeweb (≈₽1000/мес). HA-пара через keepalived — Phase Pilot+.

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

В Phase 0 — никакого in-repo semconv collector'а; cost и token usage читаются из консолей vendor'ов (Anthropic Console, OpenAI Platform).

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

Эти скетчи показывают AI-loop-specific overlay'и, добавленные поверх baseline'а ADR-0006 §9. Секции, не относящиеся к review/cost (orchestrated iteration cycle wording, SDD/TDD discipline, prompt-caching, SessionStart hook, skill priorities), — это authoritative-часть скетчей. Review-related строки описывают интерактивный three-mode review по AGENTS.md §4 — никакого автоматического reviewer-bot'а, никакого headless LLM CI workflow.

### 10.1 AGENTS.md (root)

ADR-0006 §9.1 уже зафиксировал основную структуру. DSO-30 добавляет AI-loop секцию:

```markdown
# Agent Instructions — DS Platform

[... stack list, doc structure из ADR-0006 ...]

## AI-loop discipline (ADR-0007)

Every implementation iteration follows the orchestrated iteration cycle:

### Step 1 — READ (always first)

Run `pnpm bootstrap` (alias for `tsx tools/agent-bootstrap.ts`). Read its output. Then load:

- AGENTS.md (this file) — already in your context
- CLAUDE.md if you are Claude Code
- Active spec at `apps/docs/content/specs/features/NNN-<slug>/`:
  - `NNN-requirements.md`
  - `NNN-design.md`
  - `NNN-scenarios.feature`
- ADRs from spec's "Prior decisions" section
- `gh issue view <N>` for current Issue context and history

### Step 2 — PLAN

Per ADR-0006 §9 conventions (title format `[NNN] EARS-N: ...`, label `kind:ears-handler` / `kind:policy` / `kind:saga-step` / `kind:bug` / `kind:refactor`).

- If no parent Issue exists for the spec: create one with `--body-file` (a `--body` flag must be provided in non-interactive contexts; `gh issue create` without it opens an editor and hangs in CI/Codex):
  gh issue create --title "Feature NNN: <name>" \
  --milestone "<product theme>" --label "feature:NNN-<slug>" \
  --body-file .github/issue_templates/feature.md
  Then for each EARS-handler from `NNN-requirements.md`:
  gh issue create --title "[NNN] EARS-N: <description>" \
  --milestone "<product theme>" --label "feature:NNN-<slug>,kind:ears-handler,agent-ready" \
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

Запусти интерактивный review через Mode (a) subagent `/review` skill, Mode (b) параллельный
Codex CLI, или Mode (c) pure human (AGENTS.md §4). Обработай findings, затем merge через
`gh pr merge <N> --auto --squash --delete-branch` после положительного verdict'а и зелёного CI.

## SDD — hard rule

No production code without a feature spec at apps/docs/content/specs/features/NNN-<slug>/.
If the feature has no spec, invoke superpowers:brainstorming first.

## TDD — hard rule

No production code without a failing test that motivates it.
Naming convention: `it('EARS-N: ...', ...)`.

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

Phase 0 (Tech Lead + AI, sequential — после того как DSO-31 создаст репо `ds-platform`). Порядок: bootstrap + helpers (шаги 1–4), kill switch + lint-tools + CI integration (шаги 7–9), AGENTS.md / CLAUDE.md drafting (шаги 11–12), branch protection (шаг 13 — отложен по ADR-0008 §2.6), smoke test (шаг 14).

**Pre-requisite для шага 13:** Tech Lead должен иметь admin permissions на репо (branch protection rule в шаге 13 требует admin token; cannot be automated). Если репо принадлежит организации — нужны org-admin права или явное delegation на репо-admin role.

| Step | Action | Output | Blocking |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- | ----------------------------------------------------------------- |
| 1 | Создать `tools/agent-bootstrap.ts` | bootstrap работает локально | DSO-31 (репо exists) |
| 2 | Добавить `pnpm bootstrap` alias в root `package.json` | команда runnable | step 1 | **Done в G1, см. commit `ae3826f` в `doctor-school/ds-platform`** |
| 3 | Добавить `.claude/settings.json` с SessionStart hook | Claude Code auto-loads bootstrap | step 2 |
| 4 | Создать `packages/llm-utils/buildContext.ts` | reusable helper для LLM-clients | DSO-31 |
| 7 | Добавить `.github/agents-config.json` kill switch | kill switch active | — |
| 8 | Создать `tools/lint/spec-link-lint.ts` + `ears-test-lint.ts` | AI-specific guards available | — |
| 9 | Добавить шаги в `.github/workflows/ci.yml` для guards (WARN/BLOCK per §5.2) | CI выполняет guards | step 8 |
| 11 | Обновить `AGENTS.md` (root) с секцией AI-loop discipline | агенты следуют orchestrated iteration cycle | DSO-31 baseline AGENTS.md |
| 12 | Обновить `CLAUDE.md` (root) с SessionStart hook reference + skill priorities | Claude Code aligned | step 11 |
| 13 | **[Manual GitHub UI / `gh api`]** Добавить branch protection rule: ≥1 human approval required, no direct push to main. Отложено по ADR-0008 §2.6 (GitHub Free + private). | merge gated server-side когда protection доступен | step 9 |
| 14 | Smoke test: first feature spec через цикл (superpowers:brainstorming → spec → Issues → PR → review → merge) | proof of concept | steps 1-13 |

Нумерация шагов сохраняет исходную последовательность; отменённые шаги (5, 6, 10) намеренно пропущены.

Phase 1 (продакшн, после Pre-pilot launch):

- Перевести WARN-only guards в BLOCK (TDD signal, EARS↔test linkage, spec status freshness)

Phase 2+ (runtime AI features):

- Trigger §9.1 fires → новый ADR для LiteLLM/PII-filter/OTel collector deployment
- Phase 3 activation если criteria из §8.2 met

---

## 12. Cross-refs

- **ADR-0001** — Zitadel IdP: future runtime LLM gateway (§9.1) admin защищён тем же OIDC tenant.
- **ADR-0002 §6 BullMQ** — async queue для Content Pipeline AI jobs (§9.1).
- **ADR-0003 §7 pgvector** — vector DB default; trigger на Qdrant (§9.4).
- **ADR-0004 §13 ESLint `no-vercel-only-api`** — интерактивный subagent `/review` применяет это правило в SDD-compliance prompt.
- **ADR-0005** — mobile clients для AI-рекомендаций (v3) будут вызывать backend, backend → LiteLLM (§9.1).
- **ADR-0006 §7 drift detection** — DSO-30 расширяет AI-specific guards (§5.2).
- **ADR-0006 §4 SDD format** — DSO-30 наследует 3-file feature-spec.
- **ADR-0006 §9 task-tracker split** — DSO-30 наследует GitHub Issues + milestone convention.
- **ADR-0006 §5 AGENTS.md/CLAUDE.md** — DSO-30 расширяет AI-loop section.

---

## 13. Open follow-ups (DSO-31+ и beyond)

1. **TDD signal heuristic false-positive rate** — после первых 10 PR в Phase 1 переоценить, переключать ли на BLOCK.
2. **Codex cloud activation playbook** — конкретный setup в момент когда Tech Lead захочет первую async-задачу (label conventions, GitHub App config).
3. **Phase 3 low-risk criteria** — формальный список classes изменений (test-only, doc-only, devDep bumps) для auto-merge активации.
4. **PR template** — `.github/pull_request_template.md` с обязательными секциями (Closes #N, spec link, checklist).
5. **Bootstrap caching** — для частых вызовов (если будут такие сценарии) — кешировать gh API calls на ≤60s; в Phase 0 не нужно (один вызов на сессию).
6. **Multi-repo support** — если DS Platform разделяется на multiple repos (mobile отдельно?), bootstrap нужно адаптировать.
