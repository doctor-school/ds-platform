import { describe, expect, it } from "vitest";

import {
  evaluateContextStaleness,
  parseChangelogHead,
  parseSection1ReconciledDate,
  renderContextFreshness,
  type ContextFreshnessProbe,
} from "../../context-freshness";

/**
 * Unit cover for the SessionStart release-notes reconciliation seam (#927 core).
 * Mirrors `project-reality.spec.ts` / `main-sync.spec.ts`: the AGENTS.md read +
 * `gh`/`git` I/O (`probeContextFreshness`) is a FS/subprocess seam; the pure
 * pieces — the §1-marker parser, the CHANGELOG-head parser, the staleness
 * classifier, and the formatter — are exercised here with FABRICATED inputs, no
 * FS/network. The classifier is the PRIMARY testable target of the Issue: a §1
 * reconciled date OLDER than the latest release/changeset date must flag; a
 * NEWER (or equal) one must not; a missing date must never false-flag.
 *
 * Root cause it guards (#927): session 5fbaaa9c groomed the backlog three times
 * on a prod model three releases stale, because `AGENTS.md §1` had silently
 * fallen behind the shipped releases. Prose ("never say no production") did not
 * prevent it — a DETERMINISTIC start-of-session comparison does.
 */

const freshProbe = (
  over: Partial<ContextFreshnessProbe> = {},
): ContextFreshnessProbe => ({
  section1Date: null,
  headTag: null,
  headDate: null,
  headScope: null,
  headSource: "none",
  ...over,
});

describe("context-freshness evaluateContextStaleness()", () => {
  it("flags STALE when the §1 date predates the latest release date", () => {
    const r = evaluateContextStaleness({
      section1Date: "2026-05-12",
      headDate: "2026-07-15",
      headTag: "release-2026.07.15-1",
    });
    expect(r.kind).toBe("stale");
    expect(r).toMatchObject({ tag: "release-2026.07.15-1" });
  });

  it("is FRESH when the §1 date is newer than the latest release date", () => {
    const r = evaluateContextStaleness({
      section1Date: "2026-07-16",
      headDate: "2026-07-15",
      headTag: "release-2026.07.15-1",
    });
    expect(r.kind).toBe("fresh");
  });

  it("is FRESH when §1 and the release fall on the same day (not a regression)", () => {
    const r = evaluateContextStaleness({
      section1Date: "2026-07-15",
      headDate: "2026-07-15",
      headTag: "release-2026.07.15-1",
    });
    expect(r.kind).toBe("fresh");
  });

  it("is INDETERMINATE (never a false flag) when a date is missing", () => {
    expect(
      evaluateContextStaleness({
        section1Date: null,
        headDate: "2026-07-15",
        headTag: "x",
      }).kind,
    ).toBe("indeterminate");
    expect(
      evaluateContextStaleness({
        section1Date: "2026-07-15",
        headDate: null,
        headTag: null,
      }).kind,
    ).toBe("indeterminate");
  });

  it("is INDETERMINATE on an unparseable date rather than throwing", () => {
    expect(
      evaluateContextStaleness({
        section1Date: "not-a-date",
        headDate: "2026-07-15",
        headTag: "x",
      }).kind,
    ).toBe("indeterminate");
  });
});

describe("context-freshness parseSection1ReconciledDate()", () => {
  const md = [
    "# Agent Instructions",
    "",
    "## 1. What is DS Platform",
    "",
    "<!-- prod-reality-reconciled: 2026-07-15 -->",
    "",
    "DS Platform is the medical-education platform.",
    "",
    "## 2. Repository conventions",
    "",
    "<!-- prod-reality-reconciled: 1999-01-01 -->",
  ].join("\n");

  it("extracts the ISO date from the §1 marker", () => {
    expect(parseSection1ReconciledDate(md)).toBe("2026-07-15");
  });

  it("reads ONLY §1 — a marker in a later section does not win", () => {
    // The §2 marker (1999) must be ignored; §1's 2026 date is the answer.
    expect(parseSection1ReconciledDate(md)).toBe("2026-07-15");
  });

  it("returns null when §1 carries no marker", () => {
    expect(
      parseSection1ReconciledDate("## 1. What is DS Platform\n\nno marker here"),
    ).toBeNull();
  });
});

describe("context-freshness parseChangelogHead()", () => {
  const changelog = [
    "# @ds/api",
    "",
    "## 0.18.4",
    "",
    "### Patch Changes",
    "",
    "- [#921](https://github.com/x/y/pull/921) [`b9d81e6`](https://x/commit/b9d81e6) Thanks [@dev](https://x)! - Fix the verification email CTA dead-end so a cold open seeds the account.",
    "",
    "## 0.18.3",
    "",
    "- older entry",
  ].join("\n");

  it("reads the package name + head version", () => {
    const head = parseChangelogHead(changelog);
    expect(head?.version).toBe("@ds/api 0.18.4");
  });

  it("extracts a one-line human scope (markdown links stripped)", () => {
    const head = parseChangelogHead(changelog);
    expect(head?.scope).toContain("Fix the verification email CTA dead-end");
    expect(head?.scope).not.toContain("](");
  });

  it("returns null when there is no version heading", () => {
    expect(parseChangelogHead("# @ds/api\n\nno versions yet")).toBeNull();
  });
});

describe("context-freshness renderContextFreshness()", () => {
  it("emits the loud stale banner with the release tag when stale", () => {
    const lines = renderContextFreshness(
      freshProbe({
        section1Date: "2026-05-12",
        headTag: "release-2026.07.15-1",
        headDate: "2026-07-15",
        headSource: "release",
      }),
      { kind: "stale", tag: "release-2026.07.15-1" },
    );
    const joined = lines.join("\n");
    expect(joined).toContain(
      "CONTEXT MAY BE STALE — reconcile §1/prod-reality with release release-2026.07.15-1 before triage",
    );
  });

  it("prints a changeset-head fallback line (tag + date + scope) when no GitHub Release", () => {
    const lines = renderContextFreshness(
      freshProbe({
        section1Date: "2026-07-15",
        headTag: "@ds/api 0.18.4",
        headDate: "2026-07-15",
        headScope: "Fix the verification email CTA dead-end.",
        headSource: "changeset",
      }),
      { kind: "fresh" },
    );
    const joined = lines.join("\n");
    expect(joined).toContain("@ds/api 0.18.4");
    expect(joined).toContain("2026-07-15");
    expect(joined).toContain("Fix the verification email CTA dead-end");
    expect(joined).not.toContain("CONTEXT MAY BE STALE");
  });

  it("emits no stale banner when the classifier says fresh/indeterminate", () => {
    for (const kind of ["fresh", "indeterminate"] as const) {
      const lines = renderContextFreshness(
        freshProbe({ section1Date: "2026-07-15", headDate: "2026-07-15" }),
        { kind } as never,
      );
      expect(lines.join("\n")).not.toContain("CONTEXT MAY BE STALE");
    }
  });
});
