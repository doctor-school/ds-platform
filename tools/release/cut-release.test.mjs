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
  parseGhApiResponse,
  workflowErrorLine,
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

/** A `gh api -i` stdout: status line, headers, blank line, body. */
function httpResponse(status, text, headers, body) {
  const head = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\r\n");
  return `HTTP/2.0 ${status} ${text}\r\n${head}\r\n\r\n${JSON.stringify(body)}`;
}

const NOTES_ENDPOINT = "repos/{owner}/{repo}/releases/generate-notes";
const CREATE_ENDPOINT = "repos/{owner}/{repo}/releases";

/** The `gh api` call to `endpoint` among the recorded calls. */
function apiCall(calls, endpoint) {
  return calls.find((c) => c[0] === "gh" && c.includes(endpoint));
}

/**
 * The value of a request field of a recorded `gh api` call — read from the JSON
 * request body the call sends on stdin (`--input -`), never from the argv.
 */
function field(call, name) {
  assert.ok(call.includes("--input") && call.includes("-"), "request body goes on stdin");
  assert.equal(
    call.some((a) => a === "-f" || a === "-F"),
    false,
    "no request field on the argv",
  );
  return JSON.parse(call.input)[name];
}

/**
 * A fake `run` for cutDeployRelease. `ancestorsOf[target]` lists the tag SHAs
 * that are ancestors of `target`; every gh call is recorded and answers with
 * `create` (the release create) or a generated-notes body.
 */
function makeRun({ tags, ancestors, logSubjects = [], calls, create, tagList }) {
  return (cmd, args, opts) => {
    calls.push(Object.assign([cmd, ...args], { input: opts?.input }));
    if (cmd === "git" && args[0] === "fetch") return { status: 0, stdout: "" };
    if (cmd === "git" && args[0] === "tag")
      return tagList ?? { status: 0, stdout: tags.join("\n") };
    if (cmd === "git" && args[0] === "rev-list")
      return { status: 0, stdout: SHA[args[3]] ?? "" };
    if (cmd === "git" && args[0] === "merge-base")
      return { status: ancestors.includes(args[2]) ? 0 : 1, stdout: "" };
    if (cmd === "git" && args[0] === "log")
      return { status: 0, stdout: logSubjects.join("\n") };
    if (cmd === "gh" && args.includes(NOTES_ENDPOINT))
      return {
        status: 0,
        stdout: httpResponse("200", "OK", { "X-GitHub-Request-Id": "N:1" }, {
          name: "generated",
          body: "## What's Changed\n* feat (#1)",
        }),
      };
    if (cmd === "gh" && args.includes(CREATE_ENDPOINT))
      return (
        create ?? {
          status: 0,
          stdout: httpResponse("201", "Created", { "X-GitHub-Request-Id": "C:1" }, {
            id: 1,
          }),
        }
      );
    return { status: 1, stdout: "", stderr: `unexpected ${cmd}` };
  };
}

/** A report sink that keeps the annotation lines and step-summary blocks. */
function makeReport() {
  const sink = { errors: [], summaries: [] };
  sink.report = {
    error: (line) => sink.errors.push(line),
    summary: (md) => sink.summaries.push(md),
  };
  return sink;
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
  const notes = apiCall(calls, NOTES_ENDPOINT);
  assert.ok(notes, "auto-notes are still generated");
  assert.equal(field(notes, "tag_name"), "release-2026.09.05-1");
  assert.equal(field(notes, "target_commitish"), target);
  assert.equal(field(notes, "previous_tag_name"), "release-2026.08.25-2");
  const gh = apiCall(calls, CREATE_ENDPOINT);
  assert.deepEqual(gh.slice(0, 5), ["gh", "api", "-i", "--method", "POST"]);
  assert.equal(field(gh, "tag_name"), "release-2026.09.05-1");
  assert.equal(field(gh, "target_commitish"), target);
  assert.match(field(gh, "name"), /— Hotfix$/);
  assert.match(field(gh, "body"), /Cherry-picked #1878[\s\S]*## What's Changed/);
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
  const notes = apiCall(calls, NOTES_ENDPOINT);
  assert.equal(field(notes, "previous_tag_name"), "release-2026.08.25-2");
  const gh = apiCall(calls, CREATE_ENDPOINT);
  assert.equal(
    field(gh, "body"),
    "## What's Changed\n* feat (#1)",
    "a main cut carries no hotfix notes",
  );
  assert.equal(field(gh, "name"), "release-2026.09.05-2");
});

