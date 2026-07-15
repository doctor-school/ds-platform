// Fixture (RED): a machine-specific absolute repo-root literal with a bare
// `// no-hardcoded-path-ok:` (no reason) on the same line. The empty-reason
// hatch must NOT suppress — the guard still flags the hardcoded path.
export function renderBrief() {
  const root = "C:/Users/sidor/repos/ds-platform"; // no-hardcoded-path-ok:
  return `worktree at ${root}/.claude/worktrees/915`;
}
