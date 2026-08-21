import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-4 (#1286) — the DB half of the partner authoring vertical
// (012-design §2.1, §2.2, §6). Talks to Postgres directly via pg.Pool (no Nest
// boot), the same pattern as `experts-schema.e2e-spec.ts`.
//
// Every assertion is about a constraint the DATABASE enforces, not one the
// service happens to check. The partner-specific one is the website URL: the
// spec allows only an absolute `https://` link, and that has to hold at the
// storage layer too, because a partner link is rendered into public pages —
// a `javascript:` or protocol-relative value reaching the column would be a
// stored cross-site scripting vector no service-layer check could retract.

const UUID_TEXT = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!process.env.DATABASE_URL)(
  "012 taxonomy — partners schema, https link guard and trigram search (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    function slug(): string {
      return `p-1286-${randomUUID()}`;
    }

    /** Insert a minimal draft partner; returns its id. */
    async function insertPartner(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: slug(),
        title: "Партнёр 1286",
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO partners (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        cols.map((c) => row[c]),
      );
      return rows[0]!.id;
    }

    it("012 EARS-4: when a partner is created, the system shall persist one retained row with stable id, slug and version 1 in draft", async () => {
      const s = slug();
      const id = await insertPartner({ slug: s });
      const { rows } = await pool.query(
        `SELECT slug, title, status, version, deleted_at, first_published_at,
                logo_ref, website_url
           FROM partners WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        slug: s,
        title: "Партнёр 1286",
        status: "draft",
        version: 1,
        deleted_at: null,
        first_published_at: null,
        logo_ref: null,
        website_url: null,
      });
    });

    it("012 EARS-4: when a slug repeats any retained row, the system shall reject the insert so a public URL can never resolve to a different partner", async () => {
      const s = slug();
      await insertPartner({ slug: s });
      await expect(insertPartner({ slug: s })).rejects.toThrow(
        /partners_slug_key/,
      );
      // …including against a RETIRED holder: retirement never releases identity.
      const retiredSlug = slug();
      await insertPartner({
        slug: retiredSlug,
        status: "retired",
        deleted_at: new Date(),
      });
      await expect(insertPartner({ slug: retiredSlug })).rejects.toThrow(
        /partners_slug_key/,
      );
    });

    it("012 EARS-4: when an authored slug is not lowercase-hyphen ASCII or is canonical UUID text, the system shall reject it", async () => {
      for (const bad of ["Not valid", "trailing-", "double--hyphen", "UPPER"]) {
        await expect(insertPartner({ slug: bad })).rejects.toThrow(
          /partners_slug_pattern/,
        );
      }
      await expect(insertPartner({ slug: UUID_TEXT })).rejects.toThrow(
        /partners_slug_not_uuid/,
      );
    });

    it("012 EARS-4: when status and deleted_at disagree, the system shall reject the row so retired ⇔ deleted_at holds", async () => {
      await expect(insertPartner({ status: "retired" })).rejects.toThrow(
        /partners_retired_iff_deleted/,
      );
      await expect(
        insertPartner({ status: "draft", deleted_at: new Date() }),
      ).rejects.toThrow(/partners_retired_iff_deleted/);
    });

    it("012 EARS-4: when the title or the website URL exceeds the §2.2 authoring matrix, the system shall reject the row", async () => {
      await expect(
        insertPartner({ title: "x".repeat(161) }),
      ).rejects.toThrow(/partners_title_bounds/);
      await expect(insertPartner({ title: "" })).rejects.toThrow(
        /partners_title_bounds/,
      );
      await expect(insertPartner({ title: null })).rejects.toThrow(
        /null value in column "title"|not-null/i,
      );
      await expect(
        insertPartner({
          website_url: `https://p.example/${"x".repeat(2048)}`,
        }),
      ).rejects.toThrow(/partners_website_url_bounds/);
    });

    it("012 EARS-4: when a website URL is not an absolute https link, the system shall reject the row", async () => {
      for (const bad of [
        "http://partner.example",
        "//partner.example",
        "/local/path",
        "partner.example",
        "javascript:alert(1)",
        "https://",
        "https:// partner.example",
      ]) {
        await expect(insertPartner({ website_url: bad })).rejects.toThrow(
          /partners_website_url_https/,
        );
      }
      // The accept side of the same guard — stored verbatim, no normalization.
      const url = "https://partner.example/ru/about?ref=ds#team";
      const id = await insertPartner({ website_url: url });
      const { rows } = await pool.query<{ website_url: string }>(
        `SELECT website_url FROM partners WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.website_url).toBe(url);
    });

    it("012 EARS-4: when first_published_at is set, the system shall refuse to clear or change it", async () => {
      const published = new Date("2026-01-01T00:00:00.000Z");
      const id = await insertPartner({
        status: "published",
        first_published_at: published,
      });
      await expect(
        pool.query(`UPDATE partners SET first_published_at = NULL WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      await expect(
        pool.query(`UPDATE partners SET first_published_at = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      // Re-writing the SAME instant is not a change: an ordinary full-row UPDATE
      // of an already-published partner still works.
      await pool.query(
        `UPDATE partners SET title = $2, first_published_at = $3 WHERE id = $1`,
        [id, "Партнёр 1286 (правка)", published],
      );
      const { rows } = await pool.query(
        `SELECT first_published_at FROM partners WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.first_published_at).toEqual(published);
    });

    it("012 EARS-4: when a partner row is published, the system shall require its publication instant", async () => {
      await expect(insertPartner({ status: "published" })).rejects.toThrow(
        /partners_published_has_first_published_at/,
      );
    });

    it("012 EARS-4: when a partner row changes, feature 010's audit trigger shall record it", async () => {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'partners'::regclass AND NOT tgisinternal`,
      );
      expect(rows.map((r) => r.tgname)).toContain("partners_audit");

      const id = await insertPartner();
      const { rows: ledger } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1 ORDER BY created_at`,
        [id],
      );
      expect(ledger.map((r) => r.event_type)).toContain("data.partners.insert");
    });

    it("012 EARS-4: admin title search shall be served by a trigram index rather than a full-roster scan", async () => {
      // LD-6 (§2.2 last paragraph). The honest assertion at test volume is the
      // INDEX DEFINITION, not the plan: Postgres legitimately prefers a seq scan
      // on a handful of rows, so asserting the plan would test the table size,
      // not the decision.
      const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'partners'`,
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));
      expect(byName.get("partners_title_trgm_idx")).toMatch(
        /USING gin \(title gin_trgm_ops\)/,
      );
      expect(byName.get("partners_slug_trgm_idx")).toMatch(
        /USING gin \(slug gin_trgm_ops\)/,
      );
      const { rows: ext } = await pool.query(
        `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`,
      );
      expect(ext).toHaveLength(1);
    });

    it("012 EARS-4: no partner foreign key shall cascade", async () => {
      const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE contype = 'f' AND conrelid = 'partners'::regclass`,
      );
      for (const fk of rows) {
        expect(fk.confdeltype, `${fk.conname} must not cascade`).not.toBe("c");
      }
    });
  },
);
