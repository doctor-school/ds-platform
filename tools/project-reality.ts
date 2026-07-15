/**
 * tools/project-reality.ts — the `## Project reality` bootstrap seam (#927, W1).
 *
 * Spec: apps/docs/content/specs/tech/2026-07-15-release-cycle-context-freshness-design-en.md
 *       §2 (D4), §3 (L3 unit boundary), §4 (contracts), §5 (error handling), §6 (testing).
 *
 * Driver: session `5fbaaa9c` (2026-07-15) groomed the backlog three times on a
 * production model three releases stale, because "what is shipped / current
 * phase" lived as rot-prone prose in AGENTS.md §1 + agent memory. The fix
 * (D4/L3): the SessionStart bootstrap DERIVES the project's production reality
 * from live GitHub Release/Deployment records + a `/v1/health` probe, never
 * hand-authored prose and never an in-repo dynamic file.
 *
 * Mirrors `tools/main-sync.ts` EXACTLY: an I/O **probe** seam
 * (`probeProjectReality`) gathers gh/git/health evidence and NEVER throws
 * (every failure is captured in the returned struct); a **pure classifier**
 * (`evaluateProjectReality`, no I/O) reduces the probe to a discriminated-union
 * status; **message formatters** render the section. The pure pieces are
 * exported and unit-tested (tools/lint/guard-tests/project-reality.spec.ts)
 * WITHOUT firing any subprocess/network.
 *
 * The merged-not-deployed delta reuses the SAME product-PR heuristic the release
 * digest uses (`extractPrNumbers` from `release-notes.mjs` + `labelsAreProductKind`
 * from `post-product-note.mjs`) — never a bespoke re-implementation (#847).
 */
import { execa } from "execa";

import { extractPrNumbers } from "./deploy/release-notes.mjs";
import { labelsAreProductKind } from "./ci/post-product-note.mjs";

/** Live prod health endpoint — the running container = ground truth (spec §4). */
export const HEALTH_URL = "https://api.doctor.school/v1/health";

/**
 * Raw evidence gathered by `probeProjectReality`, fed to the pure classifier.
 * Every field degrades to `null` (+ an optional `*Error`) rather than throwing,
 * exactly like `MainSyncProbe`.
 */
export interface ProjectRealityProbe {
  /** Resolved commit SHA of the latest `production` GitHub Deployment (recorded
   *  intent), or `null` when none exists / the `gh api` call failed. */
  deploymentSha: string | null;
  /** Latest `deployment_status` state (`success`, …) of that Deployment. */
  deploymentState: string | null;
  /** Did the deployments query return at least one production Deployment? */
  deploymentFound: boolean;
  /** First line of the error when the deployments `gh api` call failed. */
  deploymentError?: string;

  /** Deployed SHA read from `GET /v1/health → {version}` (ground truth), or
   *  `null` when the endpoint was unreachable / carried no `version`. */
  healthSha: string | null;
  /** First line of the error when the health probe failed. */
  healthError?: string;

  /** `tagName` of the latest GitHub Release, or `null` when none exist yet. */
  releaseTag: string | null;
  /** `publishedAt` (ISO) of the latest GitHub Release, or `null`. */
  releasePublishedAt: string | null;
  /** First line of the error when the release query failed. */
  releaseError?: string;

  /** Count of PRODUCT (feature|bug) PRs merged in `<deployedSha>..origin/main`
   *  — the merged-but-not-deployed delta. `null` when uncomputable (no basis
   *  SHA, or the anchor is not in local history). */
  mergedNotDeployed: number | null;
  /** First line of the error when the delta was uncomputable. */
  mergedNotDeployedError?: string;
}

/**
 * The reconciled production status. Primary axis = the deployed-SHA agreement
 * between the GitHub Deployment record (intent) and live `/v1/health` (reality),
 * per spec §4/§6. Every basis-bearing variant carries the merged-not-deployed
 * delta count.
 */
