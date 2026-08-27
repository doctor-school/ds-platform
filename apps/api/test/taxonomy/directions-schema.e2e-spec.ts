import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-3 (#1285) — the DB half of the curated direction authoring vertical
// (012-design §2, §2.1, §2.2, §6). Talks to Postgres directly via pg.Pool (no
// Nest boot), the same pattern as `experts-schema.e2e-spec.ts`.
//
// Every assertion is about a constraint the DATABASE enforces, not one the
// service happens to check. A direction is the THINNEST of the four taxonomy
// entities — a title plus its permanent public identity — so what has to hold
// forever is exactly that: the title is mandatory and bounded, the slug is
// unique across every retained row including retired holders, and retirement
// never releases the identity a bookmarked URL points at.

const UUID_TEXT = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!process.env.DATABASE_URL)(
  "012 taxonomy — directions schema, identity retention and trigram search (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    function slug(): string {
      return `t-1285-${randomUUID()}`;
    }

    /** Insert a minimal draft direction; returns its id. */
    async function insertDirection(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: slug(),
        title: "Кардиология 1285",
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO directions (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        cols.map((c) => row[c]),
      );
      return rows[0]!.id;
    }

    it("012 EARS-3: when a direction is created, the system shall persist one retained row with stable id, slug and version 1 in draft", async () => {
      const s = slug();
      const id = await insertDirection({ slug: s });
      const { rows } = await pool.query(
        `SELECT slug, title, status, version, deleted_at, first_published_at
           FROM directions WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        slug: s,
        title: "Кардиология 1285",
        status: "draft",
        version: 1,
        deleted_at: null,
        first_published_at: null,
      });
    });

    it("012 EARS-3: when a slug repeats any retained row, the system shall reject the insert so a public URL can never resolve to a different direction", async () => {
      const s = slug();
      await insertDirection({ slug: s });
      await expect(insertDirection({ slug: s })).rejects.toThrow(/directions_slug_key/);
      // …including against a RETIRED holder: retirement never releases identity,
      // so a bookmarked subject URL can never later name a different subject.
      const retiredSlug = slug();
      await insertDirection({
        slug: retiredSlug,
        status: "retired",
        deleted_at: new Date(),
      });
      await expect(insertDirection({ slug: retiredSlug })).rejects.toThrow(
        /directions_slug_key/,
      );
    });

    it("012 EARS-3: when an authored slug is not lowercase-hyphen ASCII or is canonical UUID text, the system shall reject it", async () => {
      for (const bad of ["Not valid", "trailing-", "double--hyphen", "UPPER"]) {
        await expect(insertDirection({ slug: bad })).rejects.toThrow(
          /directions_slug_pattern/,
        );
      }
      await expect(insertDirection({ slug: UUID_TEXT })).rejects.toThrow(
        /directions_slug_not_uuid/,
      );
    });

    it("012 EARS-3: when status and deleted_at disagree, the system shall reject the row so retired ⇔ deleted_at holds", async () => {
      await expect(insertDirection({ status: "retired" })).rejects.toThrow(
        /directions_retired_iff_deleted/,
      );
      await expect(
        insertDirection({ status: "draft", deleted_at: new Date() }),
      ).rejects.toThrow(/directions_retired_iff_deleted/);
    });

    it("012 EARS-3: when the title is absent, empty or past the §2.2 bound, the system shall reject the row", async () => {
      // A direction has no removal shape and no second descriptive column: the title
      // is the ONLY thing a reader ever sees, so it is NOT NULL rather than
      // conditionally required.
      await expect(insertDirection({ title: null })).rejects.toThrow(
        /null value in column "title"|not-null/,
      );
      await expect(insertDirection({ title: "" })).rejects.toThrow(
        /directions_title_bounds/,
      );
      await expect(insertDirection({ title: "x".repeat(121) })).rejects.toThrow(
        /directions_title_bounds/,
      );
      // The bounds are inclusive at both ends.
      await expect(insertDirection({ title: "x" })).resolves.toBeTypeOf("string");
      await expect(
        insertDirection({ title: "x".repeat(120) }),
      ).resolves.toBeTypeOf("string");
    });

    it("012 EARS-3: when the version counter would drop below one, the system shall reject the row", async () => {
      await expect(insertDirection({ version: 0 })).rejects.toThrow(
        /directions_version_positive/,
      );
    });

    it("012 EARS-3: when first_published_at is set, the system shall refuse to clear or change it", async () => {
      const published = new Date("2026-01-01T00:00:00.000Z");
      const id = await insertDirection({
        status: "published",
        first_published_at: published,
      });
      await expect(
        pool.query(`UPDATE directions SET first_published_at = NULL WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      await expect(
        pool.query(`UPDATE directions SET first_published_at = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      // Re-writing the SAME instant is not a change: an ordinary full-row UPDATE
      // of an already-published direction still works.
      await pool.query(
        `UPDATE directions SET title = $2, first_published_at = $3 WHERE id = $1`,
        [id, "Кардиология 1285 (правка)", published],
      );
      const { rows } = await pool.query(
        `SELECT first_published_at FROM directions WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.first_published_at).toEqual(published);
    });

    it("012 EARS-3: when a direction row is published, the system shall require its publication instant", async () => {
      await expect(insertDirection({ status: "published" })).rejects.toThrow(
        /directions_published_has_first_published_at/,
      );
    });

    it("012 EARS-3: when a direction row changes, feature 010's audit trigger shall record it", async () => {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'directions'::regclass AND NOT tgisinternal`,
      );
      expect(rows.map((r) => r.tgname)).toContain("directions_audit");

      const id = await insertDirection();
      const { rows: ledger } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1 ORDER BY created_at`,
        [id],
      );
      expect(ledger.map((r) => r.event_type)).toContain("data.directions.insert");
    });

    it("012 EARS-3: admin title search shall be served by a trigram index rather than a full-taxonomy scan", async () => {
      // LD-6 (§2.2 last paragraph). The honest assertion at test volume is the
      // INDEX DEFINITION, not the plan: Postgres legitimately prefers a seq scan
      // on a handful of rows, so asserting the plan would test the table size,
      // not the decision. What must hold forever is that the `ILIKE '%…%'`
      // predicate HAS a GIN trigram index available to it.
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'directions'`,
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
      expect(byName.get("directions_title_trgm_idx")).toMatch(
        /USING gin \(title gin_trgm_ops\)/,
      );
      expect(byName.get("directions_slug_trgm_idx")).toMatch(
        /USING gin \(slug gin_trgm_ops\)/,
      );
      const { rows: ext } = await pool.query(
        `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
      );
      expect(ext).toHaveLength(1);
    });

    it("012 EARS-3: no direction foreign key shall cascade", async () => {
      const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE contype = 'f' AND conrelid = 'directions'::regclass`,
      );
      for (const fk of rows) {
        expect(fk.confdeltype, `${fk.conname} must not cascade`).not.toBe("c");
      }
    });
  },
);
