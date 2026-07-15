#!/usr/bin/env node
// tools/deploy/deployment-record.mjs — record a successful `deploy:prod` as a
// GitHub Deployment(production, sha) + a `success` deployment_status (Issue #942,
// W2/L2 of #927).
//
// Spec: apps/docs/content/specs/tech/2026-07-15-release-cycle-context-freshness-design-en.md
//       §2 (D3 — the deploy record lives in GitHub, not the repo), §3 (L2 unit
//       boundary), §4 (Deployment wire contract), §5 (error handling — non-fatal).
//
// Why this exists: before #942 the only durable prod-deploy record was the running
// container image tag (read back over SSH) + the live `GET /v1/health → {version}`.
// L3 (`tools/project-reality.ts`) reads a GitHub production Deployment at
// SessionStart to derive "what is deployed". This tool WRITES that record: it
// persists the aggregated release-notes text INTO the Deployment `payload` (spec
// §D3 "persist the release-notes payload into the Deployment"), so the deploy
// record and the Mattermost digest share one source of truth (#847).
//
// Two seams, mirroring release-notes.mjs:
//   - `buildDeploymentPayload(...)` — PURE, deterministic, no I/O, no `Date.now()`
//     (the caller injects `nowIso`). Assembles the two `gh api` request bodies.
//   - `createDeploymentRecord(...)` — the I/O seam. NON-FATAL by contract: it
//     never throws to the caller (the deploy has already succeeded when it runs),
//     returning `{ ok, deploymentId?, error? }`. Mirrors the never-throw posture
//     of release-notes.mjs — a record hiccup must never turn a good deploy red.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHORT = 12;
// GitHub caps a Deployment/deployment_status `description` at 140 chars.
const GH_DESCRIPTION_MAX = 140;

/** Strip 4-byte Unicode (astral-plane code points > U+FFFF — emoji, etc.) from a
 *  string. GitHub's `deployment_status.description` / `deployment.description`
 *  columns are legacy 3-byte `utf8` and reject 4-byte chars with a 422 (the digest
 *  first line `## 🚀 Релиз на PROD` tripped this — Issue #949). BMP chars (incl.
 *  Cyrillic) survive; only surrogate-pair code points are dropped. Applied to the
 *  descriptions only — `payload.notes` (a JSON blob column) keeps the emoji. */
function stripAstral(value) {
  return [...String(value ?? "")]
    .filter((c) => c.codePointAt(0) <= 0xffff)
    .join("");
}

/** Truncate to `max` chars, appending a single-char ellipsis when it overflows so
 *  the result is always ≤ `max`. */
