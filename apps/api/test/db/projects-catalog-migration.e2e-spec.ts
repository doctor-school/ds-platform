import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { eventClassificationSql } from "../setup/event-classification.js";
import { rewindToPre0055 } from "./rewind-0055.js";

// 030 EARS-17 / EARS-3 (Issue #3503, V-1) — the forward migration 0055 that
// absorbs the feature-012 projects into the projects catalog.
//
// Same harness as `organisations-migration.e2e-spec.ts`: every case runs inside
// ONE transaction that is always rolled back. It rewinds the schema to its
// pre-0055 shape (`rewind-0055.ts`, the exact inverse of 0055's DDL), seeds a
// fixture of draft, published and retired 012 projects of every kind, each
// with an event, an expert and an organisation link, then executes the
// COMMITTED 0055 file statement by statement. Nothing survives the ROLLBACK.
const MIGRATION = readFileSync(
  resolve(__dirname, "../../drizzle/0055_projects_catalog.sql"),
  "utf8",
);

const KINDS = ["school", "media", "program"] as const;
const STATES = ["draft", "published", "retired"] as const;
const INVESTOR = "03200000-0000-4000-8000-000000000001";
const ORGANISATION = "0f550000-0000-4000-8000-0000000000f1";
const EXPERT = "0f550000-0000-4000-8000-0000000000e1";
const EVENT = "0f550000-0000-4000-8000-0000000000d1";

/** `0f550000-…-00000000<kind><state>`: stable, readable fixture ids. */
function projectId(kind: number, state: number): string {
  return `0f550000-0000-4000-8000-0000000000${kind}${state}`;
}

describe.skipIf(!process.env.DATABASE_URL)(
  "030 EARS-17 projects catalog migration 0055 (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    /** Every 012 kind × every state, each project linked three ways. */
    async function seedProjects(c: pg.PoolClient): Promise<void> {
      await c.query(
        `INSERT INTO "organisations" ("id", "slug", "title") VALUES ($1, 'mig-0055-org', 'Организация')`,
        [ORGANISATION],
      );
      await c.query(
        `INSERT INTO "experts" ("id", "slug", "family_name", "given_name") VALUES ($1, 'mig-0055-expert', 'Иванова', 'И. И.')`,
        [EXPERT],
      );
      await c.query(
        `INSERT INTO "events" ("id", "slug", "title", "school", "starts_at", "duration_min", "kind_id", "audience")
         VALUES ($1, 'mig-0055-event', 'Событие', 'Кардиология', now(), 90, ${eventClassificationSql()})`,
        [EVENT],
      );
      for (const [k, kind] of KINDS.entries()) {
        for (const [s, state] of STATES.entries()) {
          const id = projectId(k, s);
          await c.query(
            `INSERT INTO "projects" ("id", "slug", "kind", "title", "description", "status", "first_published_at", "deleted_at", "version", "default_audience")
             VALUES ($1, $2, $3, $4, 'Описание', $5::text::taxonomy_status,
                     CASE WHEN $5::text = 'draft' THEN NULL ELSE '2026-01-02T03:04:05Z'::timestamptz END,
                     CASE WHEN $5::text = 'retired' THEN '2026-02-02T00:00:00Z'::timestamptz END,
                     $6, 'doctors')`,
            [id, `mig-0055-${kind}-${state}`, kind, `Проект ${kind} ${state}`, state, k + s + 1],
          );
          await c.query(
            `INSERT INTO "event_projects" ("event_id", "project_id") VALUES ($1, $2)`,
            [EVENT, id],
          );
          await c.query(
            `INSERT INTO "project_experts" ("project_id", "expert_id", "role") VALUES ($1, $2, 'member')`,
            [id, EXPERT],
          );
          await c.query(
            `INSERT INTO "project_organisations" ("project_id", "organisation_id", "is_primary") VALUES ($1, $2, true)`,
            [id, ORGANISATION],
          );
        }
      }
    }

    async function applyMigration(c: pg.PoolClient): Promise<void> {
      for (const statement of MIGRATION.split("--> statement-breakpoint")) {
        if (statement.trim()) await c.query(statement);
      }
    }

    async function inRewoundTransaction(
      body: (c: pg.PoolClient) => Promise<void>,
    ): Promise<void> {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await rewindToPre0055(c);
        await body(c);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }

    const FIXTURE = `"slug" LIKE 'mig-0055-%'`;

    it("030 EARS-17: when the migration runs, the system shall keep every 012 project's id, slug, state, publication, retirement and version, keep its former kind as legacy_kind and give it the stage `running` with no stage note", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProjects(c);
        const { rows: before } = await c.query(
          `SELECT "id", "slug", "title", "description", "status"::text, "first_published_at", "deleted_at", "version", "kind"::text AS "legacy_kind"
             FROM "projects" WHERE ${FIXTURE} ORDER BY "id"`,
        );
        expect(before).toHaveLength(9);
        await applyMigration(c);
        const { rows: after } = await c.query(
          `SELECT "id", "slug", "title", "description", "status"::text, "first_published_at", "deleted_at", "version", "legacy_kind"::text
             FROM "projects" WHERE ${FIXTURE} ORDER BY "id"`,
        );
        expect(after).toEqual(before);
        const { rows: stages } = await c.query(
          `SELECT DISTINCT "stage"::text, "stage_note" FROM "projects" WHERE ${FIXTURE}`,
        );
        expect(stages).toEqual([{ stage: "running", stage_note: null }]);
      });
    });

    it("030 EARS-17: when the migration runs, the system shall keep every event, expert and organisation link, give each organisation link the investor role and create no result", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProjects(c);
        await applyMigration(c);
        const ids = KINDS.flatMap((_, k) => STATES.map((_, s) => projectId(k, s)));
        const count = async (sql: string): Promise<number> =>
          Number((await c.query(sql, [ids])).rows[0]!.n);
        expect(
          await count(`SELECT count(*) n FROM "event_projects" WHERE "project_id" = ANY($1)`),
        ).toBe(9);
        expect(
          await count(`SELECT count(*) n FROM "project_experts" WHERE "project_id" = ANY($1)`),
        ).toBe(9);
        const { rows: links } = await c.query(
          `SELECT DISTINCT "organisation_id", "role_id", "note" FROM "project_organisations" WHERE "project_id" = ANY($1)`,
          [ids],
        );
        expect(links).toEqual([
          { organisation_id: ORGANISATION, role_id: INVESTOR, note: null },
        ]);
        expect(
          await count(`SELECT count(*) n FROM "project_organisations" WHERE "project_id" = ANY($1)`),
        ).toBe(9);
        expect(await count(`SELECT count(*) n FROM "project_results" WHERE $1::uuid[] IS NOT NULL`)).toBe(0);
      });
    });

    it("030 EARS-3: when the migration runs, the system shall seed the six output kinds Школа, Курс, Подкаст, Событие, Конгресс and Клуб as active kinds", async () => {
      await inRewoundTransaction(async (c) => {
        await applyMigration(c);
        const { rows } = await c.query(
          `SELECT "slug", "title", "status"::text, "version" FROM "project_output_kinds" ORDER BY "id"`,
        );
        expect(rows).toEqual(
          [
            ["shkola", "Школа"],
            ["kurs", "Курс"],
            ["podkast", "Подкаст"],
            ["sobytie", "Событие"],
            ["kongress", "Конгресс"],
            ["klub", "Клуб"],
          ].map(([slug, title]) => ({ slug, title, status: "active", version: 1 })),
        );
      });
    });
  },
);
