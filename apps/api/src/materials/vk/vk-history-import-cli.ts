/**
 * 048 EARS-46 (#4005) — the argument half of the one-off VK history import's
 * operator entry (`vk-history-import.main.ts`). Kept apart from the entry so
 * it is testable without booting anything.
 */

export interface VkImportHistoryArgs {
  source: string;
}

export const VK_IMPORT_HISTORY_USAGE =
  "usage: vk-history-import --source <vk.com/address>";

/** A malformed command line: the problem, then the usage. */
export class VkImportHistoryUsageError extends Error {
  constructor(problem: string) {
    super(`${problem}\n${VK_IMPORT_HISTORY_USAGE}`);
    this.name = "Usage";
  }
}

/** Parse `--source <vk.com/address>`. */
export function parseVkImportHistoryArgs(
  argv: readonly string[],
): VkImportHistoryArgs {
  let source: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm --filter @ds/api vk:import-history -- --source …` forwards the
    // bare `--` separator itself.
    if (arg === "--") continue;
    if (arg !== "--source") {
      throw new VkImportHistoryUsageError(`unknown argument: ${arg}`);
    }
    const raw = argv[++i];
    if (raw === undefined || raw.startsWith("--")) {
      throw new VkImportHistoryUsageError("--source needs a value");
    }
    source = raw;
  }
  if (!source) {
    throw new VkImportHistoryUsageError(
      "--source <vk.com/address> is required",
    );
  }
  return { source };
}
