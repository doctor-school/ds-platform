#!/usr/bin/env tsx
/**
 * change-tier (BLOCK, #2584) — the PR body's declared `Change-tier:` must not
 * be below the minimum tier its changed-file set determines. Absent or
 * malformed declarations resolve to `ask` and always pass.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ghViewJson } from "./lib/gh";
import { normalizeTierFiles, resolveTier } from "./lib/change-tier";

const TAG = "[change-tier]";

const REPO_ROOT = process.env.LINT_FIXTURE_ROOT
  ? resolve(process.env.LINT_FIXTURE_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface GhPR {
  number: number;
  body?: string;
  changedFiles?: number;
  files?: Record<string, unknown>[];
}

function info(message: string): void {
  process.stdout.write(`${TAG} ${message}\n`);
}
function fail(message: string): never {
  process.stderr.write(`${TAG} ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request")
    return info("not a pull_request event, skipping");
  const prNumber = process.env.PR_NUMBER ?? process.env.GITHUB_PR_NUMBER ?? "";
  if (!prNumber) return info("cannot determine PR number, skipping");
  const response = await ghViewJson<GhPR>(
    "pr",
    prNumber,
    "number,body,files,changedFiles",
    REPO_ROOT,
  );
  if (!response.ok) fail(`could not fetch PR #${prNumber}: ${response.error}`);
  const pr = response.data;
  const tier = resolveTier(
    pr.body ?? "",
    normalizeTierFiles(pr.files ?? []),
    typeof pr.changedFiles === "number" ? pr.changedFiles : undefined,
  );
  if (!tier.effective)
    fail(
      `PR #${pr.number} declares Change-tier ${tier.declared}, but its changes require at least ${tier.minimum}:\n` +
        tier.reasons.map((reason) => `  - ${reason}`).join("\n"),
    );
  info(`PR #${pr.number} tier ${tier.declared} (minimum ${tier.minimum})`);
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
