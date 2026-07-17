import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { AUDIT_PD_COLUMNS } from "@ds/db";

// 010 — Universal edit audit (spec `specs/features/010-universal-edit-audit/`,
// Issue #1087): one generic PL/pgSQL row-level AFTER trigger
// (`audit_row_change()`, migration 0013) attached per domain table, appending
// `data.<table>.<insert|update|delete>` rows to the as-built `audit_ledger`.
// This suite covers the DB capture layer: EARS-1 (universal capture), EARS-2
// (field-level diff), EARS-4 (context-less writes → db-direct), EARS-6
// (storage contract) and EARS-7 (PD masking). EARS-3/5 (the Drizzle
// `withAuditContext` wrapper) belong to #1088; EARS-8 (coverage guard) to #1089.
//
// Talks to Postgres directly via pg.Pool (no Nest boot — same pattern as
// audit-ledger-partitioning.e2e-spec.ts). The ledger is append-only, so no
// cleanup of trail rows is possible (or needed): every assertion is scoped to
// the unique pk ids this run generates.

/** Domain tables that MUST carry the audit trigger (schema minus design §5 allowlist). */
const AUDITED_TABLES = [
  "users",
  "consent_records",
  "events",
  "event_speakers",
  "stream_config",
  "registrations",
] as const;

/** Design §5 allowlist — tables that must NOT carry the capture trigger. */
const ALLOWLISTED_TABLES = [
  "audit_ledger",
  "idempotency_keys",
  "presence_beats",
] as const;

