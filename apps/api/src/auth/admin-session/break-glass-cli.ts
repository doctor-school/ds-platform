import { Logger, type INestApplicationContext } from "@nestjs/common";

import { AdminSessionService } from "./admin-session.service.js";

/**
 * 011 LD-2 — the **break-glass** factor removal, and the only sanctioned removal
 * path outside the EARS-13 endpoint.
 *
 * The endpoint demands the CALLER's own current TOTP code. That is what makes it
 * safe, and it is also what makes it unusable under exactly one condition: fewer
 * than two `platform_admin` operators hold an enrolled factor, so the operator who
 * needs recovery is the only one who could have authorised it. EARS-13 states that
 * precondition explicitly and names this exception rather than leaving the sole
 * operator locked out of a live medical platform (011 requirements → EARS-13,
 * Operational precondition).
 *
 * **It is not a bypass, because it writes the same row.** It goes through
 * {@link AdminSessionService.applyFactorRemoval} — the one writer both paths
 * share — so the `auth.mfa.reset` row it appends is shape-identical to an
 * endpoint-written one: same canonical wire id, same `by_admin` actor, same
 * `tier: "admin"`. A ledger reader cannot tell which path removed a factor, which
 * is the whole point: "every factor removal leaves a ledger row with a recorded
 * acting operator" holds with no exception clause (011 requirements → Constraints;
 * design §10 asserts the shape identity in a test).
 *
 * What the script CANNOT supply is the fresh-possession proof, so the compensating
 * control is procedural and recorded in the runbook (`apps/api/src/auth/README.md`
 * → Operator factor recovery): a post-action note on the tracking Issue, naming
 * the operator, the target, and why the endpoint could not be used.
 */

/** The subjects a break-glass removal names: whose factor, and on whose authority. */
export interface BreakGlassRemoval {
  /** IdP subject whose registered TOTP factor is removed. */
  targetSub: string;
  /** IdP subject of the operator performing it — the row's `by_admin` actor. */
  byAdmin: string;
}

/**
 * Run one break-glass removal against an already-booted Nest context, then close
 * it. Split from the boot half so it is testable with a context double, exactly as
 * `runReconcileSweep` is.
 */
export async function runBreakGlassRemoval(
  app: INestApplicationContext,
  input: BreakGlassRemoval,
): Promise<void> {
  try {
    const admin = app.get(AdminSessionService);
    await admin.applyFactorRemoval(input.targetSub, input.byAdmin);
  } finally {
    await app.close();
  }
}

/**
 * Boot an HTTP-less Nest application context and run one break-glass removal.
 * The entry script ({@link file://./../../../scripts/break-glass-remove-mfa.ts})
 * calls this; it is also importable for an ops harness.
 */
export async function bootstrapAndRemoveFactor(
  input: BreakGlassRemoval,
): Promise<void> {
  const logger = new Logger("BreakGlassCli");
  // Lazy imports so a unit test of `runBreakGlassRemoval` never boots Nest.
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../../app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    // Quiet the per-provider boot chatter; keep warn/error.
    logger: ["warn", "error"],
  });
  await runBreakGlassRemoval(app, input);
  logger.warn(
    `BREAK-GLASS: removed the TOTP factor of ${input.targetSub} on the authority of ${input.byAdmin} — record the post-action note on the tracking Issue`,
  );
}
