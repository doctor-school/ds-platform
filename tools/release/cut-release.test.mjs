// tools/release/cut-release.test.mjs — ancestry-aware release-cut seams (#1881).
// `node --test` (pnpm test:tools). The pre-#1881 pure seams stay covered by
// tools/lint/guard-tests/cut-release.spec.ts (vitest).

import test from "node:test";
import assert from "node:assert/strict";

import {
  sortReleaseTagsDesc,
  pickBaseReleaseTag,
  hotfixReleaseCopy,
  cutDeployRelease,
} from "./cut-release.mjs";

const TAGS = [
  "release-2026.08.25-1",
  "release-2026.08.25-2",
  "release-2026.09.05-1", // the hotfix release, cut OFF main
  "not-a-release",
];

// ── sortReleaseTagsDesc ─────────────────────────────────────────────────────

test("EARS-4: tags sort newest-first by (date, ordinal); noise is dropped", () => {
  assert.deepEqual(sortReleaseTagsDesc(TAGS), [
    "release-2026.09.05-1",
    "release-2026.08.25-2",
    "release-2026.08.25-1",
  ]);
  assert.deepEqual(sortReleaseTagsDesc(undefined), []);
});

test("EARS-4.1: a two-digit ordinal outranks a one-digit ordinal", () => {
  assert.deepEqual(
    sortReleaseTagsDesc(["release-2026.08.25-2", "release-2026.08.25-10"]),
    ["release-2026.08.25-10", "release-2026.08.25-2"],
  );
});

// ── pickBaseReleaseTag ──────────────────────────────────────────────────────

test("EARS-5: a hotfix deploy bases on the DEPLOYED release tag", () => {
  // The hotfix branch is cut from release-2026.08.25-2, so both -25 tags are
  // ancestors of it; the newest ancestor is the deployed one.
  const ancestors = new Set(["release-2026.08.25-1", "release-2026.08.25-2"]);
  assert.equal(
    pickBaseReleaseTag(TAGS, (t) => ancestors.has(t)),
    "release-2026.08.25-2",
  );
});

test("EARS-5.1: a main deploy AFTER a hotfix release bases on the last MAIN-ancestor tag, not the newest tag", () => {
  // release-2026.09.05-1 lives off main (the hotfix), so it is not an ancestor
  // of the next origin/main deploy — the pre-#1881 newest-tag rule would have
  // skipped the cut entirely.
  const ancestors = new Set(["release-2026.08.25-1", "release-2026.08.25-2"]);
  assert.equal(
    pickBaseReleaseTag(TAGS, (t) => ancestors.has(t)),
    "release-2026.08.25-2",
  );
});

test("EARS-5.2: no ancestor among the tags yields null", () => {
  assert.equal(
    pickBaseReleaseTag(TAGS, () => false),
    null,
  );
  assert.equal(pickBaseReleaseTag([], () => true), null);
});

// ── hotfixReleaseCopy ───────────────────────────────────────────────────────

test("EARS-6: hotfix copy marks the title and names the cherry-picked PRs", () => {
  const copy = hotfixReleaseCopy({
    tag: "release-2026.09.05-1",
    baseTag: "release-2026.08.25-2",
    prNumbers: [1878],
  });
  assert.equal(copy.title, "release-2026.09.05-1 — Hotfix");
  assert.match(copy.notes, /Hotfix release/);
  assert.match(copy.notes, /release-2026\.08\.25-2/);
  assert.match(copy.notes, /Cherry-picked #1878/);
});

test("EARS-6.1: hotfix copy degrades gracefully with no PR-referencing commits", () => {
  const copy = hotfixReleaseCopy({ tag: "release-2026.09.05-1", baseTag: null });
  assert.match(copy.notes, /No PR-referencing commits/);
  assert.match(copy.notes, /no prior release/);
});

// ── cutDeployRelease (I/O seam with an injected runner) ─────────────────────

const SHA = {
  "release-2026.08.25-1": "aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1aaaaaaa1",
  "release-2026.08.25-2": "1455bb9c1455bb9c1455bb9c1455bb9c1455bb9c",
  "release-2026.09.05-1": "hotfix00hotfix00hotfix00hotfix00hotfix00".replace(
    /[^0-9a-f]/g,
    "0",
  ),
};

/**
 * A fake `run` for cutDeployRelease. `ancestorsOf[target]` lists the tag SHAs
 * that are ancestors of `target`; every gh call succeeds and is recorded.
 */
function makeRun({ tags, ancestors, logSubjects = [], calls }) {
  return (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "git" && args[0] === "fetch") return { status: 0, stdout: "" };
    if (cmd === "git" && args[0] === "tag")
      return { status: 0, stdout: tags.join("\n") };
    if (cmd === "git" && args[0] === "rev-list")
      return { status: 0, stdout: SHA[args[3]] ?? "" };
    if (cmd === "git" && args[0] === "merge-base")
      return { status: ancestors.includes(args[2]) ? 0 : 1, stdout: "" };
    if (cmd === "git" && args[0] === "log")
      return { status: 0, stdout: logSubjects.join("\n") };
    if (cmd === "gh") return { status: 0, stdout: "" };
    return { status: 1, stdout: "", stderr: `unexpected ${cmd}` };
  };
}

