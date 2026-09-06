/** Bounded shell-write detector, not an arbitrary shell parser/security boundary.
 * Known literal writers are parsed; dynamic relevant writes are refused. Other
 * programs (including package scripts), aliases and interactive stdin need the
 * host sandbox and review. */
import { absolutePath, shellCommand } from "./hook-compat.mjs";
export function shellMutationPaths(input, cwd) {
  const command = shellCommand(input);
  if (typeof command !== "string") throw new Error("unparseable shell command");
  // Literal git checkpoint/inspection commands may mention writer names in a
  // quoted commit message. Ignore quoted data for the compound-command check.
  const outsideQuotes = command.replace(/"[^"\r\n]*"|'[^'\r\n]*'/g, "");
  if (
    /^\s*git\s+(?:status|diff|log|show|rev-parse|add|commit|push)\b/.test(
      command,
    ) &&
    !/[;&|`$<>\r\n]/.test(outsideQuotes)
  )
    return [];
  if (
    /^\s*git\b/.test(command) &&
    /\b(?:apply|checkout|restore|reset|clean|read-tree)\b/.test(outsideQuotes)
  )
    throw new Error(
      "git checkout mutation requires explicit isolated worktree review; use file tools for edits",
    );
  const writer =
    /\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Clear-Content|tee|touch|mkdir|rmdir|rm|mv|cp)\b|(?:^|\s)sed\s+-i\b|writeFile(?:Sync)?\s*\(|\.write_text\s*\(|\.write_bytes\s*\(|open\s*\([^\n]*,[\s]*['"](?:w|a)|(?:^|[^>])>{1,2}(?!&)/i;
  if (!writer.test(command)) return [];
  // Reject redirection and PowerShell array syntax before accepting a literal
  // writer; otherwise additional destinations escape the single-target check.
  if (/[;&|`$\r\n(){},<>]/.test(command))
    throw new Error(
      "dynamic/chained shell mutation, redirection or array cannot be isolated; use apply_patch or one literal file writer",
    );
  const tokens = command.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+/g) || [];
  const unquote = (s) => s.replace(/^(['"])(.*)\1$/, "$2");
  const cmd = tokens[0]?.toLowerCase();
  const paths = [];
  if (
    ["set-content", "add-content", "out-file", "clear-content"].includes(cmd)
  ) {
    const ix = tokens.findIndex((t) =>
      /^-(?:literalpath|path|filepath)$/i.test(t),
    );
    const target = ix >= 0 ? tokens[ix + 1] : tokens[1];
    if (!target || target.startsWith("-"))
      throw new Error("shell writer has no literal target");
    paths.push(unquote(target));
  } else if (["touch", "mkdir", "rm", "rmdir"].includes(cmd)) {
    paths.push(
      ...tokens
        .slice(1)
        .filter((t) => !t.startsWith("-"))
        .map(unquote),
    );
  } else {
    // Moves/copies/redirection/interpreter writes need a proper grammar to find
    // every source/destination. Fail closed rather than guessing from one path.
    throw new Error(
      "unparsed shell mutation; use apply_patch or a literal file writer",
    );
  }
  if (!paths.length || paths.some((p) => /[*?[\]<>]/.test(p)))
    throw new Error("shell mutation has ambiguous targets");
  return paths.map((p) => absolutePath(p, cwd));
}
