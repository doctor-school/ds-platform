import { Inject, Injectable } from "@nestjs/common";
import type pg from "pg";
import { type CheckStatus, type ReadinessResponse } from "@ds/schemas";
import { DRIZZLE_POOL } from "../database/database.tokens.js";
import { ObjectStorageReadiness } from "../storage/storage-readiness.js";

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DRIZZLE_POOL) private readonly pool: pg.Pool,
    // The CACHED storage state (002 EARS-3): /v1/ready is public, so a request
    // never triggers an S3 call — the monitor refreshes on its own interval.
    @Inject(ObjectStorageReadiness)
    private readonly objectStorageReadiness: ObjectStorageReadiness,
  ) {}

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

    const objectStorage = this.objectStorageReadiness.status();

    const status: CheckStatus =
      postgres === "ok" && pgvector === "ok" && objectStorage === "ok"
        ? "ok"
        : "down";

    return {
      status,
      checks: { postgres, pgvector, objectStorage },
      timestamp: new Date().toISOString(),
    };
  }
}
