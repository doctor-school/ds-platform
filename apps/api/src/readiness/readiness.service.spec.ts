import type pg from "pg";
import { describe, expect, it } from "vitest";
import { ReadinessResponseSchema } from "@ds/schemas";
import { ReadinessService } from "./readiness.service.js";

/**
 * Minimal pg.Pool stub — only `query` is exercised by ReadinessService.
 * `impl` receives the SQL string so each probe can be steered independently,
 * which is what lets us assert probe isolation (EARS-2 / Promise.allSettled).
 */
function poolStub(impl: (sql: string) => Promise<unknown>): pg.Pool {
  return { query: (sql: string) => impl(sql) } as unknown as pg.Pool;
}

describe("ReadinessService", () => {
  it("EARS-2: responds status=down with the failing check 'down' and the healthy check 'ok'", async () => {
    // Postgres connectivity probe fails; pgvector probe succeeds.
    const pool = poolStub((sql) =>
      sql.includes("to_regtype")
        ? Promise.resolve({ rows: [{ ok: true }] })
        : Promise.reject(new Error("connection refused")),
    );

    const service = new ReadinessService(pool);
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

    const service = new ReadinessService(pool);
    const body = ReadinessResponseSchema.parse(await service.check());

    expect(body.status).toBe("down");
    expect(body.checks.postgres).toBe("ok");
    expect(body.checks.pgvector).toBe("down");
  });
});
