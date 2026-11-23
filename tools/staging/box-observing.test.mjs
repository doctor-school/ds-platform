import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOX_OBSERVING,
  boxObservingGrep,
  boxObservingTests,
  featureScenarios,
  stepMatcher,
  stepTexts,
} from "./box-observing.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const posix = (p) => p.split(path.sep).join("/");

function sourcesUnder(rel, keep) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = posix(path.join(dir, entry.name));
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && keep(child))
        out.push(child);
    }
  };
  walk(rel);
  return out;
}

/** The `packages/e2e/lib` files that read the stage box, directly or through another. */
function boxLibs() {
  const libs = sourcesUnder("packages/e2e/lib", () => true);
  const box = new Set(libs.filter((f) => /\bsshCapture\b/.test(read(f))));
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of libs) {
      if (box.has(f)) continue;
      if ([...box].some((b) => importsFile(f, b))) {
        box.add(f);
        grew = true;
      }
    }
  }
  return box;
}

function importsFile(from, target) {
  const re = /from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']/g;
  for (const m of read(from).matchAll(re)) {
    const spec = (m[1] ?? m[2]).replace(/\.js$/, ".ts");
    if (posix(path.join(path.dirname(from), spec)) === target) return true;
  }
  return false;
}

/** Every file outside the lib that reaches a box-observing lib: a step file, or a spec through `@ds/e2e`. */
function consumers() {
  const box = boxLibs();
  const found = new Set();
  for (const f of sourcesUnder("packages/e2e", (f) => !f.startsWith("packages/e2e/lib/"))) {
    if (f === "packages/e2e/index.ts") continue;
    if ([...box].some((b) => importsFile(f, b))) found.add(f);
  }
  // Names `@ds/e2e` re-exports from a box-observing lib.
  const index = read("packages/e2e/index.ts");
  const names = [];
  for (const m of index.matchAll(/export\s*\{([^}]+)\}\s*from\s*["']\.\/(lib\/[^"']+)["']/g)) {
    if (box.has(`packages/e2e/${m[2].replace(/\.js$/, ".ts")}`))
      names.push(...m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean));
  }
  assert.ok(names.length > 0, "@ds/e2e re-exports a box-observing lib");
  const nameRe = new RegExp(`\\b(${names.join("|")})\\b`);
  for (const app of readdirSync(path.join(ROOT, "apps"))) {
    if (!existsSync(path.join(ROOT, "apps", app, "e2e"))) continue;
    for (const f of sourcesUnder(`apps/${app}/e2e`, () => true)) {
      const src = read(f);
      if (/from\s+["']@ds\/e2e["']/.test(src) && nameRe.test(src)) found.add(f);
    }
  }
  return found;
}

describe("box-observing.mjs — the tests a PR-slot Actions run leaves out (#4202)", () => {
  it("lists every file that reaches a box-observing lib, and nothing else", () => {
    const listed = BOX_OBSERVING.map((e) => e.consumer).sort();
    assert.deepEqual(listed, [...consumers()].sort());
  });

  it("derives at least one scenario from every listed step, and every named title exists", () => {
    const tests = boxObservingTests();
    for (const { consumer, titles } of BOX_OBSERVING) {
      const mine = tests.filter((t) => t.consumer === consumer);
      assert.ok(mine.length > 0, `${consumer}: no excluded test`);
      if (titles) for (const title of titles) assert.ok(read(consumer).includes(`"${title}"`), `${consumer}: «${title}» is gone`);
    }
  });

  it("matches every step a listed step file defines to a feature step, so none slips through unparsed", () => {
    const features = readdirSync(path.join(ROOT, "apps/docs/content/specs/features"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(path.join(ROOT, "apps/docs/content/specs/features", d.name))
          .filter((f) => f.endsWith("-scenarios.feature"))
          .map((f) => read(`apps/docs/content/specs/features/${d.name}/${f}`)),
      )
      .flatMap(featureScenarios)
      .flatMap((s) => s.steps);
    for (const { consumer, titles } of BOX_OBSERVING) {
      if (titles) continue;
      for (const text of stepTexts(read(consumer))) {
        const m = stepMatcher(text);
        assert.ok(features.some((step) => m.test(step)), `${consumer}: «${text}» matches no feature step`);
      }
    }
  });

  it("its grep selects exactly the excluded titles", () => {
    const tests = boxObservingTests();
    const re = new RegExp(boxObservingGrep(tests));
    for (const t of tests) assert.ok(re.test(`academy › file › Feature › ${t.title} @tag`));
    assert.equal(re.test("academy › Registration is accepted"), false);
  });

  it("parses scenarios with their Background steps and matches outline placeholders", () => {
    const scenarios = featureScenarios(
      [
        "Feature: f",
        "  Background:",
        "    Given a shared step",
        "  @tag",
        "  Scenario: one",
        "    When it runs \"x\"",
        "  Scenario Outline: two",
        "    When it runs <value>",
        "    Examples:",
        "      | value |",
      ].join("\n"),
    );
    assert.deepEqual(scenarios, [
      { title: "one", steps: ["a shared step", 'it runs "x"'] },
      { title: "two", steps: ["a shared step", "it runs <value>"] },
    ]);
    const m = stepMatcher("it runs {string}");
    assert.ok(m.test('it runs "x"') && m.test("it runs <value>"));
    assert.equal(m.test("it runs x and more"), false);
    assert.deepEqual(stepTexts('Given(\n  "a {string} step",\n  async () => {});\nThen("done", f)'), ["a {string} step", "done"]);
  });
});
