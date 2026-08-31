// DS Platform — release-blocker + open-batched-Stage-B deploy gate (#1662).
//
// Two fail-closed pre-flight checks `pnpm deploy:prod` runs BEFORE shipping
// `origin/main` to prod. Both encode the same invariant the release-cycle spec
// §10 states in prose — `main` is deployable by default, and anything known to
// be NOT shippable is recorded where a machine can read it:
//
//   1. release-blocker label — an OPEN Issue carrying `release-blocker` holds
//      every deploy until it is closed (or the deploy is explicitly exempted).
//      This is the tracked counterpart of the revert norm: a merged PR found
//      broken ahead of its fix is REVERTED from `main`; when a revert is
//      disproportionate, the Issue gets `release-blocker` instead.
//   2. Open batched Stage-B gate — a merged-but-not-yet-deployed PR whose body
//      carries `Stage-B: batched at #<gate>` (the AGENTS.md §6 batched
//      carve-out) has, by construction, NOT been live-verified by the product
//      owner. Shipping it to prod would consume the deferral the carve-out only
//      ever granted for merging. So the gate holds until the gate Issue closes.
//
// Fail-closed by design (mirrors the live-broadcast hold in `prod.mjs`): an
// UNKNOWN — the delta basis could not be derived, a `gh` call errored — HOLDS
// the deploy rather than waving it through. The single escape hatch is the
// explicit, loudly printed `--release-gate-exempt "<reason>"` flag, mirroring
// `--mode-a-exempt` in `tools/gh/merge-gate.mjs`: a non-empty reason is
// mandatory and there is NO silent auto-detection.
//
// Shape mirrors `tools/project-reality.ts`: an I/O **probe** seam that never
// throws, a **pure evaluator**, and pure **formatters** — the pure pieces are
// unit-tested (tools/lint/guard-tests/release-gate.spec.ts) with fabricated
// probes, no subprocess and no network.

import { spawnSync } from "node:child_process";

import { extractPrNumbers } from "./release-notes.mjs";

/** The label an Issue carries to hold every prod deploy until it is closed. */
export const RELEASE_BLOCKER_LABEL = "release-blocker";

/** The explicit escape flag (mirrors `--mode-a-exempt`). */
export const RELEASE_GATE_EXEMPT_FLAG = "--release-gate-exempt";

// ── pure: CLI flag ──────────────────────────────────────────────────────────

/**
 * Parse `--release-gate-exempt "<reason>"`. A non-empty reason is mandatory
 * (auditable, the same contract `--mode-a-exempt` and `--no-verify` carry) and
 * there is NO silent auto-detection.
 *
 * @param {string[]} args raw CLI args
 * @returns {{exempt: boolean, reason: string|null, error?: string}}
 */
export function parseReleaseGateExempt(args) {
  const list = Array.isArray(args) ? args : [];
  const i = list.indexOf(RELEASE_GATE_EXEMPT_FLAG);
  if (i === -1) return { exempt: false, reason: null };
  const raw = list[i + 1];
  if (typeof raw !== "string" || raw.trim() === "" || raw.startsWith("--")) {
    return {
      exempt: false,
      reason: null,
      error:
        `${RELEASE_GATE_EXEMPT_FLAG} requires a non-empty reason, e.g. ` +
        `${RELEASE_GATE_EXEMPT_FLAG} "owner go: #1642 fix ships in this very range"`,
    };
  }
  return { exempt: true, reason: raw.trim() };
}

// ── pure: batched-Stage-B marker parsing ────────────────────────────────────

// Same marker shape `tools/lint/stage-b-lint.ts` parses (AGENTS.md §6): a
// `Stage-B:` line whose value is `batched at #<gate>`. Leading blockquote /
// list decoration and `StageB` casing are tolerated, exactly as there.
const MARKER_RE = /^[ \t>*_-]*stage-?b\s*:\s*(.+?)\s*$/gim;
const BATCHED_RE = /^batched\s+at\s+#(\d+)/i;

/**
 * Gate Issue numbers referenced by `Stage-B: batched at #<gate>` markers in a
 * PR body. Deduped, in first-seen order; a body with no batched marker (a
 * `Stage-B: GO`, a lead self-cert, or nothing at all) yields `[]`.
 *
 * @param {string|null|undefined} body
 * @returns {number[]}
 */
