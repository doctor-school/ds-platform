import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Instructions are executable process contracts even when their extension is markdown. */
export function classifyDisciplineChanges(paths) {
  return (
    paths.length === 0 ||
    paths.some(
      (path) =>
        /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(path) ||
        /^(?:\.claude\/|\.codex\/|apps\/docs\/content\/skills\/|tools\/|\.github\/)/.test(
          path,
        ),
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
      throw new Error("Cannot classify instruction changes: git diff failed");
    selected = classifyDisciplineChanges(
      diff.stdout.split("\0").filter(Boolean),
    );
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `discipline=${selected}\n`);
  console.log(`Discipline tests selected: ${selected}`);
}
