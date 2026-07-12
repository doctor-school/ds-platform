import { Logger, type INestApplicationContext } from "@nestjs/common";

import { ReconcileService } from "./reconcile.service.js";

/**
 * #119: the ops manual reconcile trigger (design §11, the runbook references it).
 *
 * It is a **standalone-Nest CLI**, not an HTTP endpoint: v1 has no admin-auth
 * surface (`platform_admin` MFA is still a §7 seam), so an HTTP reconcile-trigger
 * would open an under-authorized mirror-write surface paralleling the webhook.
 * A script keeps the on-demand sweep ops-only and fail-safe — it boots a Nest
 * application context (no HTTP listener), resolves the SAME `ReconcileService`
 * the periodic scheduler uses, runs one `sweep()`, prints `{ reconciled: N }`,
 * and tears the context down. Run via `pnpm --filter @ds/api reconcile:sweep`.
 *
 * The pure {@link runReconcileSweep} is unit-tested with a context double; the
 * Nest-boot half ({@link bootstrapAndSweep}) is exercised live against the
 * dev-stand, never unit-mocked.
 */

/** Run one sweep against an already-booted Nest context, then close it. */
export async function runReconcileSweep(
  app: INestApplicationContext,
): Promise<{ reconciled: number; deactivated: number }> {
  try {
    const reconcile = app.get(ReconcileService);
    return await reconcile.sweep();
  } finally {
    await app.close();
  }
}

/**
 * Boot an HTTP-less Nest application context, run one sweep, log + return the
 * count. The entry script ({@link file://./../../scripts/reconcile-sweep.ts})
 * calls this; it is also importable for an ops harness.
 */
export async function bootstrapAndSweep(): Promise<{ reconciled: number; deactivated: number }> {
  const logger = new Logger("ReconcileCli");
  // Lazy imports so the unit test of `runReconcileSweep` never boots Nest.
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    // Quiet the per-provider boot chatter; keep warn/error.
    logger: ["warn", "error"],
  });
  const result = await runReconcileSweep(app);
  logger.log(`manual reconcile sweep complete — ${JSON.stringify(result)}`);
  return result;
}
