import { describe, expect, it } from "vitest";

import {
  deriveBranchPrefix,
  extractPathTokens,
  gatherState,
  renderBrief,
  slugify,
} from "../../gh/dispatch-brief.mjs";

/**
 * Unit cover for `tools/gh/dispatch-brief.mjs` (#915) — the dispatch-brief
 * scaffold. Only the pure half (slugify, branch-prefix derivation, path
 * tokenization, brief rendering) is tested directly; the `gh`/`git` side goes
 * through an injectable runner, so nothing here shells out (same harness pattern
 * as dispatch-brief-check.spec.ts — imports the pure exports, never fires
 * `main()`).
 */

/**
 * Fake injectable runner: canned Issue JSON for `gh issue view --json`, and a
 * scriptable `git` responder keyed on the leading arg so both the worktree diff
 * (`git -C … diff`) and the repo-root probe (`git rev-parse …`) can be driven.
 */
function fakeRunner({
  issues = {},
  diff = null,
  root = null,
}: {
  issues?: Record<number, { title?: string; body?: string; labels?: unknown[] }>;
  diff?: { status: number; stdout: string } | null;
  root?: { status: number; stdout: string } | null;
}) {
  const calls: string[][] = [];
  return {
    calls,
    gh(args: string[]) {
      calls.push(["gh", ...args]);
      const [, , n] = args; // "issue", "view", "<n>"
      const issue = issues[Number(n)];
      if (issue === undefined)
        return { status: 1, stdout: "", stderr: "GraphQL: not found (404)" };
      return { status: 0, stdout: JSON.stringify(issue), stderr: "" };
    },
    git(args: string[]) {
      calls.push(["git", ...args]);
      if (args[0] === "rev-parse") {
        if (root === null) return { status: 1, stdout: "", stderr: "not a git repo" };
        return { status: root.status, stdout: root.stdout, stderr: "" };
      }
      // `-C <wt> diff --name-only …`
      if (diff === null) return { status: 1, stdout: "", stderr: "no such ref" };
      return { status: diff.status, stdout: diff.stdout, stderr: "" };
    },
  };
}

describe("dispatch-brief slugify()", () => {
  it("lowercases and hyphenates, capping at ~6 words", () => {
    expect(slugify("tooling(agents): low-friction dispatch brief scaffold thing")).toBe(
      "tooling-agents-low-friction-dispatch-brief",
    );
  });

  it("trims leading/trailing separators", () => {
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
  });

  it("falls back to 'task' on an empty/symbol-only title", () => {
    expect(slugify("")).toBe("task");
    expect(slugify("!!! ???")).toBe("task");
  });
});

describe("dispatch-brief deriveBranchPrefix()", () => {
  it("takes a conventional-commit title prefix", () => {
    expect(deriveBranchPrefix("tooling(agents): add scaffold")).toBe("tooling");
    expect(deriveBranchPrefix("fix: crash on boot")).toBe("fix");
  });

  it("ignores a non-canonical title prefix and falls through to labels", () => {
    expect(deriveBranchPrefix("wip: something", ["bug"])).toBe("fix");
  });

  it("maps labels onto branch prefixes (feature → feat)", () => {
    expect(deriveBranchPrefix("no prefix here", ["feature"])).toBe("feat");
    expect(deriveBranchPrefix("no prefix here", ["docs"])).toBe("docs");
  });

  it("defaults to chore with neither a title prefix nor a mapped label", () => {
    expect(deriveBranchPrefix("just a title", ["needs-triage"])).toBe("chore");
    expect(deriveBranchPrefix("just a title")).toBe("chore");
  });
});

describe("dispatch-brief extractPathTokens()", () => {
  it("keeps an extension-bearing token even with a single slash", () => {
    expect(extractPathTokens("see tools/x.mjs please")).toEqual(["tools/x.mjs"]);
  });

  it("keeps a ≥2-slash directory token with no extension", () => {
    expect(extractPathTokens("under tools/lint/guard-tests here")).toEqual([
      "tools/lint/guard-tests",
    ]);
  });

  it("rejects single-slash prose like `and/or` and a bare `tools/`", () => {
    expect(extractPathTokens("do this and/or that in tools/ dir")).toEqual([]);
  });

  it("strips surrounding punctuation and dedupes", () => {
    expect(
      extractPathTokens("edit `tools/gh/dispatch-brief.mjs`. again tools/gh/dispatch-brief.mjs"),
    ).toEqual(["tools/gh/dispatch-brief.mjs"]);
  });
});

