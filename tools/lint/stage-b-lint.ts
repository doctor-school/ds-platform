#!/usr/bin/env tsx
/** Pre-merge Stage-B: current, attributed live verdict or bounded documented carve-out. */
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { isUiSourcePath } from "./lib/ui-surface";
import {
  classifyChangeTier,
  isEnvironmentSensitivePath,
  isNonRuntimePath,
  normalizeTierFiles,
  resolveTier,
  type ChangeTier,
  type ChangeTierFile,
  type ResolvedTier,
} from "./lib/change-tier";
import { stageBArtifact } from "./lib/stage-b-artifact";
import { stageBComments } from "./lib/stage-b-comments";
import {
  instructionQuoteSource,
  validateStageB,
  stageBDecisions,
  stageBField,
  type StageBRecord,
} from "./lib/stage-b-evidence";
// #2373: the Mode (a) rebase carry-over probe (#1865), reused — never
// re-implemented. `merge-gate.mjs` guards its own entry point.
// #2699: the PR's own delta between two heads, net of main, from the same file.
import { checkRebaseEquivalence, prOwnDelta } from "../gh/merge-gate.mjs";
// #2581: the copy-only certification is the `ui-parity` guard's own verdict,
// reused so both guards read one reviewer line.
import { certifiedNaVerdict } from "./ui-parity-lint";

const TAG = "[stage-b]";

// TEST SEAM: `LINT_FIXTURE_ROOT` points the spec-folder reads at a fixture tree
// (the `gh` calls have their own `LINT_GH_FIXTURE_DIR` seam in lib/gh.ts). Inert
// in production — when unset the root resolves to the repo root exactly as
// before, so runtime behaviour is unchanged.
const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface GhPR {
  number: number;
  body: string;
  headRefOid?: string;
  comments?: StageBRecord[];
  updatedAt?: string;
  files?: ({ path: string } & Record<string, unknown>)[];
  changedFiles?: number;
  reviews?: Parameters<typeof certifiedNaVerdict>[1];
  statusCheckRollup?: GhCheck[];
}
interface GhCheck {
  name?: string;
  status?: string;
  conclusion?: string | null;
}
type GhComment = StageBRecord;
interface GhIssue {
  number: number;
  body?: string;
  comments?: GhComment[];
}

function fail(msg: string): never {
  process.stderr.write(`${TAG} ${msg}\n`);
  process.exit(1);
}
function info(msg: string): void {
  process.stdout.write(`${TAG} ${msg}\n`);
}

function resolvePrNumber(): string {
  let prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber && process.env.GITHUB_REF) {
    const m = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
    if (m) prNumber = m[1];
  }
  return prNumber;
}

async function ghPR(prNumber: string): Promise<GhPR | null> {
  const res = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,body,labels,files,changedFiles,headRefOid,updatedAt,reviews,statusCheckRollup",
    REPO_ROOT,
    true,
  );
  if (!res.ok) {
    process.stderr.write(
      `${TAG} gh pr view ${prNumber} failed: ${res.error}\n`,
    );
    return null;
  }
  return {
    ...res.data,
    comments: await stageBComments(prNumber, REPO_ROOT, res.data.comments),
  };
}

async function ghIssue(num: number): Promise<GhIssue | null> {
  const res = await ghViewJson<GhIssue>("issue", num, "number,body", REPO_ROOT);
  if (!res.ok) {
    process.stderr.write(`${TAG} gh issue view ${num} failed: ${res.error}\n`);
    return null;
  }
  return {
    ...res.data,
    comments: await stageBComments(num, REPO_ROOT, res.data.comments),
  };
}

// GitHub auto-close keywords (case-insensitive), mirrors spec-link-lint.ts.
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
function extractClosedIssues(body: string): number[] {
  const out = new Set<number>();
  if (!body) return [];
  for (const m of body.matchAll(CLOSE_RE)) out.add(Number(m[1]));
  return [...out];
}

/** The affected-area CI e2e jobs (`.github/workflows/ci.yml`, #2597). */
const CI_E2E_CHECKS = [
  "api-e2e",
  "playwright-axe",
  "playwright-academy-demo",
  "playwright-axe-portal",
  "playwright-axe-doctor",
  "admin-e2e",
];

/**
 * #2699: the required CI e2e check on the PR head (the rollup is read in the
 * same `gh pr view` as `headRefOid`). The pre-CI merge-guard pass runs before
 * CI is terminal, so there a still-running check is tolerated; the post-CI
 * binding pass requires a success. A failed check refuses in both.
 */
