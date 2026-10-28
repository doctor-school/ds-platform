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

// #3421: a boot against an unresponsive data box hung forever because the pool
// had no connect bound (`pg` default `connectionTimeoutMillis: 0` = wait
// forever). The fixture is a local TCP listener that completes the TCP
// handshake but never reads or answers the Postgres startup message — the same
// shape as a box whose port is open but whose server is wedged.
describe("createDrizzle connect timeout (#3421)", () => {
  it("3421: a query against a never-answering server rejects within the configured connect bound", async () => {
    const { createServer } = await import("node:net");
    const sockets: import("node:net").Socket[] = [];
    const server = createServer({ pauseOnConnect: true }, (socket) => {
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("fixture listener has no TCP port");
    }
    const { pool } = createDrizzle(
      `postgres://user:pass@127.0.0.1:${address.port}/db`,
      { connectionTimeoutMillis: 300 },
    );

    const startedAt = Date.now();
    try {
      await expect(pool.query("SELECT 1")).rejects.toThrow(/timeout/i);
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await pool.end().catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 10_000);

  it("3421: the pool defaults to a bounded connect timeout when the caller sets none", () => {
    const { pool } = createDrizzle("postgres://user:pass@localhost:5432/db");

    expect(pool.options.connectionTimeoutMillis).toBe(5_000);
  });
});
