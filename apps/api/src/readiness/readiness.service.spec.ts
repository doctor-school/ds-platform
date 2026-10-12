import type pg from "pg";
import { describe, expect, it } from "vitest";
import { ReadinessResponseSchema } from "@ds/schemas";
import type { ObjectStorageReadiness } from "../storage/storage-readiness.js";
import { ReadinessService } from "./readiness.service.js";

/**
 * Minimal pg.Pool stub — only `query` is exercised by ReadinessService.
 * `impl` receives the SQL string so each probe can be steered independently,
 * which is what lets us assert probe isolation (EARS-2 / Promise.allSettled).
 */
function poolStub(impl: (sql: string) => Promise<unknown>): pg.Pool {
  return { query: (sql: string) => impl(sql) } as unknown as pg.Pool;
}

/** The cached object-storage state the service reads (002 EARS-3) — no I/O. */
function storageState(
  state: "ok" | "down",
): ObjectStorageReadiness & { reads: number } {
  const stub = {
    reads: 0,
    status: () => {
      stub.reads += 1;
      return state;
    },
  };
  return stub as unknown as ObjectStorageReadiness & { reads: number };
}

const healthyPool = poolStub((sql) =>
  sql.includes("to_regtype")
    ? Promise.resolve({ rows: [{ ok: true }] })
    : Promise.resolve({ rows: [{ ok: 1 }] }),
);

describe("ReadinessService", () => {
  it("EARS-2: responds status=down with the failing check 'down' and the healthy check 'ok'", async () => {
    // Postgres connectivity probe fails; pgvector probe succeeds.
    const pool = poolStub((sql) =>
      sql.includes("to_regtype")
        ? Promise.resolve({ rows: [{ ok: true }] })
        : Promise.reject(new Error("connection refused")),
    );

    const service = new ReadinessService(pool, storageState("ok"));
    const body = ReadinessResponseSchema.parse(await service.check());

    expect(body.status).toBe("down");
    expect(body.checks.postgres).toBe("down");
    expect(body.checks.pgvector).toBe("ok");
  });

  it("EARS-2: responds status=down when the pgvector extension is missing, postgres staying 'ok'", async () => {
    // Postgres connectivity probe succeeds; pgvector probe reports absent.
    const pool = poolStub((sql) =>
      sql.includes("to_regtype")
        ? Promise.resolve({ rows: [{ ok: false }] })
        : Promise.resolve({ rows: [{ ok: 1 }] }),
    );

    const service = new ReadinessService(pool, storageState("ok"));
    const body = ReadinessResponseSchema.parse(await service.check());

    expect(body.status).toBe("down");
    expect(body.checks.postgres).toBe("ok");
    expect(body.checks.pgvector).toBe("down");
  });

  it("EARS-1: reports objectStorage ok alongside postgres + pgvector when the cached probe is ok", async () => {
    const body = ReadinessResponseSchema.parse(
      await new ReadinessService(healthyPool, storageState("ok")).check(),
    );
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual({
      postgres: "ok",
      pgvector: "ok",
      objectStorage: "ok",
    });
  });

  it("EARS-2: responds status=down with objectStorage 'down' and the database checks 'ok' when the cached storage probe is down", async () => {
    const body = ReadinessResponseSchema.parse(
      await new ReadinessService(healthyPool, storageState("down")).check(),
    );
    expect(body.status).toBe("down");
    expect(body.checks).toEqual({
      postgres: "ok",
      pgvector: "ok",
      objectStorage: "down",
    });
  });

  it("EARS-3: reads the cached storage state — no probe per request, no reason in the body", async () => {
    const storage = storageState("down");
    const body = await new ReadinessService(healthyPool, storage).check();
    expect(storage.reads).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/HTTP|InvalidAccessKeyId|reason/);
  });
});
