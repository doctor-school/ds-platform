/**
 * 048 EARS-30 (#3995, #4162) — the argument half of the one-off Telegram
 * history import's operator entry (`telegram-import-history.main.ts`). Kept
 * apart from the entry so it is testable without booting anything.
 */

export interface ImportHistoryArgs {
  source: string;
  exportPath: string;
}

export const IMPORT_HISTORY_USAGE =
  "usage: telegram-import-history --source <t.me/address> --export <path to result.json>";

/** A malformed command line: the problem, then the usage. */
export class ImportHistoryUsageError extends Error {
  constructor(problem: string) {
    super(`${problem}\n${IMPORT_HISTORY_USAGE}`);
    this.name = "Usage";
  }
}

function value(argv: readonly string[], index: number, flag: string): string {
  const raw = argv[index];
  if (raw === undefined || raw.startsWith("--")) {
    throw new ImportHistoryUsageError(`${flag} needs a value`);
  }
  return raw;
}

/** Parse `--source <t.me/address> --export <result.json>`, in either order. */
export function parseImportHistoryArgs(
  argv: readonly string[],
): ImportHistoryArgs {
  let source: string | undefined;
  let exportPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm --filter @ds/api telegram:import-history -- --source …` forwards
    // the bare `--` separator itself.
    if (arg === "--") continue;
    else if (arg === "--source") source = value(argv, ++i, "--source");
    else if (arg === "--export") exportPath = value(argv, ++i, "--export");
    else throw new ImportHistoryUsageError(`unknown argument: ${arg}`);
  }
  if (!source)
    throw new ImportHistoryUsageError("--source <t.me/address> is required");
  if (!exportPath)
    throw new ImportHistoryUsageError(
      "--export <path to result.json> is required",
    );
  return { source, exportPath };
}
