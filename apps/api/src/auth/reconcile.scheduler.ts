import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";

import { ReconcileService } from "./reconcile.service.js";
import { RECONCILE_SWEEP_INTERVAL_MS } from "./auth.tokens.js";

/**
 * #119: the periodic trigger that closes the `@nestjs/schedule` SEAM documented
 * on {@link ReconcileService} (design §11 "Reconciliation depth" / §7). The
 * Zitadel Action webhook is the primary, authoritative sync trigger; this sweep
 * is the eventual-consistency backstop that closes a webhook-miss divergence.
 *
 * The interval is **config-driven** (`RECONCILE_SWEEP_INTERVAL_MS`, env-bound in
 * `auth.module.ts`), never a hardcoded constant — a `@Interval(<literal>)`
 * decorator could not read config, so the interval is registered dynamically via
 * {@link SchedulerRegistry.addInterval}. `idp.listUsers()` is a full enumeration,
 * so the default is conservative (15 min); `0` disables the periodic sweep (the
 * manual ops trigger / an external scheduler still calls the same `sweep()`).
 *
 * Overlap guard: if a sweep outlasts the interval, the next tick is skipped
 * rather than re-entered — a slow `listUsers()` never stacks concurrent sweeps.
 * A thrown sweep is swallowed and logged: a best-effort backstop must never
 * crash the process or wedge the scheduler.
 *
 * Constructor ordering: `@Inject(...)` params precede the type-inferred deps
 * (the tsx/esbuild `design:paramtypes` hazard the endpoint-authz gate trips on —
 * see `auth.service.ts`). `@Inject(ReconcileService)` is explicit so the
 * type-inferred `SchedulerRegistry` can follow the injected interval value.
 */
@Injectable()
export class ReconcileScheduler implements OnModuleInit, OnModuleDestroy {
  /** Name the dynamic interval is registered under in the SchedulerRegistry. */
  static readonly INTERVAL_NAME = "auth-reconcile-sweep";

  private readonly logger = new Logger(ReconcileScheduler.name);
  /** Overlap guard — true while a sweep is in flight. */
  private running = false;

  constructor(
    @Inject(ReconcileService) private readonly reconcile: ReconcileService,
    @Inject(RECONCILE_SWEEP_INTERVAL_MS) private readonly intervalMs: number,
    // Explicit `@Inject(SchedulerRegistry)`: under tsx/esbuild the emitted
    // `design:paramtypes` for a type-inferred parameter is unreliable, so the
    // registry token is named rather than relying on type inference — the same
    // boot-safety concern the endpoint-authz gate documents (auth.service.ts).
    @Inject(SchedulerRegistry) private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (this.intervalMs <= 0) {
      this.logger.log(
        "reconcile sweep disabled (RECONCILE_SWEEP_INTERVAL_MS<=0); webhook + manual trigger remain the sync paths",
      );
      return;
    }
    // Defensive: never double-register (a re-init or a stray prior timer).
    this.clearInterval();
    const handle = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.registry.addInterval(ReconcileScheduler.INTERVAL_NAME, handle);
    this.logger.log(
      `reconcile sweep scheduled every ${this.intervalMs}ms (EARS-19 backstop)`,
    );
  }

  onModuleDestroy(): void {
    this.clearInterval();
  }

  /** Remove the registered interval if present (idempotent). */
  private clearInterval(): void {
    if (
      this.registry.getIntervals().includes(ReconcileScheduler.INTERVAL_NAME)
    ) {
      this.registry.deleteInterval(ReconcileScheduler.INTERVAL_NAME);
    }
  }

  /**
   * One sweep tick. Idempotent under overlap (a tick while a sweep is in flight
   * is skipped) and fail-soft (a thrown sweep is logged, never rethrown).
   */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn(
        "reconcile sweep still running from a previous tick — skipping this tick",
      );
      return;
    }
    this.running = true;
    try {
      const { reconciled } = await this.reconcile.sweep();
      this.logger.log(`reconcile sweep complete — reconciled ${reconciled}`);
    } catch (err) {
      this.logger.error(
        `reconcile sweep failed (backstop, will retry next tick): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
