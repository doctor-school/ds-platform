#!/usr/bin/env tsx
// #2063 — `pnpm seed:golden`.
//
// The staging-only entry point that writes the golden dataset into the database
// named by `DATABASE_URL` and its media into the bucket named by `S3_*`. It is
// NOT wired into `tools/deploy/prod.mjs`: production seeds nothing, and a
// fixture seed that can reach production is a data-integrity incident waiting
// for a wrong environment variable.
//
// Run it against a freshly migrated database (the `ds_golden_next` of
// `tools/staging/golden-db.mjs`) or against an existing golden database to
// refresh it in place — both the write plan and the media writer are idempotent.
//
//   set -a; source ~/.ds-platform/.env.local; set +a
//   DATABASE_URL=postgres://…/ds_golden_next pnpm seed:golden

import { createDrizzle } from "../../client.js";
import { createS3GoldenMediaStore, resolveGoldenS3Config } from "./media-s3.js";
import { seedGolden } from "./seed.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required — read it from ~/.ds-platform/.env.local, never hardcode an endpoint",
    );
  }

  // Resolved BEFORE the database connection: refusing on missing credentials
  // costs nothing, while a run that opened a transaction and then discovered it
  // cannot write portraits has already spent the slot's migrate window.
  const media = createS3GoldenMediaStore(resolveGoldenS3Config(process.env));

  // The golden seed writes every table in one transaction; the 5s default of
  // `createDrizzle` is tuned for request handling, not for a bulk fixture write.
  const handle = createDrizzle(connectionString, {
    statement_timeout: 120_000,
  });
  try {
    const result = await seedGolden(handle.db, { media });
    for (const step of result.steps) {
      console.log(`  ${step.name.padEnd(20)} ${String(step.rows).padStart(4)}`);
    }
    console.log(
      `  ${"media".padEnd(20)} ${String(result.mediaWritten ?? 0).padStart(4)} of ${result.mediaPlanned} objects written`,
    );
    console.log(
      `golden seed OK — ${result.total} rows, GOLDEN_NOW=${result.now}`,
    );
  } finally {
    media.close();
    await handle.pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
