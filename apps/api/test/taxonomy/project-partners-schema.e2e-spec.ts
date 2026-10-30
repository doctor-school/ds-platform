import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-10 (#1292) — the DB half of the project↔partner relationship
// (012-design §2, §6). Direct pg.Pool, no Nest boot, exactly as the sibling
// `*-schema.e2e-spec.ts` files.
//
// The shape mirrors `project_experts` with ONE difference that matters: the
// primary-partner seat has an upper bound and NO lower bound. A published
// project with no primary partner is legal and reports `primaryPartner: null`,
// so the entire invariant is expressible as one partial unique index —
// `project_organisations_project_primary_active_uniq` — and there is nothing here
// that a cross-table service check has to add.

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-10 — project_organisations schema, retained identity and audit capture (e2e)",
  () => {
    let pool: pg.Pool;
    const createdProjects: string[] = [];
    const createdPartners: string[] = [];

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterEach(async () => {
      for (const id of createdProjects.splice(0)) {
        await pool.query(
          "DELETE FROM project_organisations WHERE project_id = $1",
          [id],
        );
        await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      }
      for (const id of createdPartners.splice(0)) {
        await pool.query(
          "DELETE FROM project_organisations WHERE organisation_id = $1",
          [id],
        );
        await pool.query("DELETE FROM organisations WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await pool.end();
    });

    async function insertProject(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO projects (slug, stage, title, default_audience)
         VALUES ($1, 'running', 'Школа 1292', 'doctors') RETURNING id`,
        [`p-1292-${randomUUID()}`],
      );
      createdProjects.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertPartner(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO organisations (slug, title) VALUES ($1, $2) RETURNING id`,
        [`pt-1292-${randomUUID()}`, "Фарма 1292"],
      );
      createdPartners.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function relate(
      projectId: string,
      partnerId: string,
      isPrimary = false,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        // 030 EARS-17: every link holds a role; the 032 investor seed role.
        `INSERT INTO project_organisations (project_id, organisation_id, is_primary, role_id)
         VALUES ($1, $2, $3, '03200000-0000-4000-8000-000000000001') RETURNING id`,
        [projectId, partnerId, isPrimary],
      );
      return rows[0]!.id;
    }

    it("012 EARS-10: when a relation is created, the system shall persist one retained row, non-primary by default, at version 1", async () => {
      const id = await relate(await insertProject(), await insertPartner());
      const { rows } = await pool.query(
        `SELECT is_primary, status, version, deleted_at
           FROM project_organisations WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        is_primary: false,
        status: "active",
        version: 1,
        deleted_at: null,
      });
    });

    it("012 EARS-10: the system shall refuse a second row for a pair that already exists, whether the existing one is active OR retired", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner();
      const id = await relate(projectId, partnerId);

      await expect(relate(projectId, partnerId)).rejects.toThrow(
        /project_organisations_pair_key|duplicate key/i,
      );

      await pool.query(
        `UPDATE project_organisations SET status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [id],
      );
      await expect(relate(projectId, partnerId)).rejects.toThrow(
        /project_organisations_pair_key|duplicate key/i,
      );
    });

    it("012 EARS-10: the system shall refuse a second ACTIVE primary partner on one project, and free the flag when the incumbent is retired", async () => {
      const projectId = await insertProject();
      const first = await relate(projectId, await insertPartner(), true);

      await expect(
        relate(projectId, await insertPartner(), true),
      ).rejects.toThrow(
        /project_organisations_project_primary_active_uniq|duplicate key/i,
      );

      // Non-primary co-sponsors are unbounded — the index is partial on the flag.
      await expect(
        relate(projectId, await insertPartner(), false),
      ).resolves.toBeTypeOf("string");

      await pool.query(
        `UPDATE project_organisations SET status = 'retired', deleted_at = now()
          WHERE id = $1`,
        [first],
      );
      await expect(
        relate(projectId, await insertPartner(), true),
      ).resolves.toBeTypeOf("string");

      // The seat is per project.
      await expect(
        relate(await insertProject(), await insertPartner(), true),
      ).resolves.toBeTypeOf("string");
    });

    it("012 EARS-10: the system shall refuse a row whose status and deletion timestamp disagree, in either direction", async () => {
      const id = await relate(await insertProject(), await insertPartner());

      await expect(
        pool.query(
          `UPDATE project_organisations SET status = 'retired' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/project_organisations_retired_iff_deleted/i);

      await expect(
        pool.query(
          `UPDATE project_organisations SET deleted_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/project_organisations_retired_iff_deleted/i);
    });

    it("012 EARS-10: the system shall refuse an endpoint delete while a relation still points at it", async () => {
      const projectId = await insertProject();
      const partnerId = await insertPartner();
      await relate(projectId, partnerId);

      await expect(
        pool.query("DELETE FROM projects WHERE id = $1", [projectId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
      await expect(
        pool.query("DELETE FROM organisations WHERE id = $1", [partnerId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
    });

    it("012 EARS-10: moving the primary flag shall land in the same-transaction audit ledger as a plain diff", async () => {
      const id = await relate(await insertProject(), await insertPartner());
      await pool.query(
        `UPDATE project_organisations SET is_primary = true, version = version + 1
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
        "data.project_organisations.insert",
        "data.project_organisations.update",
      ]);
      expect(rows[1]!.metadata.diff.is_primary).toEqual({
        old: false,
        new: true,
      });
    });
  },
);
