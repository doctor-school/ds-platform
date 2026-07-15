// Fixture (RED): a machine-specific absolute repo-root path baked into runtime
// code — the exact #933 shape (a `C:/Users/<user>/repos/ds-platform/` literal
// standing in for a git-derived root). The guard must flag this.
export function renderBrief() {
  const root = "C:/Users/sidor/repos/ds-platform";
  return `worktree at ${root}/.claude/worktrees/915`;
}
