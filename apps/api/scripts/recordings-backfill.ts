#!/usr/bin/env tsx
import "reflect-metadata";

import { readFile } from "node:fs/promises";

import {
  backfillDepsFrom,
  parseBackfillManifest,
  runRecordingsBackfill,
} from "../src/recordings/recordings-backfill.js";

/**
 * 014 EARS-29 (#1892) — the operator entry point of the platform-born recording
 * backfill (014-design §3.2; the Product Lead's Stage-A choice, 2026-09-05: an
 * operator CLI, not an admin screen).
 *
 * It boots an HTTP-less Nest application context — the same graph the API serves
 * — resolves the ordinary 014 recording commands and drives them once per
 * manifest row, exactly as an operator clicking the «Записи» tab would. It owns
 * no write of its own; see `src/recordings/recordings-backfill.ts`.
 *
 * Run with the target environment injected (no dotenv autoload — see
 * `.claude/rules/dev-stand.md`):
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   pnpm --filter @ds/api recordings:backfill -- \
 *     --manifest ./backfill.json --actor <zitadel-sub> --dry-run
 *
 * Stdout is the machine-readable contract: one JSON object per manifest row,
 * then a final `{"summary":{…}}` line. Exits non-zero when the manifest cannot
 * be read or parsed, or when a row fails for a reason that is NOT a reported
 * refusal — a refused row is a result, not a crash, and the run continues.
 */

interface Args {
  manifest: string;
  actor: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let manifest: string | undefined;
  let actor: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--manifest") manifest = argv[++i];
    else if (arg === "--actor") actor = argv[++i];
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!manifest) throw new Error("--manifest <path> is required");
  // The operator is not optional: every row this run commits is attributed to
  // them in the feature-010 ledger, and an unattributed backfill is exactly the
  // `db-direct` write 010 EARS-4 exists to make visible.
  if (!actor) throw new Error("--actor <zitadel-sub> is required");
  return { manifest, actor, dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = parseBackfillManifest(
    JSON.parse(await readFile(args.manifest, "utf8")),
  );

  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../src/app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  try {
    const report = await runRecordingsBackfill(
      backfillDepsFrom(app),
      manifest,
      { actorSub: args.actor, dryRun: args.dryRun },
    );
    for (const entry of report.entries) {
      process.stdout.write(`${JSON.stringify(entry)}\n`);
    }
    process.stdout.write(
      `${JSON.stringify({ dryRun: args.dryRun, summary: report.summary })}\n`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(
      `[recordings:backfill] FAILED — ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    process.exit(1);
  });
