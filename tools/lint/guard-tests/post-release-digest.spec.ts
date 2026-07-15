import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Pure seams from the CI release-digest resolver (Issue #968). Importing them does
// NOT fire the script's `main()` — it is guarded behind an entry-point check, the
// same idiom as tools/deploy/release-notes.mjs / deployment-record.mjs. The script
// turns a `deployment_status: success` event into the `<prev>..<new>` range and
// delegates render+POST to release-notes.mjs; these are its own pure helpers.
import {
  buildReleaseNotesArgs,
  resolvePrevSha,
  shouldPost,
} from "../../ci/post-release-digest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "..", "..", "ci", "post-release-digest.mjs");

const SHA_NEW = "a".repeat(40);
const SHA_PREV = "b".repeat(40);
const SHA_OLDER = "c".repeat(40);
const SHA_ROOT = "d".repeat(40);

// ── shouldPost (pure guard) ─────────────────────────────────────────────────
describe("post-release-digest — shouldPost (pure)", () => {
  it("success + production → true", () => {
    expect(shouldPost({ state: "success", environment: "production" })).toBe(
      true,
    );
  });

  it("a non-success state → false (pending / failure / error)", () => {
    expect(shouldPost({ state: "pending", environment: "production" })).toBe(
      false,
    );
    expect(shouldPost({ state: "failure", environment: "production" })).toBe(
      false,
    );
    expect(shouldPost({ state: "error", environment: "production" })).toBe(
      false,
    );
  });

  it("a non-production environment → false (staging / dev / preview)", () => {
    expect(shouldPost({ state: "success", environment: "staging" })).toBe(
      false,
    );
    expect(shouldPost({ state: "success", environment: "dev" })).toBe(false);
  });

  it("missing fields → false (never posts on an underspecified event)", () => {
    expect(shouldPost({})).toBe(false);
    expect(shouldPost(undefined)).toBe(false);
  });
});

// ── resolvePrevSha (pure — release-tag anchored, #975) ───────────────────────
describe("post-release-digest — resolvePrevSha (pure)", () => {
  it("(b) steady-state: a prior release tag exists → prev = that tag's commit", () => {
    const candidateTags = [{ tag: "release-2026.07.14-1", sha: SHA_PREV }];
    expect(resolvePrevSha(candidateTags, SHA_NEW, SHA_ROOT)).toBe(SHA_PREV);
  });

  it("(a) baseline: no prior release tag → prev = the repo-root first commit", () => {
    expect(resolvePrevSha([], SHA_NEW, SHA_ROOT)).toBe(SHA_ROOT);
  });

  it("(a) baseline: no prior tag AND no repo root (git unavailable) → null (`none` range)", () => {
    expect(resolvePrevSha([], SHA_NEW, null)).toBeNull();
  });

  it("(c) a tag AT new-sha is excluded (strict ancestor), falling to the prior tag", () => {
    const candidateTags = [
      { tag: "release-2026.07.15-1", sha: SHA_NEW }, // tag at the deployed sha
      { tag: "release-2026.07.14-1", sha: SHA_PREV },
    ];
    expect(resolvePrevSha(candidateTags, SHA_NEW, SHA_ROOT)).toBe(SHA_PREV);
  });

  it("(c) only a tag AT new-sha → excluded, falls back to the repo root", () => {
    const candidateTags = [{ tag: "release-2026.07.15-1", sha: SHA_NEW }];
    expect(resolvePrevSha(candidateTags, SHA_NEW, SHA_ROOT)).toBe(SHA_ROOT);
  });

  it("orders by date, latest wins (list order irrelevant)", () => {
    const candidateTags = [
      { tag: "release-2026.07.10-1", sha: SHA_OLDER },
      { tag: "release-2026.07.14-2", sha: SHA_PREV },
      { tag: "release-2026.06.30-9", sha: SHA_ROOT },
    ];
    expect(resolvePrevSha(candidateTags, SHA_NEW, "z".repeat(40))).toBe(
      SHA_PREV,
    );
  });

  it("same-date tags: the highest ordinal wins", () => {
    const candidateTags = [
      { tag: "release-2026.07.14-1", sha: SHA_OLDER },
      { tag: "release-2026.07.14-3", sha: SHA_PREV },
      { tag: "release-2026.07.14-2", sha: SHA_ROOT },
    ];
    expect(resolvePrevSha(candidateTags, SHA_NEW, null)).toBe(SHA_PREV);
  });

  it("skips malformed / non-release tags and picks the newest valid one", () => {
    const candidateTags = [
      { tag: "release-2026.07.14-1", sha: SHA_PREV },
      { tag: "v1.2.3", sha: SHA_OLDER }, // not a release-* tag
      {}, // no tag/sha
      { tag: "release-2026.07.20-1", sha: "" }, // empty sha
      null,
    ];
    expect(resolvePrevSha(candidateTags as never, SHA_NEW, SHA_ROOT)).toBe(
      SHA_PREV,
    );
  });

  it("(d) workflow_dispatch default sha: trigger-agnostic — given the dispatch-resolved new-sha, ranges from the prior tag", () => {
    // The workflow resolves NEW_SHA (input → current prod Deployment → HEAD); the
    // resolver is identical regardless of the trigger that produced new-sha.
    const dispatchNewSha = "e".repeat(40);
    const candidateTags = [{ tag: "release-2026.07.14-1", sha: SHA_PREV }];
    expect(resolvePrevSha(candidateTags, dispatchNewSha, SHA_ROOT)).toBe(
      SHA_PREV,
    );
  });

  it("non-array input → the repo-root baseline (or null)", () => {
    expect(resolvePrevSha(undefined as never, SHA_NEW, SHA_ROOT)).toBe(SHA_ROOT);
    expect(resolvePrevSha(undefined as never, SHA_NEW, null)).toBeNull();
  });
});

// ── buildReleaseNotesArgs (pure) ────────────────────────────────────────────
describe("post-release-digest — buildReleaseNotesArgs (pure)", () => {
  it("a real prev SHA → the full `--prev-sha <prev> --new-sha <new>` range", () => {
    expect(buildReleaseNotesArgs(SHA_PREV, SHA_NEW)).toEqual([
      "--prev-sha",
      SHA_PREV,
      "--new-sha",
      SHA_NEW,
    ]);
  });

  it("a null prev (no resolvable baseline) → the literal `none` (release-notes.mjs green-skips it)", () => {
    expect(buildReleaseNotesArgs(null, SHA_NEW)).toEqual([
      "--prev-sha",
      "none",
      "--new-sha",
      SHA_NEW,
    ]);
  });
});

// ── main() guard invariant (subprocess, hermetic — never touches gh/git) ─────
describe("post-release-digest — main() guard (subprocess)", () => {
  /** Run the script with a controlled env; a clean PATH so no stray secret leaks. */
  function runScript(env: Record<string, string | undefined>): {
    code: number;
    stdout: string;
  } {
    const res = spawnSync(process.execPath, [SCRIPT], {
      env: { PATH: process.env.PATH, ...env } as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    return { code: res.status ?? -1, stdout: res.stdout ?? "" };
  }

  it("a non-success state → exit 0, skip BEFORE any gh/git call (guard short-circuits)", () => {
    // No GH_TOKEN, no network: proves the shouldPost guard runs before any I/O.
    const { code, stdout } = runScript({
      STATE: "pending",
      ENVIRONMENT: "production",
      NEW_SHA: SHA_NEW,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("nothing to post");
  });

  it("a non-production environment → exit 0, skip (no post off a preview/staging deploy)", () => {
    const { code, stdout } = runScript({
      STATE: "success",
      ENVIRONMENT: "staging",
      NEW_SHA: SHA_NEW,
    });
    expect(code).toBe(0);
    expect(stdout).toContain("nothing to post");
  });

  it("success/production but a non-hex NEW_SHA → exit 0, skip green (never a bad range)", () => {
    const { code, stdout } = runScript({
      STATE: "success",
      ENVIRONMENT: "production",
      NEW_SHA: "not-a-sha",
    });
    expect(code).toBe(0);
    expect(stdout).toContain("not a valid git SHA");
  });
});
