// 010 — Universal edit audit, EARS-3/EARS-5 (Issue #1088): the API's Drizzle
// transaction wrapper that propagates actor/source to the generic capture
// trigger (`audit_row_change()`, #1087) via per-transaction GUCs.
//
// The trigger reads `current_setting('app.actor_sub' | 'app.source', true)` and
// stamps them onto the `data.<table>.<op>` ledger row (`subject_id` = actor sub,
// `metadata.source` = source). This wrapper is the single place those GUCs are
// set — mutation call-sites adopt the wrapper, never hand-write `SET LOCAL`
// (010-design §3). `SET LOCAL` (here `set_config(..., is_local => true)`) scopes
// the settings to THIS transaction, so nothing leaks across pooled connections;
// a write that skips the wrapper carries no context and the trigger degrades it
// to `source = 'db-direct'`, actor NULL (EARS-4) — never blocked, never faked.

import { sql } from "drizzle-orm";
import type { DrizzleHandle } from "./client.js";

/**
 * The closed `app.source` set (010 EARS-3). `admin-ui` / `portal-api` for the
 * two authenticated API doors; `system:<job-name>` for background jobs;
 * `migration` for the migration runner; `manual-dba` for an announced operator
 * psql session. Anything outside this set is a defect, not a feature — the
 * trigger-side `db-direct` fallback is the ONLY value not set here (EARS-4).
 */
export type AuditSource =
  "admin-ui" | "portal-api" | "migration" | "manual-dba" | `system:${string}`;

/** Per-transaction audit attribution: the acting principal + the write door. */
export interface AuditContext {
  /** Zitadel `sub` of the authenticated principal; `null` for un-attributed system writes. */
  actorSub: string | null;
  source: AuditSource;
}

type Database = DrizzleHandle["db"];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Run `fn` inside a transaction that first sets the audit-context GUCs, so every
 * mutation `fn` performs is attributed by the capture trigger to `ctx.actorSub`
 * / `ctx.source`. Returns whatever `fn` returns; on throw the transaction rolls
 * back (domain write and its would-be audit rows discarded together).
 *
 * `set_config(name, value, is_local => true)` is the parameterizable form of
 * `SET LOCAL name = value` — transaction-scoped, so a subsequent context-less
 * statement on the same pooled connection never inherits these settings. When
 * `actorSub` is `null` the actor GUC is left unset (the trigger reads NULL and
 * never fabricates an actor); the concrete `source` is always set, so an
 * authenticated write can never surface as `db-direct` (EARS-5).
 */
export async function withAuditContext<T>(
  db: Database,
  ctx: AuditContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.source', ${ctx.source}, true)`);
    if (ctx.actorSub !== null) {
      await tx.execute(
        sql`select set_config('app.actor_sub', ${ctx.actorSub}, true)`,
      );
    }
    return fn(tx);
  });
}
