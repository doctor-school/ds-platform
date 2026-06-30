import { describe, expect, it } from "vitest";

import {
  GUARDS,
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
