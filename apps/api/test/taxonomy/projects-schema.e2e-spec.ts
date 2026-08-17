import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { AUDIT_CAPTURE_ALLOWLIST } from "@ds/db";

// 012 EARS-1 (#1283) — the DB half of the project authoring vertical
// (012-design §2.1, §5.1, §6, §8 "DB/migration"). Talks to Postgres directly via
// pg.Pool (no Nest boot), the same pattern as `test/db/universal-edit-audit`.
//
// Every assertion here is about a constraint the DATABASE enforces, not one the
// service happens to check: the retained-row lifecycle, the permanent slug
// identity, the set-once publication instant, and the cleared terminal shapes of
// the two technical coordination tables. A service-only guarantee would be
// bypassable by a script, a psql session or a future handler.

const UUID_TEXT = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!process.env.DATABASE_URL)(
  "012 taxonomy — projects schema, retained records and cleanup jobs (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    function slug(): string {
      return `p-1283-${randomUUID()}`;
    }

    /** Insert a minimal draft project; returns its id. */
    async function insertProject(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: slug(),
        kind: "school",
        title: "Проект 1283",
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO projects (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
         RETURNING id`,
        cols.map((c) => row[c]),
      );
      return rows[0]!.id;
    }

    it("012 EARS-1: when a project is created, the system shall persist one retained row with stable id, slug and version 1 in draft", async () => {
      const s = slug();
      const id = await insertProject({ slug: s });
      const { rows } = await pool.query(
        `SELECT slug, kind, status, version, deleted_at, first_published_at, cover_ref, description
           FROM projects WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        slug: s,
        kind: "school",
        status: "draft",
        version: 1,
        deleted_at: null,
        first_published_at: null,
        cover_ref: null,
        description: null,
      });
    });

    it("012 EARS-1: when a slug repeats any retained row, the system shall reject the insert so a public URL can never resolve to a different project", async () => {
      const s = slug();
      await insertProject({ slug: s });
      await expect(insertProject({ slug: s })).rejects.toThrow(
        /projects_slug_key/,
      );
      // …including against a RETIRED holder: retirement never releases identity.
      const retiredSlug = slug();
      await insertProject({
        slug: retiredSlug,
        status: "retired",
        deleted_at: new Date(),
      });
      await expect(insertProject({ slug: retiredSlug })).rejects.toThrow(
        /projects_slug_key/,
      );
    });

    it("012 EARS-1: when an authored slug is not lowercase-hyphen ASCII, the system shall reject it", async () => {
      for (const bad of ["Not valid", "trailing-", "double--hyphen", "UPPER"]) {
        await expect(insertProject({ slug: bad })).rejects.toThrow(
          /projects_slug_pattern/,
        );
      }
    });

    it("012 EARS-1: when an authored slug is canonical UUID text, the system shall reject it so /:idOrSlug stays unambiguous", async () => {
      await expect(insertProject({ slug: UUID_TEXT })).rejects.toThrow(
        /projects_slug_not_uuid/,
      );
    });

    it("012 EARS-1: when status and deleted_at disagree, the system shall reject the row so retired ⇔ deleted_at holds", async () => {
      await expect(insertProject({ status: "retired" })).rejects.toThrow(
        /projects_retired_iff_deleted/,
      );
      await expect(
        insertProject({ status: "draft", deleted_at: new Date() }),
      ).rejects.toThrow(/projects_retired_iff_deleted/);
    });

    it("012 EARS-1: when a title or description exceeds the authoring matrix, the system shall reject the row", async () => {
      await expect(insertProject({ title: "" })).rejects.toThrow(
        /projects_title_bounds/,
      );
      await expect(insertProject({ title: "x".repeat(161) })).rejects.toThrow(
        /projects_title_bounds/,
      );
      await expect(
        insertProject({ description: "x".repeat(2001) }),
      ).rejects.toThrow(/projects_description_bounds/);
    });

    it("012 EARS-1: when first_published_at is set, the system shall refuse to clear or change it", async () => {
      const published = new Date("2026-01-01T00:00:00.000Z");
      const id = await insertProject({
        status: "published",
        description: "опубликованный проект",
        first_published_at: published,
      });
      await expect(
        pool.query(`UPDATE projects SET first_published_at = NULL WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/set once/);
      await expect(
        pool.query(
          `UPDATE projects SET first_published_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/set once/);
      // Re-writing the SAME instant is not a change and must be allowed, so an
      // ordinary full-row UPDATE of an already-published project still works.
      await pool.query(
        `UPDATE projects SET title = $2, first_published_at = $3 WHERE id = $1`,
        [id, "Проект 1283 (правка)", published],
      );
      const { rows } = await pool.query(
        `SELECT first_published_at FROM projects WHERE id = $1`,
        [id],
      );
      expect(rows[0]!.first_published_at).toEqual(published);
    });

    it("012 EARS-1: when a project row is published, the system shall require its publication instant", async () => {
      await expect(
        insertProject({ status: "published", description: "нет даты" }),
      ).rejects.toThrow(/projects_published_has_first_published_at/);
    });

    it("012 EARS-1: when a project row changes, feature 010's audit trigger shall record it", async () => {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'projects'::regclass AND NOT tgisinternal`,
      );
      const names = rows.map((r) => r.tgname);
      expect(names).toContain("projects_audit");

      const id = await insertProject();
      const { rows: ledger } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1 ORDER BY created_at`,
        [id],
      );
      expect(ledger.map((r) => r.event_type)).toContain("data.projects.insert");
    });

    it("012 EARS-17: the exact two technical tables shall be audit exclusions in both the TS allowlist and the database", async () => {
      const allowlisted = AUDIT_CAPTURE_ALLOWLIST.map((e) => e.table);
      expect(allowlisted).toContain("idempotency_keys");
      expect(allowlisted).toContain("media_cleanup_jobs");
      for (const table of ["idempotency_keys", "media_cleanup_jobs"]) {
        const { rows } = await pool.query(
          `SELECT tgname FROM pg_trigger
            WHERE tgrelid = $1::regclass AND NOT tgisinternal`,
          [table],
        );
        expect(rows, `${table} must carry no audit trigger`).toHaveLength(0);
      }
    });

    it("012 EARS-17: when an idempotency record is active, the system shall require its route and fingerprint binding", async () => {
      const key = randomUUID();
      await expect(
        pool.query(
          `INSERT INTO idempotency_keys (key, scope, expires_at)
           VALUES ($1, 'taxonomy', now() + interval '24 hours')`,
          [key],
        ),
      ).rejects.toThrow(/idempotency_keys_active_is_bound/);
    });

    it("012 EARS-17: when a record expires, the system shall keep the key while clearing every payload column", async () => {
      const key = randomUUID();
      await pool.query(
        `INSERT INTO idempotency_keys
           (key, scope, actor_id, method, route, request_fingerprint,
            response_status, response_body, response_etag, execution_state, expires_at)
         VALUES ($1, 'taxonomy', 'actor-1', 'POST', '/v1/admin/projects', 'fp-1',
                 201, '{"id":"x"}'::jsonb, 'W/"1"', 'completed', now() + interval '24 hours')`,
        [key],
      );
      // A half-cleared expiry must be impossible.
      await expect(
        pool.query(
          `UPDATE idempotency_keys SET status = 'expired', deleted_at = now() WHERE key = $1`,
          [key],
        ),
      ).rejects.toThrow(/idempotency_keys_expired_is_cleared/);
      // The full clearing UPDATE succeeds and the key survives forever.
      await pool.query(
        `UPDATE idempotency_keys
            SET status = 'expired', deleted_at = now(), actor_id = NULL, method = NULL,
                route = NULL, request_fingerprint = NULL, response_body = NULL,
                response_etag = NULL, response_location = NULL, lease_owner = NULL,
                lease_expires_at = NULL
          WHERE key = $1`,
        [key],
      );
      const { rows } = await pool.query(
        `SELECT key, status, execution_state, response_status FROM idempotency_keys WHERE key = $1`,
        [key],
      );
      expect(rows[0]).toMatchObject({
        key,
        status: "expired",
        execution_state: "completed",
        response_status: 201,
      });
      // The globally unique key is never reusable, expiry notwithstanding.
      await expect(
        pool.query(
          `INSERT INTO idempotency_keys (key, scope, method, route, request_fingerprint, expires_at)
           VALUES ($1, 'taxonomy', 'POST', '/v1/admin/projects', 'fp-2', now() + interval '24 hours')`,
          [key],
        ),
      ).rejects.toThrow(/idempotency_keys_pkey/);
    });

    it("012 EARS-1: when a cleanup job completes, the system shall accept only the fully cleared terminal shape", async () => {
      const { rows: created } = await pool.query<{ id: string }>(
        `INSERT INTO media_cleanup_jobs
           (cleanup_kind, entity_kind, entity_id, slot, object_key, cdn_key)
         VALUES ('replace', 'project', gen_random_uuid(), 'cover', 'k/old.webp', 'cdn/old.webp')
         RETURNING id`,
      );
      const id = created[0]!.id;
      await expect(
        pool.query(
          `UPDATE media_cleanup_jobs SET status = 'expired', deleted_at = now() WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/media_cleanup_jobs_terminal_is_cleared/);
      await pool.query(
        `UPDATE media_cleanup_jobs
            SET status = 'expired', execution_state = 'completed', deleted_at = now(),
                completed_at = now(), object_key = NULL, cdn_key = NULL, entity_id = NULL,
                lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
          WHERE id = $1`,
        [id],
      );
      const { rows } = await pool.query(
        `SELECT status, execution_state, cleanup_kind, slot FROM media_cleanup_jobs WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        status: "expired",
        execution_state: "completed",
        cleanup_kind: "replace",
        slot: "cover",
      });
    });

    it("012 EARS-1: when a cleanup job is active, the system shall require the locator it must delete", async () => {
      await expect(
        pool.query(
          `INSERT INTO media_cleanup_jobs (cleanup_kind, entity_kind, slot)
           VALUES ('clear', 'project', 'cover')`,
        ),
      ).rejects.toThrow(/media_cleanup_jobs_active_has_locator/);
    });

    it("012 EARS-1: no taxonomy foreign key shall cascade", async () => {
      const { rows } = await pool.query<{ conname: string; confdeltype: string }>(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE contype = 'f'
            AND conrelid IN ('projects'::regclass, 'media_cleanup_jobs'::regclass)`,
      );
      for (const fk of rows) {
        expect(fk.confdeltype, `${fk.conname} must not cascade`).not.toBe("c");
      }
    });
  },
);
