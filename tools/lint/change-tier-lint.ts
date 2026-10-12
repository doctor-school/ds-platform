#!/usr/bin/env tsx
/**
 * change-tier (BLOCK, #2584) — the PR body's declared `Change-tier:` must not
 * be below the minimum tier its changed-file set determines. Absent or
 * malformed declarations resolve to `ask` and always pass.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { execa } from "execa";

import { ghViewJson } from "./lib/gh";
import {
  normalizeTierFiles,
  resolveTier,
  type ChangeTierFile,
} from "./lib/change-tier";

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
  const files = normalizeTierFiles(pr.files ?? []);
  if (files.some((file) => file.path.endsWith(".feature")))
    await attachFeaturePatches(prNumber, files);
  const tier = resolveTier(
    pr.body ?? "",
    files,
    typeof pr.changedFiles === "number" ? pr.changedFiles : undefined,
  );
  if (!tier.effective)
    fail(
      `PR #${pr.number} declares Change-tier ${tier.declared}, but its changes require at least ${tier.minimum}:\n` +
        tier.reasons.map((reason) => `  - ${reason}`).join("\n"),
    );
  info(
    `PR #${pr.number} tier ${tier.declared} (minimum ${tier.minimum}${tier.testOnly ? ", test-only" : ""})`,
  );
}

/**
 * #2807: `gh pr view --json files` carries no patch; a spec `.feature` is a
 * test only when its hunks prove the scenario text unchanged, so read them
 * from the REST listing. A failed read leaves the patch absent ⇒ ask.
 */
async function attachFeaturePatches(
  prNumber: string,
  files: ChangeTierFile[],
): Promise<void> {
  let raw: string;
  const fixtureDir = process.env.LINT_GH_FIXTURE_DIR;
  try {
    raw = fixtureDir
      ? readFileSync(resolve(fixtureDir, `pr-files-${prNumber}.json`), "utf8")
      : (
          await execa(
            "gh",
            [
              "api",
              `repos/{owner}/{repo}/pulls/${prNumber}/files?per_page=100`,
              "--paginate",
              "--slurp",
            ],
            { cwd: REPO_ROOT },
          )
        ).stdout;
  } catch (e) {
    info(
      `could not read .feature patches: ${(e as Error).message.split("\n")[0]}`,
    );
    return;
  }
  const pages = JSON.parse(raw) as Record<string, unknown>[][];
  const patches = new Map(
    normalizeTierFiles(pages.flat()).map((file) => [file.path, file.patch]),
  );
  for (const file of files) {
    const patch = patches.get(file.path);
    if (typeof patch === "string") file.patch = patch;
  }
}

main().catch((e) => {
  process.stderr.write(
    `${TAG} unexpected error: ${(e as Error).stack ?? String(e)}\n`,
  );
  process.exit(1);
});
