import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-9 (#1291) — the DB half of the project↔expert relationship
// (012-design §2, §3.2, §6). Talks to Postgres directly via pg.Pool (no Nest
// boot), the same pattern as the sibling `*-schema.e2e-spec.ts` files.
//
// The service refuses the illegal states before they reach the database; this
// file proves the database refuses them ANYWAY — against a hand-written
// statement, a future migration and a second writer. Two constraints carry the
// §3.2 curator rule's upper half:
//
//   `project_experts_pair_key`                    — the pair is unique across
//     EVERY retained row, so a retired relation is RESTORED, never shadowed by
//     a fresh insert (deliberately not partial);
//   `project_experts_project_curator_active_uniq` — at most one ACTIVE curator
//     per project, and IMMEDIATE, which is precisely why the service demotes
//     before it promotes.
//
// The lower half of the rule (a published project keeps exactly one ELIGIBLE
// curator) spans `experts` and cannot be an index; it lives in the service and
// is proven in `project-experts.e2e-spec.ts`.

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-9 — project_experts schema, retained identity and audit capture (e2e)",
  () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdExperts: string[] = [];

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterEach(async () => {
      for (const id of createdProjects.splice(0)) {
        await pool.query("DELETE FROM project_experts WHERE project_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const id of createdExperts.splice(0)) {
        await pool.query("DELETE FROM project_experts WHERE expert_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await pool.end();
    });

    async function insertProject(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO projects (slug, kind, title)
         VALUES ($1, 'school', 'Школа 1291') RETURNING id`,
        [`p-1291-${randomUUID()}`],
      );
      createdProjects.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertExpert(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (slug, family_name, given_name) VALUES ($1, $2, $3) RETURNING id`,
        [`x-1291-${randomUUID()}`, "Иванова", "И. И."],
      );
      createdExperts.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function relate(
      projectId: string,
      expertId: string,
      role: "curator" | "member" = "member",
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO project_experts (project_id, expert_id, role)
         VALUES ($1, $2, $3) RETURNING id`,
        [projectId, expertId, role],
      );
      return rows[0]!.id;
    }

    it("012 EARS-9: when a relation is created, the system shall persist one retained row with a stable id, active status and version 1", async () => {
      const id = await relate(await insertProject(), await insertExpert());
      const { rows } = await pool.query(
        `SELECT role, status, version, deleted_at
           FROM project_experts WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        role: "member",
        status: "active",
        version: 1,
        deleted_at: null,
      });
    });

    it("012 EARS-9: the system shall refuse a second row for a pair that already exists, whether the existing one is active OR retired", async () => {
      const projectId = await insertProject();
      const expertId = await insertExpert();
      const id = await relate(projectId, expertId);

      await expect(relate(projectId, expertId)).rejects.toThrow(
        /project_experts_pair_key|duplicate key/i,
      );

      // Retiring it does NOT release the pair: a restore must move THIS row, so
      // the relation's audit history stays on one id forever.
      await pool.query(
        `UPDATE project_experts SET status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [id],
      );
      await expect(relate(projectId, expertId)).rejects.toThrow(
        /project_experts_pair_key|duplicate key/i,
      );
    });

    it("012 EARS-9: the system shall refuse a second ACTIVE curator on one project while leaving a retired one and a second project alone", async () => {
      const projectId = await insertProject();
      const first = await relate(projectId, await insertExpert(), "curator");

      await expect(
        relate(projectId, await insertExpert(), "curator"),
      ).rejects.toThrow(
        /project_experts_project_curator_active_uniq|duplicate key/i,
      );

      // A `member` on the same project is unaffected — the index is partial on
      // the ROLE as well as on the status.
      await expect(
        relate(projectId, await insertExpert(), "member"),
      ).resolves.toBeTypeOf("string");

      // Retiring the incumbent frees the seat, mirroring `WHERE status =
      // 'active'`; otherwise a retired curator would squat on the project.
      await pool.query(
        `UPDATE project_experts SET status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [first],
      );
      await expect(
        relate(projectId, await insertExpert(), "curator"),
      ).resolves.toBeTypeOf("string");

      // And the seat is PER PROJECT, not global.
      await expect(
        relate(await insertProject(), await insertExpert(), "curator"),
      ).resolves.toBeTypeOf("string");
    });

    it("012 EARS-9: the system shall refuse a row whose status and deletion timestamp disagree, in either direction", async () => {
      const id = await relate(await insertProject(), await insertExpert());

      await expect(
        pool.query(
          `UPDATE project_experts SET status = 'retired' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/project_experts_retired_iff_deleted/i);

      await expect(
        pool.query(
          `UPDATE project_experts SET deleted_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/project_experts_retired_iff_deleted/i);
    });

    it("012 EARS-9: the system shall refuse an endpoint delete while a relation still points at it", async () => {
      // Both FKs are ON DELETE RESTRICT: a hard delete of either endpoint would
      // silently drop the relation's history, so it is refused at the DB level.
      const projectId = await insertProject();
      const expertId = await insertExpert();
      await relate(projectId, expertId);

      await expect(
        pool.query("DELETE FROM projects WHERE id = $1", [projectId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
      await expect(
        pool.query("DELETE FROM experts WHERE id = $1", [expertId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
    });

    it("012 EARS-9: every write to the relation shall land in the same-transaction audit ledger as a plain diff", async () => {
      // feature-010 audit capture. The 012 join columns are ordinary editorial
      // attributions, so `role` is a PLAIN audited diff rather than a
      // PD-registry entry (012-design §6 :346) — this asserts the value is
      // readable in the ledger, which is what «plain» means.
      const projectId = await insertProject();
      const id = await relate(projectId, await insertExpert(), "member");
      await pool.query(
        `UPDATE project_experts SET role = 'curator', version = version + 1
          WHERE id = $1`,
        [id],
      );

      const { rows } = await pool.query<{
        event_type: string;
        metadata: { diff: Record<string, { old?: unknown; new?: unknown }> };
      }>(
        `SELECT event_type, metadata
           FROM audit_ledger
          WHERE metadata -> 'pk' ->> 'id' = $1
          ORDER BY created_at, event_type`,
        [id],
      );
      expect(rows.map((r) => r.event_type)).toEqual([
        "data.project_experts.insert",
        "data.project_experts.update",
      ]);
      // A PLAIN diff: the value is readable in the ledger rather than
      // `{"masked": true}`, which is what "not in the PD registry" means.
      expect(rows[1]!.metadata.diff.role).toEqual({
        old: "member",
        new: "curator",
      });
    });
  },
);