const ALL_TAGS = [
  "release-2026.08.25-1",
  "release-2026.08.25-2",
  "release-2026.09.05-1",
];

test("EARS-7: a hotfix cut bases on the deployed tag and marks the Release", () => {
  const calls = [];
  const target = "beef0001beef0001beef0001beef0001beef0001";
  const res = cutDeployRelease({
    targetSha: target,
    hotfix: true,
    now: new Date(Date.UTC(2026, 8, 5)),
    run: makeRun({
      tags: ["release-2026.08.25-1", "release-2026.08.25-2"],
      ancestors: [SHA["release-2026.08.25-1"], SHA["release-2026.08.25-2"]],
      logSubjects: ["fix(1877): interim Academy home header (#1878)"],
      calls,
    }),
  });
  assert.equal(res.cut, true);
  assert.equal(res.tag, "release-2026.09.05-1");
  const gh = calls.find((c) => c[0] === "gh");
  assert.deepEqual(
    gh.slice(0, 5),
    ["gh", "release", "create", "release-2026.09.05-1", "--generate-notes"],
    "auto-notes are still generated",
  );
  assert.equal(gh[gh.indexOf("--notes-start-tag") + 1], "release-2026.08.25-2");
  assert.match(gh[gh.indexOf("--title") + 1], /— Hotfix$/);
  assert.match(gh[gh.indexOf("--notes") + 1], /Cherry-picked #1878/);
});

test("EARS-7.1: a main deploy after a hotfix release still cuts, based on the last main-ancestor tag", () => {
  const calls = [];
  const target = "ma1nma1nma1nma1nma1nma1nma1nma1nma1nma1n".replace(
    /[^0-9a-f]/g,
    "0",
  );
  const res = cutDeployRelease({
    targetSha: target,
    now: new Date(Date.UTC(2026, 8, 5)),
    run: makeRun({
      tags: ALL_TAGS,
      // the 2026.09.05-1 hotfix tag is NOT an ancestor of origin/main
      ancestors: [SHA["release-2026.08.25-1"], SHA["release-2026.08.25-2"]],
      calls,
    }),
  });
  assert.equal(res.cut, true, res.reason);
  assert.equal(res.tag, "release-2026.09.05-2", "same-day ordinal continues");
  const gh = calls.find((c) => c[0] === "gh");
  assert.equal(gh[gh.indexOf("--notes-start-tag") + 1], "release-2026.08.25-2");
  assert.equal(gh.includes("--notes"), false, "a main cut carries no hotfix notes");
  assert.equal(gh[gh.indexOf("--title") + 1], "release-2026.09.05-2");
});

test("EARS-7.2: redeploying an already-released SHA cuts nothing", () => {
  const calls = [];
  const res = cutDeployRelease({
    targetSha: SHA["release-2026.08.25-2"],
    now: new Date(Date.UTC(2026, 8, 5)),
    run: makeRun({
      tags: ALL_TAGS,
      ancestors: [SHA["release-2026.08.25-1"]],
      calls,
    }),
  });
  assert.equal(res.cut, false);
  assert.match(res.reason, /already released/);
  assert.equal(calls.some((c) => c[0] === "gh"), false);
});

test("EARS-7.3: a target with no ancestor release tag cuts nothing", () => {
  const calls = [];
  const res = cutDeployRelease({
    targetSha: "0ff10ff10ff10ff10ff10ff10ff10ff10ff10ff1",
    now: new Date(Date.UTC(2026, 8, 5)),
    run: makeRun({ tags: ALL_TAGS, ancestors: [], calls }),
  });
  assert.equal(res.cut, false);
  assert.match(res.reason, /no release tag is an ancestor/);
  assert.equal(calls.some((c) => c[0] === "gh"), false);
});
