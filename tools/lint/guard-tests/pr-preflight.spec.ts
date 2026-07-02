import { describe, expect, it } from "vitest";

import {
  GUARDS,
  STATIC_GUARDS,
  hasStaticFlag,
  parsePrNumber,
  summarize,
} from "../pr-preflight.mjs";

/**
 * Unit cover for `tools/lint/pr-preflight.mjs`'s pure seams (#406). The impure
 * half (spawning each guard with `GITHUB_EVENT_NAME=pull_request PR_NUMBER=<N>`)
 * is exercised live against a real PR; only the guard roster, arg parsing, and
 * summary derivation are unit-tested here, on the established guard-test harness
 * (imports the pure exports, never fires `main()`).
 */
describe("pr-preflight GUARDS roster", () => {
  it("runs exactly the four PR-event-gated guards", () => {
    expect(GUARDS.map((g) => g.name)).toEqual([
      "registry-research",
      "spec-link",
      "prior-decisions",
      "spec-status-fresh",
    ]);
  });

  it("maps each guard to its tools/lint/*.ts entrypoint", () => {
    for (const g of GUARDS) {
      expect(g.file).toMatch(/^[a-z-]+-lint\.ts$/);
    }
  });
});

describe("pr-preflight STATIC_GUARDS roster (#462)", () => {
  it("maps each static guard to a tools/lint/*.ts entrypoint", () => {
    expect(STATIC_GUARDS.length).toBeGreaterThan(0);
    for (const g of STATIC_GUARDS) {
      expect(g.file).toMatch(/-lint\.ts$/);
    }
  });

  it("excludes the four PR-gated guards and the Nest-booting endpoint-authz", () => {
    const staticFiles = new Set(STATIC_GUARDS.map((g) => g.file));
    // the PR-event-gated family runs in the base sweep, never the static one.
    for (const g of GUARDS) expect(staticFiles.has(g.file)).toBe(false);
    // tdd-signal is also PR-event-gated; endpoint-authz boots a Nest context.
    expect(staticFiles.has("tdd-signal-lint.ts")).toBe(false);
    expect(staticFiles.has("endpoint-authz-lint.ts")).toBe(false);
  });

  it("has no duplicate entrypoints", () => {
    const files = STATIC_GUARDS.map((g) => g.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("pr-preflight hasStaticFlag()", () => {
  it("detects the --static flag anywhere in argv", () => {
    expect(hasStaticFlag(["--static"])).toBe(true);
    expect(hasStaticFlag(["406", "--static"])).toBe(true);
    expect(hasStaticFlag(["406"])).toBe(false);
    expect(hasStaticFlag([])).toBe(false);
  });
});

describe("pr-preflight parsePrNumber()", () => {
  it("reads the first positional arg as the PR number", () => {
    expect(parsePrNumber(["406"])).toBe("406");
  });

  it("ignores --flags before the positional", () => {
    expect(parsePrNumber(["--verbose", "406"])).toBe("406");
  });

  it("returns null for a missing or non-numeric arg", () => {
    expect(parsePrNumber([])).toBeNull();
    expect(parsePrNumber(["abc"])).toBeNull();
    expect(parsePrNumber(["#406"])).toBeNull();
  });
});

describe("pr-preflight summarize()", () => {
  it("is ok only when every guard exited zero", () => {
    expect(
      summarize([
        { name: "registry-research", status: 0 },
        { name: "spec-link", status: 0 },
      ]).ok,
    ).toBe(true);
    expect(
      summarize([
        { name: "registry-research", status: 1 },
        { name: "spec-link", status: 0 },
      ]).ok,
    ).toBe(false);
  });

  it("emits one PASS/FAIL line per guard, in order", () => {
    const { lines } = summarize([
      { name: "registry-research", status: 0 },
      { name: "spec-link", status: 1 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("PASS");
    expect(lines[0]).toContain("registry-research");
    expect(lines[1]).toContain("FAIL");
    expect(lines[1]).toContain("spec-link");
  });
});
