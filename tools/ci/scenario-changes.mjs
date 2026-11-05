import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Spec scenario files are docs-class for the `code` classifier, yet they are the
 * e2e suite's input (#3345): a binding to a project that generates with
 * `missingSteps: "fail-on-gen"` must fail generation on the PR, not on `main`.
 */
export function classifyScenarioChanges(paths) {
  return (
    paths.length === 0 ||
    paths.some((path) =>
      /^apps\/docs\/content\/specs\/features\/.+\.feature$/.test(path),
    )
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let selected = true;
  if (process.env.EVENT_NAME === "pull_request") {
    const diff = spawnSync(
      "git",
      [
        "diff",
        "--name-only",
        "-z",
        `${process.env.BASE_SHA}...${process.env.HEAD_SHA}`,
      ],
      { encoding: "utf8" },
    );
    if (diff.status !== 0)
      throw new Error("Cannot classify scenario changes: git diff failed");
    selected = classifyScenarioChanges(diff.stdout.split("\0").filter(Boolean));
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `scenarios=${selected}\n`);
  console.log(`Scenario generation selected: ${selected}`);
}
