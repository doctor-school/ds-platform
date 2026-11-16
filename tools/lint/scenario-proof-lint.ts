#!/usr/bin/env tsx
/**
 * tools/lint/scenario-proof-lint.ts — the `scenario-proof` guard: every spec
 * scenario is proven, or is tracked debt (regression-contour tech spec §6.1 +
 * §6.4, Issues #4062, #4087).
 *
 * Why this exists: nothing stopped unproven scenarios from piling up, and a
 * release shipped regressions every code-level tier had passed (tech spec §1)
 * — so a user journey counts as proven only in the browser on the real stack,
 * and code-level tests count only for rule details.
 *
 * Class. A scenario of a `surface: user-facing` spec is `@journey` (a path a
 * real user walks end to end, with the refusals met on it) or `@rule` (a
 * variant, wording, limit or boundary); with neither it is unclassified, and a
 * scenario absent at the merge base with `origin/main` (same key as the debt
 * list) that has no class in a user-facing spec — Draft included, since every
 * spec is born Draft — is a BLOCK finding; existing unclassified scenarios are
 * legacy and only counted. Every scenario of any other spec is a rule;
 * `@journey` there, and both tags on one scenario, are BLOCK findings.
 *
 * State, first match wins:
 *
 *   - pending — its spec's requirements `status:` is `Draft`;
 *   - bound — bound BY ONE runner config (a `defineBddConfig` call): its
 *     `features` globs take the scenario's file in, the scenario has a step of
 *     its own, and every step (Background steps included) matches a step
 *     definition from that same config's `steps` globs; an outline only when
 *     that holds for every row of every `Examples` block, placeholders
 *     substituted. Definitions are never pooled across configs — playwright-bdd
 *     binds a feature only to the steps of the config that runs it. Tag
 *     filters inside a config are not modelled. For a journey only a
 *     real-stack config counts — one under `packages/e2e/` (the staging suite,
 *     the production compose set) or `apps/admin/` (the admin tier on real
 *     api + database + IdP) — and a journey quarantined on the scenario or on
 *     any of its `Examples` blocks (`@quarantine(#N)`, `@quarantine:login(#N)`)
 *     is never bound. A config whose `features` / `steps` are not string
 *     literals, an array of them, a same-file const or a ternary of those is a
 *     BLOCK finding;
 *   - proof:<level> — a rule carrying `@proof:<level>` (`unit` | `api` |
 *     `app-e2e`); counted under the highest level it names. On a journey, or
 *     on an unclassified scenario of a user-facing spec, the tag is a BLOCK
 *     finding and proves nothing;
 *   - unproven — none of the above.
 *
 * A proof tag is a claim the guard verifies: for EVERY `@EARS-N` on the
 * scenario some test title at one of the tagged levels cites that id
 * (dotted-prefix ancestry, lib/ears-tests.ts) AS the scenario's spec's id. An
 * id in a title belongs to spec `NNN` only when that occurrence is written
 * `NNN EARS-k`, or when it is bare and the whole file cites exactly one spec,
 * `NNN`. In a file citing two or more specs a bare id proves nothing, and no
 * ownership is inherited from an enclosing `describe` — a pooled file scope
 * would let one spec's `EARS-k` prove another's. A file citing no spec proves
 * nothing either. Level by path: `app-e2e` = `apps/<app>/e2e/**`, `api` =
 * `apps/api/test/**`, `unit` = any other test file; `packages/e2e/**` is the
 * binding harness itself and proves nothing here.
 *
 * The ratchet. `packages/e2e/scenario-proof-debt.txt` lists exactly the
 * unproven scenarios, key `NNN | <title>` (` [k]` for the k-th repeat of a
 * title in a spec), optionally ` | #<issue>`. It lives with the harness so a
 * backfill PR that only tags scenarios and deletes lines stays test-only. An
 * unlisted unproven scenario, a stale line (its scenario is proven, Draft or
 * gone) and a line absent at the merge base with `origin/main` whose number is
 * not an OPEN Issue — no number, a closed Issue, a number that does not exist,
 * a pull request — are BLOCK findings; a line already present at the merge
 * base needs no Issue, and when the list did not exist there every line is
 * baseline. A spec does not move to Shipped while one of its journeys is
 * unproven: a new line for a journey of a `status: Shipped` spec blocks with
 * or without an Issue, and a spec whose `status:` is `Shipped` here but was
 * not at the merge base (or did not exist there) blocks on each unproven
 * journey, listed or not; specs already Shipped at the base keep their listed
 * journeys as baseline. So the list shrinks freely and grows only as tracked
 * debt. When the lookup itself (or
 * the merge base) cannot run (no `gh`, no auth, network), the line blocks
 * under `CI` and is a WARN elsewhere — CI must not pass an unverified line.
 *
 * Modes: default = the guard; `--report` prints the per-spec inventory table
 * (`pnpm scenarios:inventory`, the one source of the coverage number; the
 * headline is journeys bound / journeys total); `--write-debt` rewrites the
 * debt list from the current state, keeping each surviving line's Issue.
 *
 * Seams: `LINT_FIXTURE_ROOT` (repo tree), `LINT_PROOF_BASE_DEBT_FILE` (the debt
 * list at the merge base; a missing file = absent there),
 * `LINT_PROOF_BASE_ROOT` (a tree holding the spec `.feature` files at the
 * merge base; a missing dir = no scenario existed there), `LINT_GH_FIXTURE_DIR`
 * (`issue-view-<n>.json` = the `gh issue view` answer, `issue-view-<n>.error` =
 * its stderr on a failed call, neither = the lookup could not run),
 * `LINT_DIFF_BASE` (merge-base ref, default `origin/main`). All inert in
 * production.
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

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TAG = "[scenario-proof]";
const DEBT_REL = "packages/e2e/scenario-proof-debt.txt";
const FEATURE_GLOB = "apps/docs/content/specs/features/*/*-scenarios.feature";
const REQUIREMENTS_GLOB =
  "apps/docs/content/specs/features/*/*-requirements*.md";
