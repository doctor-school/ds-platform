import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";
import { type CheckStatus, type ReadinessResponse } from "@ds/schemas";
import { DRIZZLE_POOL } from "../database/database.tokens.js";

@Injectable()
export class ReadinessService {
  constructor(@Inject(DRIZZLE_POOL) private readonly pool: pg.Pool) {}

  async check(): Promise<ReadinessResponse> {
    const [pgResult, vecResult] = await Promise.allSettled([
      this.pool.query("SELECT 1 AS ok"),
      this.pool.query("SELECT to_regtype('vector') IS NOT NULL AS ok"),
    ]);

    const postgres: CheckStatus =
      pgResult.status === "fulfilled" && pgResult.value.rows[0]?.ok === 1
        ? "ok"
        : "down";

    const pgvector: CheckStatus =
      vecResult.status === "fulfilled" && vecResult.value.rows[0]?.ok === true
        ? "ok"
        : "down";

    const status: CheckStatus =
      postgres === "ok" && pgvector === "ok" ? "ok" : "down";

    return {
      status,
      checks: { postgres, pgvector },
      timestamp: new Date().toISOString(),
    };
  }
}
