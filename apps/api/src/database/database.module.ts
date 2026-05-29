import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import type pg from "pg";
import { loadEnv } from "../config/env.schema.js";
import { DRIZZLE_DB, DRIZZLE_POOL } from "./database.tokens.js";

@Global()
@Module({
  providers: [
    {
      provide: "DRIZZLE_HANDLE",
      useFactory: (): DrizzleHandle => {
        const env = loadEnv();
        return createDrizzle(env.DATABASE_URL, {
          max: env.DATABASE_POOL_MAX,
          statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
        });
      },
    },
    {
      provide: DRIZZLE_POOL,
      inject: ["DRIZZLE_HANDLE"],
      useFactory: (h: DrizzleHandle) => h.pool,
    },
    {
      provide: DRIZZLE_DB,
      inject: ["DRIZZLE_HANDLE"],
      useFactory: (h: DrizzleHandle) => h.db,
    },
  ],
  exports: [DRIZZLE_POOL, DRIZZLE_DB],
})
export class DatabaseModule implements OnModuleDestroy {
  // Pattern (a) from design §9: capture the pool via DI and close it on
  // teardown so the process (and the e2e suite) does not leak connections.
  constructor(@Inject(DRIZZLE_POOL) private readonly pool: pg.Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
