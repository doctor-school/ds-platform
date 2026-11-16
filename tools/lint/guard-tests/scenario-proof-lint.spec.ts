import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { caseDir, ghDir, runGuard } from "./run-guard";

/**
 * Exit-code harness for `tools/lint/scenario-proof-lint.ts` (regression-contour
 * tech spec §6.1/§6.4, Issues #4062, #4087). Each case points four seams at a
 * fixture case dir: `LINT_FIXTURE_ROOT` (the mini repo tree: specs, step
 * definitions, test files, the debt list), `LINT_PROOF_BASE_DEBT_FILE` (the
 * debt list as it stood at the merge base; a missing file = the list did not
 * exist there), `LINT_PROOF_BASE_ROOT` (the tree at the merge base: the case's
 * `base/` dir when it has one, else the case dir itself = no scenario is new)
 * and `LINT_GH_FIXTURE_DIR` (canned `gh issue view` JSON for new tracked
 * entries).
 *
 * A scenario of a user-facing spec is a `@journey`, a `@rule` or unclassified;
 * every scenario of a backend-only spec is a rule. A journey is proven only
 * when bound by a real-stack config (`packages/e2e/`, `apps/admin/`) and not
 * quarantined; a rule when bound or proof-tagged; an unclassified scenario
 * only when bound. The `green` case carries every class plus the
 * discriminators that must not fire: a nested test id proving a flat EARS tag,
 * a multi-level tag satisfied at one of its levels, a rule both bound and
 * tagged, a repeated title keyed `[2]`, a new entry tracked by an OPEN Issue,
 * an outline bound through its `Examples` row, an API proof named by an
 * explicit `001 EARS-3` title in a file that also cites spec 002, a journey
 * bound by the admin tier's own config, and a backend-only proof tag.
 *
 * Binding is per runner config: a scenario is bound only when ONE
 * `defineBddConfig` caller both includes its feature file and matches every
 * step of it, Background included — pooled definitions run nowhere.
 */
const GUARD = "scenario-proof-lint.ts";
const dir = (name: string) => caseDir("scenario-proof", name);
const feature =
  "apps/docs/content/specs/features/001-alpha/001-scenarios.feature";

const seams = (name: string) => ({
  env: {
    LINT_PROOF_BASE_DEBT_FILE: resolve(dir(name), "base-debt.txt"),
    LINT_PROOF_BASE_ROOT: existsSync(resolve(dir(name), "base"))
      ? resolve(dir(name), "base")
      : dir(name),
    LINT_GH_FIXTURE_DIR: ghDir("scenario-proof", name),
  },
});