interface LedgerRow {
  id: string;
  event_id: string;
  event_type: string;
  subject_id: string | null;
  metadata: {
    table: string;
    pk: Record<string, unknown>;
    diff: Record<string, Record<string, unknown>>;
    source: string;
    txid: string;
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "010 universal edit audit — generic capture trigger (e2e)",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      await pool.end();
    });

    /** Insert a minimal events row; returns its id. */
    async function insertEvent(client?: pg.PoolClient): Promise<string> {
      const runner = client ?? pool;
      const { rows } = await runner.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
         VALUES ($1, $2, 'audit-e2e', now() + interval '1 day', 60)
         RETURNING id`,
        [`audit-e2e-${randomUUID()}`, "audit e2e event"],
      );
      return rows[0]!.id;
    }

    /** Insert a minimal users row; returns {id, email}. */
    async function insertUser(): Promise<{ id: string; email: string }> {
      const email = `audit-e2e-${randomUUID()}@example.test`;
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO users (zitadel_sub, email) VALUES ($1, $2) RETURNING id`,
        [`audit-e2e-sub-${randomUUID()}`, email],
      );
      return { id: rows[0]!.id, email };
    }

    /** All data.<table>.<op> trail rows whose metadata.pk contains the given column=value. */
    async function trailRows(
      table: string,
      op: "insert" | "update" | "delete",
      pkColumn: string,
      pkValue: string,
    ): Promise<LedgerRow[]> {
      const { rows } = await pool.query<LedgerRow>(
        `SELECT id, event_id, event_type, subject_id, metadata
         FROM audit_ledger
         WHERE event_type = $1 AND metadata -> 'pk' ->> $2 = $3
         ORDER BY created_at`,
        [`data.${table}.${op}`, pkColumn, pkValue],
      );
      return rows;
    }

    // ── EARS-1 — universal DB-layer capture ────────────────────────────────

    it("010 EARS-1: an INSERT into an audited table appends exactly one data.<table>.insert row in the same transaction", async () => {
      const client = await pool.connect();
      let id: string;
      let txid: string;
      try {
        await client.query("BEGIN");
        id = await insertEvent(client);
        const { rows } = await client.query<{ txid: string }>(
          "SELECT txid_current()::text AS txid",
        );
        txid = rows[0]!.txid;
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      const trail = await trailRows("events", "insert", "id", id);
      expect(trail).toHaveLength(1);
      // Same transaction: the trail row carries the txid of the mutating tx.
      expect(trail[0]!.metadata.txid).toBe(txid);
    });

    it("010 EARS-1: one generic trigger function serves every audited table — no per-table capture code", async () => {
      // Exactly one capture function exists…
      const { rows: procs } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_proc WHERE proname = 'audit_row_change'`,
      );
      expect(procs[0]!.n).toBe("1");
      // …and every audited table's trigger points at it.
      const { rows: attached } = await pool.query<{ table_name: string }>(
        `SELECT c.relname AS table_name
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE NOT t.tgisinternal AND p.proname = 'audit_row_change'
         ORDER BY c.relname`,
      );
      const attachedSet = attached.map((r) => r.table_name);
      for (const table of AUDITED_TABLES) {
        expect(attachedSet).toContain(table);
      }
      // Allowlisted tables (design §5 rationales) carry NO capture trigger.
      for (const table of ALLOWLISTED_TABLES) {
        expect(attachedSet).not.toContain(table);
      }
    });

    // ── EARS-2 — field-level diff ──────────────────────────────────────────

    it("010 EARS-2: an UPDATE diff carries only fields that actually changed, as {field:{old,new}}, with updated_at excluded", async () => {
      const id = await insertEvent();
      await pool.query(
        `UPDATE events SET title = 'audit e2e retitled', updated_at = now() WHERE id = $1`,
        [id],
      );
      const trail = await trailRows("events", "update", "id", id);
      expect(trail).toHaveLength(1);
      const diff = trail[0]!.metadata.diff;
      expect(Object.keys(diff)).toEqual(["title"]);
      expect(diff["title"]).toEqual({
        old: "audit e2e event",
        new: "audit e2e retitled",
      });
    });

    it("010 EARS-2: a no-op UPDATE (nothing but updated_at moved) writes no trail row", async () => {
      const id = await insertEvent();
      await pool.query(
        `UPDATE events SET title = title, updated_at = now() WHERE id = $1`,
        [id],
      );
      const trail = await trailRows("events", "update", "id", id);
      expect(trail).toHaveLength(0);
    });

    it("010 EARS-2: an INSERT captures the full new row as {field:{new}}", async () => {
      const id = await insertEvent();
      const trail = await trailRows("events", "insert", "id", id);
      expect(trail).toHaveLength(1);
      const diff = trail[0]!.metadata.diff;
      // Every column of the row is present, each as {new: …} (no old side).
      const { rows: cols } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'events'`,
      );
      for (const { column_name } of cols) {
        expect(diff[column_name]).toBeDefined();
        expect(Object.keys(diff[column_name]!)).toEqual(["new"]);
      }
      expect(diff["title"]).toEqual({ new: "audit e2e event" });
    });

    it("010 EARS-2: a DELETE captures the full old row as {field:{old}} — the deleted record stays reconstructible", async () => {
      const id = await insertEvent();
      await pool.query(`DELETE FROM events WHERE id = $1`, [id]);
      const trail = await trailRows("events", "delete", "id", id);
      expect(trail).toHaveLength(1);
      const diff = trail[0]!.metadata.diff;
      expect(diff["title"]).toEqual({ old: "audit e2e event" });
      expect(diff["slug"]!["old"]).toBeDefined();
      expect(diff["id"]).toEqual({ old: id });
      for (const field of Object.keys(diff)) {
        expect(Object.keys(diff[field]!)).toEqual(["old"]);
      }
    });

    // ── EARS-4 — context-less writes: audited, never blocked ──────────────

    it("010 EARS-4: a raw SQL write with no audit context succeeds AND lands source='db-direct', subject_id NULL", async () => {
      // pool.query with no SET LOCAL — the direct-DB door.
      const id = await insertEvent();
      const trail = await trailRows("events", "insert", "id", id);
      expect(trail).toHaveLength(1);
      expect(trail[0]!.metadata.source).toBe("db-direct");
      expect(trail[0]!.subject_id).toBeNull();
      // The domain write itself was never blocked: the row exists.
      const { rows } = await pool.query(`SELECT id FROM events WHERE id = $1`, [
        id,
      ]);
      expect(rows).toHaveLength(1);
    });

    // ── EARS-6 — storage contract on the as-built ledger ───────────────────

    it("010 EARS-6: trail rows carry event_type data.<table>.<op> and metadata {table, pk, diff, source, txid}", async () => {
      const id = await insertEvent();
      const trail = await trailRows("events", "insert", "id", id);
      expect(trail).toHaveLength(1);
      const row = trail[0]!;
      expect(row.event_type).toMatch(/^data\.[a-z_]+\.(insert|update|delete)$/);
      expect(Object.keys(row.metadata).sort()).toEqual([
        "diff",
        "pk",
        "source",
        "table",
        "txid",
      ]);
      expect(row.metadata.table).toBe("events");
      expect(row.metadata.pk).toEqual({ id });
      expect(row.metadata.txid).toMatch(/^\d+$/);
      expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("010 EARS-6: a composite-pk table records every pk column in metadata.pk", async () => {
      const eventId = await insertEvent();
      await pool.query(
        `INSERT INTO event_speakers (event_id, position, name) VALUES ($1, 1, 'Dr. Audit')`,
        [eventId],
      );
      const trail = await trailRows(
        "event_speakers",
        "insert",
        "event_id",
        eventId,
      );
      expect(trail).toHaveLength(1);
      expect(trail[0]!.metadata.pk).toEqual({ event_id: eventId, position: 1 });
    });

    it("010 EARS-6: all trail rows of one transaction share metadata.txid", async () => {
      const client = await pool.connect();
      let idA: string;
      let idB: string;
      try {
        await client.query("BEGIN");
        idA = await insertEvent(client);
        idB = await insertEvent(client);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      const [a] = await trailRows("events", "insert", "id", idA);
      const [b] = await trailRows("events", "insert", "id", idB);
      expect(a!.metadata.txid).toBe(b!.metadata.txid);
    });

    it("010 EARS-6: when the transaction carries audit GUCs, subject_id = actor sub and metadata.source = the set source", async () => {
      const actorSub = `audit-e2e-actor-${randomUUID()}`;
      const client = await pool.connect();
      let id: string;
      try {
        await client.query("BEGIN");
        // SET LOCAL via set_config(..., is_local => true) — the EARS-3 wrapper
        // contract at the SQL level (the wrapper itself is #1088's deliverable).
        await client.query(`SELECT set_config('app.actor_sub', $1, true)`, [
          actorSub,
        ]);
        await client.query(
          `SELECT set_config('app.source', 'portal-api', true)`,
        );
        id = await insertEvent(client);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      const trail = await trailRows("events", "insert", "id", id);
      expect(trail).toHaveLength(1);
      expect(trail[0]!.subject_id).toBe(actorSub);
      expect(trail[0]!.metadata.source).toBe("portal-api");
      // SET LOCAL scope: a follow-up write on the SAME pool outside that tx
      // degrades back to db-direct — no context leakage across transactions.
      const after = await insertEvent();
      const afterTrail = await trailRows("events", "insert", "id", after);
      expect(afterTrail[0]!.metadata.source).toBe("db-direct");
      expect(afterTrail[0]!.subject_id).toBeNull();
    });

    it("010 EARS-6: data.* trail rows inherit the ledger's append-only contract — UPDATE and DELETE are refused", async () => {
      const id = await insertEvent();
      const [row] = await trailRows("events", "insert", "id", id);
      await expect(
        pool.query(
          `UPDATE audit_ledger SET subject_id = 'tampered' WHERE id = $1`,
          [row!.id],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        pool.query(`DELETE FROM audit_ledger WHERE id = $1`, [row!.id]),
      ).rejects.toThrow(/append-only/);
    });

    // ── EARS-7 — PD masking in diffs ───────────────────────────────────────

    it("010 EARS-7: a users UPDATE touching PD columns records {masked:true} with no plaintext values; non-PD columns diff normally", async () => {
      const { id, email } = await insertUser();
      const newEmail = `audit-e2e-${randomUUID()}@example.test`;
      await pool.query(
        `UPDATE users SET email = $2, display_name = 'Dr. PD Test', role = 'doctor_verified', updated_at = now()
         WHERE id = $1`,
        [id, newEmail],
      );
      const trail = await trailRows("users", "update", "id", id);
      expect(trail).toHaveLength(1);
      const diff = trail[0]!.metadata.diff;
      // PD columns: presence proves THAT they changed; values are omitted.
      expect(diff["email"]).toEqual({ masked: true });
      expect(diff["display_name"]).toEqual({ masked: true });
      // Non-PD column of the same row diffs normally.
      expect(diff["role"]).toEqual({
        old: "doctor_guest",
        new: "doctor_verified",
      });
      // No plaintext PD value anywhere in the ledger row.
      const serialized = JSON.stringify(trail[0]);
      expect(serialized).not.toContain(email);
      expect(serialized).not.toContain(newEmail);
      expect(serialized).not.toContain("Dr. PD Test");
    });

    it("010 EARS-7: a users INSERT masks PD columns in the full-row diff", async () => {
      const { id, email } = await insertUser();
      const trail = await trailRows("users", "insert", "id", id);
      expect(trail).toHaveLength(1);
      const diff = trail[0]!.metadata.diff;
      expect(diff["email"]).toEqual({ masked: true });
      expect(diff["phone"]).toEqual({ masked: true });
      expect(JSON.stringify(trail[0])).not.toContain(email);
    });

    it("010 EARS-7: a consent_records write masks its subject-identifying column", async () => {
      const { id: userId } = await insertUser();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO consent_records (user_id, purpose, version)
         VALUES ($1, 'audit-e2e-purpose', 'v1') RETURNING id`,
        [userId],
      );
      const trail = await trailRows("consent_records", "insert", "id", rows[0]!.id);
      expect(trail).toHaveLength(1);
      const diff = trail[0]!.metadata.diff;
      expect(diff["user_id"]).toEqual({ masked: true });
      // Non-PD columns diff normally.
      expect(diff["purpose"]).toEqual({ new: "audit-e2e-purpose" });
      expect(JSON.stringify(trail[0]!.metadata.diff)).not.toContain(userId);
    });

    it("010 EARS-7: the SQL masking registry (audit_pd_columns) mirrors the packages/db registry — no silent drift", async () => {
      for (const [table, columns] of Object.entries(AUDIT_PD_COLUMNS)) {
        const { rows } = await pool.query<{ cols: string[] }>(
          `SELECT audit_pd_columns($1) AS cols`,
          [table],
        );
        expect([...rows[0]!.cols].sort()).toEqual([...columns].sort());
      }
      // A non-PD table has an empty masking set.
      const { rows } = await pool.query<{ cols: string[] }>(
        `SELECT audit_pd_columns('events') AS cols`,
      );
      expect(rows[0]!.cols).toEqual([]);
    });
  },
);