describe("dispatch-brief renderBrief() degrade paths", () => {
  it("(a) missing title → <fill …> placeholders + <fill-slug>", () => {
    const brief = renderBrief({ issueNumber: 915, title: null });
    expect(brief).toContain("<fill: Issue #915 title>");
    expect(brief).toContain("chore/915-<fill-slug>");
  });

  it("(b) repoRoot null → isolation lines carry <repo-root>/, never a machine path", () => {
    const brief = renderBrief({ issueNumber: 915, title: "tooling: x", repoRoot: null });
    expect(brief).toContain("<repo-root>/.claude/worktrees/915");
    // Regression guard for BLOCKER 1: no baked machine-specific drive literal.
    expect(brief).not.toContain("C:/Users");
  });

  it("(c) repoRoot set → isolation lines carry that root", () => {
    const brief = renderBrief({
      issueNumber: 915,
      title: "tooling: x",
      repoRoot: "/home/dev/ds-platform",
    });
    expect(brief).toContain("/home/dev/ds-platform/.claude/worktrees/915");
    expect(brief).not.toContain("<repo-root>");
  });

  it("(d) worktreeChanged present → scope seeded from the worktree diff label", () => {
    const brief = renderBrief({
      issueNumber: 915,
      title: "tooling: x",
      seededFiles: ["tools/gh/from-issue.mjs"],
      worktreeChanged: ["tools/gh/changed.mjs"],
    });
    expect(brief).toContain("seeded from the worktree diff");
    expect(brief).toContain("tools/gh/changed.mjs");
    expect(brief).not.toContain("tools/gh/from-issue.mjs");
  });

  it("(d) no worktree diff → scope seeded from the Issue path-tokens label", () => {
    const brief = renderBrief({
      issueNumber: 915,
      title: "tooling: x",
      seededFiles: ["tools/gh/from-issue.mjs"],
      worktreeChanged: [],
    });
    expect(brief).toContain("seeded from the Issue body path-tokens");
    expect(brief).toContain("tools/gh/from-issue.mjs");
  });
});

describe("dispatch-brief gatherState() with an injected runner", () => {
  it("(e) seeds repoRoot from `git rev-parse --show-toplevel`", () => {
    const runner = fakeRunner({
      issues: { 915: { title: "tooling: x", body: "touch tools/gh/x.mjs", labels: [] } },
      root: { status: 0, stdout: "C:/Users/dev/ds-platform\n" },
    });
    const state = gatherState({ issueNumber: 915, runner, worktreeExists: false });
    expect(state.repoRoot).toBe("C:/Users/dev/ds-platform");
    expect(state.title).toBe("tooling: x");
    expect(state.seededFiles).toEqual(["tools/gh/x.mjs"]);
  });

  it("(e) repoRoot is null when `git rev-parse` fails", () => {
    const runner = fakeRunner({
      issues: { 915: { title: "tooling: x", body: "", labels: [] } },
      root: null,
    });
    const state = gatherState({ issueNumber: 915, runner, worktreeExists: false });
    expect(state.repoRoot).toBeNull();
  });

  it("degrades every field on a gh failure without throwing", () => {
    const runner = fakeRunner({ root: { status: 0, stdout: "/repo\n" } });
    const state = gatherState({ issueNumber: 404, runner, worktreeExists: false });
    expect(state.title).toBeNull();
    expect(state.labels).toEqual([]);
    expect(state.seededFiles).toEqual([]);
  });

  it("seeds worktreeChanged from the diff when the worktree exists", () => {
    const runner = fakeRunner({
      issues: { 915: { title: "tooling: x", body: "", labels: [] } },
      diff: { status: 0, stdout: "tools/gh/a.mjs\ntools/gh/b.mjs\n" },
      root: { status: 0, stdout: "/repo\n" },
    });
    const state = gatherState({ issueNumber: 915, runner, worktreeExists: true });
    expect(state.worktreeChanged).toEqual(["tools/gh/a.mjs", "tools/gh/b.mjs"]);
  });

  it("gatherState → renderBrief carries the derived root, no machine literal on null", () => {
    const runner = fakeRunner({
      issues: { 915: { title: "tooling: x", body: "", labels: [] } },
      root: null,
    });
    const state = gatherState({ issueNumber: 915, runner, worktreeExists: false });
    const brief = renderBrief({ issueNumber: 915, title: state.title, repoRoot: state.repoRoot });
    expect(brief).not.toContain("C:/Users");
    expect(brief).toContain("<repo-root>/.claude/worktrees/915");
  });
});