describe("scenario-proof-lint", () => {
  it("green: bound, every proof level, Draft pending and listed debt → exit 0", () => {
    const { code, stdout, stderr } = runGuard(
      GUARD,
      dir("green"),
      seams("green"),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("PASS");
    // The summary leads with the journey number.
    expect(stdout).toContain(
      "[scenario-proof] journeys bound 2/2; rules proven 7/7; unclassified bound 2, unbound 4; pending 2",
    );
  });

  it("report: one row per spec plus a totals row; the classes and pending sum to the total", () => {
    const { code, stdout } = runGuard(GUARD, dir("green"), {
      ...seams("green"),
      extraArgs: ["--report"],
    });
    expect(code).toBe(0);
    expect(stdout).toContain(
      "| spec | total | journeys bound | journeys total | rules proven | rules total | unclassified bound | unclassified unbound | pending |",
    );
    expect(stdout).toContain("| 001 | 13 | 2 | 2 | 5 | 5 | 2 | 4 | 0 |");
    expect(stdout).toContain("| 002 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |");
    expect(stdout).toContain("| 003 | 2 | 0 | 0 | 2 | 2 | 0 | 0 | 0 |");
    expect(stdout).toContain("| total | 17 | 2 | 2 | 7 | 7 | 2 | 4 | 2 |");
  });

  it("red: journey proof — a proof tag, steps only under the portal tier, a quarantine, both class tags → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-journey"),
      seams("red-journey"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      `"journey with proof" -> @proof:unit on a @journey: a journey is proven only by binding its steps on the real stack`,
    );
    expect(stderr).toContain(
      "001 | portal-only journey -> unproven scenario missing from",
    );
    expect(stderr).toContain(
      "bind it in one real-stack config (packages/e2e, apps/admin) that runs its file, " +
        "selects it by its tags and matches every step, or list it with an OPEN Issue",
    );
    expect(stderr).toContain(
      "001 | quarantined journey -> unproven scenario missing from",
    );
    expect(stderr).toContain(
      `"both classes" -> carries both @journey and @rule; a scenario is one or the other`,
    );
    expect(stderr).toContain(
      `"unclassified with proof" -> @proof:unit on an unclassified scenario of a user-facing spec; classify it first (@journey or @rule)`,
    );
    expect(stderr).toContain(
      `"backend journey" -> @journey in a backend-only spec; every scenario there is a rule`,
    );
    // A rule bound only under the portal tier is still proven, a journey
    // bound on the staging tier is proven.
    expect(stderr).not.toContain("001 | portal rule");
    expect(stderr).not.toContain("001 | staging journey");
  });

  it("red: a quarantine on one Examples block of a journey outline → the journey is unproven", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-journey"),
      seams("red-journey"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | examples-quarantined journey -> unproven scenario missing from",
    );
  });

  it("red: a new unclassified scenario in a user-facing spec, Draft included → exit 1; legacy ones pass", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-journey"),
      seams("red-journey"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      `"new unclassified" -> new scenario (absent at the merge base) has no class; tag it @journey or @rule`,
    );
    // A whole new Draft spec file, and a new scenario in a Draft spec that
    // existed at the merge base: a class is born with the scenario.
    expect(stderr).toContain(
      `"draft newcomer" -> new scenario (absent at the merge base) has no class`,
    );
    expect(stderr).toContain(
      `"new draft unclassified" -> new scenario (absent at the merge base) has no class`,
    );
    expect(stderr).not.toContain(`"legacy unclassified" -> new scenario`);
    expect(stderr).not.toContain(`"old draft scenario" -> new scenario`);
    expect(stderr).not.toContain(`"new tagged rule" -> new scenario`);
    // Draft scenarios stay pending for proof: never listed as missing debt.
    expect(stderr).not.toContain("004 | draft newcomer -> unproven");
    expect(stderr).not.toContain("005 | new draft unclassified -> unproven");
  });

  it("red: binding is per runner config — Background and own step split across tiers, a config not running the file → unproven", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-split-tier"),
      seams("red-split-tier"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | split journey -> unproven scenario missing from",
    );
    expect(stderr).toContain(
      "001 | split rule -> unproven scenario missing from",
    );
    expect(stderr).toContain(
      "001 | scoped journey -> unproven scenario missing from",
    );
    // One config binding every step of a file it runs: proven.
    expect(stderr).not.toContain("001 | staging journey");
    expect(stderr).not.toContain("002 | scoped home journey");
  });

  it("red: a defineBddConfig caller whose steps cannot be read statically → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-split-tier"),
      seams("red-split-tier"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "apps/doctor/playwright.config.ts -> a defineBddConfig call whose steps cannot be read statically",
    );
    // A same-file const, a shorthand property and a ternary of literals are read.
    expect(stderr).not.toContain("packages/e2e/playwright.config.ts ->");
    expect(stderr).not.toContain("packages/e2e/scoped.config.ts ->");
    expect(stderr).not.toContain("apps/admin/playwright.config.ts ->");
  });

  it("red: a config binds only what its tag filter selects — a journey whose steps all match but no config's tags select it → unproven", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-tag-filter"),
      seams("red-tag-filter"),
    );
    expect(code).toBe(1);
    // @host:admin: the storefront calls exclude it, the wave config wants @wave-x.
    expect(stderr).toContain(
      "001 | excluded journey -> unproven scenario missing from",
    );
    // `process.env` reads as `{}`, so the academy call excludes @default-auth-limits.
    expect(stderr).toContain(
      "003 | limits journey -> unproven scenario missing from",
    );
    // A literal filter, a Rule-level tag, an outline whose one selected
    // Examples block binds (the unselected one does not run).
    expect(stderr).not.toContain("001 | wave journey");
    expect(stderr).not.toContain("001 | rule-tagged journey");
    expect(stderr).not.toContain("001 | outline partly selected");
  });

  it("green forms: helper calls through a wrapper, a zero-argument helper, a template literal of a wrapper parameter → resolved", () => {
    const { stderr } = runGuard(
      GUARD,
      dir("red-tag-filter"),
      seams("red-tag-filter"),
    );
    expect(stderr).not.toContain("002 | storefront journey");
    expect(stderr).not.toContain("002 | sign-in journey");
    expect(stderr).not.toContain("004 | doctor journey");
    expect(stderr).not.toContain("004 | doctor-only step journey");
    expect(stderr).not.toContain("packages/e2e/playwright.config.ts");
    expect(stderr).not.toContain("packages/e2e/feed.config.ts");
    expect(stderr).not.toContain("packages/e2e/wave.config.ts");
  });

  it("red: a defineBddConfig call whose tags cannot be resolved → exit 1, naming the file and the expression", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-tag-filter"),
      seams("red-tag-filter"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "apps/admin/playwright.config.ts (call 1) -> a defineBddConfig call whose tags cannot be read statically (tags: process.env.ADMIN_TAGS)",
    );
    // A helper outside the allowlist is never executed.
    expect(stderr).toContain(
      "apps/admin/playwright.config.ts (call 2) -> a defineBddConfig call whose tags cannot be read statically (tags: otherTags())",
    );
  });

  it("red: a spec moving to Shipped with an unproven journey blocks, its debt line already at the merge base → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-shipped-flip"),
      seams("red-shipped-flip"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | flipped journey debt -> the spec moves to Shipped (In dev at the merge base) with this @journey unproven",
    );
    expect(stderr).toContain(
      "003 | born shipped journey debt -> the spec moves to Shipped (absent at the merge base) with this @journey unproven",
    );
    expect(stderr).toContain(
      "a spec does not move to Shipped while one of its journeys is unproven — bind it in " +
        "one real-stack config that runs its file, selects it by its tags and matches every step",
    );
    // A rule, a bound journey, a legacy Shipped spec and a flip with every
    // journey bound pass.
    expect(stderr).not.toContain("001 | flipped rule debt");
    expect(stderr).not.toContain("001 | flipped bound journey");
    expect(stderr).not.toContain("002 | legacy shipped journey debt");
    expect(stderr).not.toContain("004 | ready journey");
  });

  it("red: a new journey debt line under a Shipped spec blocks even with an OPEN Issue → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-shipped"),
      seams("red-shipped"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | shipped journey debt -> new debt entry for a @journey of a Shipped spec",
    );
    // A rule under a Shipped spec and a journey under an In-dev spec keep the
    // OPEN-Issue rule; a journey line already at the merge base is baseline.
    expect(stderr).not.toContain("001 | shipped rule debt");
    expect(stderr).not.toContain("001 | baseline journey debt");
    expect(stderr).not.toContain("003 | in-dev journey debt");
  });

  it("red: an unproven scenario missing from the debt list → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-unlisted"),
      seams("red-unlisted"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain("001 | forgotten scenario");
    expect(stderr).toContain("unproven scenario missing from");
    expect(stderr).not.toContain("001 | listed scenario");
  });

  it("red: a debt entry whose scenario is bound or gone is stale → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-stale"),
      seams("red-stale"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | now bound -> stale debt entry: the scenario is bound",
    );
    expect(stderr).toContain(
      "001 | vanished scenario -> stale debt entry: no such scenario",
    );
  });

  it("red: a new debt entry without an Issue, a CLOSED, missing or PR number → exit 1", () => {
    const { code, stdout, stderr } = runGuard(GUARD, dir("red-new-entry"), {
      env: { ...seams("red-new-entry").env, CI: "" },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | untracked new debt -> new debt entry (absent at the merge base) names no #<issue>",
    );
    expect(stderr).toContain(
      "001 | closed issue debt -> new debt entry tracks Issue #9001, which is CLOSED",
    );
    expect(stderr).toContain(
      "001 | missing issue debt -> new debt entry names #9002, which is no Issue in this repository",
    );
    expect(stderr).toContain(
      "001 | pull request debt -> new debt entry names #9003, which is a pull request, not an Issue",
    );
    expect(stderr).not.toContain("001 | baseline debt");
    // Outside CI an unavailable lookup warns instead of blocking.
    expect(stderr).not.toContain("001 | unreachable lookup debt");
    expect(stdout).toContain(
      "WARN 001 | unreachable lookup debt -> could not look up #9004",
    );
  });

  it("red: under CI an Issue lookup that cannot run blocks → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("red-new-entry"), {
      env: { ...seams("red-new-entry").env, CI: "true" },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | unreachable lookup debt -> could not look up #9004",
    );
    expect(stderr).toContain("CI is set");
  });

  // No base-debt seam and a base ref that does not exist: `git merge-base`
  // fails, so the new-entry check cannot run.
  const noMergeBase = (ci: string) => ({
    env: {
      ...seams("green").env,
      LINT_PROOF_BASE_DEBT_FILE: "",
      LINT_DIFF_BASE: "refs/heads/scenario-proof-no-such-base",
      CI: ci,
    },
  });

  it("red: under CI an unavailable merge base blocks → exit 1", () => {
    const { code, stderr } = runGuard(GUARD, dir("green"), noMergeBase("true"));
    expect(code).toBe(1);
    expect(stderr).toContain("the merge base was unavailable");
    expect(stderr).toContain("CI is set: BLOCK");
  });

  it("green: outside CI an unavailable merge base warns → exit 0", () => {
    const { code, stdout, stderr } = runGuard(
      GUARD,
      dir("green"),
      noMergeBase(""),
    );
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("WARN the merge base was unavailable");
  });

  it("red: an outline with one unbound Examples row, a scenario with only Background steps → unproven", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-bound-rules"),
      seams("red-bound-rules"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      "001 | a later row unbound -> unproven scenario missing from",
    );
    expect(stderr).toContain(
      "001 | background only -> unproven scenario missing from",
    );
    expect(stderr).not.toContain("001 | every row bound");
  });

  it("red: unknown level, no EARS tag and every unverifiable claim → exit 1", () => {
    const { code, stderr } = runGuard(
      GUARD,
      dir("red-proof-claims"),
      seams("red-proof-claims"),
    );
    expect(code).toBe(1);
    expect(stderr).toContain(
      `${feature}:5 "unknown level" -> @proof:browser names an unknown level (unit, api, app-e2e)`,
    );
    expect(stderr).toContain(
      `"proof without ears" -> @proof:unit on a scenario with no @EARS-N tag`,
    );
    // The only test is feature-agnostic.
    expect(stderr).toContain(
      `"agnostic only" -> @proof:unit claims EARS-2, but no 001-scoped test at level unit cites it`,
    );
    // The only test is at another level.
    expect(stderr).toContain(
      `"wrong level" -> @proof:api claims EARS-3, but no 001-scoped test at level api cites it`,
    );
    // The only test is another spec's same-numbered id.
    expect(stderr).toContain(
      `"other spec" -> @proof:unit claims EARS-4, but no 001-scoped test at level unit cites it`,
    );
    // In a file citing two specs a bare id belongs to neither; another spec's
    // explicitly prefixed id never proves this spec's.
    expect(stderr).toContain(
      `"two-spec file" -> @proof:unit claims EARS-6, but no 001-scoped test at level unit cites it`,
    );
    // packages/e2e is the binding harness, not a proof level.
    expect(stderr).toContain(
      `"harness only" -> @proof:unit claims EARS-5, but no 001-scoped test at level unit cites it`,
    );
  });

  it("--write-debt generates the list the guard then accepts", () => {
    const work = mkdtempSync(join(tmpdir(), "scenario-proof-"));
    try {
      cpSync(dir("red-unlisted"), work, { recursive: true });
      const env = {
        env: {
          LINT_PROOF_BASE_DEBT_FILE: join(work, "base-debt.txt"),
          LINT_PROOF_BASE_ROOT: work,
        },
      };
      const written = runGuard(GUARD, work, {
        ...env,
        extraArgs: ["--write-debt"],
      });
      expect(written.code).toBe(0);
      const list = readFileSync(
        join(work, "packages", "e2e", "scenario-proof-debt.txt"),
        "utf8",
      );
      expect(list).toContain(
        "001 | forgotten scenario\n001 | listed scenario\n",
      );
      const checked = runGuard(GUARD, work, env);
      expect(checked.stderr).toBe("");
      expect(checked.code).toBe(0);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("--write-debt --issues gives a line absent at the merge base its spec's Issue; baseline lines and a line's own Issue stay", () => {
    const work = mkdtempSync(join(tmpdir(), "scenario-proof-"));
    try {
      cpSync(dir("red-unlisted"), work, { recursive: true });
      const debt = join(work, "packages", "e2e", "scenario-proof-debt.txt");
      const baseDebtFile = join(work, "base-debt.txt");
      writeFileSync(baseDebtFile, "001 | listed scenario\n");
      writeFileSync(debt, "001 | listed scenario\n");
      const env = {
        LINT_PROOF_BASE_ROOT: work,
        LINT_PROOF_BASE_DEBT_FILE: baseDebtFile,
      };
      const written = runGuard(GUARD, work, {
        env,
        extraArgs: ["--write-debt", "--issues", "001:9100,002:9200"],
      });
      expect(written.code).toBe(0);
      expect(readFileSync(debt, "utf8")).toContain(
        "001 | forgotten scenario | #9100\n001 | listed scenario\n",
      );
      // A line's own Issue wins over the spec's.
      writeFileSync(debt, "001 | forgotten scenario | #77\n");
      runGuard(GUARD, work, {
        env,
        extraArgs: ["--write-debt", "--issues", "001:9100"],
      });
      expect(readFileSync(debt, "utf8")).toContain(
        "001 | forgotten scenario | #77\n",
      );
      const bad = runGuard(GUARD, work, {
        env,
        extraArgs: ["--write-debt", "--issues", "1:x"],
      });
      expect(bad.code).toBe(1);
      expect(bad.stderr).toContain("--issues");
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
