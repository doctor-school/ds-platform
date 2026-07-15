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

// ── resolvePrevSha (pure) ───────────────────────────────────────────────────
describe("post-release-digest — resolvePrevSha (pure)", () => {
  it("newest-first list: index 0 is the current deploy → returns the next SHA", () => {
    const deployments = [
      { sha: SHA_NEW },
      { sha: SHA_PREV },
      { sha: SHA_OLDER },
    ];
    expect(resolvePrevSha(deployments, SHA_NEW)).toBe(SHA_PREV);
  });

  it("first deploy (only the current entry) → null", () => {
    expect(resolvePrevSha([{ sha: SHA_NEW }], SHA_NEW)).toBeNull();
  });

  it("empty list (no Deployment recorded yet) → null", () => {
    expect(resolvePrevSha([], SHA_NEW)).toBeNull();
  });

  it("a duplicated head entry (same-SHA redeploy recorded twice) → the true prior SHA", () => {
    const deployments = [{ sha: SHA_NEW }, { sha: SHA_NEW }, { sha: SHA_PREV }];
    expect(resolvePrevSha(deployments, SHA_NEW)).toBe(SHA_PREV);
  });

  it("skips malformed entries (no/empty sha) and finds the first real prior SHA", () => {
    const deployments = [
      { sha: SHA_NEW },
      {},
      { sha: "" },
      null,
      { sha: SHA_PREV },
    ];
    expect(resolvePrevSha(deployments as never, SHA_NEW)).toBe(SHA_PREV);
  });

  it("non-array input → null", () => {
    expect(resolvePrevSha(undefined as never, SHA_NEW)).toBeNull();
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

  it("a null prev (first deploy) → the literal `none` (release-notes.mjs green-skips it)", () => {
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
