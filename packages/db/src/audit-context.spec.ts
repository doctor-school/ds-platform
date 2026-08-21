import { describe, expect, it } from "vitest";
import {
  type AuditTransactionConfig,
  withAuditContext,
} from "./audit-context.js";

// 010 EARS-3/EARS-5 (#1088) + 012-design §3.1 (#1288) — the wrapper's contract
// at the seam every taxonomy command now depends on.
//
// The transaction CONFIG passthrough is the part worth pinning with a test: it
// is not a convenience parameter. The GUC statements this wrapper issues are
// ordinary queries, and PostgreSQL refuses `SET TRANSACTION ISOLATION LEVEL`
// after a transaction's first query — so a command that must run SERIALIZABLE
// has exactly one place to say so, as the transaction OPENS. If the config were
// dropped on the floor here, the lifecycle confirmation would silently run at
// READ COMMITTED and the §3.1 zero-mutation guarantee would rest on nothing.

/** A minimal stand-in for the Drizzle handle: it records what it was handed. */
function fakeDb() {
  const executed: string[] = [];
  const calls: { config: AuditTransactionConfig }[] = [];
  const tx = {
    execute(query: { queryChunks?: unknown[] }) {
      executed.push(JSON.stringify(query.queryChunks ?? query));
      return Promise.resolve();
    },
  };
  const db = {
    transaction(
      fn: (t: typeof tx) => Promise<unknown>,
      config: AuditTransactionConfig,
    ) {
      calls.push({ config });
      return fn(tx);
    },
  };
  return { db, tx, calls, executed };
}

describe("withAuditContext", () => {
  it("010 EARS-3: when a caller pins transaction characteristics, the wrapper shall declare them as the transaction opens rather than dropping them", async () => {
    const { db, calls } = fakeDb();
    const result = await withAuditContext(
      db as never,
      { actorSub: "sub-1", source: "admin-ui" },
      async () => "done",
      { isolationLevel: "serializable" },
    );
    expect(result).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.config).toEqual({ isolationLevel: "serializable" });
  });

  it("010 EARS-3: when no characteristics are pinned, the wrapper shall open an ordinary transaction and still set the audit GUCs", async () => {
    const { db, calls, executed } = fakeDb();
    await withAuditContext(
      db as never,
      { actorSub: "sub-2", source: "portal-api" },
      async () => undefined,
    );
    expect(calls[0]!.config).toBeUndefined();
    // Both GUCs: the source always, the actor because this one is attributed.
    expect(executed).toHaveLength(2);
    expect(executed.join("|")).toContain("app.source");
    expect(executed.join("|")).toContain("app.actor_sub");
  });

  it("010 EARS-5: when a write is un-attributed, the wrapper shall leave the actor GUC unset rather than fabricating an actor", async () => {
    const { db, executed } = fakeDb();
    await withAuditContext(
      db as never,
      { actorSub: null, source: "system:reconcile" },
      async () => undefined,
    );
    expect(executed).toHaveLength(1);
    expect(executed.join("|")).not.toContain("app.actor_sub");
  });
});
