import "reflect-metadata";

import {
  ImportHistoryUsageError,
  parseImportHistoryArgs,
} from "./telegram-import-history-cli.js";
import {
  HistoryImportRefusedError,
  TelegramHistoryImport,
} from "./telegram-history-import.command.js";

/**
 * 048 EARS-30 (#3995, #4162) — the operator entry of the one-off Telegram
 * channel history import (048-design «One-off history import (EARS-30)»;
 * rollout step 5, once the source shows «Работает»). It boots an HTTP-less
 * Nest application context and drives `TelegramHistoryImport` once. The entry
 * lives under `src/` so it compiles into the api image's `dist/`, which
 * carries no `scripts/`, no tsx and no pnpm. It exports nothing and no module
 * imports it: it runs only when executed as the entry.
 *
 *   # on the API host — a one-off container of the api service with the
 *   # export folder mounted read-only (the image runs as `node`, so the
 *   # folder must be world-readable: chmod -R a+rX <export folder>):
 *   sudo docker compose run --rm --no-deps -v <export folder>:/export:ro api \
 *     node dist/materials/telegram/telegram-import-history.main.js \
 *     --source t.me/bbmacademy --export /export/result.json
 *   # on a workstation, against the dev stand:
 *   pnpm --filter @ds/api telegram:import-history -- \
 *     --source t.me/<address> --export <export folder>/result.json
 *
 * `--export` is the `result.json` of Telegram Desktop's «Export chat history»
 * in the machine-readable JSON format, with photos (and video thumbnails)
 * selected; the exported files are read next to it. Stdout is one JSON line
 * of counts — read, written, skipped as existing, skipped as media with no
 * text, dropped by reason, previews failed. A refusal (unparsable file, not a
 * channel export, another channel, a source with no bound Telegram id) prints
 * its reason to stderr, writes nothing and exits 1; malformed arguments print
 * the problem and the usage and exit 1. Re-running is safe: a message already
 * held is skipped.
 */
async function main(): Promise<void> {
  const args = parseImportHistoryArgs(process.argv.slice(2));
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  try {
    const report = await app.get(TelegramHistoryImport).run(args);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await app.close();
  }
}

// The exit CODE is set, never forced with `process.exit()`: the Nest context
// and the pg pool are still closing their handles when `main` resolves.
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err: unknown) => {
    // A refusal's reason, the usage, or an error's name and message — never a
    // post text (the import's errors carry none, EARS-36).
    process.stderr.write(
      `[telegram:import-history] ${
        err instanceof HistoryImportRefusedError
          ? `REFUSED — ${err.reason}; nothing written`
          : err instanceof ImportHistoryUsageError
            ? err.message
            : `FAILED — ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`
      }\n`,
    );
    process.exitCode = 1;
  });