test("EARS-7.4: a first release (no base tag) lets GitHub generate the notes in the create call", () => {
  const calls = [];
  const target = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";
  const res = cutDeployRelease({
    targetSha: target,
    now: new Date(Date.UTC(2026, 8, 5)),
    run: makeRun({ tags: [], ancestors: [], calls }),
  });
  assert.equal(res.cut, true, res.reason);
  assert.equal(apiCall(calls, NOTES_ENDPOINT), undefined);
  const gh = apiCall(calls, CREATE_ENDPOINT);
  assert.equal(field(gh, "generate_release_notes"), true);
  assert.equal(field(gh, "previous_tag_name"), undefined);
});

test("EARS-7.5: a large wave's notes travel on stdin, so the argv stays under the Windows command-line limit", () => {
  const calls = [];
  const bigNotes = `## What's Changed\n${"* feat: a long line of release notes (#1)\n".repeat(1500)}`;
  assert.ok(bigNotes.length > 32768, "the fixture exceeds the 32K command line");
  const base = makeRun({
    tags: ALL_TAGS,
    ancestors: [SHA["release-2026.08.25-2"]],
    calls,
  });
  const res = cutDeployRelease({
    targetSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
    now: new Date(Date.UTC(2026, 8, 5)),
    run: (cmd, args, opts) =>
      cmd === "gh" && args.includes(NOTES_ENDPOINT)
        ? (base(cmd, args, opts),
          {
            status: 0,
            stdout: httpResponse("200", "OK", {}, { name: "n", body: bigNotes }),
          })
        : base(cmd, args, opts),
  });
  assert.equal(res.cut, true, res.reason);
  const gh = apiCall(calls, CREATE_ENDPOINT);
  assert.ok(gh.join(" ").length < 1024, "the argv carries no notes");
  assert.equal(field(gh, "body"), bigNotes);
});

// ── a failed cut is visible and explainable (#3656) ─────────────────────────

test("EARS-8: parseGhApiResponse reads the status, headers and JSON message of `gh api -i`", () => {
  const parsed = parseGhApiResponse(
    httpResponse(
      "403",
      "Forbidden",
      {
        "X-GitHub-Request-Id": "AB12:3456:7890",
        "X-Accepted-GitHub-Permissions": "contents=write",
        "X-OAuth-Scopes": "",
      },
      { message: "Resource not accessible by integration" },
    ),
  );
  assert.equal(parsed.status, 403);
  assert.equal(parsed.headers["x-github-request-id"], "AB12:3456:7890");
  assert.equal(parsed.headers["x-accepted-github-permissions"], "contents=write");
  assert.equal(parsed.message, "Resource not accessible by integration");
  assert.equal(parseGhApiResponse("").status, null);
});