export type ProjectRealityStatus =
  | { kind: "agree"; deployedSha: string; mergedNotDeployed: number | null }
  | {
      kind: "disagree";
      deploymentSha: string;
      healthSha: string;
      mergedNotDeployed: number | null;
    }
  | {
      kind: "deployed-unrecorded";
      healthSha: string;
      mergedNotDeployed: number | null;
    }
  | {
      kind: "deployment-only";
      deploymentSha: string;
      deploymentState: string | null;
      mergedNotDeployed: number | null;
    }
  | { kind: "unreachable" };

/** Latest-release facts pulled from the probe for the formatters. */
export interface ReleaseInfo {
  tag: string | null;
  publishedAt: string | null;
}

/** The `## Project reality` heading — a pointer to the derived source, never a
 *  place to hand-author scope (spec §4 example). */
export const PROJECT_REALITY_HEADING =
  "## Project reality (derived from GitHub Releases/Deployments + /v1/health — never edit docs to state this)";

/** Short (7-char) SHA for display; leaves shorter SHAs (e.g. a health `version`
 *  that is already abbreviated) untouched. */
export function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

/**
 * Do two SHAs refer to the same commit, tolerating a full 40-char Deployment
 * `sha` vs an abbreviated `/v1/health` `version`? Compared case-insensitively on
 * the shorter length's prefix (min 7 hex — anything shorter must match exactly).
 */
export function shaMatches(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  const n = Math.min(x.length, y.length);
  if (n < 7) return x === y;
  return x.slice(0, n) === y.slice(0, n);
}

/**
 * Classify a probe into a reconciled status (NO I/O). Deployment = recorded
 * intent, health = ground truth:
 *   - both present & agree            → `agree`
 *   - both present & differ           → `disagree` (loud reconcile banner)
 *   - Deployment missing, health only → `deployed-unrecorded` (record skipped)
 *   - Deployment only, health down    → `deployment-only` (graceful degrade §5)
 *   - neither reachable               → `unreachable` (reality-source unavailable)
 */
export function evaluateProjectReality(
  probe: ProjectRealityProbe,
): ProjectRealityStatus {
  const dep = probe.deploymentSha;
  const health = probe.healthSha;
  const delta = probe.mergedNotDeployed;

  if (dep && health) {
    if (shaMatches(dep, health)) {
      return { kind: "agree", deployedSha: health, mergedNotDeployed: delta };
    }
    return {
      kind: "disagree",
      deploymentSha: dep,
      healthSha: health,
      mergedNotDeployed: delta,
    };
  }
  if (!dep && health) {
    return {
      kind: "deployed-unrecorded",
      healthSha: health,
      mergedNotDeployed: delta,
    };
  }
  if (dep && !health) {
    return {
      kind: "deployment-only",
      deploymentSha: dep,
      deploymentState: probe.deploymentState,
      mergedNotDeployed: delta,
    };
  }
  return { kind: "unreachable" };
}

/** Pull the latest-release facts out of a probe for the formatters. */
export function releaseFromProbe(probe: ProjectRealityProbe): ReleaseInfo {
  return { tag: probe.releaseTag, publishedAt: probe.releasePublishedAt };
}

/**
 * The loud, non-crashing reconcile banner message for a status, or `null` when
 * there is nothing to flag. Fires on exactly the three spec §4 cases:
 * Deployment-missing-but-health-present, Deployment≠health, all-unreachable.
 */
export function reconcileMessage(status: ProjectRealityStatus): string | null {
  switch (status.kind) {
    case "disagree":
      return "the production Deployment SHA disagrees with live /v1/health — the record disagrees with reality; verify before stating deployed scope";
    case "deployed-unrecorded":
      return "prod reports a live SHA but has NO production Deployment record — deployed but unrecorded (the record cycle was skipped)";
    case "unreachable":
      return "prod-reality could not be derived — check GitHub Releases/Deployments before stating scope";
    case "agree":
    case "deployment-only":
      return null;
  }
}

