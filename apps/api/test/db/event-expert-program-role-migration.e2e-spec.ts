import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { eventClassificationSql } from "../setup/event-classification.js";

// 012 EARS-31 (#4306) — the forward migration 0078 that gives every
// `event_experts` link the closed programme role.
//
// Same harness as `organisations-migration.e2e-spec.ts`: the case runs inside
// ONE transaction that is always rolled back. It rewinds the schema to its
// pre-0078 shape (the exact inverse of 0078's DDL), seeds links the way a
// pre-0078 writer did — captioned, retired and caption-cleared — then executes
// the COMMITTED 0078 file statement by statement. Nothing survives the
// ROLLBACK. Every row already in the database is part of the before/after
// comparison too, so «every existing link» is read literally.
const MIGRATION = readFileSync(
  resolve(__dirname, "../../drizzle/0078_012_event_expert_program_role.sql"),
  "utf8",
);

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-31 event_experts programme role migration 0078 (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    async function rewindToPre0078(c: pg.PoolClient): Promise<void> {
      await c.query(`ALTER TABLE "event_experts" DROP COLUMN "program_role"`);
      await c.query(`DROP TYPE "public"."event_expert_program_role"`);
    }

    /** Three links in the pre-0078 shape: no `program_role` column exists. */
    async function seedPre0078Links(c: pg.PoolClient): Promise<void> {
      const { rows: events } = await c.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, kind_id, audience)
         VALUES ($1, 'Эфир 0078', 'Школа 0078', now(), 60, ${eventClassificationSql()}) RETURNING id`,
        [`mig-0078-${randomUUID()}`],
      );
      const eventId = events[0]!.id;
      const links: Array<[string | null, string, number]> = [
        ["к.м.н., доцент кафедры кардиологии", "active", 0],
        ["Ведущий секции", "retired", 1],
        [null, "retired", 2],
      ];
      for (const [role, status, position] of links) {
        const { rows: experts } = await c.query<{ id: string }>(
          `INSERT INTO experts (slug, family_name, given_name, status, first_published_at)
           VALUES ($1, 'Иванова', 'И. И.', 'published', now()) RETURNING id`,
          [`mig-0078-${randomUUID()}`],
        );
        await c.query(
          `INSERT INTO event_experts (event_id, expert_id, role, position, status, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            eventId,
            experts[0]!.id,
            role,
            position,
            status,
            status === "retired" ? new Date() : null,
          ],
        );
      }
    }

    async function applyMigration(c: pg.PoolClient): Promise<void> {
      for (const statement of MIGRATION.split("--> statement-breakpoint")) {
        if (statement.trim()) await c.query(statement);
      }
    }

    it("012 EARS-31: the forward migration gives every existing link the programme role speaker and keeps its caption, position, status and version untouched", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await rewindToPre0078(c);
        await seedPre0078Links(c);
        const snapshot = `SELECT "id", "role", "position", "status"::text, "deleted_at", "version", "updated_at"
                            FROM "event_experts" ORDER BY "id"`;
        const { rows: before } = await c.query(snapshot);
        expect(before.length).toBeGreaterThanOrEqual(3);

        await applyMigration(c);

        const { rows: after } = await c.query(snapshot);
        expect(after).toEqual(before);
        const { rows: roles } = await c.query<{
          program_role: string;
          n: string;
        }>(
          `SELECT "program_role"::text AS program_role, count(*)::text AS n
             FROM "event_experts" GROUP BY 1`,
        );
        expect(roles).toEqual([
          { program_role: "speaker", n: String(before.length) },
        ]);
        const { rows: labels } = await c.query<{ v: string }>(
          `SELECT unnest(enum_range(NULL::event_expert_program_role))::text AS v`,
        );
        expect(labels.map((r) => r.v)).toEqual(["speaker", "moderator"]);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  },
);
