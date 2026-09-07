import { execa } from "execa";
import type { StageBRecord } from "./stage-b-evidence";

interface NativeComment extends StageBRecord {
  created_at?: string;
  updated_at?: string;
  html_url?: string;
}

/** gh view omits updatedAt; the paginated REST timeline preserves later edits. */
export async function stageBComments(
  number: string | number,
  cwd: string,
  fixtures?: StageBRecord[],
): Promise<StageBRecord[]> {
  let comments: NativeComment[];
  if (process.env.LINT_GH_FIXTURE_DIR) comments = fixtures ?? [];
  else {
    const { stdout } = await execa(
      "gh",
      [
        "api",
        `repos/{owner}/{repo}/issues/${number}/comments?per_page=100`,
        "--paginate",
        "--slurp",
      ],
      { cwd },
    );
    const pages = JSON.parse(stdout);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
      throw new Error("Malformed Stage-B comments pagination");
    comments = pages.flat();
  }
  return comments.map((comment) => ({
    body: comment.body,
    createdAt: comment.created_at ?? comment.createdAt,
    updatedAt: comment.updated_at ?? comment.updatedAt,
    url: comment.html_url ?? comment.url,
  }));
}
