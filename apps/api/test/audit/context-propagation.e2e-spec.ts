import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, events, withAuditContext } from "@ds/db";

// 010 — Universal edit audit, EARS-3 (Issue #1088): the API's Drizzle
// transaction wrapper `withAuditContext(db, {actorSub, source}, fn)` issues
// `SET LOCAL app.actor_sub` + `SET LOCAL app.source` at the start of the
// transaction (via `set_config(..., is_local => true)`), so the generic capture
// trigger (`audit_row_change()`, #1087) reads them with
// `current_setting(..., true)` and attributes the `data.<table>.<op>` ledger
// row (`subject_id` = actor sub, `metadata.source` = source).
//
// Talks to Postgres via the real @ds/db handle (no Nest boot) — the same
// pattern as apps/api/test/db/universal-edit-audit.e2e-spec.ts. The ledger is
// append-only, so every assertion is scoped to the unique pk this run creates.

interface LedgerRow {
  id: string;
  subject_id: string | null;
  metadata: { table: string; source: string; diff: Record<string, unknown> };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "010 EARS-3 — withAuditContext propagation wrapper (e2e)",
  () => {
    let handle: ReturnType<typeof createDrizzle>;

    beforeAll(() => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 3 });
    });

    afterAll(async () => {
      await handle.pool.end();
    });

    function newEventValues() {
      return {
        slug: `audit-ctx-${randomUUID()}`,
        title: "audit ctx event",
        school: "audit-ctx-e2e",
        startsAt: new Date(Date.now() + 86_400_000),
        durationMin: 60,
      };
    }

    async function insertTrailRow(
      pool: ReturnType<typeof createDrizzle>["pool"],
      id: string,
    ): Promise<LedgerRow | undefined> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT id, subject_id, metadata
         FROM audit_ledger
         WHERE event_type = 'data.events.insert' AND metadata -> 'pk' ->> 'id' = $1`,
        [id],
      );
      return rows[0];
    }

    it("010 EARS-3: a mutation run through withAuditContext attributes the trigger row with the actor sub and the set source", async () => {
      const actorSub = `audit-ctx-actor-${randomUUID()}`;
      let id!: string;
      await withAuditContext(
        handle.db,
        { actorSub, source: "admin-ui" },
        async (tx) => {
          const [row] = await tx
            .insert(events)
            .values(newEventValues())
            .returning({ id: events.id });
          id = row!.id;
        },
      );
      const trail = await insertTrailRow(handle.pool, id);
      expect(trail).toBeDefined();
      expect(trail!.subject_id).toBe(actorSub);
      expect(trail!.metadata.source).toBe("admin-ui");
    });

    it("010 EARS-3: a system-job source is carried onto the row (source=system:<job>), actor sub optional", async () => {
      let id!: string;
      await withAuditContext(
        handle.db,
        { actorSub: null, source: "system:reconcile" },
        async (tx) => {
          const [row] = await tx
            .insert(events)
            .values(newEventValues())
            .returning({ id: events.id });
          id = row!.id;
        },
      );
      const trail = await insertTrailRow(handle.pool, id);
      expect(trail!.metadata.source).toBe("system:reconcile");
      // No authenticated principal ⇒ no fabricated actor.
      expect(trail!.subject_id).toBeNull();
    });

    it("010 EARS-5: SET LOCAL scope — a follow-up context-less write on the SAME pooled connection does NOT inherit the prior tx's GUCs (pool-leak proof)", async () => {
      // max: 1 forces both statements onto ONE physical connection, so a
      // session-level SET (the bug this guards) would leak; SET LOCAL must not.
      const single = createDrizzle(process.env.DATABASE_URL!, { max: 1 });
      try {
        const actorSub = `audit-ctx-actor-${randomUUID()}`;
        let firstId!: string;
        await withAuditContext(
          single.db,
          { actorSub, source: "portal-api" },
          async (tx) => {
            const [row] = await tx
              .insert(events)
              .values(newEventValues())
              .returning({ id: events.id });
            firstId = row!.id;
          },
        );
        // Second write: no context, same pooled connection (max:1), autocommit.
        const [row2] = await single.db
          .insert(events)
          .values(newEventValues())
          .returning({ id: events.id });
        const secondId = row2!.id;

        const first = await insertTrailRow(single.pool, firstId);
        const second = await insertTrailRow(single.pool, secondId);
        expect(first!.metadata.source).toBe("portal-api");
        expect(first!.subject_id).toBe(actorSub);
        // No leak: the uncontextual write degrades to db-direct, actor NULL.
        expect(second!.metadata.source).toBe("db-direct");
        expect(second!.subject_id).toBeNull();
      } finally {
        await single.pool.end();
      }
    });
  },
);
