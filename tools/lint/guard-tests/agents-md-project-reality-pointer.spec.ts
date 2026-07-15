import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * D5 positive-invariant guard (#927, W1). AGENTS.md §1 must no longer ENUMERATE
 * the live deploy scope/phase (that prose rots between owner corrections — the
 * #927 root cause); instead it must POINT at the derived `## Project reality`
 * bootstrap section + GitHub Releases/Deployments as the authoritative source.
 *
 * This asserts the POSITIVE invariant (the pointer sentence is present in §1) —
 * deliberately NOT a blocklist of stale phrasings (an open-ended set), and it
 * does NOT scan memory files (they legitimately narrate pre-pilot history, per
 * spec D5). Scoped to AGENTS.md §1 only.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const AGENTS_MD = resolve(REPO_ROOT, "AGENTS.md");

/** The `## 1. …` section body, sliced at the next top-level `## ` heading. */
function section1(md: string): string {
  const start = md.search(/^## 1\.[^\n]*$/m);
  if (start === -1) return "";
  const rest = md.slice(start);
  const nextIdx = rest.slice(1).search(/^## \d/m);
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx + 1);
}

describe("AGENTS.md §1 — derived-reality pointer invariant (D5)", () => {
  const s1 = section1(readFileSync(AGENTS_MD, "utf8"));

  it("§1 exists and is non-empty", () => {
    expect(s1.length).toBeGreaterThan(0);
  });

  it("points at the derived `## Project reality` bootstrap section", () => {
    expect(s1).toContain("## Project reality");
  });

  it("names GitHub Releases/Deployments as the authoritative deployed scope", () => {
    expect(s1).toMatch(/GitHub Releases\/Deployments/);
    expect(s1).toMatch(/authoritative deployed scope/i);
  });

  it("states the scope is never inferred from these docs", () => {
    expect(s1).toMatch(/never inferred from these docs/i);
  });

  it("keeps the stable 'never tell the owner there is no production' rule", () => {
    expect(s1).toMatch(/never tell the owner "there is no production"/i);
  });
});
