import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-6 (#1288) — the DB half of the event↔project relationship
// (012-design §2, §3, §6). Talks to Postgres directly via pg.Pool (no Nest
// boot), the same pattern as the sibling `*-schema.e2e-spec.ts` files.
//
// Every assertion here is about a constraint the DATABASE enforces, not one the
// service happens to check — because the retained-relationship rule has to hold
// against a hand-written statement, a future migration and a second writer, not
// only against the code path this slice ships.
//
// The single load-bearing choice this file pins: the pair uniqueness is NOT
// partial. A partial unique index (`WHERE status = 'active'`) would let a
// retired relationship be shadowed by a fresh row for the same pair — which is
// exactly the re-insert the whole vertical exists to prevent.

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-6 — event_projects schema, retained identity and audit capture (e2e)",
  () => {
    let pool: pg.Pool;
    const createdEvents: string[] = [];
    const createdProjects: string[] = [];

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterEach(async () => {
      for (const id of createdEvents.splice(0)) {
        await pool.query("DELETE FROM event_projects WHERE event_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of createdProjects.splice(0)) {
        await pool.query("DELETE FROM event_projects WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await pool.end();
    });

    async function insertEvent(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
         VALUES ($1, $2, 'Кардиология', now(), 90)
         RETURNING id`,
        [`e-1288-${randomUUID()}`, "ХСН 1288"],
      );
      createdEvents.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertProject(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO projects (slug, kind, title)
         VALUES ($1, 'school', 'Школа 1288')
         RETURNING id`,
        [`p-1288-${randomUUID()}`],
      );
      createdProjects.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function relate(
      eventId: string,
      projectId: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_projects (event_id, project_id)
         VALUES ($1, $2) RETURNING id`,
        [eventId, projectId],
      );
      return rows[0]!.id;
    }

    it("012 EARS-6: when a relationship is created, the system shall persist one retained row with a stable id, active status and version 1", async () => {
      const id = await relate(await insertEvent(), await insertProject());
      const { rows } = await pool.query(
        `SELECT status, version, deleted_at FROM event_projects WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        status: "active",
        version: 1,
        deleted_at: null,
      });
    });

    it("012 EARS-6: the system shall refuse a second row for a pair that already exists, whether the existing one is active OR retired", async () => {
      const eventId = await insertEvent();
      const projectId = await insertProject();
      const id = await relate(eventId, projectId);

      await expect(relate(eventId, projectId)).rejects.toThrow(
        /event_projects_pair_key|duplicate key/i,
      );

      // Retiring it does NOT release the pair: a restore must move this row.
      await pool.query(
        `UPDATE event_projects SET status = 'retired', deleted_at = now() WHERE id = $1`,
        [id],
      );
      await expect(relate(eventId, projectId)).rejects.toThrow(
        /event_projects_pair_key|duplicate key/i,
      );
    });

    it("012 EARS-6: the system shall refuse a row whose status and deletion timestamp disagree, in either direction", async () => {
      const id = await relate(await insertEvent(), await insertProject());

      await expect(
        pool.query(
          `UPDATE event_projects SET status = 'retired' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/event_projects_retired_iff_deleted/);

      await expect(
        pool.query(
          `UPDATE event_projects SET deleted_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/event_projects_retired_iff_deleted/);
    });

    it("012 EARS-6: the system shall refuse a non-positive version — the ETag a client quotes must always name a real revision", async () => {
      const id = await relate(await insertEvent(), await insertProject());
      await expect(
        pool.query(`UPDATE event_projects SET version = 0 WHERE id = $1`, [id]),
      ).rejects.toThrow(/event_projects_version_positive/);
    });

    it("012 EARS-6: the system shall refuse to physically remove an endpoint that a relationship still references", async () => {
      const eventId = await insertEvent();
      const projectId = await insertProject();
      await relate(eventId, projectId);

      await expect(
        pool.query("DELETE FROM events WHERE id = $1", [eventId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
      await expect(
        pool.query("DELETE FROM projects WHERE id = $1", [projectId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
    });

    it("012 EARS-8: when a relationship is created and then retired, the system shall capture both changes in the audit ledger", async () => {
      const id = await relate(await insertEvent(), await insertProject());
      await pool.query(
        `UPDATE event_projects SET status = 'retired', deleted_at = now(), version = version + 1 WHERE id = $1`,
        [id],
      );
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit_ledger WHERE entity_id = $1`,
        [id],
      );
      // The row-change trigger is what writes these — a domain table opts IN to
      // feature 010's capture, and a relationship is domain data.
      expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(2);
    });

    it("012 EARS-6: the reverse traversal shall be index-backed — a project's events must not require a sequential scan", async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'event_projects' AND indexname = 'event_projects_project_id_idx'`,
      );
      expect(rows).toHaveLength(1);
    });
  },
);