test("EARS-8.1: a refused create reports the status, request id and accepted permissions, and never fails the deploy", () => {
  const calls = [];
  const sink = makeReport();
  const target = "23aa1a2609bf23aa1a2609bf23aa1a2609bf23aa";
  const res = cutDeployRelease({
    targetSha: target,
    now: new Date(Date.UTC(2026, 8, 5)),
    report: sink.report,
    run: makeRun({
      tags: ALL_TAGS,
      ancestors: [SHA["release-2026.08.25-1"], SHA["release-2026.08.25-2"]],
      calls,
      create: {
        status: 1,
        stdout: httpResponse(
          "403",
          "Forbidden",
          {
            "X-GitHub-Request-Id": "AB12:3456:7890",
            "X-Accepted-GitHub-Permissions": "contents=write",
          },
          { message: "Resource not accessible by integration" },
        ),
        stderr: "gh: Resource not accessible by integration (HTTP 403)",
      },
    }),
  });
  assert.equal(res.cut, false);
  assert.equal(res.failed, true);
  assert.equal(res.tag, undefined, "a failed cut names no tag");
  assert.deepEqual(res.diagnostics, {
    endpoint: CREATE_ENDPOINT,
    status: 403,
    message: "Resource not accessible by integration",
    requestId: "AB12:3456:7890",
    acceptedPermissions: "contents=write",
    oauthScopes: null,
  });
  assert.equal(sink.errors.length, 1);
  const [line] = sink.errors;
  assert.match(line, /^::error title=Release not cut::/);
  assert.match(line, /release-2026\.09\.05-2/);
  assert.match(line, /23aa1a2609bf/);
  assert.match(line, /HTTP 403/);
  assert.match(line, /AB12:3456:7890/);
  assert.doesNotMatch(line, /[\r\n]/, "one annotation line");
  assert.equal(sink.summaries.length, 1);
  const [md] = sink.summaries;
  assert.match(md, /23aa1a2609bf/);
  assert.match(md, /untagged/);
  assert.match(md, /#3656/);
  assert.match(md, /AB12:3456:7890/);
});

test("EARS-8.2: a refused generate-notes call is reported the same way", () => {
  const calls = [];
  const sink = makeReport();
  const run = makeRun({
    tags: ALL_TAGS,
    ancestors: [SHA["release-2026.08.25-2"]],
    calls,
  });
  const res = cutDeployRelease({
    targetSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
    now: new Date(Date.UTC(2026, 8, 5)),
    report: sink.report,
    run: (cmd, args) =>
      cmd === "gh" && args.includes(NOTES_ENDPOINT)
        ? {
            status: 1,
            stdout: httpResponse("403", "Forbidden", { "X-GitHub-Request-Id": "N:9" }, {
              message: "nope",
            }),
            stderr: "gh: nope (HTTP 403)",
          }
        : run(cmd, args),
  });
  assert.equal(res.failed, true);
  assert.equal(res.diagnostics.endpoint, NOTES_ENDPOINT);
  assert.equal(res.diagnostics.requestId, "N:9");
  assert.equal(apiCall(calls, CREATE_ENDPOINT), undefined, "no create without notes");
  assert.equal(sink.errors.length, 1);
});

test("EARS-8.3: a failed `git tag -l` is reported too, the deploy still not failed", () => {
  const sink = makeReport();
  const res = cutDeployRelease({
    targetSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
    report: sink.report,
    run: makeRun({
      tags: [],
      ancestors: [],
      calls: [],
      tagList: { status: 128, stdout: "", stderr: "fatal: not a git repository" },
    }),
  });
  assert.equal(res.cut, false);
  assert.equal(res.failed, true);
  assert.match(sink.errors[0], /^::error title=Release not cut::.*not a git repository/);
  assert.equal(sink.summaries.length, 1);
});

test("EARS-8.4: an unexpected error is reported too", () => {
  const sink = makeReport();
  const res = cutDeployRelease({
    targetSha: "abcdef0123abcdef0123abcdef0123abcdef0123",
    report: sink.report,
    run: () => {
      throw new Error("spawn gh ENOENT");
    },
  });
  assert.equal(res.failed, true);
  assert.match(sink.errors[0], /spawn gh ENOENT/);
});

test("EARS-8.5: legitimate no-cut decisions stay quiet; a redeploy names the tag already at the SHA", () => {
  const sink = makeReport();
  const redeploy = cutDeployRelease({
    targetSha: SHA["release-2026.08.25-2"],
    report: sink.report,
    run: makeRun({ tags: ALL_TAGS, ancestors: [SHA["release-2026.08.25-1"]], calls: [] }),
  });
  assert.equal(redeploy.cut, false);
  assert.equal(redeploy.tag, "release-2026.08.25-2");
  const behind = cutDeployRelease({
    targetSha: "0ff10ff10ff10ff10ff10ff10ff10ff10ff10ff1",
    report: sink.report,
    run: makeRun({ tags: ALL_TAGS, ancestors: [], calls: [] }),
  });
  assert.equal(behind.cut, false);
  assert.equal(behind.failed, undefined);
  assert.deepEqual(sink.errors, []);
  assert.deepEqual(sink.summaries, []);
});

test("EARS-8.6: the annotation escapes the workflow-command metacharacters", () => {
  assert.equal(
    workflowErrorLine("Release not cut", "50% done\nline two"),
    "::error title=Release not cut::50%25 done%0Aline two",
  );
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
