#!/usr/bin/env tsx
/** Pre-merge Stage-B: current, attributed live verdict or bounded documented carve-out. */
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { isUiSourcePath } from "./lib/ui-surface";
import { stageBArtifact } from "./lib/stage-b-artifact";
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

const DS_RE = /^packages\/design-system\//;
// `feature:NNN-<slug>` area label → the slug IS the spec folder name (mirrors
// spec-link-lint.ts FEATURE_AREA_RE).
const FEATURE_AREA_RE = /^feature:(\d{3}-[a-z0-9][a-z0-9-]*)$/i;

interface GhLabel {
  name: string;
}
interface GhPR {
  number: number;
  body: string;
  headRefOid?: string;
  comments?: StageBRecord[];
  updatedAt?: string;
  labels?: GhLabel[];
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
    "number,body,labels,files,headRefOid,comments,updatedAt",
    REPO_ROOT,
    true,
  );
  if (!res.ok) {
    process.stderr.write(
      `${TAG} gh pr view ${prNumber} failed: ${res.error}\n`,
    );
    return null;
  }
  return res.data;
}

async function ghIssue(num: number): Promise<GhIssue | null> {
  const res = await ghViewJson<GhIssue>(
    "issue",
    num,
    "number,body,comments",
    REPO_ROOT,
  );
  if (!res.ok) {
    process.stderr.write(`${TAG} gh issue view ${num} failed: ${res.error}\n`);
    return null;
  }
  return res.data;
}

// GitHub auto-close keywords (case-insensitive), mirrors spec-link-lint.ts.
const CLOSE_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
function extractClosedIssues(body: string): number[] {
  const out = new Set<number>();
  if (!body) return [];
  for (const m of body.matchAll(CLOSE_RE)) out.add(Number(m[1]));
  return [...out];
}

/**
 * Read a linked feature spec's `surface:` frontmatter value. Resolves the spec
 * folder from the `feature:NNN-<slug>` label (like spec-link-lint.ts), reads
 * `NNN-requirements.md` or `-en`, and pulls `surface:` from the leading YAML
 * frontmatter block. Returns the value (e.g. `user-facing`) or null if the label
 * is not a feature area label, the folder/file is absent, or no `surface:` key.
 */
async function specSurfaceForLabel(labelName: string): Promise<string | null> {
  const m = labelName.match(FEATURE_AREA_RE);
  if (!m) return null;
  const slug = m[1];
  const nnn = slug.slice(0, 3);
  const folder = resolve(
    REPO_ROOT,
    "apps",
    "docs",
    "content",
    "specs",
    "features",
    slug,
  );
  for (const file of [`${nnn}-requirements.md`, `${nnn}-requirements-en.md`]) {
    const path = resolve(folder, file);
    if (!(await exists(path))) continue;
    const text = readFileSync(path, "utf8");
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return null;
    const surface = fm[1].match(/^surface:\s*(\S+)/m);
    return surface ? surface[1].trim() : null;
  }
  return null;
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
  const productFiles = renderable.filter((p) => !DS_RE.test(p));
  const dsFiles = renderable.filter((p) => DS_RE.test(p));

  // Frontmatter heuristic: a DS-only render change is user-facing only when a
  // linked feature spec is `surface: user-facing`.
  let specUserFacing = false;
  let specNote = "";
  if (productFiles.length === 0 && dsFiles.length > 0) {
    for (const label of pr.labels ?? []) {
      const surface = await specSurfaceForLabel(label.name);
      if (surface === "user-facing") {
        specUserFacing = true;
        specNote = ` (linked spec ${label.name} is surface: user-facing)`;
        break;
      }
    }
  }

  const isUserFacing =
    productFiles.length > 0 || (dsFiles.length > 0 && specUserFacing);

  if (!isUserFacing) {
    info(
      `PR #${pr.number} touches no user-facing render surface (apps/portal|admin|academy-demo, or a design-system change under a user-facing spec), rule does not apply`,
    );
    process.exit(0);
  }

  const trigger =
    productFiles.length > 0
      ? `${productFiles.length} product UI file(s), e.g. ${productFiles.slice(0, 3).join(", ")}`
      : `${dsFiles.length} design-system render file(s)${specNote}`;
  info(`PR #${pr.number} is user-facing: ${trigger}`);

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
  const decision = stageBDecisions(records).at(-1);
  const batch = decision?.value.match(/^batched at #(\d+)$/i);
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
      ...(gate.comments ?? []).filter((c) => /^Stage-B:/im.test(c.body)),
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
  for (const record of decision ? [decision] : []) {
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
