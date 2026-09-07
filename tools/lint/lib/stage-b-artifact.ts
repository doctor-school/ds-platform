import { execa } from "execa";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve an exact GitHub comment/review artifact; a bare URL is not evidence. */
export async function stageBArtifact(
  url: string,
  cwd: string,
): Promise<string> {
  const match =
    /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)#(issuecomment-|discussion_r|pullrequestreview-)(\d+)$/.exec(
      url,
    );
  if (!match)
    throw new Error(
      `Stage-B artifact must name an exact GitHub comment/review: ${url}`,
    );
  const [, owner, repo, , number, kind, id] = match;
  if (process.env.LINT_GH_FIXTURE_DIR) {
    return JSON.parse(
      readFileSync(
        resolve(process.env.LINT_GH_FIXTURE_DIR, `artifact-${id}.json`),
        "utf8",
      ),
    ).body;
  }
  const endpoint =
    kind === "issuecomment-"
      ? `issues/comments/${id}`
      : kind === "discussion_r"
        ? `pulls/comments/${id}`
        : `pulls/${number}/reviews/${id}`;
  const { stdout } = await execa(
    "gh",
    ["api", `repos/${owner}/${repo}/${endpoint}`],
    { cwd },
  );
  const artifact = JSON.parse(stdout);
  if (typeof artifact.body !== "string" || artifact.state === "DISMISSED")
    throw new Error("Stage-B artifact unavailable or dismissed");
  return artifact.body;
}
