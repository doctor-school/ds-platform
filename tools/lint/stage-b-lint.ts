#!/usr/bin/env tsx
/** Pre-merge Stage-B: current, attributed live verdict or bounded documented carve-out. */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { isUiSourcePath } from "./lib/ui-surface";
import { stageBArtifact } from "./lib/stage-b-artifact";
import { stageBComments } from "./lib/stage-b-comments";
import {
  validateStageB,
  stageBDecisions,
  stageBField,
  type StageBRecord,
} from "./lib/stage-b-evidence";

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
  files?: { path: string }[];
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
    "number,body,labels,files,headRefOid,updatedAt",
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
  const verdict = validateStageB(
    records,
    pr.headRefOid ?? "",
    renderable,
    gates,
  );
  if (!verdict.ok) fail(`PR #${pr.number}: ${verdict.reason}`);
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