function releaseLine(release: ReleaseInfo): string {
  if (release.tag) {
    const date = release.publishedAt
      ? release.publishedAt.slice(0, 10)
      : "date unknown";
    return `- Latest release: ${release.tag} (${date})`;
  }
  return "- Latest release: (none yet — no GitHub Release cut; see `gh release list`)";
}

function deployedLine(status: ProjectRealityStatus): string {
  switch (status.kind) {
    case "agree":
      return `- Deployed to prod: ${shortSha(status.deployedSha)} — health ✓ matches Deployment record`;
    case "disagree":
      return `- Deployed to prod: Deployment record ${shortSha(status.deploymentSha)} ✗ DISAGREES with live /v1/health ${shortSha(status.healthSha)}`;
    case "deployed-unrecorded":
      return `- Deployed to prod: ${shortSha(status.healthSha)} (live /v1/health) — ⚠ no production Deployment record`;
    case "deployment-only": {
      const st = status.deploymentState
        ? `, status ${status.deploymentState}`
        : "";
      return `- Deployed to prod: ${shortSha(status.deploymentSha)} (Deployment record${st}) — live /v1/health unreachable, unconfirmed`;
    }
    case "unreachable":
      return "- Deployed to prod: (unknown — neither the production GitHub Deployment nor /v1/health was reachable)";
  }
}

/** The merged-but-not-deployed delta line, or `null` when there is no deployed
 *  basis to diff against (all-unreachable). */
function deltaLine(status: ProjectRealityStatus): string | null {
  if (status.kind === "unreachable") return null;
  const n = status.mergedNotDeployed;
  if (n == null) {
    return "- Merged since deploy: (delta uncomputable — deployed SHA not in local history? fetch origin/main)";
  }
  if (n === 0) {
    return "- Merged since deploy: none — prod is level with `origin/main` product PRs.";
  }
  return `- Merged since deploy: ${n} product PR(s) NOT yet on prod — run \`pnpm deploy:prod\` to ship.`;
}

/**
 * Render the full `## Project reality` section as an array of markdown lines: a
 * loud reconcile banner (on mismatch/unreachable) FIRST, then the heading, the
 * latest-release line, the deployed-sha line (with the health-match indicator),
 * the merged-not-deployed delta + `pnpm deploy:prod` nudge, and the cumulative
 * `gh release list` scope pointer. Pure — no I/O.
 */
export function renderProjectReality(
  status: ProjectRealityStatus,
  release: ReleaseInfo,
): string[] {
  const out: string[] = [];
  const banner = reconcileMessage(status);
  if (banner) out.push(`> 🛑 **PROD-REALITY RECONCILE — ${banner}.**`);
  out.push(PROJECT_REALITY_HEADING);
  out.push(releaseLine(release));
  out.push(deployedLine(status));
  const delta = deltaLine(status);
  if (delta) out.push(delta);
  out.push(
    "- Full shipped scope: see `gh release list` (cumulative), not this line.",
  );
  return out;
}

// ── I/O probe seam (never throws) ───────────────────────────────────────────

function firstLine(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0]! : String(e);
}

/** Probe `GET /v1/health` for its `{version}` SHA with a short timeout. Never
 *  throws — returns the SHA or an error string. */
