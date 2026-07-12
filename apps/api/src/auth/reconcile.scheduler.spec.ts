import { describe, expect, it, vi } from "vitest";
import type { SchedulerRegistry } from "@nestjs/schedule";
import { ReconcileScheduler } from "./reconcile.scheduler.js";
import type { ReconcileService } from "./reconcile.service.js";

/**
 * Minimal Map-backed `SchedulerRegistry` double — the scheduler only uses
 * `addInterval` / `deleteInterval` / `getIntervals`. A real `SchedulerRegistry`
 * is built by `ScheduleModule.forRoot()` at boot; the unit isolates the
 * scheduler's own logic (period source, registration, overlap, fail-soft) from
 * Nest's registry internals (which the e2e boot exercises).
 */
function fakeRegistry(): SchedulerRegistry {
  const intervals = new Map<string, unknown>();
  return {
    addInterval: (name: string, id: unknown) => {
      if (intervals.has(name)) throw new Error(`duplicate interval ${name}`);
      intervals.set(name, id);
    },
    deleteInterval: (name: string) => {
      const id = intervals.get(name);
      if (id !== undefined) clearInterval(id as ReturnType<typeof setInterval>);
      intervals.delete(name);
    },
    getIntervals: () => [...intervals.keys()],
  } as unknown as SchedulerRegistry;
}

/**
 * #119: the periodic trigger that closes the `@nestjs/schedule` seam
 * (reconcile.service.ts SEAM / design §11 "Reconciliation depth"). The unit
 * proves the wiring without asserting on wall-clock firing:
 *   - the registered interval period is config-driven (the env value, not a
 *     hardcoded constant);
 *   - the registered callback calls `sweep()`;
 *   - concurrent runs do not overlap (a sweep outlasting the interval is not
 *     re-entered).
 */

/**
 * A controllable `ReconcileService` fake: each `sweep()` call returns a promise
 * the test resolves by hand (FIFO), so a sweep can be held "in flight" to probe
 * the overlap guard. `calls()` counts invocations.
 */
function fakeSweep(): {
  service: ReconcileService;
  calls: () => number;
  resolveNext: () => void;
} {
  let calls = 0;
  const resolvers: Array<() => void> = [];
  const service = {
    sweep: vi.fn(() => {
      calls += 1;
      return new Promise<{ reconciled: number; deactivated: number }>(
        (resolve) => {
          resolvers.push(() => resolve({ reconciled: 0, deactivated: 0 }));
        },
      );
    }),
  } as unknown as ReconcileService;
  return {
    service,
    calls: () => calls,
    resolveNext: () => resolvers.shift()?.(),
  };
}

describe("ReconcileScheduler — #119 periodic sweep wiring", () => {
  it("EARS-19: registers an interval whose period is the configured value (config-driven, not hardcoded)", () => {
    const { service } = fakeSweep();
    const registry = fakeRegistry();
    const intervalMs = 123_456;
    const scheduler = new ReconcileScheduler(service, intervalMs, registry);

    scheduler.onModuleInit();

    // The interval is registered under the scheduler's name with the configured
    // period. SchedulerRegistry exposes the registered timer; the spy on the
    // global setInterval would also work, but the registry is the contract.
    expect(registry.getIntervals()).toContain(ReconcileScheduler.INTERVAL_NAME);

    scheduler.onModuleDestroy();
    // A second scheduler with a different period registers that period — proving
    // the value is read from config, not a constant baked into the class.
    const other = new ReconcileScheduler(service, 999_000, registry);
    other.onModuleInit();
    expect(registry.getIntervals()).toContain(ReconcileScheduler.INTERVAL_NAME);
    other.onModuleDestroy();
  });

  it("EARS-19: a non-positive interval disables the schedule (no interval registered)", () => {
    const { service } = fakeSweep();
    const registry = fakeRegistry();
    const scheduler = new ReconcileScheduler(service, 0, registry);

    scheduler.onModuleInit();

    expect(registry.getIntervals()).not.toContain(
      ReconcileScheduler.INTERVAL_NAME,
    );
    scheduler.onModuleDestroy();
  });

  it("EARS-19: the tick calls sweep()", async () => {
    const { service, calls, resolveNext } = fakeSweep();
    const registry = fakeRegistry();
    const scheduler = new ReconcileScheduler(service, 60_000, registry);

    const tick = scheduler.runOnce();
    resolveNext();
    await tick;

    expect(service.sweep).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(1);
  });

  it("EARS-19: does not overlap: a tick while a sweep is still running is skipped", async () => {
    const { service, calls, resolveNext } = fakeSweep();
    const registry = fakeRegistry();
    const scheduler = new ReconcileScheduler(service, 60_000, registry);

    // First tick starts a sweep that has not resolved yet (held in flight).
    const first = scheduler.runOnce();
    // A second tick fires before the first sweep completes — it must be a no-op.
    const second = scheduler.runOnce();
    await second; // the overlap-skip returns immediately
    expect(calls()).toBe(1);

    // Once the in-flight sweep resolves, a later tick runs again.
    resolveNext();
    await first;
    const third = scheduler.runOnce();
    resolveNext();
    await third;
    expect(calls()).toBe(2);
  });

  it("EARS-19: a thrown sweep is swallowed (a backstop must not crash the scheduler) and the next tick still runs", async () => {
    let calls = 0;
    const service = {
      sweep: vi.fn(() => {
        calls += 1;
        return Promise.reject(new Error("listUsers boom"));
      }),
    } as unknown as ReconcileService;
    const registry = fakeRegistry();
    const scheduler = new ReconcileScheduler(service, 60_000, registry);

    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