/** The files holding the `defineBddConfig` callers that bind spec scenarios. */
const BDD_CONFIG_GLOBS = [
  "packages/e2e/*.config.ts",
  "apps/*/playwright*.config.ts",
];

/**
 * Config locations whose runs are on the real stack (tech spec §6.1): the
 * staging suite and the admin tier. A config anywhere else — the portal's
 * manual dev-stand tier among them — binds rules, never a journey.
 */
const REAL_STACK_CONFIG_DIRS = ["packages/e2e/", "apps/admin/"];

export const LEVELS = ["unit", "api", "app-e2e"] as const;
type Level = (typeof LEVELS)[number];
type State = "bound" | `proof:${Level}` | "pending" | "unproven";
type Class = "journey" | "rule" | "unclassified";

const PROOF_TAG_RE = /^@proof(?::(.*))?$/;
const QUARANTINE_TAG_RE = /^@quarantine(?::login)?(?:\(|$)/i;
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

/**
 * The index just past the string literal or comment starting at `i`, or -1
 * when none starts there — so brackets, commas and `?`/`:` inside them never
 * count as code.
 */
function skipNonCode(src: string, i: number): number {
  const c = src[i];
  if (c === "/" && src[i + 1] === "/") {
    const end = src.indexOf("\n", i);
    return end === -1 ? src.length : end;
  }
  if (c === "/" && src[i + 1] === "*") {
    const end = src.indexOf("*/", i + 2);
    return end === -1 ? src.length : end + 2;
  }
  if (c === '"' || c === "'" || c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
    return Math.min(j + 1, src.length);
  }
  return -1;
}

/** Calls `visit` on each code character at bracket depth 0; `true` stops. */
function scanTop(src: string, visit: (i: number) => boolean | void): void {
  let depth = 0;
  for (let i = 0; i < src.length;) {
    const skip = skipNonCode(src, i);
    if (skip !== -1) {
      i = skip;
      continue;
    }
    const c = src[i];
    if ("([{".includes(c)) depth += 1;
    else if (")]}".includes(c)) depth -= 1;
    else if (depth === 0 && visit(i) === true) return;
    i += 1;
  }
}

/** The index of the bracket closing the one at `open`, or -1. */
function closingBracket(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length;) {
    const skip = skipNonCode(src, i);
    if (skip !== -1) {
      i = skip;
      continue;
    }
    if ("([{".includes(src[i])) depth += 1;
    else if (")]}".includes(src[i])) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** `src` split at its depth-0 commas. */
function splitTopCommas(src: string): string[] {
  const parts: string[] = [];
  let from = 0;
  scanTop(src, (i) => {
    if (src[i] === ",") {
      parts.push(src.slice(from, i));
      from = i + 1;
    }
  });
  parts.push(src.slice(from));
  return parts;
}

/** `src` with its comments removed (string literals kept verbatim). */
function stripComments(src: string): string {
  let out = "";
  for (let i = 0; i < src.length;) {
    const skip = skipNonCode(src, i);
    if (skip === -1) {
      out += src[i];
      i += 1;
    } else {
      if (src[i] !== "/") out += src.slice(i, skip);
      i = skip;
    }
  }
  return out;
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const isTernaryMark = (s: string, i: number): boolean =>
  s[i] === "?" && s[i + 1] !== "." && s[i + 1] !== "?" && s[i - 1] !== "?";

/**
 * The strings a config value can take, read statically: a string literal, an
 * array of them, a same-file `const`/`let` naming one, or a ternary of those
 * (both branches, the condition unread — a config that picks a file by
 * environment runs either). `null` = not statically readable.
 */
function staticStrings(
  expr: string,
  src: string,
  seen: Set<string> = new Set(),
): string[] | null {
  const e = stripComments(expr).trim();
  if (e === "") return null;
  if (`"'\``.includes(e[0]) && skipNonCode(e, 0) === e.length) {
    const lit = decodeLiteral(e);
    return lit === null ? null : [lit];
  }
  if (e[0] === "[" && closingBracket(e, 0) === e.length - 1) {
    const out: string[] = [];
    for (const part of splitTopCommas(e.slice(1, -1))) {
      if (stripComments(part).trim() === "") continue;
      const vals = staticStrings(part, src, seen);
      if (vals === null) return null;
      out.push(...vals);
    }
    return out;
  }
  let q = -1;
  scanTop(e, (i) => {
    if (!isTernaryMark(e, i)) return false;
    q = i;
    return true;
  });
  if (q !== -1) {
    let colon = -1;
    let nested = 0;
    scanTop(e.slice(q + 1), (i) => {
      const j = q + 1 + i;
      if (isTernaryMark(e, j)) nested += 1;
      else if (e[j] === ":") {
        if (nested === 0) {
          colon = j;
          return true;
        }
        nested -= 1;
      }
      return false;
    });
    if (colon === -1) return null;
    const a = staticStrings(e.slice(q + 1, colon), src, seen);
    const b = staticStrings(e.slice(colon + 1), src, seen);
    return a === null || b === null ? null : [...a, ...b];
  }
  if (IDENT_RE.test(e) && !seen.has(e)) {
    const decl = new RegExp(`\\b(?:const|let)\\s+${e}\\s*=`).exec(src);
    if (!decl) return null;
    const rest = src.slice(decl.index + decl[0].length);
    let end = -1;
    scanTop(rest, (i) => {
      if (rest[i] !== ";") return false;
      end = i;
      return true;
    });
    if (end === -1) return null;
    return staticStrings(rest.slice(0, end), src, new Set([...seen, e]));
  }
  return null;
}

/** One `defineBddConfig` call: its `features` / `steps` globs, as written. */
export interface BddConfigCall {
  features: string[] | null;
  steps: string[] | null;
}

/**
 * Every `defineBddConfig({ … })` call of a config source, with the
 * `features` and `steps` values read statically (`null` = not readable).
 */
export function bddConfigCalls(src: string): BddConfigCall[] {
  const calls: BddConfigCall[] = [];
  for (const m of src.matchAll(/\bdefineBddConfig\s*\(\s*/g)) {
    const open = m.index + m[0].length;
    const call: BddConfigCall = { features: null, steps: null };
    calls.push(call);
    if (src[open] !== "{") continue;
    const close = closingBracket(src, open);
    if (close === -1) continue;
    for (const prop of splitTopCommas(src.slice(open + 1, close))) {
      const p = stripComments(prop).trim();
      const kv = p.match(/^([A-Za-z_$][\w$]*)\s*(?::([\s\S]*))?$/);
      if (!kv || (kv[1] !== "features" && kv[1] !== "steps")) continue;
      call[kv[1]] = staticStrings(kv[2] ?? kv[1], src);
    }
  }
  return calls;
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

/**
 * One runner config as playwright-bdd sees it: the spec feature files its
 * `features` globs take in, and a matcher over the step definitions of its
 * own `steps` globs only — a feature binds to nothing else in that run.
 */
interface RunnerConfig {
  where: string;
  realStack: boolean;
  features: Set<string>;
  matches: (text: string) => boolean;
}

/**
 * Every `defineBddConfig` call on disk as a runner config. Tag filters
 * (`tags`, a `grep`) are not modelled: a config binds every scenario of the
 * files it takes in whose steps it matches, the way `missingSteps` would
 * judge it. A call whose `features` or `steps` cannot be read statically is a
 * finding — binding it by guess could pass a journey no runner executes.
 */
async function loadRunnerConfigs(findings: string[]): Promise<{
  configs: RunnerConfig[];
  defs: number;
  files: number;
}> {
  const configFiles = (
    await fg(BDD_CONFIG_GLOBS, {
      cwd: REPO_ROOT,
      absolute: true,
      ignore: ["**/node_modules/**"],
    })
  ).sort();
  const factory = new ExpressionFactory(new ParameterTypeRegistry());
  const exprsOf = new Map<string, Expression[]>();
  let unparsable = 0;
  const expressionsIn = (file: string): Expression[] => {
    let list = exprsOf.get(file);
    if (list === undefined) {
      list = [];
      for (const p of stepPatterns(readFileSync(file, "utf8"))) {
        try {
          list.push(factory.createExpression(p));
        } catch {
          unparsable += 1;
        }
      }
      exprsOf.set(file, list);
    }
    return list;
  };
  const resolveGlobs = (dir: string, globs: string[]): Promise<string[]> =>
    globs.length === 0
      ? Promise.resolve([])
      : fg(
          globs.map((g) => posix.normalize(posix.join(dir, g))),
          { cwd: REPO_ROOT, absolute: true, ignore: ["**/node_modules/**"] },
        );
  const configs: RunnerConfig[] = [];
  for (const file of configFiles) {
    const rel = relPath(file);
    const dir = posix.dirname(rel);
    const realStack = REAL_STACK_CONFIG_DIRS.some((d) => rel.startsWith(d));
    const calls = bddConfigCalls(readFileSync(file, "utf8"));
    for (const [n, call] of calls.entries()) {
      const where = calls.length > 1 ? `${rel} (call ${n + 1})` : rel;
      const unread = [
        call.features === null ? "features" : null,
        call.steps === null ? "steps" : null,
      ].filter((x): x is string => x !== null);
      if (call.features === null || call.steps === null) {
        findings.push(
          `${where} -> a defineBddConfig call whose ${unread.join(" and ")} cannot be read ` +
            `statically; write string literals, an array of them, or a same-file const`,
        );
        continue;
      }
      const features = new Set(
        (await resolveGlobs(dir, call.features)).map(relPath),
      );
      const exprs = (await resolveGlobs(dir, call.steps)).flatMap(
        expressionsIn,
      );
      const cache = new Map<string, boolean>();
      configs.push({
        where,
        realStack,
        features,
        matches: (text) => {
          let hit = cache.get(text);
          if (hit === undefined) {
            hit = exprs.some((x) => x.match(text) !== null);
            cache.set(text, hit);
          }
          return hit;
        },
      });
    }
  }
  if (unparsable > 0) {
    info(`${unparsable} step pattern(s) are not valid expressions; ignored.`);
  }
  return {
    configs,
    defs: [...exprsOf.values()].reduce((n, l) => n + l.length, 0),
    files: exprsOf.size,
  };
}

// ── scenarios ───────────────────────────────────────────────────────────────

export interface ParsedScenario {
  line: number;
  title: string;
  /** Steps the scenario writes itself — a Background-only scenario has none. */
  ownSteps: number;
  /**
   * Background steps first, then its own: one list for a plain scenario, one
   * per `Examples` row (every block) for an outline, placeholders substituted.
   */
  runs: string[][];
}

interface ExamplesBlock {
  header: string[] | null;
  rows: string[][];
}

/**
 * The title and the steps of every scenario of a `.feature` file, in file
 * order: Feature- and Rule-level Background steps prefix each scenario in their
 * scope, and an outline runs once per row of each of its `Examples` blocks.
 */
export function parseScenarioSteps(text: string): ParsedScenario[] {
  const out: {
    line: number;
    title: string;
    background: string[];
    own: string[];
    examples: ExamplesBlock[];
  }[] = [];
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
      current?.examples.push({ header: null, rows: [] });
      return;
    }
    const head = t.match(SCENARIO_HEAD_RE);
    if (head) {
      out.push({
        line: idx + 1,
        title: head[1].trim(),
        background: [...featureBg, ...ruleBg],
        own: [],
        examples: [],
      });
      section = "scenario";
      return;
    }
    const step = t.match(STEP_RE);
    if (step) {
      if (section === "feature-bg") featureBg.push(step[1]);
      else if (section === "rule-bg") ruleBg.push(step[1]);
      else if (section === "scenario" && current) current.own.push(step[1]);
      return;
    }
    const block = current?.examples[current.examples.length - 1];
    if (t.startsWith("|") && section === "examples" && block) {
      const cells = t
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      if (!block.header) block.header = cells;
      else block.rows.push(cells);
    }
  });
  return out.map(({ line, title, background, own, examples }) => {
    const steps = [...background, ...own];
    const rows = examples.flatMap(({ header, rows: r }) =>
      header ? r.map((row) => ({ header, row })) : [],
    );
    return {
      line,
      title,
      ownSteps: own.length,
      runs:
        rows.length === 0
          ? [steps]
          : rows.map(({ header, row }) =>
              steps.map((s) =>
                s.replace(/<([^<>]+)>/g, (all, name: string) => {
                  const i = header.indexOf(name);
                  return i === -1 ? all : (row[i] ?? all);
                }),
              ),
            ),
    };
  });
}

interface Scenario {
  feature: string;
  where: string;
  title: string;
  key: string;
  cls: Class;
  state: State;
}

/** The debt-list key of each title in file order (` [k]` on the k-th repeat). */
function scenarioKeys(feature: string, titles: string[]): string[] {
  const repeats = new Map<string, number>();
  return titles.map((title) => {
    const k = (repeats.get(title) ?? 0) + 1;
    repeats.set(title, k);
    return `${feature} | ${title}${k > 1 ? ` [${k}]` : ""}`;
  });
}

// ── tests ───────────────────────────────────────────────────────────────────

interface TestEntry {
  level: Level;
  /** The ids this file proves, each for the one spec that owns it. */
  proofs: { feature: string; id: string }[];
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

const errorReason = (e: unknown): string =>
  (e as Error).message.split("\n")[0] ?? "git failed";

let mergeBaseMemo: Promise<string> | null = null;
/** The merge base with `origin/main` (`LINT_DIFF_BASE`); rejects when git cannot answer. */
function mergeBase(): Promise<string> {
  mergeBaseMemo ??= execa(
    "git",
    ["merge-base", process.env.LINT_DIFF_BASE ?? "origin/main", "HEAD"],
    { cwd: REPO_ROOT },
  ).then(({ stdout }) => stdout.trim());
  return mergeBaseMemo;
}

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
  try {
    const mb = await mergeBase();
    const { stdout: listed } = await execa(
      "git",
      ["ls-tree", "--name-only", mb, "--", DEBT_REL],
      { cwd: REPO_ROOT },
    );
    if (listed.trim() === "") return { status: "absent" };
    const { stdout } = await execa("git", ["show", `${mb}:${DEBT_REL}`], {
      cwd: REPO_ROOT,
      stripFinalNewline: false,
    });
    return { status: "ok", keys: keysOf(stdout) };
  } catch (e) {
    return { status: "unknown", reason: errorReason(e) };
  }
}

const FEATURE_PATH_RE =
  /^apps\/docs\/content\/specs\/features\/[^/]+\/[^/]+-scenarios\.feature$/;
const REQUIREMENTS_PATH_RE =
  /^apps\/docs\/content\/specs\/features\/[^/]+\/[^/]+-requirements[^/]*\.md$/;

/**
 * A spec's `status:` and surface, from its EN/base requirements file (the RU
 * twin mirrors them, so it is skipped). `null` = not that file.
 */
function specFrontmatter(
  rel: string,
  text: string,
): { status: string | undefined; userFacing: boolean } | null {
  if (rel.endsWith("-requirements-ru.md")) return null;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return {
    status: fm.match(/^status:\s*(.+?)\s*$/m)?.[1],
    userFacing: /^surface:\s*user-facing\s*$/m.test(fm),
  };
}

/**
 * The scenario keys of every spec `.feature` file at the merge base, and the
 * `status:` of every spec there (a spec absent there has none).
 */
async function baseScenarioKeys(): Promise<
  | { status: "ok"; keys: Set<string>; statusOf: Map<string, string> }
  | { status: "unknown"; reason: string }
> {
  const files: { rel: string; text: string }[] = [];
  const seam = process.env.LINT_PROOF_BASE_ROOT;
  if (seam) {
    const root = resolve(seam);
    if (existsSync(root)) {
      for (const rel of await fg([FEATURE_GLOB, REQUIREMENTS_GLOB], {
        cwd: root,
        ignore: ["**/node_modules/**"],
      })) {
        files.push({ rel, text: readFileSync(resolve(root, rel), "utf8") });
      }
    }
  } else {
    try {
      const mb = await mergeBase();
      const { stdout: listed } = await execa(
        "git",
        [
          "ls-tree",
          "-r",
          "--name-only",
          mb,
          "--",
          "apps/docs/content/specs/features",
        ],
        { cwd: REPO_ROOT },
      );
      const rels = listed
        .split("\n")
        .filter((p) => FEATURE_PATH_RE.test(p) || REQUIREMENTS_PATH_RE.test(p));
      if (rels.length > 0) {
        // One `cat-file --batch` for every file: `<sha> blob <size>\n<bytes>\n`.
        const { stdout } = await execa("git", ["cat-file", "--batch"], {
          cwd: REPO_ROOT,
          input: rels.map((p) => `${mb}:${p}`).join("\n") + "\n",
          encoding: "buffer",
          stripFinalNewline: false,
        });
        const buf = Buffer.from(stdout);
        let pos = 0;
        for (const rel of rels) {
          const eol = buf.indexOf(0x0a, pos);
          if (eol === -1) throw new Error("truncated git cat-file answer");
          const header = buf.subarray(pos, eol).toString("utf8");
          pos = eol + 1;
          const size = Number(header.match(/ blob (\d+)$/)?.[1] ?? NaN);
          if (Number.isNaN(size)) continue;
          files.push({
            rel,
            text: buf.subarray(pos, pos + size).toString("utf8"),
          });
          pos += size + 1;
        }
      }
    } catch (e) {
      return { status: "unknown", reason: errorReason(e) };
    }
  }
  const keys = new Set<string>();
  const statusOf = new Map<string, string>();
  for (const { rel, text } of files) {
    const feature = specFeature(rel);
    if (!feature) continue;
    if (!rel.endsWith(".feature")) {
      const status = specFrontmatter(rel, text)?.status;
      if (status) statusOf.set(feature, status);
      continue;
    }
    const titles = parseScenarioSteps(text).map((s) => s.title);
    for (const k of scenarioKeys(feature, titles)) keys.add(k);
  }
  return { status: "ok", keys, statusOf };
}

type IssueLookup =
  | { kind: "issue"; state: string }
  | { kind: "pull" }
  | { kind: "missing" }
  | { kind: "unavailable"; reason: string };

/** `gh`'s answer for a number that is neither an Issue nor a pull request. */
const GH_NOT_FOUND_RE = /Could not resolve to an? (?:issue|pull request)/i;

/** True when `CI` is set to anything but an explicit off value. */
function inCi(): boolean {
  const ci = (process.env.CI ?? "").trim().toLowerCase();
  return ci !== "" && ci !== "false" && ci !== "0";
}

/**
 * What a debt line's `#<n>` names. `gh issue view` also answers for a pull
 * request (same number space), so the URL decides: `/issues/` is an Issue,
 * `/pull/` is not. A failed call is "missing" only on gh's not-found answer;
 * anything else (no binary, no auth, network) means the lookup did not run.
 */
async function lookupIssue(n: number): Promise<IssueLookup> {
  const classify = (raw: string): IssueLookup => {
    let data: { state?: unknown; url?: unknown };
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      return { kind: "unavailable", reason: "unparsable gh answer" };
    }
    const url = typeof data.url === "string" ? data.url : "";
    if (/\/pull\/\d+$/.test(url)) return { kind: "pull" };
    if (!/\/issues\/\d+$/.test(url) || typeof data.state !== "string") {
      return {
        kind: "unavailable",
        reason: "gh answer has no Issue url/state",
      };
    }
    return { kind: "issue", state: data.state.toUpperCase() };
  };
  const failed = (stderr: string): IssueLookup =>
    GH_NOT_FOUND_RE.test(stderr)
      ? { kind: "missing" }
      : {
          kind: "unavailable",
          reason: stderr.trim().split("\n")[0] || "gh failed",
        };
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR;
  if (fixtureDir) {
    const answer = resolve(fixtureDir, `issue-view-${n}.json`);
    const error = resolve(fixtureDir, `issue-view-${n}.error`);
    if (existsSync(answer)) return classify(readFileSync(answer, "utf8"));
    if (existsSync(error)) return failed(readFileSync(error, "utf8"));
    return { kind: "unavailable", reason: `no gh fixture for #${n}` };
  }
  try {
    const res = await execa(
      "gh",
      ["issue", "view", String(n), "--json", "state,url"],
      { cwd: REPO_ROOT, reject: false },
    );
    if (res.failed && res.exitCode === undefined) {
      return {
        kind: "unavailable",
        reason: (res.shortMessage ?? "gh did not run").split("\n")[0],
      };
    }
    return res.exitCode === 0
      ? classify(String(res.stdout))
      : failed(String(res.stderr));
  } catch (e) {
    return {
      kind: "unavailable",
      reason: (e as Error).message.split("\n")[0] ?? "gh did not run",
    };
  }
}

const DEBT_HEADER = [
  "# Unproven spec scenarios — the scenario-proof ratchet (tools/lint/scenario-proof-lint.ts,",
  "# regression-contour tech spec §6.4). One line per scenario of a non-Draft spec that is",
  "# not proven: a @journey not bound by one real-stack runner config, a @rule neither bound",
  "# by one runner config nor carrying a verified @proof:<level> tag, an unclassified",
  "# scenario not bound:",
  "#   NNN | <scenario title>[ [k]][ | #<issue>]   ([k] = the k-th scenario with that title)",
  "# Delete a line once its scenario is proven. A line added after the merge base names an",
  "# OPEN Issue; a spec does not move to Shipped while one of its journeys is unproven.",
  "# Regenerate: pnpm lint:scenario-proof --write-debt",
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
  const statusOf = new Map<string, string>();
  const userFacing = new Set<string>();
  for (const f of reqFiles) {
    const rel = relPath(f);
    const feature = specFeature(rel);
    if (!feature) continue;
    knownFeatures.add(feature);
    const fm = specFrontmatter(rel, readFileSync(f, "utf8"));
    if (!fm) continue;
    if (fm.status) statusOf.set(feature, fm.status);
    if (fm.userFacing) userFacing.add(feature);
  }
  const isDraft = (feature: string): boolean =>
    statusOf.get(feature) === "Draft";

  const tests: TestEntry[] = [];
  for (const f of await fg(TEST_FILE_GLOBS, {
    cwd: REPO_ROOT,
    absolute: true,
    ignore: TEST_FILE_IGNORE,
  })) {
    const level = levelOf(relPath(f));
    if (level === null) continue;
    const { features, occurrences } = parseTestTitles(readFileSync(f, "utf8"));
    const cited = new Set(
      [...features, ...occurrences.map((o) => o.feature ?? "")].filter((n) =>
        knownFeatures.has(n),
      ),
    );
    const sole = cited.size === 1 ? [...cited][0] : null;
    const proofs = occurrences.flatMap(({ id, feature }) => {
      const owner = feature !== null ? feature : sole;
      return owner !== null && knownFeatures.has(owner)
        ? [{ feature: owner, id }]
        : [];
    });
    if (proofs.length > 0) tests.push({ level, proofs });
  }

  const findings: string[] = [];
  const runners = await loadRunnerConfigs(findings);
  const scenarios: Scenario[] = [];
  const baseScenarios = mode === "check" ? await baseScenarioKeys() : null;
  if (baseScenarios?.status === "unknown") {
    const msg =
      `the merge base was unavailable (${baseScenarios.reason}); ` +
      `new scenarios are not checked for a class`;
    if (inCi()) findings.push(`${msg}, and CI is set: BLOCK`);
    else info(`WARN ${msg}; outside CI not blocked on a guess.`);
  }

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
    const keys = scenarioKeys(
      feature,
      parsed.map((s) => s.title),
    );
    const specUserFacing = userFacing.has(feature);
    parsed.forEach((s, i) => {
      const tags = tagged[i].tags;
      const where = `${rel}:${s.line}`;
      const key = keys[i];

      const journeyTag = tags.includes("@journey");
      const ruleTag = tags.includes("@rule");
      let cls: Class;
      if (!specUserFacing) {
        if (journeyTag) {
          findings.push(
            `${where} "${s.title}" -> @journey in a backend-only spec; every scenario there is a rule`,
          );
        }
        cls = "rule";
      } else if (journeyTag && ruleTag) {
        findings.push(
          `${where} "${s.title}" -> carries both @journey and @rule; a scenario is one or the other`,
        );
        cls = "journey";
      } else {
        cls = journeyTag ? "journey" : ruleTag ? "rule" : "unclassified";
      }
      // Draft specs included: every spec is born Draft, so a class is
      // required where the scenario is written, not when the status moves.
      if (
        cls === "unclassified" &&
        baseScenarios?.status === "ok" &&
        !baseScenarios.keys.has(key)
      ) {
        findings.push(
          `${where} "${s.title}" -> new scenario (absent at the merge base) has no class; ` +
            `tag it @journey or @rule`,
        );
      }

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
      const tagList = proofTags.map((m) => m[0]).join(" ");
      if (proofTags.length > 0 && cls === "journey") {
        findings.push(
          `${where} "${s.title}" -> ${tagList} on a @journey: a journey is proven only by ` +
            `binding its steps on the real stack (packages/e2e, apps/admin/e2e); remove the tag`,
        );
      } else if (proofTags.length > 0 && cls === "unclassified") {
        findings.push(
          `${where} "${s.title}" -> ${tagList} on an unclassified scenario of a user-facing ` +
            `spec; classify it first (@journey or @rule)`,
        );
      } else if (proofTags.length > 0 && ears.length === 0) {
        findings.push(
          `${where} "${s.title}" -> ${proofTags.map((m) => m[0]).join(" ")} on a scenario with no @EARS-N tag`,
        );
      } else if (levels.length > 0) {
        for (const id of [...new Set(ears)]) {
          const proven = tests.some(
            (t) =>
              levels.includes(t.level) &&
              t.proofs.some((p) => p.feature === feature && matches(id, p.id)),
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

      // Bound BY ONE config: it takes this file in and its own steps match
      // every step of every run — a split across tiers runs nowhere.
      const boundBy = (c: RunnerConfig): boolean =>
        c.features.has(rel) &&
        s.ownSteps > 0 &&
        s.runs.every((run) => run.every((t) => c.matches(t)));
      // A quarantine on any `Examples` block leaves those rows unrun.
      const quarantined = [
        ...tags,
        ...tagged[i].examples.flatMap((x) => x.tags),
      ].some((t) => QUARANTINE_TAG_RE.test(t));
      const bound =
        cls === "journey"
          ? !quarantined &&
            runners.configs.some((c) => c.realStack && boundBy(c))
          : runners.configs.some(boundBy);
      const highest =
        cls === "rule"
          ? [...LEVELS].reverse().find((l) => levels.includes(l))
          : undefined;
      const state: State = isDraft(feature)
        ? "pending"
        : bound
          ? "bound"
          : highest
            ? `proof:${highest}`
            : "unproven";
      scenarios.push({ feature, where, title: s.title, key, cls, state });
    });
  }

  const unproven = scenarios.filter((s) => s.state === "unproven");
  const TALLY_COLUMNS = [
    "journeys bound",
    "journeys total",
    "rules proven",
    "rules total",
    "unclassified bound",
    "unclassified unbound",
    "pending",
  ];
  /** The class split, in `TALLY_COLUMNS` order; it sums to `list.length`. */
  const tally = (list: Scenario[]): number[] => {
    const live = list.filter((s) => s.state !== "pending");
    const of = (c: Class) => live.filter((s) => s.cls === c);
    const proven = (l: Scenario[]) =>
      l.filter((s) => s.state !== "unproven").length;
    return [
      proven(of("journey")),
      of("journey").length,
      proven(of("rule")),
      of("rule").length,
      proven(of("unclassified")),
      of("unclassified").length - proven(of("unclassified")),
      list.length - live.length,
    ];
  };
  const debtPath = resolve(REPO_ROOT, DEBT_REL);
  const debtText = existsSync(debtPath) ? readFileSync(debtPath, "utf8") : "";

  if (mode === "report") {
    const features = [...new Set(scenarios.map((s) => s.feature))].sort();
    const row = (label: string, list: Scenario[]): string =>
      `| ${label} | ${list.length} | ${tally(list).join(" | ")} |`;
    const lines = [
      `| spec | total | ${TALLY_COLUMNS.join(" | ")} |`,
      `|${" --- |".repeat(TALLY_COLUMNS.length + 2)}`,
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
          (s.cls === "rule"
            ? `bind it, tag a verified @proof:<level>, or list it with an OPEN Issue`
            : s.cls === "journey"
              ? `bind it under packages/e2e or apps/admin/e2e, or list it with an OPEN Issue`
              : `bind it, or classify it and prove it, or list it with an OPEN Issue`),
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

  // The status flip: a spec that is Shipped here and was not at the merge base
  // (or did not exist there) carries no unproven journey, debt line or not.
  // Specs Shipped at the base keep their listed journeys as baseline.
  if (baseScenarios?.status === "ok") {
    for (const s of scenarios) {
      if (s.cls !== "journey" || s.state === "bound") continue;
      if (statusOf.get(s.feature) !== "Shipped") continue;
      const was = baseScenarios.statusOf.get(s.feature);
      if (was === "Shipped") continue;
      findings.push(
        `${s.key} -> the spec moves to Shipped (${was ?? "absent"} at the merge base) ` +
          `with this @journey unproven (${s.where}); a spec does not move to Shipped ` +
          `while one of its journeys is unproven — bind it under packages/e2e or apps/admin/e2e`,
      );
    }
  }

  const base = await baseDebt();
  if (base.status === "unknown") {
    const msg =
      `the merge base was unavailable (${base.reason}); ` +
      `new debt entries are not checked for an Issue`;
    if (inCi()) findings.push(`${msg}, and CI is set: BLOCK`);
    else info(`WARN ${msg}; outside CI not blocked on a guess.`);
  } else if (base.status === "ok") {
    for (const e of debt) {
      if (base.keys.has(e.key)) continue;
      const s = byKey.get(e.key);
      if (s?.cls === "journey" && statusOf.get(s.feature) === "Shipped") {
        findings.push(
          `${e.key} -> new debt entry for a @journey of a Shipped spec; a spec does not ` +
            `move to Shipped while one of its journeys is unproven, and an Issue does ` +
            `not excuse it (${s.where})`,
        );
        continue;
      }
      if (e.issue === null) {
        findings.push(
          `${e.key} -> new debt entry (absent at the merge base) names no #<issue>; ` +
            `append \` | #<issue>\` naming an OPEN Issue`,
        );
        continue;
      }
      const res = await lookupIssue(e.issue);
      if (res.kind === "unavailable") {
        const msg =
          `${e.key} -> could not look up #${e.issue} (${res.reason}); ` +
          `the new debt entry's Issue is unverified`;
        if (inCi()) findings.push(`${msg}, and CI is set: BLOCK`);
        else info(`WARN ${msg}; outside CI not blocked on a guess.`);
      } else if (res.kind === "missing") {
        findings.push(
          `${e.key} -> new debt entry names #${e.issue}, which is no Issue in this repository`,
        );
      } else if (res.kind === "pull") {
        findings.push(
          `${e.key} -> new debt entry names #${e.issue}, which is a pull request, not an Issue`,
        );
      } else if (res.state !== "OPEN") {
        findings.push(
          `${e.key} -> new debt entry tracks Issue #${e.issue}, which is ${res.state}`,
        );
      }
    }
  }

  const [jBound, jTotal, rProven, rTotal, uBound, uUnbound, pending] =
    tally(scenarios);
  info(
    `journeys bound ${jBound}/${jTotal}; rules proven ${rProven}/${rTotal}; ` +
      `unclassified bound ${uBound}, unbound ${uUnbound}; pending ${pending} ` +
      `(${DEBT_REL}: ${debt.length} line(s)).`,
  );
  info(
    `${scenarios.length} scenario(s) in ${featureFiles.length} feature file(s); ` +
      `${runners.defs} step definition(s) from ${runners.files} file(s) in ` +
      `${runners.configs.length} runner config(s).`,
  );
  if (findings.length === 0) {
    info(
      "PASS — every journey is bound on the real stack, every rule is bound or " +
        "carries a verified @proof:<level> tag, every unclassified scenario is " +
        "bound, or the scenario belongs to a Draft spec or is listed as debt; the " +
        "list is exact and every new line names an OPEN Issue.",
    );
    process.exit(0);
  }
  for (const f of findings) process.stderr.write(`${TAG} ${f}\n`);
  process.stderr.write(
    `${TAG} FAIL — ${findings.length} finding(s) (tech spec §6.4). Prove a ` +
      `journey by binding its steps under packages/e2e or apps/admin/e2e; a ` +
      `rule by binding it or by a @proof:<level> tag a spec-scoped test backs; ` +
      `otherwise list it in ${DEBT_REL} with an OPEN Issue.\n`,
  );
  process.exit(1);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
