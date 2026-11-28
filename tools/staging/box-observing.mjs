import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The box-observing stage scenarios (#4202) — the ONE source list of what a PR-slot
 * Actions run leaves out.
 *
 * These scenarios read the stage box itself (a mirror count, a consent row, the IdP
 * password policy): over the CI key's `observe` verb on the
 * `main` slot run, over the operator's own ssh otherwise (`packages/e2e/lib/
 * stage-observe.ts`). A PR-slot Actions run holds neither — no ssh key ever reaches
 * PR code, and the box's `observe` verb serves the `main` slot only — so the run
 * excludes them BY NAME, says so in its comment, and prints the `--local` command
 * that runs just them from the workstation. A PR-slot `observe` verb is the
 * follow-up that retires this list.
 *
 * Each entry is a file that reads the box through a box-observing lib: a step file,
 * whose scenarios are derived from the feature files (every scenario using one of
 * its steps), or a plain spec, whose test titles are named here. `box-observing.
 * test.mjs` fails when a file reaches a box-observing lib and is not listed, so a
 * new box-observing scenario cannot silently join the Actions run.
 */
export const BOX_OBSERVING = [
  { consumer: "packages/e2e/steps/congress-registration.steps.ts" },
  { consumer: "packages/e2e/steps/consent-refusal.steps.ts" },
  { consumer: "packages/e2e/steps/password-minimum.steps.ts" },
  { consumer: "packages/e2e/steps/phone-only-registration.steps.ts" },
  { consumer: "packages/e2e/steps/registration-consent-preservation.steps.ts" },
  { consumer: "packages/e2e/steps/signin-sms-hint.steps.ts" },
  { consumer: "packages/e2e/steps/wrong-verification-code.steps.ts" },
];

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FEATURES_DIR = "apps/docs/content/specs/features";

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** The step texts a step file defines (`Given("…", …)` and its kin). */
export function stepTexts(source) {
  const texts = [];
  const re = /\b(?:Given|When|Then|Step)\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  for (const m of source.matchAll(re)) texts.push(m[2].replace(/\\(.)/g, "$1"));
  return texts;
}

/**
 * A cucumber expression as an anchored RegExp. A parameter also matches an outline
 * placeholder (`<name>`), so a Scenario Outline's step lines match too.
 */
export function stepMatcher(expression) {
  const placeholder = "<[^>]+>";
  const params = {
    string: `"[^"]*"|'[^']*'`,
    int: "-?\\d+",
    float: "-?\\d*\\.?\\d+",
    word: "[^\\s]+",
    "": ".*",
  };
  let source = "";
  for (const part of expression.split(/(\{[a-z]*\})/)) {
    const param = /^\{([a-z]*)\}$/.exec(part);
    source += param
      ? `(?:${params[param[1]] ?? ".*"}|${placeholder})`
      : escapeRegExp(part);
  }
  return new RegExp(`^${source}$`);
}

/**
 * The scenarios of one feature file with the steps each runs — its own, plus the
 * feature's and its rule's Background steps.
 */
export function featureScenarios(text) {
  const scenarios = [];
  let featureBackground = [];
  let ruleBackground = [];
  let current;
  let section = "none";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#") || line.startsWith("@")) continue;
    const keyword =
      /^(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios):\s*(.*)$/.exec(
        line,
      );
    if (keyword) {
      const [, kind, title] = keyword;
      if (kind === "Rule") {
        ruleBackground = [];
        section = "rule";
      } else if (kind === "Background") {
        section = section === "rule" ? "ruleBackground" : "featureBackground";
      } else if (/^(Scenario|Example)/.test(kind) && kind !== "Examples") {
        current = { title, steps: [...featureBackground, ...ruleBackground] };
        scenarios.push(current);
        section = "scenario";
      } else if (kind === "Examples" || kind === "Scenarios") {
        section = "examples";
      }
      continue;
    }
    const step = /^(?:Given|When|Then|And|But|\*)\s+(.*)$/.exec(line);
    if (!step) continue;
    if (section === "featureBackground") featureBackground.push(step[1]);
    else if (section === "ruleBackground") ruleBackground.push(step[1]);
    else if (section === "scenario") current.steps.push(step[1]);
  }
  return scenarios;
}

function featureFiles(root) {
  const dir = path.join(root, FEATURES_DIR);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(dir, d.name))
        .filter((f) => f.endsWith("-scenarios.feature"))
        .map((f) => path.join(dir, d.name, f)),
    );
}

/**
 * The excluded tests: `{ consumer, title }` per scenario or spec test, in list
 * order, each title once.
 */
export function boxObservingTests({
  root = REPO_ROOT,
  list = BOX_OBSERVING,
} = {}) {
  const features = featureFiles(root).flatMap((file) =>
    featureScenarios(readFileSync(file, "utf8")),
  );
  const seen = new Set();
  const tests = [];
  for (const { consumer, titles } of list) {
    let found = titles ?? [];
    if (titles === undefined) {
      const matchers = stepTexts(
        readFileSync(path.join(root, consumer), "utf8"),
      ).map(stepMatcher);
      found = features
        .filter((s) =>
          s.steps.some((step) => matchers.some((m) => m.test(step))),
        )
        .map((s) => s.title);
    }
    for (const title of found) {
      if (seen.has(title)) continue;
      seen.add(title);
      tests.push({ consumer, title });
    }
  }
  return tests;
}

/** The grep (Playwright title RegExp source) that selects exactly those tests. */
export function boxObservingGrep(tests) {
  return tests.map((t) => escapeRegExp(t.title)).join("|");
}
