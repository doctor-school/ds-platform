#!/usr/bin/env tsx
import "reflect-metadata";

import {
  HistoryImportRefusedError,
  TelegramHistoryImport,
} from "../src/materials/telegram/telegram-history-import.command.js";

/**
 * 048 EARS-30 (#3995) — the operator entry point of the one-off Telegram
 * channel history import (048-design «One-off history import (EARS-30)»;
 * rollout step 5, once the source shows «Работает»). It boots an HTTP-less
 * Nest application context and drives `TelegramHistoryImport` once:
 *
 *   set -a; source <the environment's API env>; set +a
 *   pnpm --filter @ds/api telegram:import-history -- \
 *     --source t.me/bbmacademy --export <export folder>/result.json
 *
 * `--export` is the `result.json` of Telegram Desktop's «Export chat history»
 * in the machine-readable JSON format, with photos (and video thumbnails)
 * selected; the exported files are read next to it. Stdout is one JSON line
 * of counts — read, written, skipped as existing, skipped as media with no
 * text, dropped by reason, previews failed. A refusal (unparsable file, not a
 * channel export, another channel, a source with no bound Telegram id) prints
 * its reason to stderr, writes nothing and exits 1. Re-running is safe: a
 * message already held is skipped.
 */

interface Args {
  source: string;
  exportPath: string;
}

function value(argv: string[], index: number, flag: string): string {
  const raw = argv[index];
  if (raw === undefined || raw.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return raw;
}

function parseArgs(argv: string[]): Args {
  let source: string | undefined;
  let exportPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    // `pnpm --filter @ds/api telegram:import-history -- --source …` forwards
    // the bare `--` separator itself.
    if (arg === "--") continue;
    else if (arg === "--source") source = value(argv, ++i, "--source");
    else if (arg === "--export") exportPath = value(argv, ++i, "--export");
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!source) throw new Error("--source <t.me/address> is required");
  if (!exportPath)
    throw new Error("--export <path to result.json> is required");
  return { source, exportPath };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../src/app.module.js");
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
    // A refusal's reason, or an error's name and message — never a post text
    // (the import's errors carry none, EARS-36).
    process.stderr.write(
      `[telegram:import-history] ${
        err instanceof HistoryImportRefusedError
          ? `REFUSED — ${err.reason}; nothing written`
          : `FAILED — ${err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"}`
      }\n`,
    );
    process.exitCode = 1;
  });
