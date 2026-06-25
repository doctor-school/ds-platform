/** DI token carrying the configured Zitadel Action webhook shared secret (EARS-19). */
export const AUTH_WEBHOOK_SECRET = Symbol("AUTH_WEBHOOK_SECRET");

/** Header the Zitadel Action webhook presents its shared secret in (lower-cased by Fastify). */
export const WEBHOOK_SECRET_HEADER = "x-zitadel-webhook-secret";

/**
 * DI token carrying the periodic reconciliation-sweep interval in ms (#119,
 * `RECONCILE_SWEEP_INTERVAL_MS`). The `ReconcileScheduler` reads this rather than
 * a hardcoded constant; `0` disables the periodic sweep.
 */
export const RECONCILE_SWEEP_INTERVAL_MS = Symbol("RECONCILE_SWEEP_INTERVAL_MS");
