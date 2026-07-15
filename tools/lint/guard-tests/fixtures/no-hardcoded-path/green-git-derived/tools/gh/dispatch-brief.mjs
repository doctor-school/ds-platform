// Fixture (GREEN): the sanctioned pattern — the repo root is derived at runtime
// via `git rev-parse --show-toplevel`, never a hardcoded literal. The header
// comment may even mention that git prints a forward-slash `C:/Users/...` path
// on Windows; comments are documentation, not runtime literals, and are ignored.
import { execSync } from "node:child_process";

export function renderBrief() {
  const root = execSync("git rev-parse --show-toplevel").toString().trim();
  return `worktree at ${root}/.claude/worktrees/915`;
}