export function extractBatchedGateRefs(body) {
  if (typeof body !== "string" || body.length === 0) return [];
  const out = [];
  MARKER_RE.lastIndex = 0;
  let m;
  while ((m = MARKER_RE.exec(body)) !== null) {
    const value = m[1] ?? "";
    const batched = BATCHED_RE.exec(value.trim());
    if (!batched) continue;
    const n = Number(batched[1]);
    if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

// ── pure: evaluator + formatter ─────────────────────────────────────────────

/**
 * @typedef {Object} ReleaseGateProbe
 * @property {Array<{number:number,title:string}>|null} blockers OPEN Issues
 *   carrying `release-blocker`; `null` when the query failed (fail-closed).
 * @property {string=} blockersError first line of the blocker-query error.
 * @property {Array<{pr:number,gate:number,gateTitle:string}>|null} openBatched
 *   merged-undeployed PR → OPEN batched-Stage-B gate pairs; `null` when the
 *   delta could not be enumerated (fail-closed).
 * @property {string=} openBatchedError first line of the delta error.
 * @property {string|null} basisSha the deployed SHA the delta was computed from.
 */

/**
 * Reduce a probe to a hold/clear verdict. PURE — no I/O.
 *
 * HOLD on: any open `release-blocker` Issue; any merged-undeployed PR whose
 * batched-Stage-B gate Issue is still open; OR any UNKNOWN (a `null` list —
 * the evidence was not obtainable, so the gate cannot claim it is clear).
 *
 * @param {ReleaseGateProbe} probe
 * @returns {{hold: boolean, reasons: string[]}}
 */
export function evaluateReleaseGate(probe) {
  const reasons = [];
  const p = probe ?? {};

  if (!Array.isArray(p.blockers)) {
    reasons.push(
      `UNKNOWN: could not list open \`${RELEASE_BLOCKER_LABEL}\` Issues` +
        (p.blockersError ? ` (${p.blockersError})` : "") +
        " — fail-closed",
    );
  } else if (p.blockers.length > 0) {
    reasons.push(
      `${p.blockers.length} open \`${RELEASE_BLOCKER_LABEL}\` Issue(s) hold the release:`,
    );
    for (const b of p.blockers) reasons.push(`    #${b.number} ${b.title}`);
  }

  if (!Array.isArray(p.openBatched)) {
    reasons.push(
      "UNKNOWN: could not enumerate the merged-but-not-deployed PR delta" +
        (p.openBatchedError ? ` (${p.openBatchedError})` : "") +
        " — fail-closed",
    );
  } else if (p.openBatched.length > 0) {
    reasons.push(
      `${p.openBatched.length} merged-undeployed PR(s) defer Stage-B to a still-OPEN gate:`,
    );
    for (const b of p.openBatched) {
      reasons.push(
        `    PR #${b.pr} → gate #${b.gate} ${b.gateTitle}`.trimEnd(),
      );
    }
  }

  return { hold: reasons.length > 0, reasons };
}

/**
 * The operator-facing hold message for a verdict, or `null` when it is clear.
 * PURE — the caller decides whether to `die()` with it.
 *
 * @param {{hold: boolean, reasons: string[]}} verdict
 * @returns {string|null}
 */
export function formatReleaseGateHold(verdict) {
  if (!verdict || !verdict.hold) return null;
  return (
    `release gate (spec §10 — \`main\` stays deployable by default):\n  ` +
    verdict.reasons.join("\n  ") +
    `\n  Resolve by closing the blocker(s) / the batched Stage-B gate, or by\n` +
    `  REVERTING the offending PR from \`main\` (spec §10 revert norm). An\n` +
    `  owner-approved ship past this gate is explicit:\n` +
    `      pnpm deploy:prod ${RELEASE_GATE_EXEMPT_FLAG} "<reason>"`
  );
}

/** The clear line (single source for the `ok(...)` text). */
export function formatReleaseGateClear(basisSha) {
  const basis = basisSha ? ` (delta basis ${basisSha.slice(0, 12)})` : "";
  return `release gate clear — no open ${RELEASE_BLOCKER_LABEL} Issue, no open batched Stage-B gate${basis}`;
}

// ── I/O probe seam (never throws) ───────────────────────────────────────────

function firstLine(e) {
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

/** Capture a command's stdout; throws with a one-line message on failure. */
function capture(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(
      `\`${cmd} ${args.join(" ")}\` exited ${r.status}: ${(r.stderr || r.stdout || "").trim().split("\n")[0]}`,
    );
  }
  return (r.stdout || "").trim();
}

/**
 * Gather the gate's evidence. NEVER throws — every failure degrades to a `null`
 * list plus an error string, which `evaluateReleaseGate` reads as UNKNOWN and
 * therefore HOLDS.
 *
 * The merged-but-not-deployed delta is enumerated exactly the way the
 * `## Project reality` bootstrap section does it (`tools/project-reality.ts`
 * step 4): basis = the latest `production` GitHub Deployment's SHA, range =
 * `<basis>..<targetSha>`, PR numbers via the shared `extractPrNumbers` seam
 * from `release-notes.mjs` — never a bespoke re-implementation (#847).
 *
 * @param {{targetSha: string, cwd?: string, run?: (cmd: string, args: string[]) => string}} opts
 * @returns {Promise<ReleaseGateProbe>}
 */
export async function probeReleaseGate({ targetSha, cwd, run } = {}) {
  const exec = run ?? ((cmd, args) => capture(cmd, args, cwd));
  /** @type {ReleaseGateProbe} */
  const probe = { blockers: null, openBatched: null, basisSha: null };

  // 1. Open `release-blocker` Issues.
  try {
    const raw = exec("gh", [
      "issue",
      "list",
      "--label",
      RELEASE_BLOCKER_LABEL,
      "--state",
      "open",
      "--json",
      "number,title",
      "--limit",
      "100",
    ]);
    const arr = JSON.parse(raw || "[]");
    probe.blockers = Array.isArray(arr)
      ? arr.map((i) => ({
          number: Number(i.number),
          title: String(i.title ?? "").trim(),
        }))
      : [];
  } catch (e) {
    probe.blockersError = firstLine(e);
  }

  // 2. Merged-but-not-deployed PRs whose batched Stage-B gate is still open.
  try {
    const raw = exec("gh", [
      "api",
      "repos/{owner}/{repo}/deployments?environment=production&per_page=1",
    ]);
    const deployments = JSON.parse(raw || "[]");
    const d = Array.isArray(deployments) ? deployments[0] : null;
    const basis =
      d && typeof d.sha === "string"
        ? d.sha
        : d && typeof d.ref === "string"
          ? d.ref
          : null;
    if (!basis) {
      throw new Error(
        "no production GitHub Deployment recorded — no basis for the merged-undeployed delta",
      );
    }
    probe.basisSha = basis;

    const subjects = exec("git", [
      "log",
      "--format=%s",
      `${basis}..${targetSha}`,
    ])
      .split(/\r?\n/)
      .filter(Boolean);
    const prNumbers = extractPrNumbers(subjects);

    const pairs = [];
    /** @type {Map<number, {state: string, title: string}>} */
    const gateCache = new Map();
    for (const n of prNumbers) {
      let body;
      try {
        const prRaw = exec("gh", ["pr", "view", String(n), "--json", "body"]);
        body = JSON.parse(prRaw || "{}").body ?? "";
      } catch {
        // A ref that is an Issue (not a PR) / a 404 → skip it, like the digest.
        continue;
      }
      for (const gate of extractBatchedGateRefs(body)) {
        let info = gateCache.get(gate);
        if (!info) {
          const gateRaw = exec("gh", [
            "issue",
            "view",
            String(gate),
            "--json",
            "state,title",
          ]);
          const parsed = JSON.parse(gateRaw || "{}");
          info = {
            state: String(parsed.state ?? "").toUpperCase(),
            title: String(parsed.title ?? "").trim(),
          };
          gateCache.set(gate, info);
        }
        if (info.state === "OPEN") {
          pairs.push({ pr: n, gate, gateTitle: info.title });
        }
      }
    }
    probe.openBatched = pairs;
  } catch (e) {
    probe.openBatchedError = firstLine(e);
  }

  return probe;
}