function truncate(value, max) {
  const s = String(value ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** The first non-empty (trimmed) line of a block of text, or `""`. */
function firstNonEmptyLine(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Assemble the two `gh api` request bodies for recording a deploy — PURE, no I/O.
 *
 * The `deployment` body creates the GitHub Deployment (recorded intent); its
 * `payload` persists the release-notes text + release tag + deploy timestamp so a
 * later session can read the exact shipped digest from GitHub (spec §D3/§4). The
 * `status` body marks it `success`, points `log_url` at the live health endpoint,
 * and summarises the digest in its (≤140-char) description.
 *
 * @param {object}      args
 * @param {string}      args.sha         deployed commit SHA (Deployment `ref`).
 * @param {string|null} args.releaseTag  release tag shipped, or null (untagged).
 * @param {string|null} args.notesText   aggregated release-notes digest, or null/"".
 * @param {string}      args.healthUrl   prod health URL (the status `log_url`).
 * @param {string}      args.nowIso      caller-injected ISO deploy timestamp.
 */
export function buildDeploymentPayload({
  sha,
  releaseTag,
  notesText,
  healthUrl,
  nowIso,
}) {
  const shortSha = typeof sha === "string" ? sha.slice(0, SHORT) : "";
  const tagLabel = releaseTag ?? "(untagged)";
  const notes = notesText ?? "";
  const statusSummary = firstNonEmptyLine(notes) || `release ${tagLabel}`;

  return {
    deployment: {
      ref: sha,
      environment: "production",
      auto_merge: false,
      required_contexts: [],
      description: truncate(
        stripAstral(`release ${tagLabel} @ ${shortSha}`),
        GH_DESCRIPTION_MAX,
      ),
      payload: {
        releaseTag: releaseTag ?? null,
        notes,
        deployedAt: nowIso,
      },
    },
    status: {
      state: "success",
      log_url: healthUrl,
      environment: "production",
      description: truncate(stripAstral(statusSummary), GH_DESCRIPTION_MAX),
    },
  };
}

/** POST a JSON body to a `gh api` path via stdin (safest for the nested `payload`).
 *  Returns `{ ok, data? , error? }` — never throws. */
function ghApiPost(path, body, cwd) {
  const r = spawnSync("gh", ["api", "-X", "POST", path, "--input", "-"], {
    input: JSON.stringify(body),
    encoding: "utf8",
    cwd,
  });
  if (r.status !== 0) {
    // `gh api` writes the JSON error body (which names the offending field, e.g.
    // "description doesn't accept 4-byte Unicode") to STDOUT, and a short summary
    // ("Validation Failed (HTTP 422)") to STDERR. Surface BOTH so a future
    // validation failure is self-diagnosing (#949 — the stdout body was dropped,
    // hiding the field). Bounded to keep the non-fatal warning one line.
    const stderr1 = (r.stderr || "").trim().split(/\r?\n/)[0] ?? "";
    const stdoutBody = (r.stdout || "").trim().replace(/\s+/g, " ");
    const detail = [stderr1, stdoutBody].filter(Boolean).join(" | ").slice(0, 300);
    return { ok: false, error: `gh api ${path} exited ${r.status}: ${detail}` };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout || "null") };
  } catch {
    return { ok: false, error: `gh api ${path}: response was not valid JSON` };
  }
}

/**
 * Create the GitHub Deployment + success status for a shipped SHA. NON-FATAL: it
 * catches everything and returns a result struct rather than throwing — the deploy
 * has already succeeded by the time this runs (spec §5).
 *
 * @returns {{ ok: boolean, deploymentId?: number, error?: string }}
 */
export function createDeploymentRecord({
  sha,
  releaseTag,
  notesText,
  healthUrl,
  cwd = process.cwd(),
}) {
  try {
    const nowIso = new Date().toISOString();
    const { deployment, status } = buildDeploymentPayload({
      sha,
      releaseTag,
      notesText,
      healthUrl,
      nowIso,
    });

    const created = ghApiPost(
      "repos/{owner}/{repo}/deployments",
      deployment,
      cwd,
    );
    if (!created.ok) return { ok: false, error: created.error };

    const deploymentId =
      created.data && typeof created.data.id === "number"
        ? created.data.id
        : null;
    if (deploymentId === null) {
      return {
        ok: false,
        error: `deployment create returned no numeric id: ${JSON.stringify(
          created.data,
        ).slice(0, 200)}`,
      };
    }

    const marked = ghApiPost(
      `repos/{owner}/{repo}/deployments/${deploymentId}/statuses`,
      status,
      cwd,
    );
    if (!marked.ok) return { ok: false, deploymentId, error: marked.error };

    return { ok: true, deploymentId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Run only as the entry point — keep the pure seam importable without any gh I/O,
// the same guard release-notes.mjs uses. Invoked directly (no args wired yet), it
// is a no-op that documents the seam; `prod.mjs` imports and calls the seams.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    "[deployment-record] this module exposes buildDeploymentPayload / " +
      "createDeploymentRecord as importable seams; it is wired into deploy:prod " +
      "(tools/deploy/prod.mjs), not run standalone.\n",
  );
}
