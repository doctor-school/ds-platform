import "reflect-metadata";

import { PartnershipRecordsImport } from "./import-partnership-records.js";

/**
 * 033 EARS-19 (#4032) — the operator entry of the one-off import of the
 * interim partnership form's stored records (033-design «Import of the interim
 * records»; procedure: `operations/academy-partnership-submissions.md`). It
 * boots an HTTP-less Nest application context and drives
 * `PartnershipRecordsImport` once. The entry lives under `src/` so it compiles
 * into the api image's `dist/`. It exports nothing and no module imports it.
 *
 *   # on the API host — a one-off api container with the portal's submissions
 *   # volume mounted read-only:
 *   sudo docker compose run --rm --no-deps \
 *     -v academy_partnership_submissions:/import:ro api \
 *     node dist/applications/import-partnership-records.main.js /import
 *   # on a workstation, against the dev stand:
 *   pnpm --filter @ds/api applications:import-partnership <dir>
 *
 * Stdout is one JSON line `{ imported, alreadyPresent, invalid: [names] }` —
 * file names only, never a record's content. A missing directory argument or
 * an unreadable directory prints the reason and exits 1 having written nothing.
 * Re-running is safe: a record already imported is counted as present.
 */
async function main(): Promise<void> {
  const directory = process.argv.slice(2).find((a) => a !== "--");
  if (!directory)
    throw new Error("usage: applications:import-partnership <directory>");
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  try {
    const report = await app.get(PartnershipRecordsImport).run(directory);
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
    process.stderr.write(
      `[applications:import-partnership] FAILED — ${
        err instanceof Error ? `${err.name}: ${err.message}` : "unknown error"
      }; nothing more written\n`,
    );
    process.exitCode = 1;
  });
