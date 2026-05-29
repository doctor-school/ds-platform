import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export interface DrizzleHandle {
  pool: pg.Pool;
  db: NodePgDatabase<typeof schema>;
}

export interface CreateDrizzleOptions {
  max?: number;
  statement_timeout?: number;
}

export function createDrizzle(
  connectionString: string,
  options: CreateDrizzleOptions = {},
): DrizzleHandle {
  const pool = new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    statement_timeout: options.statement_timeout ?? 5_000,
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
