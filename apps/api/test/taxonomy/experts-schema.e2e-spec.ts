import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-2 (#1284) — the DB half of the expert authoring vertical
// (012-design §2.1, §2.2, §2.4, §6). Talks to Postgres directly via pg.Pool (no
// Nest boot), the same pattern as `projects-schema.e2e-spec.ts`.
//
// Every assertion is about a constraint the DATABASE enforces, not one the
// service happens to check. The expert-specific ones are three: the removal
// shape §2.4 pins (`content_removed_at` ⇒ retired + deleted + every descriptive
// column NULL), the display label being mandatory for every NON-removed row,
// and the LD-6 trigram index that keeps admin search off a full-roster scan.

const UUID_TEXT = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!process.env.DATABASE_URL)(
  "012 taxonomy — experts schema, removal shape and trigram search (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    function slug(): string {
      return `e-1284-${randomUUID()}`;
    }

    /** Insert a minimal draft expert; returns its id. */
    async function insertExpert(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: slug(),
        name: "Эксперт 1284",
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        cols.map((c) => row[c]),
      );
      return rows[0]!.id;
    }

    it("012 EARS-2: when an expert is created, the system shall persist one retained row with stable id, slug and version 1 in draft", async () => {
      const s = slug();
      const id = await insertExpert({ slug: s });
      const { rows } = await pool.query(
        `SELECT slug, name, status, version, deleted_at, first_published_at,
                photo_ref, professional_role, credentials, affiliation, bio,
                content_removed_at
           FROM experts WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        slug: s,
        name: "Эксперт 1284",
        status: "draft",
        version: 1,
        deleted_at: null,
        first_published_at: null,
        photo_ref: null,
        professional_role: null,
        credentials: null,
        affiliation: null,
        bio: null,
        content_removed_at: null,
      });
    });

    it("012 EARS-2: when a slug repeats any retained row, the system shall reject the insert so a public URL can never resolve to a different expert", async () => {
      const s = slug();
      await insertExpert({ slug: s });
      await expect(insertExpert({ slug: s })).rejects.toThrow(
        /experts_slug_key/,
      );
      // …including against a RETIRED holder: retirement never releases identity,
      // and §2.4's removal keeps the slug forever precisely so it cannot be
      // re-pointed at a different person.
      const retiredSlug = slug();
      await insertExpert({
        slug: retiredSlug,
        status: "retired",
        deleted_at: new Date(),
      });
      await expect(insertExpert({ slug: retiredSlug })).rejects.toThrow(
        /experts_slug_key/,
      );
    });

    it("012 EARS-2: when an authored slug is not lowercase-hyphen ASCII or is canonical UUID text, the system shall reject it", async () => {
      for (const bad of ["Not valid", "trailing-", "double--hyphen", "UPPER"]) {
        await expect(insertExpert({ slug: bad })).rejects.toThrow(
          /experts_slug_pattern/,
        );
      }
      await expect(insertExpert({ slug: UUID_TEXT })).rejects.toThrow(
        /experts_slug_not_uuid/,
      );
    });

    it("012 EARS-2: when status and deleted_at disagree, the system shall reject the row so retired ⇔ deleted_at holds", async () => {
      await expect(insertExpert({ status: "retired" })).rejects.toThrow(
        /experts_retired_iff_deleted/,
      );
      await expect(
        insertExpert({ status: "draft", deleted_at: new Date() }),
      ).rejects.toThrow(/experts_retired_iff_deleted/);
    });

    it("012 EARS-2: when a descriptive field exceeds the §2.2 authoring matrix, the system shall reject the row", async () => {
      const cases: [string, string, number][] = [
        ["name", "experts_name_bounds", 160],
        ["professional_role", "experts_professional_role_bounds", 160],
        ["credentials", "experts_credentials_bounds", 500],
        ["affiliation", "experts_affiliation_bounds", 240],
        ["bio", "experts_bio_bounds", 4000],
      ];
      for (const [column, constraint, max] of cases) {
        await expect(
          insertExpert({ [column]: "x".repeat(max + 1) }),
        ).rejects.toThrow(new RegExp(constraint));
        await expect(insertExpert({ [column]: "" })).rejects.toThrow(
          new RegExp(constraint),
        );
      }
    });

    it("012 EARS-2: when a row is not editorially removed, the system shall require its display label", async () => {
      await expect(insertExpert({ name: null })).rejects.toThrow(
        /experts_name_present_unless_removed/,
      );
    });

    it("012 EARS-14: when content_removed_at is set, the system shall accept only the fully removed shape and keep id and slug", async () => {
      const s = slug();
      const id = await insertExpert({
        slug: s,
        professional_role: "Кардиолог",
        bio: "Практикующий врач.",
      });
      // A half-removal — the marker without the retirement and the NULLed
      // columns — must be impossible, so no window can leave a person's data
      // live under a "removed" flag.
      await expect(
        pool.query(`UPDATE experts SET content_removed_at = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/experts_content_removed_shape/);

      await pool.query(
        `UPDATE experts
            SET content_removed_at = now(), status = 'retired', deleted_at = now(),
                name = NULL, photo_ref = NULL, professional_role = NULL,
                credentials = NULL, affiliation = NULL, bio = NULL
          WHERE id = $1`,
        [id],
      );
      const { rows } = await pool.query<{ id: string; slug: string }>(
        `SELECT id, slug, name, status FROM experts WHERE id = $1`,
        [id],
      );
      // The row, its id and its slug survive the removal — «[удалён]» is a
      // render-time label, never a stored value.
      expect(rows[0]).toMatchObject({ id, slug: s, name: null, status: "retired" });
      await expect(insertExpert({ slug: s })).rejects.toThrow(
        /experts_slug_key/,
      );
    });

    it("012 EARS-2: when first_published_at is set, the system shall refuse to clear or change it", async () => {
      const published = new Date("2026-01-01T00:00:00.000Z");
      const id = await insertExpert({
        status: "published",
        first_published_at: published,
      });
      await expect(
        pool.query(`UPDATE experts SET first_published_at = NULL WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      await expect(
        pool.query(`UPDATE experts SET first_published_at = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      // Re-writing the SAME instant is not a change: an ordinary full-row UPDATE
      // of an already-published expert still works.
      await pool.query(
        `UPDATE experts SET name = $2, first_published_at = $3 WHERE id = $1`,
        [id, "Эксперт 1284 (правка)", published],
      );
      const { rows } = await pool.query(
        `SELECT first_published_at FROM experts WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.first_published_at).toEqual(published);
    });

    it("012 EARS-2: when an expert row is published, the system shall require its publication instant", async () => {
      await expect(insertExpert({ status: "published" })).rejects.toThrow(
        /experts_published_has_first_published_at/,
      );
    });

    it("012 EARS-2: when an expert row changes, feature 010's audit trigger shall record it", async () => {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'experts'::regclass AND NOT tgisinternal`,
      );
      expect(rows.map((r) => r.tgname)).toContain("experts_audit");

      const id = await insertExpert();
      const { rows: ledger } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1 ORDER BY created_at`,
        [id],
      );
      expect(ledger.map((r) => r.event_type)).toContain("data.experts.insert");
    });

    it("012 EARS-2: admin name search shall be served by a trigram index rather than a full-roster scan", async () => {
      // LD-6 (§2.2 last paragraph). The honest assertion at test volume is the
      // INDEX DEFINITION, not the plan: Postgres legitimately prefers a seq scan
      // on a handful of rows, so asserting the plan would test the table size,
      // not the decision. What must hold forever is that the `ILIKE '%…%'`
      // predicate HAS a GIN trigram index available to it.
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'experts'`,
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
      expect(byName.get("experts_name_trgm_idx")).toMatch(
        /USING gin \(name gin_trgm_ops\)/,
      );
      expect(byName.get("experts_slug_trgm_idx")).toMatch(
        /USING gin \(slug gin_trgm_ops\)/,
      );
      const { rows: ext } = await pool.query(
        `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
      );
      expect(ext).toHaveLength(1);
    });

    it("012 EARS-2: no expert foreign key shall cascade", async () => {
      const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE contype = 'f' AND conrelid = 'experts'::regclass`,
      );
      for (const fk of rows) {
        expect(fk.confdeltype, `${fk.conname} must not cascade`).not.toBe("c");
      }
    });
  },
);
