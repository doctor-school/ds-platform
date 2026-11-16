#!/usr/bin/env tsx
/**
 * tools/lint/scenario-proof-lint.ts — the `scenario-proof` guard: every spec
 * scenario is proven at some test level, or is tracked debt (regression-contour
 * tech spec §6.1 + §6.4, Issue #4062).
 *
 * Why this exists: counting a scenario as covered only when every step of it is
 * bound to a step definition left most of the suite "uncovered" although a
 * spec-scoped test at another level (Vitest unit, Vitest API e2e, app-local
 * Playwright) already proves each of its EARS ids, and nothing stopped new
 * unproven scenarios from piling up. Every scenario is in exactly one state:
 *
 *   - bound — it has a step and every step (Background steps included, outline
 *     placeholders substituted from the first `Examples` row) matches a step
 *     definition from the `steps` globs of a `defineBddConfig` caller;
 *   - proof:<level> — it carries `@proof:<level>` (`unit` | `api` | `app-e2e`)
 *     and is not bound; counted under the highest level it names;
 *   - pending — its spec's requirements `status:` is `Draft`;
 *   - unproven — none of the above.
 *
 * A proof tag is a claim the guard verifies: for EVERY `@EARS-N` on the
 * scenario some test title cites that id (dotted-prefix ancestry, the
 * `ears-test-lint` semantics in lib/ears-tests.ts) in a file feature-scoped to
 * the scenario's spec, at one of the tagged levels. Level by path: `app-e2e` =
 * `apps/<app>/e2e/**`, `api` = `apps/api/test/**`, `unit` = any other test file;
 * `packages/e2e/**` is the binding harness itself and proves nothing here. A
 * feature-agnostic test file never satisfies a claim — an unscoped `EARS-4`
 * cannot tell which spec's `EARS-4` it tests.
 *
 * The ratchet. `tools/lint/scenario-proof-debt.txt` lists exactly the unproven
 * scenarios, key `NNN | <title>` (` [k]` for the k-th repeat of a title in a
 * spec), optionally ` | #<issue>`. An unlisted unproven scenario, a stale line
 * (its scenario is proven, Draft or gone) and a line absent at the merge base
 * with `origin/main` that names no OPEN Issue are BLOCK findings; a line already
 * present at the merge base needs no Issue, and when the list did not exist
 * there every line is baseline. So the list shrinks freely and grows only as
 * tracked debt. When `gh` cannot answer, an Issue's state is reported
 * unverified (WARN), as the quarantine check of `scenario-coverage-lint.ts` does.
 *
 * Modes: default = the guard; `--report` prints the per-spec inventory table
 * (`pnpm scenarios:inventory`, the one source of the coverage number);
 * `--write-debt` rewrites the debt list from the current state, keeping each
 * surviving line's Issue.
 *
 * Seams: `LINT_FIXTURE_ROOT` (repo tree), `LINT_PROOF_BASE_DEBT_FILE` (the debt
 * list at the merge base; a missing file = absent there), `LINT_GH_FIXTURE_DIR`
 * (lib/gh.ts), `LINT_DIFF_BASE` (merge-base ref, default `origin/main`). All
 * inert in production.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ExpressionFactory,
  ParameterTypeRegistry,
  type Expression,
} from "@cucumber/cucumber-expressions";
import { execa } from "execa";
import fg from "fast-glob";

import {
  TEST_FILE_GLOBS,
  TEST_FILE_IGNORE,
  matches,
  parseTestTitles,
  specFeature,
} from "./lib/ears-tests.js";
import { parseScenarios } from "./lib/feature-scenarios.js";
import { ghViewJson } from "./lib/gh.js";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[scenario-proof]";
const DEBT_REL = "tools/lint/scenario-proof-debt.txt";
const FEATURE_GLOB = "apps/docs/content/specs/features/*/*-scenarios.feature";
const REQUIREMENTS_GLOB =
  "apps/docs/content/specs/features/*/*-requirements*.md";
/** The `defineBddConfig` callers whose `steps` globs bind spec scenarios. */
const BDD_CONFIG_GLOBS = [
  "packages/e2e/*.config.ts",
  "apps/*/playwright*.config.ts",
];

