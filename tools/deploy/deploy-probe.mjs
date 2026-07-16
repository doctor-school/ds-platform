#!/usr/bin/env node
/**
 * tools/deploy/deploy-probe.mjs — one-line prod box-reality probe (#905).
 *
 * Why: when the deploy watchdog trips (`STALLED: <step> …` in prod.mjs), the
 * local channel went quiet but the REMOTE work may have completed — the box's
 * actual state, not the local exit code, decides re-run vs rollback vs "it
 * actually shipped". This script answers that in one deterministic command
 * with a machine-parseable verdict, mirroring the SHAPE of
 * `tools/gh/dispatch-probe.mjs` (pure classifier/formatter + injectable
 * runners + invoke-guard) — the domains are unrelated, only the pattern is
 * shared.
 *
 * Usage:
 *   pnpm deploy:probe
 *
 * What it observes (each field degrades gracefully, bounded timeouts — the
 * probe itself can never hang):
 *   - health:      GET https://api.doctor.school/v1/health → `.version`
 *                  (= the deployed SHA), 10s timeout → `health=UNREACHABLE`.
 *   - containers:  `ssh <api-prod> sudo docker ps` (BatchMode, 10s connect /
 *                  30s total) → the api/portal/admin images + statuses →
 *                  `containers=UNREACHABLE` when the channel is down,
 *                  `<role>=absent` when the box answers but a container is gone.
 *
 * Verdict (pure `classifyProbe`, unit-tested):
 *   - LIVE        — both sources answered.
 *   - DEGRADED    — exactly one answered.
 *   - UNREACHABLE — neither answered.
 *
 * Output (ONE machine-parseable line; whitespace inside values → `_`):
 *   <VERDICT> health=<sha|UNREACHABLE> api=<image>(<status>) portal=… admin=…
 *   <VERDICT> health=<sha|UNREACHABLE> containers=UNREACHABLE
 *
 * Exit codes: 0 = probe ran and classified (every verdict — the exit code
 * reflects whether the PROBE succeeded, not box health, same contract as
 * dispatch-probe); non-zero only on an internal error. Pure node, no
 * bash-isms — Windows/PowerShell and POSIX alike. The classifier, parser and
 * formatter are exported for unit tests
 * (tools/lint/guard-tests/deploy-stall.spec.ts); the fetch and ssh go through
 * injectable seams so tests never touch the network.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PROD_HEALTH_URL } from "./prod.mjs";

const API_PROD = process.env.DS_API_PROD_SSH || "ds-api-prod";
const FETCH_TIMEOUT_MS = 10_000;
const SSH_TIMEOUT_MS = 30_000;

/** Prod compose container names → probe roles (see infra/deploy/compose/api-prod). */
export const CONTAINER_ROLES = {
  "ds-api-prod-api-1": "api",
  "ds-api-prod-portal-1": "portal",
  "ds-api-prod-admin-1": "admin",
};

/** Keep the line one-token-per-field: collapse any whitespace in a value to `_`. */
export function sanitizeToken(v) {
  return String(v).trim().replace(/\s+/g, "_");
}

/**
 * Parse `docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'` output into
 * `{api|portal|admin: {image, status}}`. Unknown containers (caddy, …) are
 * ignored; an empty ps yields `{}` (reachable box, nothing running).
 * @param {string} stdout
 */
export function parseDockerPs(stdout) {
  const rows = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const [name, image, status] = line.split("\t");
    if (!name || !image) continue;
    const role = CONTAINER_ROLES[name.trim()];
    if (role) {
      rows[role] = { image: image.trim(), status: (status ?? "").trim() };
    }
  }
  return rows;
}

/**
 * @param {{healthSha: string|null, containers: object|null}} o
 * @returns {"LIVE"|"DEGRADED"|"UNREACHABLE"}
 */
export function classifyProbe({ healthSha, containers }) {
  if (healthSha && containers) return "LIVE";
  if (healthSha || containers) return "DEGRADED";
  return "UNREACHABLE";
}

/** Format the one-line verdict for stdout. */
export function formatProbeLine({ healthSha, containers }) {
  const parts = [
    classifyProbe({ healthSha, containers }),
    `health=${healthSha ? sanitizeToken(healthSha) : "UNREACHABLE"}`,
  ];
  if (containers) {
    for (const role of ["api", "portal", "admin"]) {
      const c = containers[role];
      parts.push(
        c
          ? `${role}=${sanitizeToken(c.image)}(${sanitizeToken(c.status) || "unknown"})`
          : `${role}=absent`,
      );
    }
  } else {
    parts.push("containers=UNREACHABLE");
  }
  return parts.join(" ");
}

/**
 * Collect both fields via injected runners. Each runner may be sync or async;
 * a throw/reject degrades ONLY its field to null — gatherProbe never rejects.
 * @param {{fetchHealth: () => any, sshDockerPs: () => any}} o
 */
export async function gatherProbe({ fetchHealth, sshDockerPs }) {
  const [healthSha, containers] = await Promise.all([
    Promise.resolve()
      .then(() => fetchHealth())
      .catch(() => null),
    Promise.resolve()
      .then(() => sshDockerPs())
      .catch(() => null),
  ]);
  return { healthSha: healthSha ?? null, containers: containers ?? null };
}

// ── impure runners + CLI (skipped on import) ────────────────────────────────

/** Default health runner: bounded GET → `.version`, or null. Same
 * AbortController-timeout pattern as live-broadcast-check.mjs. */
export async function defaultFetchHealth() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PROD_HEALTH_URL, { signal: ac.signal });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const v =
      body && typeof body.version === "string" ? body.version.trim() : "";
    return v || null;
  } finally {
    clearTimeout(timer);
  }
}

/** Default ssh runner: bounded `docker ps` on api-prod, or null. */
export function defaultSshDockerPs() {
  const res = spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      API_PROD,
      "sudo docker ps --format '{{.Names}}\\t{{.Image}}\\t{{.Status}}'",
    ],
    { encoding: "utf8", timeout: SSH_TIMEOUT_MS },
  );
  if (res.error || res.status !== 0) return null;
  return parseDockerPs(res.stdout ?? "");
}

async function main() {
  const probe = await gatherProbe({
    fetchHealth: defaultFetchHealth,
    sshDockerPs: defaultSshDockerPs,
  });
  process.stdout.write(`${formatProbeLine(probe)}\n`);
  process.exit(0);
}

// Run main only when invoked directly, so the pure functions can be imported in
// tests. `pathToFileURL` yields canonical `file:///C:/…` on Windows too.
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
const selfPath = resolve(fileURLToPath(import.meta.url));
if (
  invokedPath &&
  invokedPath === selfPath &&
  import.meta.url === pathToFileURL(invokedPath).href
) {
  main().catch((err) => {
    process.stderr.write(`[deploy:probe] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}
