#!/usr/bin/env node
// tools/ci/post-release-digest.mjs — fire the aggregated PROD release digest from
// CI on a successful production Deployment (Issue #968), anchored on the previous
// RELEASE TAG (Issue #975).
//
// Why this exists: the aggregated digest (#868) is a DEPLOY event. `deploy:prod`
// ships from the operator's box (ADR-0012 — SSH deploy, no CI), where
// `secrets.MATTERMOST_WEBHOOK_URL` does not exist, so the digest had NEVER fired
// (the #950 `.env.local` fallback was a crutch, now retired). But `deploy:prod`
// records a GitHub Deployment + `success` status (#942/#954), and THAT event fires
// a CI workflow (`.github/workflows/release-digest.yml`) where the secret already
// lives. This script is that workflow's thin resolver: it turns the
// `deployment_status` (or a manual `workflow_dispatch`) into the
// `<prev-sha>..<new-sha>` range and delegates the render+POST to
// `tools/deploy/release-notes.mjs` — the ONE digest seam (#847), never duplicated.
//
// Inputs (from the workflow `env:`, sourced from the event payload / dispatch):
//   - STATE        `github.event.deployment_status.state`   (guard: only `success`)
//   - ENVIRONMENT  `github.event.deployment.environment`    (guard: only `production`)
//   - NEW_SHA      the just-deployed SHA (event) or the dispatch target SHA
//   - DELIVERY_ENV `prod` (mandatory footer marker, passed straight through)
//   - MATTERMOST_WEBHOOK_URL / GH_TOKEN / GH_REPO           (release-notes.mjs + gh)
//
// The prev-sha is the commit of the latest `release-*` tag that is a STRICT
// ANCESTOR of `new-sha` (a tag AT `new-sha` is excluded), ordered by the tag's
// `release-YYYY.MM.DD-<n>` date + same-day ordinal (`parseReleaseTag`, reused from
// cut-release.mjs). This makes the digest describe exactly the RELEASE it announces
// — the same range the GitHub Release notes (auto-generated "since the previous
// release") cover. When NO prior release tag exists, the baseline is the repo-root
// first commit (`git rev-list --max-parents=0`), so the range is the full history —
// matching `--generate-notes` on the inaugural Release (the #975 empty-digest bug:
// anchoring on the previous DEPLOYMENT instead made the inaugural range tooling-only
// because the prior deploy already carried all the product work).
//
// NON-FATAL by contract: a release digest must never fail the workflow. Every
// error path logs a warning and exits 0 — the pure resolver below is unit-tested,
// so a real regression is caught by the spec, not by a red CI notification job.

import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseReleaseTag } from "../release/cut-release.mjs";

const HEX_RE = /^[0-9a-f]{7,40}$/i;

/**
 * The deployment_status guard, in JS (mirrors the workflow `if:`). Only a
 * `success` state on the `production` environment posts a digest — anything else
 * is a no-op. A manual `workflow_dispatch` run synthesises `success`/`production`
 * in the workflow env, so it flows through the same guard. PURE.
 *
 * @param {{ state?: string, environment?: string }} evt
 * @returns {boolean}
 */
export function shouldPost({ state, environment } = {}) {
  return state === "success" && environment === "production";
}

/**
 * Resolve the previous-release prev-sha from the candidate `release-*` tags that
 * are ancestors-or-equal of `newSha` and an injected repo-root sha. PURE — no I/O
 * (the git gathering lives in `fetchPrevShaInputs`, the same pure/seam split the
 * old deployment-list resolver used, and `nextReleaseTag` in cut-release.mjs).
 *
 * The winner is the STRICT-ANCESTOR release tag with the latest
 * `release-YYYY.MM.DD-<n>` date, then the highest same-day ordinal — a tag AT
 * `newSha` is excluded (its sha equals `newSha`), so re-running the digest for an
 * already-tagged release still ranges from the PRIOR release. With no qualifying
 * tag, the repo-root sha is the baseline (full-history range); with neither
 * (git unavailable), `null` → release-notes.mjs green-skips the `none` range.
 *
 * @param {Array<{ tag?: string, sha?: string }>} candidateTags
 * @param {string}                                newSha
 * @param {string|null}                           repoRootSha
 * @returns {string|null}
 */
export function resolvePrevSha(candidateTags, newSha, repoRootSha = null) {
  const candidates = Array.isArray(candidateTags) ? candidateTags : [];
  let best = null; // { date, ordinal, sha }
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const { tag, sha } = c;
    if (typeof sha !== "string" || !sha) continue;
    if (sha === newSha) continue; // strict ancestor — exclude a tag AT new-sha
    const parsed = parseReleaseTag(tag);
    if (!parsed) continue;
    if (
      best === null ||
      parsed.date > best.date ||
      (parsed.date === best.date && parsed.ordinal > best.ordinal)
    ) {
      best = { date: parsed.date, ordinal: parsed.ordinal, sha };
    }
  }
  if (best) return best.sha;
  return typeof repoRootSha === "string" && repoRootSha ? repoRootSha : null;
}

