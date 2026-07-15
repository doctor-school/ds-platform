#!/usr/bin/env node
// tools/ci/post-release-digest.mjs — fire the aggregated PROD release digest from
// CI on a successful production Deployment (Issue #968).
//
// Why this exists: the aggregated digest (#868) is a DEPLOY event. `deploy:prod`
// ships from the operator's box (ADR-0012 — SSH deploy, no CI), where
// `secrets.MATTERMOST_WEBHOOK_URL` does not exist, so the digest had NEVER fired
// (the #950 `.env.local` fallback was a crutch, now retired). But `deploy:prod`
// records a GitHub Deployment + `success` status (#942/#954), and THAT event fires
// a CI workflow (`.github/workflows/release-digest.yml`) where the secret already
// lives. This script is that workflow's thin resolver: it turns the
// `deployment_status` event into the `<prev-sha>..<new-sha>` range and delegates
// the render+POST to `tools/deploy/release-notes.mjs` — the ONE digest seam (#847),
// never duplicated here.
//
// Inputs (from the workflow `env:`, sourced from the event payload):
//   - STATE        `github.event.deployment_status.state`   (guard: only `success`)
//   - ENVIRONMENT  `github.event.deployment.environment`    (guard: only `production`)
//   - NEW_SHA      `github.event.deployment.sha`            (the just-deployed SHA)
//   - DELIVERY_ENV `prod` (mandatory footer marker, passed straight through)
//   - MATTERMOST_WEBHOOK_URL / GH_TOKEN / GH_REPO           (release-notes.mjs + gh)
//
// The prev-sha is the most recent PRIOR production Deployment SHA, read from
// `gh api …/deployments?environment=production`. Because `deploy:prod` only ever
// creates a production Deployment AFTER a green smoke (#942), every entry in that
// list is a successful prod deploy — so "the most recent entry whose sha differs
// from the current one" IS the previous successful deploy. First deploy (no prior
// entry) → `none`, and release-notes.mjs green-skips the range gracefully.
//
// NON-FATAL by contract: a release digest must never fail the workflow. Every
// error path logs a warning and exits 0 — the pure resolver below is unit-tested,
// so a real regression is caught by the spec, not by a red CI notification job.

import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEX_RE = /^[0-9a-f]{7,40}$/i;

/**
 * The deployment_status guard, in JS (mirrors the workflow `if:`). Only a
 * `success` state on the `production` environment posts a digest — anything else
 * is a no-op. PURE.
 *
 * @param {{ state?: string, environment?: string }} evt
 * @returns {boolean}
 */
export function shouldPost({ state, environment } = {}) {
  return state === "success" && environment === "production";
}

/**
 * Resolve the previous production Deployment SHA from the `gh api …/deployments`
 * list (newest-first) and the current (just-deployed) SHA. Returns the sha of the
 * most recent entry that differs from `currentSha`, or `null` when there is none
 * (the first-ever prod deploy). PURE — no I/O.
 *
 * The list is newest-first, so index 0 is normally the current deploy; we scan
 * for the first DIFFERENT sha rather than assuming index 1, so a duplicated head
 * entry (a same-SHA redeploy recorded twice) still resolves to the true prior SHA.
 *
 * @param {Array<{ sha?: string }>} deployments
 * @param {string}                  currentSha
 * @returns {string|null}
 */
export function resolvePrevSha(deployments, currentSha) {
  if (!Array.isArray(deployments)) return null;
  for (const d of deployments) {
    const sha = d && typeof d === "object" ? d.sha : null;
    if (typeof sha === "string" && sha && sha !== currentSha) return sha;
  }
  return null;
}

/**
 * Build the argv for `release-notes.mjs` from a resolved range. A null/absent
 * prevSha becomes the literal `none` (release-notes.mjs green-skips a first
 * deploy). PURE.
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

/** Read the newest-first production Deployment list via `gh api`. Returns an
 *  array (possibly empty) or throws (caught by the non-fatal main). I/O seam. */
function fetchProductionDeployments(cwd) {
  const r = spawnSync(
    "gh",
    [
      "api",
      "-X",
      "GET",
      "repos/{owner}/{repo}/deployments",
      "-f",
      "environment=production",
      "-F",
      "per_page=30",
    ],
    { encoding: "utf8", cwd },
  );
  if (r.status !== 0) {
    throw new Error(
      `gh api deployments exited ${r.status}: ${(r.stderr || "").trim().slice(0, 200)}`,
    );
  }
  const data = JSON.parse(r.stdout || "[]");
  return Array.isArray(data) ? data : [];
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
  // only a successful production deploy posts a digest.
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
  // Defaults to null (first-deploy / `none` range) when the prior deploy can't be
  // read — release-notes.mjs green-skips a `none` prev rather than failing.
  let prevSha = null;
  try {
    prevSha = resolvePrevSha(fetchProductionDeployments(cwd), newSha);
  } catch (e) {
    log(
      `⚠ could not resolve the previous production Deployment (${e.message}) — treating as first deploy.`,
    );
  }

  const args = buildReleaseNotesArgs(prevSha, newSha);
  log(
    `posting the aggregated release digest for ${
      prevSha ? `${prevSha.slice(0, 12)}..` : "(first deploy) "
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
