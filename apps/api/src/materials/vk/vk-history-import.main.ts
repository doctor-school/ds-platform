import "reflect-metadata";

import {
  VkImportHistoryUsageError,
  parseVkImportHistoryArgs,
} from "./vk-history-import-cli.js";
import {
  VkHistoryImport,
  VkHistoryImportRefusedError,
} from "./vk-history-import.command.js";

/**
 * 048 EARS-46 (#4005) — the operator entry of the one-off VK wall history
 * import (048-design «One-off history import (EARS-46)»; rollout step 6, once
 * the source shows «Работает»). It boots an HTTP-less Nest application
 * context and drives `VkHistoryImport` once. The entry lives under `src/` so
 * it compiles into the api image's `dist/`, which carries no `scripts/`, no
 * tsx and no pnpm (the #4162 precedent of the Telegram import). It exports
 * nothing and no module imports it: it runs only when executed as the entry.
 *
 *   # on the API host — a one-off container of the api service:
 *   sudo docker compose run --rm --no-deps api \
 *     node dist/materials/vk/vk-history-import.main.js --source vk.com/bbm.academy
 *   # on a workstation, against the dev stand:
 *   pnpm --filter @ds/api vk:import-history -- --source vk.com/<address>
 *
 * Stdout is one JSON line of counts — read, written, skipped as existing,
 * dropped by reason, VK calls used, and `stopped` (null when the whole wall
 * was read). A refusal (not a VK address, an unlisted source, a source with
 * no bound VK community id, VK not configured) prints its reason to stderr,
 * writes nothing and exits 1. A stop before the month's VK calls would pass
 * 8 000 prints the counts, then its reason to stderr, and exits 1: what was
 * written stays, and a run next month completes the wall. Malformed
 * arguments print the problem and the usage and exit 1. Re-running is safe:
 * a post already held is skipped, so a complete re-run prints `written: 0`.
 */
async function main(): Promise<void> {
  const args = parseVkImportHistoryArgs(process.argv.slice(2));
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  try {
    const report = await app.get(VkHistoryImport).run(args);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.stopped !== null) {
      process.stderr.write(
        `[vk:import-history] STOPPED — ${report.stopped}; what was written stays\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

// The exit CODE is set, never forced with `process.exit()`: the Nest context
// and the pg pool are still closing their handles when `main` resolves.
main()
  .then(() => {
    process.exitCode ??= 0;
  })
  .catch((err: unknown) => {
    // A refusal's reason, the usage, or an error's name and message — never a
    // post text (the import's errors carry none, EARS-51).
    process.stderr.write(
      `[vk:import-history] ${
        err instanceof VkHistoryImportRefusedError
          ? `REFUSED — ${err.reason}; nothing written`
          : err instanceof VkImportHistoryUsageError
            ? err.message
            : `FAILED — ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`
      }\n`,
    );
    process.exitCode = 1;
  });