async function probeHealth(
  url: string,
  timeoutMs: number,
): Promise<{ sha: string | null; error?: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) return { sha: null, error: `health ${res.status}` };
    const json = (await res.json()) as unknown;
    const version =
      json && typeof json === "object" && "version" in json
        ? (json as { version?: unknown }).version
        : undefined;
    if (typeof version === "string" && version.trim().length > 0) {
      return { sha: version.trim() };
    }
    return { sha: null, error: "health response carried no .version" };
  } catch (e) {
    return { sha: null, error: firstLine(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Gather production-reality evidence from three live sources with graceful
 * degradation (spec §5 order: GitHub Deployment → /v1/health → GitHub Release).
 * NEVER throws: every failure is captured in the returned probe so the caller
 * degrades to a printable banner instead of crashing the SessionStart hook.
 */
export async function probeProjectReality(
  cwd: string,
): Promise<ProjectRealityProbe> {
  const probe: ProjectRealityProbe = {
    deploymentSha: null,
    deploymentState: null,
    deploymentFound: false,
    healthSha: null,
    releaseTag: null,
    releasePublishedAt: null,
    mergedNotDeployed: null,
  };

  // 1. Latest `production` GitHub Deployment (recorded intent) + its latest state.
  try {
    const { stdout } = await execa(
      "gh",
      [
        "api",
        "repos/{owner}/{repo}/deployments?environment=production&per_page=1",
      ],
      { cwd, timeout: 15000 },
    );
    const arr = JSON.parse(stdout) as Array<{
      id?: number;
      sha?: string;
      ref?: string;
    }>;
    if (Array.isArray(arr) && arr.length > 0) {
      const d = arr[0]!;
      probe.deploymentFound = true;
      probe.deploymentSha =
        typeof d.sha === "string"
          ? d.sha
          : typeof d.ref === "string"
            ? d.ref
            : null;
      if (typeof d.id === "number") {
        try {
          const { stdout: statusOut } = await execa(
            "gh",
            [
              "api",
              `repos/{owner}/{repo}/deployments/${d.id}/statuses?per_page=1`,
            ],
            { cwd, timeout: 15000 },
          );
          const states = JSON.parse(statusOut) as Array<{ state?: string }>;
          if (
            Array.isArray(states) &&
            states.length > 0 &&
            typeof states[0]!.state === "string"
          ) {
            probe.deploymentState = states[0]!.state!;
          }
        } catch {
          // A missing status is non-fatal — the Deployment SHA still stands.
        }
      }
    }
  } catch (e) {
    probe.deploymentError = firstLine(e);
  }

  // 2. Live health (ground truth).
  const health = await probeHealth(HEALTH_URL, 8000);
  probe.healthSha = health.sha;
  if (health.error) probe.healthError = health.error;

  // 3. Latest GitHub Release (there are NONE yet — handled: empty → nulls).
  try {
    const { stdout } = await execa(
      "gh",
      ["release", "list", "--limit", "1", "--json", "tagName,publishedAt"],
      { cwd, timeout: 15000 },
    );
    const arr = JSON.parse(stdout) as Array<{
      tagName?: string;
      publishedAt?: string;
    }>;
    if (Array.isArray(arr) && arr.length > 0) {
      probe.releaseTag = arr[0]!.tagName ?? null;
      probe.releasePublishedAt = arr[0]!.publishedAt ?? null;
    }
  } catch (e) {
    probe.releaseError = firstLine(e);
  }

  // 4. Merged-but-not-deployed PRODUCT-PR delta: `<deployedSha>..origin/main`
  //    filtered by the SAME heuristic the release digest uses. Basis SHA =
  //    health (reality) when present, else the Deployment record.
  const basis = probe.healthSha ?? probe.deploymentSha;
  if (basis) {
    try {
      const { stdout } = await execa(
        "git",
        ["log", "--format=%s", `${basis}..origin/main`],
        { cwd, timeout: 15000 },
      );
      const subjects = stdout.split(/\r?\n/).filter(Boolean);
      const prNums = extractPrNumbers(subjects);
      let count = 0;
      for (const n of prNums) {
        try {
          const { stdout: prOut } = await execa(
            "gh",
            ["pr", "view", String(n), "--json", "labels"],
            { cwd, timeout: 15000 },
          );
          const pr = JSON.parse(prOut) as {
            labels?: Array<{ name?: string } | string>;
          };
          const labelNames = Array.isArray(pr.labels)
            ? pr.labels.map((l) =>
                l && typeof l === "object" ? (l.name ?? "") : String(l),
              )
            : [];
          if (labelsAreProductKind(labelNames)) count++;
        } catch {
          // A ref that is an issue (not a PR) / a 404 → skip it, like the digest.
        }
      }
      probe.mergedNotDeployed = count;
    } catch (e) {
      probe.mergedNotDeployedError = firstLine(e);
    }
  }

  return probe;
}
