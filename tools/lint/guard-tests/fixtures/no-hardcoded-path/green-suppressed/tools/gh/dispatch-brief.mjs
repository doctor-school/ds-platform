// Fixture (GREEN): a machine-specific absolute repo-root literal deliberately
// acknowledged with a NON-EMPTY reason via the suppression hatch on the same
// line — the guard must NOT flag it.
export function renderBrief() {
  const root = "C:/Users/sidor/repos/ds-platform"; // no-hardcoded-path-ok: fixture literal exercised by the guard's own test
  return `worktree at ${root}/.claude/worktrees/915`;
}