/**
 * Build the argv for `release-notes.mjs` from a resolved range. A null/absent
 * prevSha becomes the literal `none` (release-notes.mjs green-skips a range with no
 * baseline). PURE.
 *
 * @param {string|null} prevSha
 * @param {string}      newSha
 * @returns {string[]}
 */
export function buildReleaseNotesArgs(prevSha, newSha) {
  return ["--prev-sha", prevSha || "none", "--new-sha", newSha];
}

function log(msg) {
  process.stdout.write(`[release-digest] ${msg}\n`);
}

/**
 * Gather the pure resolver's inputs from git: the `release-*` tags that are
 * ancestors-or-equal of `newSha` (each peeled to its commit sha), plus the
 * repo-root first commit for the no-prior-tag baseline. Returns
 * `{ candidateTags, repoRootSha }` or throws (caught by the non-fatal main). I/O
 * seam. `--merged <newSha>` keeps only tags reachable from the deployed sha, so a
 * tag on an unrelated branch never anchors the range.
 */
function fetchPrevShaInputs(cwd, newSha) {
  const tagList = spawnSync(
    "git",
    ["tag", "--list", "release-*", "--merged", newSha],
    { encoding: "utf8", cwd },
  );
  if (tagList.status !== 0) {
    throw new Error(
      `git tag --merged exited ${tagList.status}: ${(tagList.stderr || "")
        .trim()
        .slice(0, 200)}`,
    );
  }
  const tags = (tagList.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const candidateTags = [];
  for (const tag of tags) {
    // Peel to the commit sha (dereferences an annotated tag object).
    const r = spawnSync("git", ["rev-list", "-n", "1", tag], {
      encoding: "utf8",
      cwd,
    });
    if (r.status === 0) {
      const sha = (r.stdout || "").trim();
      if (sha) candidateTags.push({ tag, sha });
    }
  }

  let repoRootSha = null;
  const root = spawnSync("git", ["rev-list", "--max-parents=0", newSha], {
    encoding: "utf8",
    cwd,
  });
  if (root.status === 0) {
    const roots = (root.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Multiple roots are possible (grafted histories); the last line is the
    // earliest root — the widest full-history baseline.
    repoRootSha = roots.length ? roots[roots.length - 1] : null;
  }

  return { candidateTags, repoRootSha };
}

/** Spawn release-notes.mjs (the ONE render+POST seam) with the resolved range and
 *  the inherited env (DELIVERY_ENV=prod + MATTERMOST_WEBHOOK_URL from CI). Resolves
 *  the child exit code; the caller treats a non-zero as a warn, never a failure. */
function postDigest(args) {
  return new Promise((resolve) => {
    const script = fileURLToPath(
      new URL("../deploy/release-notes.mjs", import.meta.url),
    );
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (e) => {
      log(`⚠ release-notes.mjs failed to spawn: ${e.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const state = process.env.STATE;
  const environment = process.env.ENVIRONMENT;
  const newSha = process.env.NEW_SHA;

  // Defensive guard (the workflow `if:` already gates, but keep the JS honest):
  // only a successful production deploy (or a workflow_dispatch synthesising the
  // same) posts a digest.
  if (!shouldPost({ state, environment })) {
    log(
      `not a successful production deploy (state=${JSON.stringify(
        state ?? null,
      )}, environment=${JSON.stringify(environment ?? null)}) — nothing to post.`,
    );
    return;
  }

  if (!newSha || !HEX_RE.test(newSha)) {
    log(
      `deployment sha is not a valid git SHA (${JSON.stringify(
        newSha ?? null,
      )}) — skipping the digest (green).`,
    );
    return;
  }

  const cwd = process.cwd();
  // Defaults to null (`none` range) when the prior release can't be resolved —
  // release-notes.mjs green-skips a `none` prev rather than failing.
  let prevSha = null;
  try {
    const { candidateTags, repoRootSha } = fetchPrevShaInputs(cwd, newSha);
    prevSha = resolvePrevSha(candidateTags, newSha, repoRootSha);
  } catch (e) {
    log(
      `⚠ could not resolve the previous release tag (${e.message}) — treating as no baseline (green).`,
    );
  }

  const args = buildReleaseNotesArgs(prevSha, newSha);
  log(
    `posting the aggregated release digest for ${
      prevSha ? `${prevSha.slice(0, 12)}..` : "(no baseline) "
    }${newSha.slice(0, 12)} …`,
  );
  const code = await postDigest(args);
  if (code !== 0) {
    // Non-fatal: a digest post must never fail the workflow (#968).
    log(
      `⚠ release-notes.mjs exited ${code} — the digest did not post, but this notification job stays green.`,
    );
  }
}

// Run only as the entry point — keep the pure seams importable without any I/O,
// the same guard release-notes.mjs / deployment-record.mjs use.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  // NON-FATAL: catch everything and exit 0 — a notification job must never turn a
  // successful deploy's post-event red.
  main()
    .catch((e) => {
      process.stdout.write(
        `[release-digest] ⚠ unexpected error (staying green): ${
          e instanceof Error ? e.message : String(e)
        }\n`,
      );
    })
    .finally(() => process.exit(0));
}
