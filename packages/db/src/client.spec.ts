import { describe, expect, it, vi } from "vitest";
import { createDrizzle } from "./client.js";

// Regression for #213: a dropped idle Postgres connection (TrueNAS dev-stand
// power-cycle → "terminating connection due to administrator command") made `pg`
// emit an `'error'` event on the Pool. `pg.Pool` is an EventEmitter, and Node's
// EventEmitter throws when `'error'` is emitted with **no** listener attached —
// that is exactly the unhandled `'error'` event that crashed the whole BFF.
//
// These tests need no real database: we construct the pool via the real factory
// (which never connects until a query runs) and emit `'error'` ourselves. Without
// the `pool.on('error', …)` handler the emit throws (RED); with it, the event is
// logged and swallowed and the process survives (GREEN).
describe("createDrizzle pool error handling (#213)", () => {
  it("attaches an 'error' listener to the pool", () => {
    const { pool } = createDrizzle("postgres://user:pass@localhost:5432/db");

    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });

  it("swallows an idle-client 'error' event instead of crashing the process", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { pool } = createDrizzle("postgres://user:pass@localhost:5432/db");

    const idleClientError = new Error(
      "terminating connection due to administrator command",
    );

    // With no listener this `emit` would throw (Node treats it as the fatal
    // unhandled 'error' event that exits the process). It must NOT throw.
    expect(() => pool.emit("error", idleClientError)).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
