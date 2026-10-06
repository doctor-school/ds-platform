import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 LD-11 / LD-12, EARS-26 / EARS-27 / EARS-29 / EARS-30 (Issue #2509) — the
// forward migration 0046 that introduces the event-kind dictionary, the event
// audience and the project default audience, carrying the Product Lead's
// reviewed row-by-row mapping of the production inventory (2026-10-05).
//
// No migration harness exists in this repo, so every case runs inside ONE
// transaction that is always rolled back: it rewinds the schema to its
// pre-0046 shape (the exact inverse of 0046's DDL), truncates the event and
// project graph, seeds pre-migration rows, then executes the COMMITTED 0046 file
// statement by statement. Nothing survives the ROLLBACK, so the suite needs no
// cleanup and leaves the migrated database exactly as it found it
// (`fileParallelism: false` keeps other suites off the locked tables).
const MIGRATION = readFileSync(
  resolve(__dirname, "../../drizzle/0046_event_kinds_and_audience.sql"),
  "utf8",
);

const ORTHOBIO = "eae866f8-03d6-4fcf-8900-c64b257ec4c0";
const SMYSLY_EVENTS = [
  "6d28a44d-5de1-406a-9c6d-127d29547c0d",
  "641a1b9a-e575-413f-bba4-38038fb70648",
  "df5576b2-5dc4-4fd1-949a-ec23d2ce6e85",
  "aa4e8980-3085-4eb5-b7bf-765dfd8c13a0",
  "890df0a2-e93d-46eb-9155-6ed90bc400d0",
  "53589cb2-8151-476f-b78e-60ddf56a0f99",
  "8cd68379-a508-4235-9dc9-4021945de07f",
  "c7b373e5-af07-4b45-8986-b7d2da404144",
];
const ORTHOBIO_WEBINAR = "308db4c9-6e4f-45ef-b00b-4685751c8846";
const ORTHOBIO_CONGRESS = "f637ce37-02e3-4fb8-ae88-56f782729632";
const DELETED_EVENTS = [
  "a821f7a3-18f5-411f-a9ab-ce03783722f1",
  "27d0a2d4-1361-468e-a2f8-bbeb1d51226a",
  "c3f1afb8-5e38-4c06-9fa6-63bb127a3743",
  "a90819b1-d447-418e-a292-720ed2c4c58d",
  "95de5595-1e4d-4003-b9c2-4c579470ce44",
];

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-26…30 event-kind / audience migration 0046 (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    /** Rewinds to the pre-0046 schema with an empty event/project graph. */
    async function rewindToPre0046(c: pg.PoolClient): Promise<void> {
      await c.query(`TRUNCATE "events", "projects", "event_kinds" CASCADE`);
      await c.query(
        `ALTER TABLE "events" DROP CONSTRAINT "events_kind_id_event_kinds_id_fk"`,
      );
      await c.query(`DROP INDEX "events_kind_id_idx"`);
      await c.query(
        `ALTER TABLE "events" DROP COLUMN "kind_id", DROP COLUMN "audience"`,
      );
      await c.query(`ALTER TABLE "projects" DROP COLUMN "default_audience"`);
      await c.query(`DROP TABLE "event_kinds"`);
      await c.query(`DROP TYPE "event_audience"`);
    }

    async function insertEvent(
      c: pg.PoolClient,
      id: string,
      format: "online" | "offline" | "hybrid" = "online",
    ): Promise<void> {
      await c.query(
        `INSERT INTO "events" ("id", "slug", "title", "school", "starts_at", "duration_min", "participation_format")
         VALUES ($1, $2, 'Событие', 'Школа', now(), 60, $3)`,
        [id, `mig-0046-${id}`, format],
      );
    }

    /** The production inventory of 2026-10-05, in its pre-0046 shape. */
    async function seedProductionInventory(c: pg.PoolClient): Promise<void> {
      await c.query(
        `INSERT INTO "projects" ("id", "slug", "kind", "title", "status")
         VALUES ($1, 'orthobio-school', 'school', 'Orthobio School', 'draft')`,
        [ORTHOBIO],
      );
      for (const id of SMYSLY_EVENTS) await insertEvent(c, id, "online");
      await insertEvent(c, ORTHOBIO_WEBINAR, "online");
      await insertEvent(c, ORTHOBIO_CONGRESS, "offline");
      for (const id of [ORTHOBIO_WEBINAR, ORTHOBIO_CONGRESS]) {
        await c.query(
          `INSERT INTO "event_projects" ("event_id", "project_id") VALUES ($1, $2)`,
          [id, ORTHOBIO],
        );
      }
      // Each test event carries child rows down to the grandchild level, so the
      // deletion has to walk the restrict-FK graph rather than hit an empty one.
      const {
        rows: [user],
      } = await c.query<{ id: string }>(
        `INSERT INTO "users" ("zitadel_sub", "email") VALUES ('mig-0046-' || gen_random_uuid(), 'mig-0046-' || gen_random_uuid() || '@example.test') RETURNING "id"`,
      );
      for (const id of DELETED_EVENTS) {
        await insertEvent(c, id, "online");
        await c.query(
          `INSERT INTO "event_projects" ("event_id", "project_id") VALUES ($1, $2)`,
          [id, ORTHOBIO],
        );
        const {
          rows: [reg],
        } = await c.query<{ id: string }>(
          `INSERT INTO "registrations" ("user_id", "event_id") VALUES ($1, $2) RETURNING "id"`,
          [user!.id, id],
        );
        await c.query(
          `INSERT INTO "registration_attendance" ("registration_id", "day", "present") VALUES ($1, current_date, true)`,
          [reg!.id],
        );
      }
    }

    async function applyMigration(c: pg.PoolClient): Promise<void> {
      for (const statement of MIGRATION.split("--> statement-breakpoint")) {
        if (statement.trim()) await c.query(statement);
      }
    }

    /** Runs `body` in a transaction that is ALWAYS rolled back. */
    async function inRewoundTransaction(
      body: (c: pg.PoolClient) => Promise<void>,
    ): Promise<void> {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await rewindToPre0046(c);
        await body(c);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }

    it("012 EARS-27: the migration seeds exactly the five published kinds with their allowed formats", async () => {
      await inRewoundTransaction(async (c) => {
        await applyMigration(c);
        const { rows } = await c.query<{
          slug: string;
          title: string;
          allowed_formats: string;
          status: string;
        }>(
          `SELECT "slug", "title", "allowed_formats"::text, "status" FROM "event_kinds" ORDER BY "slug"`,
        );
        expect(rows).toEqual([
          { slug: "efir", title: "Эфир", allowed_formats: "{online}", status: "published" },
          { slug: "kongress", title: "Конгресс", allowed_formats: "{offline,hybrid}", status: "published" },
          { slug: "master-klass", title: "Мастер-класс", allowed_formats: "{offline,hybrid}", status: "published" },
          { slug: "vebinar", title: "Вебинар", allowed_formats: "{online}", status: "published" },
          { slug: "vstrecha-kluba", title: "Встреча клуба", allowed_formats: "{online,offline,hybrid}", status: "published" },
        ]);
      });
    });

    it("012 EARS-26 / EARS-29 / EARS-30: the reviewed mapping gives every event one kind allowing its format and one audience, and every project a default audience", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        await applyMigration(c);

        const { rows: events } = await c.query<{
          id: string;
          audience: string;
          kind: string;
          allowed: boolean;
        }>(
          `SELECT e."id", e."audience"::text, k."slug" AS kind,
                  e."participation_format" = ANY (k."allowed_formats") AS allowed
             FROM "events" e JOIN "event_kinds" k ON k."id" = e."kind_id"`,
        );
        const byId = new Map(events.map((e) => [e.id, e]));
        expect(events).toHaveLength(10);
        for (const id of SMYSLY_EVENTS) {
          expect(byId.get(id)).toMatchObject({ audience: "experts", kind: "efir" });
        }
        expect(byId.get(ORTHOBIO_WEBINAR)).toMatchObject({ audience: "doctors", kind: "vebinar" });
        expect(byId.get(ORTHOBIO_CONGRESS)).toMatchObject({ audience: "doctors", kind: "kongress" });
        expect(events.every((e) => e.allowed)).toBe(true);

        const { rows: projects } = await c.query<{
          id: string;
          slug: string;
          kind: string;
          status: string;
          default_audience: string;
        }>(
          `SELECT "id", "slug", "kind"::text, "status"::text, "default_audience"::text FROM "projects" ORDER BY "slug"`,
        );
        expect(projects).toHaveLength(2);
        expect(projects[0]).toMatchObject({
          slug: "akademiya-smyslov",
          kind: "media",
          status: "draft",
          default_audience: "experts",
        });
        expect(projects[1]).toMatchObject({ id: ORTHOBIO, default_audience: "doctors" });

        const { rows: links } = await c.query<{ event_id: string }>(
          `SELECT "event_id" FROM "event_projects" WHERE "project_id" = $1 AND "status" = 'active'`,
          [projects[0]!.id],
        );
        expect(links.map((l) => l.event_id).sort()).toEqual([...SMYSLY_EVENTS].sort());

        // The three columns are NOT NULL once the mapping has run.
        const { rows: nullable } = await c.query<{ column_name: string }>(
          `SELECT "column_name" FROM information_schema.columns
            WHERE table_schema = 'public' AND is_nullable = 'YES'
              AND ((table_name = 'events' AND column_name IN ('kind_id', 'audience'))
                OR (table_name = 'projects' AND column_name = 'default_audience'))`,
        );
        expect(nullable).toEqual([]);
      });
    });

    it("012 LD-12: the five test events are deleted with every child row and no other event is touched", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        await applyMigration(c);

        const { rows: gone } = await c.query(
          `SELECT 1 FROM "events" WHERE "id" = ANY ($1::uuid[])`,
          [DELETED_EVENTS],
        );
        expect(gone).toEqual([]);
        for (const table of ["registrations", "event_projects"]) {
          const { rows } = await c.query(
            `SELECT 1 FROM "${table}" WHERE "event_id" = ANY ($1::uuid[])`,
            [DELETED_EVENTS],
          );
          expect(rows, table).toEqual([]);
        }
        const { rows: attendance } = await c.query(
          `SELECT 1 FROM "registration_attendance"`,
        );
        expect(attendance).toEqual([]);
        const { rows: kept } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM "events"`,
        );
        expect(kept[0]!.n).toBe("10");
      });
    });

    it("012 EARS-26 / EARS-29: an event outside the reviewed mapping aborts the migration", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        await insertEvent(c, "11111111-1111-4111-8111-111111111111");
        await expect(applyMigration(c)).rejects.toThrow(
          /events outside the reviewed kind\/audience mapping: 11111111-1111-4111-8111-111111111111/,
        );
      });
    });

    // Golden fixture ids (`packages/db/src/seed/golden/ids.ts` `goldenUuid`).
    const goldenId = (group: number, ordinal: number): string =>
      `20630063-${group.toString(16).padStart(4, "0")}-4d5b-8b63-${ordinal
        .toString(16)
        .padStart(12, "0")}`;
    const GOLDEN_PROJECTS = 0x0003;
    const GOLDEN_EVENTS = 0x0004;

    /** Golden rows as an old `ds_golden` template holds them (pre-0046 shape). */
    async function seedGoldenFixture(c: pg.PoolClient): Promise<void> {
      // Base projects 1 (school), 2 (media); volume slots 1000+3/+4 (media) and
      // 1000+5 (school), as VOLUME_PROJECTS declares them.
      for (const [ordinal, kind] of [
        [1, "school"],
        [2, "media"],
        [1003, "media"],
        [1004, "media"],
        [1005, "school"],
      ] as const) {
        await c.query(
          `INSERT INTO "projects" ("id", "slug", "kind", "title") VALUES ($1, $2, $3, 'Golden')`,
          [goldenId(GOLDEN_PROJECTS, ordinal), `golden-p-${ordinal}`, kind],
        );
      }
      for (const [ordinal, format] of [
        [1, "online"], // base event
        [1003, "online"], // i=3 → slot 1003 media
        [1017, "online"], // i=17 → slot 1005 school
        [1029, "hybrid"], // i=29 → slot 1005
        [1015, "offline"], // i=15 → slot 1003, odd i
        [1004, "offline"], // i=4 → slot 1004, even i
      ] as const) {
        await insertEvent(c, goldenId(GOLDEN_EVENTS, ordinal), format);
      }
    }

    it("012 LD-12: golden-namespace fixture rows are mapped by the golden dataset's rule", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        await seedGoldenFixture(c);
        await applyMigration(c);

        const { rows: projects } = await c.query<{
          id: string;
          default_audience: string;
        }>(
          `SELECT "id", "default_audience" FROM "projects" WHERE "id"::text LIKE '20630063-%'`,
        );
        expect(
          Object.fromEntries(projects.map((p) => [p.id, p.default_audience])),
        ).toEqual({
          [goldenId(GOLDEN_PROJECTS, 1)]: "doctors",
          [goldenId(GOLDEN_PROJECTS, 2)]: "experts",
          [goldenId(GOLDEN_PROJECTS, 1003)]: "experts",
          [goldenId(GOLDEN_PROJECTS, 1004)]: "experts",
          [goldenId(GOLDEN_PROJECTS, 1005)]: "doctors",
        });

        const { rows } = await c.query<{
          id: string;
          slug: string;
          audience: string;
        }>(
          `SELECT e."id", k."slug", e."audience" FROM "events" e
             JOIN "event_kinds" k ON k."id" = e."kind_id"
            WHERE e."id"::text LIKE '20630063-%'`,
        );
        expect(
          Object.fromEntries(rows.map((r) => [r.id, `${r.slug}/${r.audience}`])),
        ).toEqual({
          [goldenId(GOLDEN_EVENTS, 1)]: "vebinar/doctors",
          [goldenId(GOLDEN_EVENTS, 1003)]: "efir/experts",
          [goldenId(GOLDEN_EVENTS, 1017)]: "vebinar/doctors",
          [goldenId(GOLDEN_EVENTS, 1029)]: "vstrecha-kluba/doctors",
          [goldenId(GOLDEN_EVENTS, 1015)]: "master-klass/experts",
          [goldenId(GOLDEN_EVENTS, 1004)]: "kongress/experts",
        });
      });
    });

    it("012 LD-12: a non-golden unmapped event still aborts, and a look-alike id outside the exact golden shape is not golden", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        await insertEvent(c, goldenId(GOLDEN_EVENTS, 1), "online");
        // Golden prefix, wrong variant nibble — a loose-prefix match would admit it.
        const lookAlike = "20630063-0004-4d5b-9b63-000000000001";
        await insertEvent(c, lookAlike, "online");
        await expect(applyMigration(c)).rejects.toThrow(
          new RegExp(
            `events outside the reviewed kind/audience mapping: ${lookAlike}$`,
          ),
        );
      });
    });

    it("012 LD-12: a golden volume event whose primary project is absent aborts the migration", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        // i=30 → primary slot 1000 + 30 % 12 = 1006, not present.
        await insertEvent(c, goldenId(GOLDEN_EVENTS, 1030), "offline");
        await expect(applyMigration(c)).rejects.toThrow(
          /events the mapping left without a kind or audience: 20630063-0004-4d5b-8b63-000000000406/,
        );
      });
    });

    it("012 EARS-30: a project outside the reviewed mapping aborts the migration", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        await c.query(
          `INSERT INTO "projects" ("id", "slug", "kind", "title") VALUES ('22222222-2222-4222-8222-222222222222', 'unmapped', 'school', 'Unmapped')`,
        );
        await expect(applyMigration(c)).rejects.toThrow(
          /projects outside the reviewed audience mapping: 22222222-2222-4222-8222-222222222222/,
        );
      });
    });

    it("012 LD-11: a mapped kind that disallows the row's format aborts the migration", async () => {
      await inRewoundTransaction(async (c) => {
        await seedProductionInventory(c);
        // Конгресс allows {offline, hybrid}; an online congress row must not pass.
        await c.query(
          `UPDATE "events" SET "participation_format" = 'online' WHERE "id" = $1`,
          [ORTHOBIO_CONGRESS],
        );
        await expect(applyMigration(c)).rejects.toThrow(
          /mapped kind disallows the event format: f637ce37/,
        );
      });
    });
  },
);