function ciE2eOnHead(rollup: GhCheck[] | undefined): {
  ok: boolean;
  detail: string;
} {
  const latest = new Map<string, GhCheck>();
  for (const check of rollup ?? [])
    if (check.name && CI_E2E_CHECKS.includes(check.name))
      latest.set(check.name, check);
  const runs = [...latest.values()];
  const done = (c: GhCheck) => (c.status ?? "").toUpperCase() === "COMPLETED";
  const conclusion = (c: GhCheck) => (c.conclusion ?? "").toUpperCase();
  const failed = runs.filter(
    (c) =>
      done(c) && !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(conclusion(c)),
  );
  if (failed.length)
    return {
      ok: false,
      detail: failed
        .map((c) => `${c.name} ${conclusion(c).toLowerCase() || "unknown"}`)
        .join(", "),
    };
  const passed = runs.filter((c) => done(c) && conclusion(c) === "SUCCESS");
  const pending = runs.filter((c) => !done(c)).map((c) => c.name);
  if (pending.length || !passed.length) {
    const detail = pending.length
      ? `CI e2e still running: ${pending.join(", ")}`
      : `no CI e2e check (${CI_E2E_CHECKS.join(", ")}) succeeded on the head`;
    return process.env.STAGE_B_CI_PHASE === "pre-ci"
      ? { ok: true, detail: `${detail}; the post-CI pass re-checks it` }
      : { ok: false, detail };
  }
  return {
    ok: true,
    detail: `${passed.map((c) => `${c.name} success`).join(", ")} on the head`,
  };
}

const ROUTE_ORDER: Record<ChangeTier, number> = { ship: 0, show: 1, ask: 2 };

/**
 * #2699: the Stage-B route comes from the PR's runtime files only. A
 * declaration the non-runtime files forced up to the whole-PR minimum (a spec
 * line, a test, an evidence capture) routes Stage-B by the runtime minimum; a
 * declaration above the whole-PR minimum is the author's own escalation and
 * stands. The change-tier guard and Mode (a) keep the whole-PR minimum.
 */
function stageBRouteTier(
  tier: ResolvedTier,
  files: ChangeTierFile[],
): ChangeTier {
  if (tier.effective === null) return "ask";
  if (tier.reasons.some((r) => /^(?:incomplete|no changed-file)/.test(r)))
    return "ask";
  if (ROUTE_ORDER[tier.declared] > ROUTE_ORDER[tier.minimum])
    return tier.declared;
  const runtime = files.filter(
    (f) =>
      !isNonRuntimePath(f.path) ||
      (f.previousPath !== undefined && !isNonRuntimePath(f.previousPath)),
  );
  const { minimum } = classifyChangeTier(runtime);
  return ROUTE_ORDER[minimum] < ROUTE_ORDER[tier.declared]
    ? minimum
    : tier.declared;
}

