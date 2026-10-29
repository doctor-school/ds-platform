import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 032 EARS-11 / EARS-3 (Issue #3492, V-1) — the forward migration 0054 that
// absorbs the feature-012 partners into the organisation registry.
//
// Same harness as `event-kinds-migration.e2e-spec.ts`: every case runs inside
// ONE transaction that is always rolled back. It rewinds the schema to its
// pre-0054 shape (the exact inverse of 0054's DDL), empties the two partner
// tables, seeds a fixture of published, draft and retired partners with primary
// and non-primary links, then executes the COMMITTED 0054 file statement by
// statement. Nothing survives the ROLLBACK.
const MIGRATION = readFileSync(
  resolve(__dirname, "../../drizzle/0054_organisation_registry.sql"),
  "utf8",
);

const PUBLISHED = "0f000000-0000-4000-8000-000000000001";
const DRAFT = "0f000000-0000-4000-8000-000000000002";
const RETIRED = "0f000000-0000-4000-8000-000000000003";
const PROJECT_A = "0f000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "0f000000-0000-4000-8000-0000000000b1";
const LINK_PRIMARY = "0f000000-0000-4000-8000-0000000000c1";
const LINK_SECONDARY = "0f000000-0000-4000-8000-0000000000c2";
const LINK_RETIRED = "0f000000-0000-4000-8000-0000000000c3";
const INVESTOR = "03200000-0000-4000-8000-000000000001";

const ORG_CONSTRAINTS = [
  "pkey",
  "published_has_first_published_at",
  "retired_iff_deleted",
  "slug_bounds",
  "slug_not_uuid",
  "slug_pattern",
  "title_bounds",
  "version_positive",
  "website_url_bounds",
  "website_url_https",
];
const ORG_INDEXES = ["slug_key", "title_trgm_idx", "slug_trgm_idx"];

describe.skipIf(!process.env.DATABASE_URL)(
  "032 EARS-11 organisation registry migration 0054 (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    /** Rewinds to the pre-0054 schema with empty partner tables. */
    async function rewindToPre0054(c: pg.PoolClient): Promise<void> {
      await c.query(`DROP TABLE "organisation_role_assignments"`);
      await c.query(`DROP TABLE "organisation_roles"`);
      await c.query(`DROP TYPE "organisation_role_status"`);
      await c.query(`DROP TRIGGER "organisations_audit" ON "organisations"`);
      await c.query(
        `DROP TRIGGER "project_organisations_audit" ON "project_organisations"`,
      );
      await c.query(
        `ALTER TABLE "organisations" DROP CONSTRAINT "organisations_description_bounds"`,
      );
      await c.query(
        `ALTER TABLE "organisations" DROP COLUMN "description", DROP COLUMN "public_name_visible", DROP COLUMN "public_logo_visible"`,
      );
      await c.query(`ALTER TABLE "organisations" RENAME TO "partners"`);
      for (const name of ORG_CONSTRAINTS) {
        await c.query(
          `ALTER TABLE "partners" RENAME CONSTRAINT "organisations_${name}" TO "partners_${name}"`,
        );
      }
      for (const name of ORG_INDEXES) {
        await c.query(
          `ALTER INDEX "organisations_${name}" RENAME TO "partners_${name}"`,
        );
      }
      await c.query(
        `ALTER TRIGGER "organisations_first_published_at_set_once" ON "partners" RENAME TO "partners_first_published_at_set_once"`,
      );
      await c.query(
        `ALTER TABLE "project_organisations" RENAME TO "project_partners"`,
      );
      await c.query(
        `ALTER TABLE "project_partners" RENAME COLUMN "organisation_id" TO "partner_id"`,
      );
      for (const [from, to] of [
        ["project_organisations_pkey", "project_partners_pkey"],
        [
          "project_organisations_retired_iff_deleted",
          "project_partners_retired_iff_deleted",
        ],
        [
          "project_organisations_version_positive",
          "project_partners_version_positive",
        ],
        [
          "project_organisations_project_id_projects_id_fk",
          "project_partners_project_id_projects_id_fk",
        ],
        [
          "project_organisations_organisation_id_organisations_id_fk",
          "project_partners_partner_id_partners_id_fk",
        ],
      ]) {
        await c.query(
          `ALTER TABLE "project_partners" RENAME CONSTRAINT "${from}" TO "${to}"`,
        );
      }
      for (const [from, to] of [
        ["project_organisations_pair_key", "project_partners_pair_key"],
        [
          "project_organisations_project_primary_active_uniq",
          "project_partners_project_primary_active_uniq",
        ],
        [
          "project_organisations_organisation_id_idx",
          "project_partners_partner_id_idx",
        ],
      ]) {
        await c.query(`ALTER INDEX "${from}" RENAME TO "${to}"`);
      }
      await c.query(
        `CREATE TRIGGER partners_audit AFTER INSERT OR UPDATE OR DELETE ON "partners" FOR EACH ROW EXECUTE FUNCTION audit_row_change()`,
      );
      await c.query(
        `CREATE TRIGGER project_partners_audit AFTER INSERT OR UPDATE OR DELETE ON "project_partners" FOR EACH ROW EXECUTE FUNCTION audit_row_change()`,
      );
      await c.query(`TRUNCATE "project_partners", "partners" CASCADE`);
    }

    /** Published, draft and retired partners; primary, secondary and retired links. */
    async function seedPartners(c: pg.PoolClient): Promise<void> {
      await c.query(
        `INSERT INTO "partners" ("id", "slug", "title", "logo_ref", "website_url", "status", "first_published_at", "version")
         VALUES ($1, 'mig-0054-published', 'Опубликованный', 'taxonomy/partners/logos/p.webp', 'https://published.example', 'published', '2026-01-02T03:04:05Z', 4)`,
        [PUBLISHED],
      );
      await c.query(
        `INSERT INTO "partners" ("id", "slug", "title", "status", "version")
         VALUES ($1, 'mig-0054-draft', 'Черновик', 'draft', 1)`,
        [DRAFT],
      );
      await c.query(
        `INSERT INTO "partners" ("id", "slug", "title", "website_url", "status", "first_published_at", "deleted_at", "version")
         VALUES ($1, 'mig-0054-retired', 'Снятый', 'https://retired.example', 'retired', '2025-05-05T00:00:00Z', '2026-02-02T00:00:00Z', 7)`,
        [RETIRED],
      );
      for (const [id, slug] of [
        [PROJECT_A, "mig-0054-project-a"],
        [PROJECT_B, "mig-0054-project-b"],
      ]) {
        await c.query(
          `INSERT INTO "projects" ("id", "slug", "kind", "title", "status", "default_audience") VALUES ($1, $2, 'school', 'Проект', 'draft', 'doctors')`,
          [id, slug],
        );
      }
      await c.query(
        `INSERT INTO "project_partners" ("id", "project_id", "partner_id", "is_primary", "status", "version")
         VALUES ($1, $2, $3, true, 'active', 2)`,
        [LINK_PRIMARY, PROJECT_A, PUBLISHED],
      );
      await c.query(
        `INSERT INTO "project_partners" ("id", "project_id", "partner_id", "is_primary", "status", "version")
         VALUES ($1, $2, $3, false, 'active', 1)`,
        [LINK_SECONDARY, PROJECT_A, DRAFT],
      );
      await c.query(
        `INSERT INTO "project_partners" ("id", "project_id", "partner_id", "is_primary", "status", "deleted_at", "version")
         VALUES ($1, $2, $3, false, 'retired', now(), 3)`,
        [LINK_RETIRED, PROJECT_B, RETIRED],
      );
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
        await rewindToPre0054(c);
        await body(c);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    }

    it("032 EARS-11: every partner becomes an organisation with the same id, slug, title, logo, website, state, first publication and version, both display rules on and no description", async () => {
      await inRewoundTransaction(async (c) => {
        await seedPartners(c);
        const { rows: before } = await c.query(
          `SELECT "id", "slug", "title", "logo_ref", "website_url", "status"::text, "first_published_at", "deleted_at", "version", "created_at"
             FROM "partners" ORDER BY "id"`,
        );
        await applyMigration(c);
        const { rows: after } = await c.query(
          `SELECT "id", "slug", "title", "logo_ref", "website_url", "status"::text, "first_published_at", "deleted_at", "version", "created_at"
             FROM "organisations" ORDER BY "id"`,
        );
        expect(after).toEqual(before);
        expect(after.map((r) => r.status)).toEqual([
          "published",
          "draft",
          "retired",
        ]);
        const { rows: extra } = await c.query(
          `SELECT "description", "public_name_visible", "public_logo_visible" FROM "organisations"`,
        );
        expect(extra).toHaveLength(3);
        for (const row of extra) {
          expect(row).toEqual({
            description: null,
            public_name_visible: true,
            public_logo_visible: true,
          });
        }
        const { rows: gone } = await c.query(
          `SELECT to_regclass('public.partners') AS p, to_regclass('public.project_partners') AS pp`,
        );
        expect(gone[0]).toEqual({ p: null, pp: null });
      });
    });

    it("032 EARS-11: every absorbed partner holds exactly the «Инвестор» role", async () => {
      await inRewoundTransaction(async (c) => {
        await seedPartners(c);
        await applyMigration(c);
        const { rows } = await c.query<{ organisation_id: string; slug: string }>(
          `SELECT a."organisation_id", r."slug"
             FROM "organisation_role_assignments" a
             JOIN "organisation_roles" r ON r."id" = a."role_id"
            ORDER BY a."organisation_id"`,
        );
        expect(rows).toEqual([
          { organisation_id: PUBLISHED, slug: "investor" },
          { organisation_id: DRAFT, slug: "investor" },
          { organisation_id: RETIRED, slug: "investor" },
        ]);
      });
    });

    it("032 EARS-11: every project_partners row survives as a project_organisations row with the same id, project, organisation, primary flag and status", async () => {
      await inRewoundTransaction(async (c) => {
        await seedPartners(c);
        const { rows: before } = await c.query(
          `SELECT "id", "project_id", "partner_id" AS organisation_id, "is_primary", "status"::text, "deleted_at", "version"
             FROM "project_partners" ORDER BY "id"`,
        );
        await applyMigration(c);
        const { rows: after } = await c.query(
          `SELECT "id", "project_id", "organisation_id", "is_primary", "status"::text, "deleted_at", "version"
             FROM "project_organisations" ORDER BY "id"`,
        );
        expect(before).toHaveLength(3);
        expect(after).toEqual(before);
      });
    });

    it("032 EARS-3: the migration seeds exactly the three active roles and no employer, sponsor or advertiser role", async () => {
      await inRewoundTransaction(async (c) => {
        await applyMigration(c);
        const { rows } = await c.query(
          `SELECT "id", "slug", "title", "status"::text, "version" FROM "organisation_roles" ORDER BY "slug"`,
        );
        expect(rows).toEqual([
          {
            id: "03200000-0000-4000-8000-000000000002",
            slug: "clinical-base",
            title: "Клиническая площадка",
            status: "active",
            version: 1,
          },
          {
            id: "03200000-0000-4000-8000-000000000003",
            slug: "educational-licensee",
            title: "Образовательный лицензиат",
            status: "active",
            version: 1,
          },
          {
            id: INVESTOR,
            slug: "investor",
            title: "Инвестор",
            status: "active",
            version: 1,
          },
        ]);
      });
    });

    it("032 EARS-13: the registry tables carry the 010 audit trigger and the renamed tables keep their constraints", async () => {
      await inRewoundTransaction(async (c) => {
        await applyMigration(c);
        const { rows: triggers } = await c.query<{ tgname: string }>(
          `SELECT tgname FROM pg_trigger
            WHERE NOT tgisinternal
              AND tgrelid IN ('organisations'::regclass, 'project_organisations'::regclass,
                              'organisation_roles'::regclass, 'organisation_role_assignments'::regclass)
            ORDER BY tgname`,
        );
        expect(triggers.map((t) => t.tgname)).toEqual([
          "organisation_role_assignments_audit",
          "organisation_roles_audit",
          "organisations_audit",
          "organisations_first_published_at_set_once",
          "project_organisations_audit",
        ]);
        const { rows: constraints } = await c.query<{ conname: string }>(
          `SELECT conname FROM pg_constraint WHERE conrelid = 'organisations'::regclass ORDER BY conname`,
        );
        expect(constraints.map((r) => r.conname)).toEqual(
          [
            ...ORG_CONSTRAINTS.map((n) => `organisations_${n}`),
            "organisations_description_bounds",
          ].sort(),
        );
      });
    });
  },
);