export const LEVELS = ["unit", "api", "app-e2e"] as const;
type Level = (typeof LEVELS)[number];
type State = "bound" | `proof:${Level}` | "pending" | "unproven";
const STATES: State[] = [
  "bound",
  "proof:unit",
  "proof:api",
  "proof:app-e2e",
  "pending",
  "unproven",
];

const PROOF_TAG_RE = /^@proof(?::(.*))?$/;
const EARS_TAG_RE = /^@EARS-(\d+(?:\.\d+)*)$/;
const STEP_RE = /^(?:Given|When|Then|And|But|\*)\s+(.*)$/;
const SCENARIO_HEAD_RE =
  /^(?:Scenario Outline|Scenario Template|Scenario|Example)\b:?\s*(.*)$/;
/**
 * A step-definition call with a literal pattern: a string (cucumber
 * expression) or a regex literal (char classes may hold a `/`).
 */
const STEP_DEF_RE =
  /\b(?:Given|When|Then|Step|And|But)\(\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/((?:\[(?:[^\]\\\n]|\\.)*\]|[^/\\\n[]|\\.)+)\/([a-z]*))/g;
const DEBT_LINE_RE = /^(\d{3} \| .*?)(?: \| #(\d+))?$/;

function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

/** Repo-relative, POSIX-slashed path. */
function relPath(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join("/");
}

// ── step definitions ────────────────────────────────────────────────────────

/** The string literals of a source span (`["a", 'b']` → a, b). */
function stringLiterals(span: string): string[] {
  return [...span.matchAll(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map(
    (m) => m[2],
  );
}

/** The `steps` globs one `defineBddConfig` config declares, repo-relative. */
export function configStepGlobs(src: string, configRel: string): string[] {
  if (!src.includes("defineBddConfig")) return [];
  const dir = posix.dirname(configRel);
  const globs: string[] = [];
  for (const m of src.matchAll(
    /\bsteps:\s*(\[[^\]]*\]|(["'`])[^"'`]*\2|[A-Za-z_$][\w$]*)/g,
  )) {
    let span = m[1];
    if (/^[A-Za-z_$]/.test(span)) {
      const decl = src.match(
        new RegExp(`\\b(?:const|let)\\s+${span}\\s*=\\s*(\\[[^\\]]*\\])`),
      );
      if (!decl) continue;
      span = decl[1];
    }
    for (const lit of stringLiterals(span)) {
      globs.push(posix.normalize(posix.join(dir, lit)));
    }
  }
  return globs;
}

/** Decode a JS string-literal token (quotes included) to its value. */
function decodeLiteral(raw: string): string | null {
  const q = raw[0];
  const body = raw.slice(1, -1);
  if (q === "`") {
    if (body.includes("${")) return null;
    return body.replace(/\\([\s\S])/g, "$1");
  }
  try {
    return JSON.parse(
      q === '"' ? raw : `"${body.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`,
    ) as string;
  } catch {
    return null;
  }
}

/** The step patterns of a step-definition source file. */
export function stepPatterns(src: string): (string | RegExp)[] {
  const out: (string | RegExp)[] = [];
  for (const m of src.matchAll(STEP_DEF_RE)) {
    if (m[1]) {
      const lit = decodeLiteral(m[1]);
      if (lit !== null) out.push(lit);
    } else {
      try {
        out.push(new RegExp(m[2], m[3]));
      } catch {
        // not a valid regex literal — no definition to bind with
      }
    }
  }
  return out;
}

async function loadStepMatcher(): Promise<{
  defs: number;
  files: number;
  bound: (text: string) => boolean;
}> {
  const configs = await fg(BDD_CONFIG_GLOBS, {
    cwd: REPO_ROOT,
    absolute: true,
    ignore: ["**/node_modules/**"],
  });
  const globs = new Set<string>();
  for (const c of configs) {
    for (const g of configStepGlobs(readFileSync(c, "utf8"), relPath(c))) {
      globs.add(g);
    }
  }
  const stepFiles =
    globs.size === 0
      ? []
      : await fg([...globs], {
          cwd: REPO_ROOT,
          absolute: true,
          ignore: ["**/node_modules/**"],
        });
  const factory = new ExpressionFactory(new ParameterTypeRegistry());
  const expressions: Expression[] = [];
  let unparsable = 0;
  for (const f of stepFiles) {
    for (const p of stepPatterns(readFileSync(f, "utf8"))) {
      try {
        expressions.push(factory.createExpression(p));
      } catch {
        unparsable += 1;
      }
    }
  }
  if (unparsable > 0) {
    info(`${unparsable} step pattern(s) are not valid expressions; ignored.`);
  }
  const cache = new Map<string, boolean>();
  return {
    defs: expressions.length,
    files: stepFiles.length,
    bound: (text) => {
      let hit = cache.get(text);
      if (hit === undefined) {
        hit = expressions.some((e) => e.match(text) !== null);
        cache.set(text, hit);
      }
      return hit;
    },
  };
}

// ── scenarios ───────────────────────────────────────────────────────────────

export interface ParsedScenario {
  line: number;
  title: string;
  /** Background steps first, then its own; placeholders already substituted. */
  steps: string[];
}

/**
 * The title and the steps of every scenario of a `.feature` file, in file
 * order: Feature- and Rule-level Background steps prefix each scenario in their
 * scope, and an outline's `<name>` placeholders take the first `Examples` row.
 */
export function parseScenarioSteps(text: string): ParsedScenario[] {
  const out: (ParsedScenario & {
    header: string[] | null;
    row: string[] | null;
  })[] = [];
  let section: "feature-bg" | "rule-bg" | "scenario" | "examples" | null = null;
  let inRule = false;
  const featureBg: string[] = [];
  let ruleBg: string[] = [];
  let docString: string | null = null;
  text.split(/\r?\n/).forEach((raw, idx) => {
    const t = raw.trim();
    if (docString !== null) {
      if (t.startsWith(docString)) docString = null;
      return;
    }
    if (t.startsWith('"""') || t.startsWith("```")) {
      docString = t.slice(0, 3);
      return;
    }
    if (t === "" || t.startsWith("#") || t.startsWith("@")) return;
    const current = out[out.length - 1];
    if (/^Feature\b/.test(t)) {
      section = null;
      return;
    }
    if (/^Rule\b/.test(t)) {
      inRule = true;
      ruleBg = [];
      section = null;
      return;
    }
    if (/^Background\b/.test(t)) {
      section = inRule ? "rule-bg" : "feature-bg";
      return;
    }
    if (/^(?:Examples|Scenarios)\s*:/.test(t)) {
      section = "examples";
      return;
    }
    const head = t.match(SCENARIO_HEAD_RE);
    if (head) {
      out.push({
        line: idx + 1,
        title: head[1].trim(),
        steps: [...featureBg, ...ruleBg],
        header: null,
        row: null,
      });
      section = "scenario";
      return;
    }
    const step = t.match(STEP_RE);
    if (step) {
      if (section === "feature-bg") featureBg.push(step[1]);
      else if (section === "rule-bg") ruleBg.push(step[1]);
      else if (section === "scenario" && current) current.steps.push(step[1]);
      return;
    }
    if (
      t.startsWith("|") &&
      section === "examples" &&
      current &&
      !current.row
    ) {
      const cells = t
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      if (!current.header) current.header = cells;
      else current.row = cells;
    }
  });
  return out.map(({ line, title, steps, header, row }) => ({
    line,
    title,
    steps:
      header && row
        ? steps.map((s) =>
            s.replace(/<([^<>]+)>/g, (all, name: string) => {
              const i = header.indexOf(name);
              return i === -1 ? all : (row[i] ?? all);
            }),
          )
        : steps,
  }));
}

interface Scenario {
  feature: string;
  where: string;
  title: string;
  key: string;
  state: State;
}

// ── tests ───────────────────────────────────────────────────────────────────

interface TestEntry {
  level: Level;
  ids: Set<string>;
  features: Set<string>;
}

/** The proof level of a test file by its path; `null` = proves no tag. */
export function levelOf(rel: string): Level | null {
  if (rel.startsWith("packages/e2e/")) return null;
  if (/^apps\/[^/]+\/e2e\//.test(rel)) return "app-e2e";
  if (rel.startsWith("apps/api/test/")) return "api";
  return "unit";
}

// ── debt list ───────────────────────────────────────────────────────────────

interface DebtEntry {
  key: string;
  issue: number | null;
  line: number;
}

function parseDebt(
  text: string,
  findings: string[],
  where: string,
): DebtEntry[] {
  const entries: DebtEntry[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (line.trim() === "" || line.startsWith("#")) return;
    const m = line.match(DEBT_LINE_RE);
    if (!m) {
      findings.push(
        `${where}:${idx + 1} -> malformed line (expected \`NNN | <scenario title>[ | #<issue>]\`)`,
      );
      return;
    }
    if (seen.has(m[1])) {
      findings.push(`${where}:${idx + 1} -> ${m[1]} is listed twice`);
      return;
    }
    seen.add(m[1]);
    entries.push({
      key: m[1],
      issue: m[2] ? Number(m[2]) : null,
      line: idx + 1,
    });
  });
  return entries;
}

type BaseDebt =
  | { status: "absent" }
  | { status: "ok"; keys: Set<string> }
  | { status: "unknown"; reason: string };

/** The debt list as it stood at the merge base with `origin/main`. */
async function baseDebt(): Promise<BaseDebt> {
  const keysOf = (text: string): Set<string> =>
    new Set(parseDebt(text, [], DEBT_REL).map((e) => e.key));
  const seam = process.env.LINT_PROOF_BASE_DEBT_FILE;
  if (seam) {
    return existsSync(seam)
      ? { status: "ok", keys: keysOf(readFileSync(seam, "utf8")) }
      : { status: "absent" };
  }
  const base = process.env.LINT_DIFF_BASE ?? "origin/main";
  try {
    const { stdout: mb } = await execa("git", ["merge-base", base, "HEAD"], {
      cwd: REPO_ROOT,
    });
    const { stdout: listed } = await execa(
      "git",
      ["ls-tree", "--name-only", mb.trim(), "--", DEBT_REL],
      { cwd: REPO_ROOT },
    );
    if (listed.trim() === "") return { status: "absent" };
    const { stdout } = await execa(
      "git",
      ["show", `${mb.trim()}:${DEBT_REL}`],
      {
        cwd: REPO_ROOT,
        stripFinalNewline: false,
      },
    );
    return { status: "ok", keys: keysOf(stdout) };
  } catch (e) {
    return {
      status: "unknown",
      reason: (e as Error).message.split("\n")[0] ?? "git failed",
    };
  }
}

const DEBT_HEADER = [
  "# Unproven spec scenarios — the scenario-proof ratchet (tools/lint/scenario-proof-lint.ts,",
  "# regression-contour tech spec §6.4). One line per scenario of a non-Draft spec that is",
  "# neither bound to a step definition nor carries a verified @proof:<level> tag:",
  "#   NNN | <scenario title>[ [k]][ | #<issue>]   ([k] = the k-th scenario with that title)",
  "# Delete a line once its scenario is bound or proof-tagged. A line added after the merge",
  "# base names an OPEN Issue. Regenerate: pnpm lint:scenario-proof --write-debt",
];

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const mode = process.argv.includes("--report")
    ? "report"
    : process.argv.includes("--write-debt")
      ? "write-debt"
      : "check";

  const reqFiles = await fg([REQUIREMENTS_GLOB], {
    cwd: REPO_ROOT,
    absolute: true,
    ignore: ["**/node_modules/**"],
  });
  const knownFeatures = new Set<string>();
  const draft = new Set<string>();
  for (const f of reqFiles) {
    const rel = relPath(f);
    const feature = specFeature(rel);
    if (!feature) continue;
    knownFeatures.add(feature);
    // The status lives in the EN/base requirements file; the RU twin mirrors it.
    if (rel.endsWith("-requirements-ru.md")) continue;
    const fm = readFileSync(f, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const status = fm?.[1].match(/^status:\s*(.+?)\s*$/m)?.[1];
    if (status === "Draft") draft.add(feature);
  }

  const tests: TestEntry[] = [];
  for (const f of await fg(TEST_FILE_GLOBS, {
    cwd: REPO_ROOT,
    absolute: true,
    ignore: TEST_FILE_IGNORE,
  })) {
    const level = levelOf(relPath(f));
    if (level === null) continue;
    const { ids, features } = parseTestTitles(readFileSync(f, "utf8"));
    if (ids.size === 0) continue;
    const scoped = new Set([...features].filter((n) => knownFeatures.has(n)));
    if (scoped.size === 0) continue; // feature-agnostic: proves no claim
    tests.push({ level, ids, features: scoped });
  }

  const steps = await loadStepMatcher();
  const findings: string[] = [];
  const scenarios: Scenario[] = [];

  const featureFiles = (
    await fg([FEATURE_GLOB], {
      cwd: REPO_ROOT,
      absolute: true,
      ignore: ["**/node_modules/**"],
    })
  ).sort();
  for (const file of featureFiles) {
    const rel = relPath(file);
    const feature = specFeature(rel);
    if (!feature) continue;
    const text = readFileSync(file, "utf8");
    const tagged = parseScenarios(text);
    const parsed = parseScenarioSteps(text);
    if (
      tagged.length !== parsed.length ||
      tagged.some((t, i) => t.line !== parsed[i].line)
    ) {
      throw new Error(
        `${rel}: the tag parser and the step parser disagree on the scenarios`,
      );
    }
    const repeats = new Map<string, number>();
    parsed.forEach((s, i) => {
      const tags = tagged[i].tags;
      const where = `${rel}:${s.line}`;
      const k = (repeats.get(s.title) ?? 0) + 1;
      repeats.set(s.title, k);
      const key = `${feature} | ${s.title}${k > 1 ? ` [${k}]` : ""}`;

      const proofTags = tags
        .map((t) => t.match(PROOF_TAG_RE))
        .filter((m): m is RegExpMatchArray => m !== null);
      const levels: Level[] = [];
      for (const m of proofTags) {
        const level = m[1] ?? "";
        if ((LEVELS as readonly string[]).includes(level)) {
          if (!levels.includes(level as Level)) levels.push(level as Level);
        } else {
          findings.push(
            `${where} "${s.title}" -> ${m[0]} names an unknown level (${LEVELS.join(", ")})`,
          );
        }
      }
      const ears = tags
        .map((t) => t.match(EARS_TAG_RE))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => `EARS-${m[1]}`);
      if (proofTags.length > 0 && ears.length === 0) {
        findings.push(
          `${where} "${s.title}" -> ${proofTags.map((m) => m[0]).join(" ")} on a scenario with no @EARS-N tag`,
        );
      } else if (levels.length > 0) {
        for (const id of [...new Set(ears)]) {
          const proven = tests.some(
            (t) =>
              t.features.has(feature) &&
              levels.includes(t.level) &&
              [...t.ids].some((tid) => matches(id, tid)),
          );
          if (!proven) {
            findings.push(
              `${where} "${s.title}" -> ${levels.map((l) => `@proof:${l}`).join(" ")} ` +
                `claims ${id}, but no ${feature}-scoped test at level ` +
                `${levels.join(" or ")} cites it`,
            );
          }
        }
      }

      const bound = s.steps.length > 0 && s.steps.every((t) => steps.bound(t));
      const highest = [...LEVELS].reverse().find((l) => levels.includes(l));
      const state: State = bound
        ? "bound"
        : highest
          ? `proof:${highest}`
          : draft.has(feature)
            ? "pending"
            : "unproven";
      scenarios.push({ feature, where, title: s.title, key, state });
    });
  }

  const unproven = scenarios.filter((s) => s.state === "unproven");
  const debtPath = resolve(REPO_ROOT, DEBT_REL);
  const debtText = existsSync(debtPath) ? readFileSync(debtPath, "utf8") : "";

  if (mode === "report") {
    const features = [...new Set(scenarios.map((s) => s.feature))].sort();
    const row = (label: string, list: Scenario[]): string =>
      `| ${label} | ${list.length} | ` +
      STATES.map((st) => list.filter((s) => s.state === st).length).join(
        " | ",
      ) +
      " |";
    const lines = [
      `| spec | total | ${STATES.join(" | ")} |`,
      `|${" --- |".repeat(STATES.length + 2)}`,
      ...features.map((f) =>
        row(
          f,
          scenarios.filter((s) => s.feature === f),
        ),
      ),
      row("total", scenarios),
    ];
    process.stdout.write(lines.join("\n") + "\n");
    process.exit(0);
  }

  if (mode === "write-debt") {
    const issues = new Map(
      parseDebt(debtText, [], DEBT_REL).map((e) => [e.key, e.issue]),
    );
    const lines = unproven
      .map((s) => s.key)
      .sort()
      .map((key) => {
        const issue = issues.get(key);
        return issue ? `${key} | #${issue}` : key;
      });
    writeFileSync(debtPath, [...DEBT_HEADER, ...lines].join("\n") + "\n");
    info(`wrote ${lines.length} unproven scenario(s) to ${DEBT_REL}.`);
    process.exit(0);
  }

  const debt = parseDebt(debtText, findings, DEBT_REL);
  const listed = new Map(debt.map((e) => [e.key, e]));
  const byKey = new Map(scenarios.map((s) => [s.key, s]));
  for (const s of unproven) {
    if (!listed.has(s.key)) {
      findings.push(
        `${s.key} -> unproven scenario missing from ${DEBT_REL} (${s.where}): ` +
          `bind it, tag a verified @proof:<level>, or list it with an OPEN Issue`,
      );
    }
  }
  for (const e of debt) {
    const s = byKey.get(e.key);
    if (!s) {
      findings.push(
        `${e.key} -> stale debt entry: no such scenario (${DEBT_REL}:${e.line}); delete the line`,
      );
    } else if (s.state !== "unproven") {
      const now =
        s.state === "bound"
          ? "bound"
          : s.state === "pending"
            ? "in a Draft spec"
            : `proof-tagged (${s.state})`;
      findings.push(
        `${e.key} -> stale debt entry: the scenario is ${now} (${DEBT_REL}:${e.line}); delete the line`,
      );
    }
  }

  const base = await baseDebt();
  if (base.status === "unknown") {
    info(
      `WARN the merge base was unavailable (${base.reason}); new debt entries ` +
        `are not checked for an Issue, not blocked on a guess.`,
    );
  } else if (base.status === "ok") {
    for (const e of debt) {
      if (base.keys.has(e.key)) continue;
      if (e.issue === null) {
        findings.push(
          `${e.key} -> new debt entry (absent at the merge base) names no #<issue>; ` +
            `append \` | #<issue>\` naming an OPEN Issue`,
        );
        continue;
      }
      const res = await ghViewJson<{ state?: string }>(
        "issue",
        e.issue,
        "state",
        REPO_ROOT,
      );
      if (!res.ok) {
        info(
          `WARN ${e.key} -> could not read Issue #${e.issue} (${res.error}); ` +
            `debt tracking unverified, not blocked on a guess.`,
        );
      } else if ((res.data.state ?? "").toUpperCase() !== "OPEN") {
        findings.push(
          `${e.key} -> new debt entry tracks Issue #${e.issue}, which is ${res.data.state}`,
        );
      }
    }
  }

  const count = (st: State): number =>
    scenarios.filter((s) => s.state === st).length;
  info(
    `${scenarios.length} scenario(s) in ${featureFiles.length} feature file(s); ` +
      `${steps.defs} step definition(s) from ${steps.files} file(s).`,
  );
  info(
    STATES.map((st) => `${st} ${count(st)}`).join(", ") +
      ` (${DEBT_REL}: ${debt.length} line(s)).`,
  );
  if (findings.length === 0) {
    info(
      "PASS — every scenario is bound, carries a verified @proof:<level> tag, " +
        "belongs to a Draft spec, or is listed as debt; the list is exact and " +
        "every new line names an OPEN Issue.",
    );
    process.exit(0);
  }
  for (const f of findings) process.stderr.write(`${TAG} ${f}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} finding(s) (tech spec §6.4). Prove a ` +
      `scenario by binding its steps or by a @proof:<level> tag a spec-scoped ` +
      `test backs; otherwise list it in ${DEBT_REL} with an OPEN Issue.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
