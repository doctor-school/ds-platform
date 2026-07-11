import { describe, expect, it, vi } from "vitest";
import { runReconcileSweep } from "./reconcile-cli.js";
import { ReconcileService } from "./reconcile.service.js";

/**
 * #119: the ops manual-trigger. A standalone-Nest CLI (NOT an HTTP endpoint —
 * the wave-1 admin session has no mandatory platform_admin MFA (ADR-0004
 * staged model; hardening #718), so a reconcile-trigger endpoint would open an
 * under-authorized mirror-write mirror of the webhook; the runbook references
 * the script). The unit proves the wiring: the trigger resolves the SAME
 * `ReconcileService.sweep()` the scheduler calls and surfaces its result. The
 * Nest-boot half is exercised live against the dev-stand, not unit-mocked.
 */

/** Minimal Nest-context double exposing only `get` + `close`. */
function fakeContext(service: ReconcileService): {
  get: (token: unknown) => unknown;
  close: () => Promise<void>;
  closed: () => boolean;
} {
  let closed = false;
  return {
    get: (token: unknown) => {
      if (token === ReconcileService) return service;
      throw new Error("unexpected token resolved from the context");
    },
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    closed: () => closed,
  };
}

describe("runReconcileSweep — #119 manual reconcile trigger", () => {
  it("EARS-19: resolves ReconcileService from the context and returns its sweep result", async () => {
    const service = {
      sweep: vi.fn(() => Promise.resolve({ reconciled: 7 })),
    } as unknown as ReconcileService;
    const ctx = fakeContext(service);

    const result = await runReconcileSweep(ctx as never);

    expect(service.sweep).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ reconciled: 7 });
  });

  it("EARS-19: closes the application context even when the sweep throws", async () => {
    const service = {
      sweep: vi.fn(() => Promise.reject(new Error("listUsers down"))),
    } as unknown as ReconcileService;
    const ctx = fakeContext(service);

    await expect(runReconcileSweep(ctx as never)).rejects.toThrow(
      "listUsers down",
    );
    expect(ctx.closed()).toBe(true);
  });

  it("EARS-19: closes the application context on success", async () => {
    const service = {
      sweep: vi.fn(() => Promise.resolve({ reconciled: 0 })),
    } as unknown as ReconcileService;
    const ctx = fakeContext(service);

    await runReconcileSweep(ctx as never);

    expect(ctx.closed()).toBe(true);
  });
});
