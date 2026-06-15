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
  // `pg` emits an 'error' event on the Pool when an *idle* pooled client errors
  // — e.g. the server terminates the connection ("terminating connection due to
  // administrator command" on a dev-stand power-cycle), a network drop, or an
  // idle timeout. `pg.Pool` is an EventEmitter, so an unhandled 'error' event is
  // fatal: Node re-throws it and the whole process exits (#213). `pg` has already
  // removed the broken client from the pool, so the next query opens a fresh
  // connection and the service self-heals — we just log and swallow here, keeping
  // the failure fail-soft (a transient blip degrades individual requests to the
  // existing 5xx "unavailable" contract instead of crashing the BFF).
  pool.on("error", (err: Error) => {
    console.error("[@ds/db] idle pg client error (pool self-healing):", err);
  });
  const db = drizzle(pool, { schema });
  return { pool, db };
}
