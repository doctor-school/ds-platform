import { withAuditContext, type DrizzleHandle } from "@ds/db";
import { getAuditContext } from "./audit-context.js";

// 010 — Universal edit audit, EARS-3/EARS-5 (Issue #1088): the repo-layer
// transaction seam. Every mutating write path in the API adopts this instead of
// `db.transaction(...)`, so the capture trigger attributes its `data.*` ledger
// rows to the current request's actor/source WITHOUT the write site knowing the
// actor. The `SET LOCAL` must run inside the SAME transaction as the mutation
// (an interceptor alone can't own the tx), which is exactly what this does.

type Db = DrizzleHandle["db"];
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Run `fn` in a transaction attributed to the current request's audit context.
 * With a request context (populated by {@link AuditContextInterceptor}) it sets
 * the `app.actor_sub` / `app.source` GUCs via {@link withAuditContext}; with
 * none (background job, migration, direct call, psql) it runs a plain
 * transaction and the trigger degrades the row to `source = 'db-direct'`, actor
 * NULL (EARS-4) — audited, never blocked, never fabricated.
 */
export async function withRequestAuditContext<T>(
  db: Db,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const ctx = getAuditContext();
  if (ctx) return withAuditContext(db, ctx, fn);
  return db.transaction(fn);
}
