#!/usr/bin/env tsx
import "reflect-metadata";

import { bootstrapAndSweep } from "../src/auth/reconcile-cli.js";

/**
 * #119 ops manual reconcile trigger (design §11). Boots an HTTP-less Nest
 * application context, runs ONE `ReconcileService.sweep()` (the same unit the
 * periodic scheduler calls), prints `{ "reconciled": N }`, and exits.
 *
 * Run with the dev-stand env injected (no dotenv autoload — see
 * `.claude/rules/dev-stand.md` / `reference_local_api_portal_live_run_recipe`):
 *
 *   set -a; source ~/.ds-platform/.env.local; set +a
 *   pnpm --filter @ds/api reconcile:sweep
 *
 * Exits non-zero on failure so a cron / ops wrapper sees it. NOT an HTTP
 * endpoint: v1 has no admin-auth surface, so a reconcile-trigger route would
 * open an under-authorized mirror-write surface (see reconcile-cli.ts).
 */
async function main(): Promise<void> {
  const result = await bootstrapAndSweep();
  // The machine-readable result is the script's stdout contract.
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(
      `[reconcile:sweep] FAILED — ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    process.exit(1);
  });