/** #2699: the repo instruction files an owner quote must not be copied from. */
function instructionDocs(): Record<string, string> {
  const docs: Record<string, string> = {};
  const add = (rel: string) => {
    try {
      docs[rel] = readFileSync(resolve(REPO_ROOT, rel), "utf8");
    } catch {
      // absent in this checkout: nothing to compare against
    }
  };
  for (const rel of [
    "AGENTS.md",
    "CLAUDE.md",
    "apps/docs/content/agent-discipline.md",
  ])
    add(rel);
  for (const dir of [".claude/rules", "apps/docs/content/skills"]) {
    let entries: string[] = [];
    try {
      entries = readdirSync(resolve(REPO_ROOT, dir), {
        recursive: true,
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    for (const entry of entries)
      if (/\.mdx?$/.test(entry)) add(`${dir}/${entry.replace(/\\/g, "/")}`);
  }
  return docs;
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    info(
      `not a pull_request event (GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME ?? "unset"}), skipping`,
    );
    process.exit(0);
  }
  const prNumber = resolvePrNumber();
  if (!prNumber) {
    info("cannot determine PR number from environment, skipping");
    process.exit(0);
  }
  const pr = await ghPR(prNumber);
  if (!pr) fail(`could not fetch PR #${prNumber} metadata`);

  const files = (pr.files ?? []).map((f) => f.path);
  const renderable = files.filter(isUiSourcePath);
  if (!renderable.length) {
    info(
      `PR #${pr.number} touches no user-facing render surface, rule does not apply`,
    );
    process.exit(0);
  }
  info(
    `PR #${pr.number} is user-facing: ${renderable.length} rendered source file(s), e.g. ${renderable.slice(0, 3).join(", ")}`,
  );

  const records: StageBRecord[] = [
    { body: pr.body ?? "", updatedAt: pr.updatedAt },
    ...(pr.comments ?? []),
  ];
  for (const num of extractClosedIssues(pr.body ?? "")) {
    const issue = await ghIssue(num);
    if (!issue) fail(`Cannot reconcile linked Issue #${num} Stage-B decisions`);
    records.push(...(issue.comments ?? []));
  }
  const gates: Record<number, string> = {};
  const childDecision = stageBDecisions(records).at(-1);
  const batch = childDecision?.value.match(/^batched at #(\d+)$/i);
  if (batch) {
    const num = Number(batch[1]);
    const gate = await ghIssue(num);
    if (!gate) fail(`Cannot read batched Stage-B gate #${num}`);
    gates[num] = gate.body ?? "";
    const prs = stageBField(gates[num], "deferred-prs").match(/#\d+/g) ?? [];
    if (!prs.includes(`#${pr.number}`))
      fail(
        `Gate #${num} does not name PR #${pr.number} in Stage-B-deferred-prs`,
      );
    records.push(
      ...(gate.comments ?? []).map((comment) => ({
        ...comment,
        batchContext: { gate: num, child: childDecision! },
      })),
    );
    const source = stageBField(gates[num], "source");
    if (source.startsWith("https:")) {
      const artifact = await stageBArtifact(source, REPO_ROOT);
      if (!artifact.includes(stageBField(gates[num], "owner-quote")))
        fail("Batched gate source does not contain its owner quote");
    }
  }
  const na = certifiedNaVerdict(pr.body ?? "", pr.reviews, pr.headRefOid);
  const copyOnly = na.ok && na.route === "copy-only";
  if (copyOnly)
    info(
      `PR #${pr.number} is reviewer-certified copy-only: a GO needs no live URL`,
    );
  // #2584: a declaration below its minimum gets the strictest (ask) rules here;
  // the change-tier guard refuses it on its own.
  const allFiles = normalizeTierFiles(pr.files ?? []);
  const tier = resolveTier(
    pr.body ?? "",
    allFiles,
    typeof pr.changedFiles === "number" ? pr.changedFiles : undefined,
  );
  const effectiveTier = stageBRouteTier(tier, allFiles);
  if (effectiveTier !== "ask")
    info(
      `PR #${pr.number} Stage-B route tier ${effectiveTier} (declared ${tier.declared}, whole-PR minimum ${tier.minimum})`,
    );
  const verdict = validateStageB(
    records,
    pr.headRefOid ?? "",
    renderable,
    gates,
    checkRebaseEquivalence,
    copyOnly,
    effectiveTier,
    {
      headDelta: prOwnDelta,
      slotFree: {
        environmentSensitive: allFiles
          .flatMap((f) => [f.path, f.previousPath ?? ""])
          .filter((p) => p && isEnvironmentSensitivePath(p)),
        ciE2e: ciE2eOnHead(pr.statusCheckRollup),
      },
    },
  );
  if (!verdict.ok) fail(`PR #${pr.number}: ${verdict.reason}`);
  // #2699: an owner quote is the owner's decision, never an instruction line.
  const docs = instructionDocs();
  for (const body of [verdict.decision.body, ...Object.values(gates)]) {
    const copied = instructionQuoteSource(
      stageBField(body, "owner-quote"),
      docs,
    );
    if (copied)
      fail(
        `Stage-B-owner-quote occurs verbatim in ${copied}: an instruction line is not an owner decision — record the owner's own words and their source`,
      );
  }
  // URL-backed sources are fetched; relays remain explicit session/message
  // attribution, never a claim that a shared GitHub login proves identity.
  for (const record of [verdict.decision]) {
    const source = stageBField(record.body, "source");
    if (source.startsWith("https:")) {
      const artifact = await stageBArtifact(source, REPO_ROOT);
      if (!artifact.includes(stageBField(record.body, "owner-quote")))
        fail("Stage-B source does not contain the exact recorded owner quote");
    }
    const report = record.body.match(/;\s*report:\s*(https:\/\/\S+)/i)?.[1];
    if (report) {
      const artifact = await stageBArtifact(report, REPO_ROOT);
      if (
        !artifact.includes(stageBField(record.body, "report-stdout")) ||
        !artifact.includes(pr.headRefOid ?? "")
      )
        fail(
          "Stage-B report does not contain the recorded stdout and current tested SHA",
        );
    }
  }
  info(verdict.reason);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
