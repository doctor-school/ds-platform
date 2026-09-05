import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-7 (#1289) — the DB half of the expert↔event link (012-design §2,
// §2.3, §4 LD-2, §6). Talks to Postgres directly via pg.Pool (no Nest boot),
// the same pattern as `directions-schema.e2e-spec.ts`.
//
// Every assertion here is about a constraint the DATABASE enforces, not one the
// service happens to check. That distinction matters more for this table than
// for any of the four entities: since the EARS-24 cutover (#1607)
// `event_experts` is the SOLE source of the public speaker projection, so the
// invariants that keep that projection honest — one link per expert per event,
// one ACTIVE link per slot, retired ⇔ deleted_at — have to survive a future
// writer that forgets to re-check them.

describe.skipIf(!process.env.DATABASE_URL)(
  "012 taxonomy — event_experts schema, link uniqueness and slot uniqueness (e2e)",
  () => {
    let pool: pg.Pool;
    const createdEventIds: string[] = [];
    const createdExpertIds: string[] = [];

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterAll(async () => {
      // Children first: every FK here is RESTRICT by design, so a parent cannot
      // be removed while a link still points at it.
      for (const id of createdEventIds) {
        await pool.query("DELETE FROM event_experts WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of createdExpertIds) {
        await pool.query("DELETE FROM event_experts WHERE expert_id = $1", [
          id,
        ]);
        await pool.query("DELETE FROM experts WHERE id = $1", [id]);
      }
      await pool.end();
    });

    /** A retained event to hang links off. */
    async function insertEvent(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min)
         VALUES ($1, $2, $3, now(), 60) RETURNING id`,
        [`e-1289-${randomUUID()}`, "Эфир 1289", "Школа 1289"],
      );
      createdEventIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /** A published expert — the only lifecycle in which a link is visible. */
    async function insertExpert(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = {
        slug: `x-1289-${randomUUID()}`,
        family_name: "Иванова",
        given_name: "И. И.",
        status: "published",
        first_published_at: new Date(),
        ...overrides,
      } as Record<string, unknown>;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO experts (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      createdExpertIds.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertLink(
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const row = { position: 0, role: "Спикер", ...overrides } as Record<
        string,
        unknown
      >;
      const cols = Object.keys(row);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_experts (${cols.map((c) => `"${c}"`).join(", ")})
         VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        cols.map((c) => row[c]),
      );
      return rows[0]!.id;
    }

    it("012 EARS-7: when an expert is linked to an event, the system shall persist one retained active row with a stable id and version 1", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const id = await insertLink({ event_id: eventId, expert_id: expertId });
      const { rows } = await pool.query(
        `SELECT event_id, expert_id, role, position,
                status, version, deleted_at
           FROM event_experts WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        event_id: eventId,
        expert_id: expertId,
        role: "Спикер",
        position: 0,
        status: "active",
        version: 1,
        deleted_at: null,
      });
    });

    it("012 EARS-7: when the same expert is linked twice to one event, the system shall reject the duplicate across retained rows", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      await insertLink({ event_id: eventId, expert_id: expertId, position: 0 });
      await expect(
        insertLink({ event_id: eventId, expert_id: expertId, position: 1 }),
      ).rejects.toThrow(/event_experts_event_expert_key/);
      // Retiring the first one does NOT free the pair: the retired link is what
      // a restore acts on, so a second row would fork the link's own history.
      await pool.query(
        `UPDATE event_experts SET status = 'retired', deleted_at = now()
          WHERE event_id = $1 AND expert_id = $2`,
        [eventId, expertId],
      );
      await expect(
        insertLink({ event_id: eventId, expert_id: expertId, position: 1 }),
      ).rejects.toThrow(/event_experts_event_expert_key/);
    });

    it("012 EARS-7: when two ACTIVE links claim one position on an event, the system shall reject the second while leaving retired rows free to hold it", async () => {
      const eventId = await insertEvent();
      const first = await insertExpert();
      const second = await insertExpert();
      const third = await insertExpert();
      await insertLink({ event_id: eventId, expert_id: first, position: 3 });
      await expect(
        insertLink({ event_id: eventId, expert_id: second, position: 3 }),
      ).rejects.toThrow(/event_experts_event_position_active_uniq/);
      // The index is PARTIAL: a retired link keeps the position it had, so a
      // retire does not have to rewrite history to free a slot.
      await expect(
        insertLink({
          event_id: eventId,
          expert_id: third,
          position: 3,
          status: "retired",
          deleted_at: new Date(),
        }),
      ).resolves.toBeTypeOf("string");
    });

    it("012 EARS-7: when status and deleted_at disagree, the system shall reject the row so retired ⇔ deleted_at holds", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      await expect(
        insertLink({
          event_id: eventId,
          expert_id: expertId,
          status: "retired",
        }),
      ).rejects.toThrow(/event_experts_retired_iff_deleted/);
      await expect(
        insertLink({
          event_id: eventId,
          expert_id: expertId,
          status: "active",
          deleted_at: new Date(),
        }),
      ).rejects.toThrow(/event_experts_retired_iff_deleted/);
    });

    it("012 EARS-7: when the role or the position is outside its §2.2 bound, the system shall reject the row", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      await expect(
        insertLink({ event_id: eventId, expert_id: expertId, role: "" }),
      ).rejects.toThrow(/event_experts_role_bounds/);
      await expect(
        insertLink({
          event_id: eventId,
          expert_id: expertId,
          role: "x".repeat(81),
        }),
      ).rejects.toThrow(/event_experts_role_bounds/);
      await expect(
        insertLink({ event_id: eventId, expert_id: expertId, position: -1 }),
      ).rejects.toThrow(/event_experts_position_bounds/);
      await expect(
        insertLink({ event_id: eventId, expert_id: expertId, position: 32768 }),
      ).rejects.toThrow(/event_experts_position_bounds/);
      // The bounds are inclusive at both ends.
      await expect(
        insertLink({
          event_id: eventId,
          expert_id: expertId,
          role: "x".repeat(80),
          position: 32767,
        }),
      ).resolves.toBeTypeOf("string");
    });

    it("012 EARS-7: role shall be nullable at rest so #1306 can clear it without deleting the link", async () => {
      // The Zod write contract REQUIRES a role — an operator never authors a
      // link without one. Nullability exists for exactly one writer:
      // `RemoveExpertContent` (§2.4), which clears the editorial text of a
      // person who asked to be taken off the site while the link itself, and
      // the historical fact it records, survive.
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const id = await insertLink({
        event_id: eventId,
        expert_id: expertId,
        role: null,
      });
      expect(id).toBeTypeOf("string");
    });

    it("012 EARS-7: when the version counter would drop below one, the system shall reject the row", async () => {
      const eventId = await insertEvent();
      const expertId = await insertExpert();
      await expect(
        insertLink({ event_id: eventId, expert_id: expertId, version: 0 }),
      ).rejects.toThrow(/event_experts_version_positive/);
    });

    it("012 EARS-7: no event_experts foreign key shall cascade", async () => {
      // §3.6 rule 1: a link is domain history. Deleting an event or an expert
      // must fail loudly rather than silently erase the record of who was
      // announced for what.
      const { rows } = await pool.query<{
        conname: string;
        confdeltype: string;
      }>(
        `SELECT conname, confdeltype FROM pg_constraint
          WHERE contype = 'f' AND conrelid = 'event_experts'::regclass`,
      );
      // Two endpoints remain after the EARS-24 cutover removed the legacy seam:
      // `events` and `experts`.
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const fk of rows) {
        expect(fk.confdeltype, `${fk.conname} must not cascade`).not.toBe("c");
      }
    });

    it("012 EARS-7: when an event_experts row changes, feature 010's audit trigger shall record it", async () => {
      const { rows } = await pool.query<{ tgname: string }>(
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'event_experts'::regclass AND NOT tgisinternal`,
      );
      expect(rows.map((r) => r.tgname)).toContain("event_experts_audit");

      const eventId = await insertEvent();
      const expertId = await insertExpert();
      const id = await insertLink({ event_id: eventId, expert_id: expertId });
      const { rows: ledger } = await pool.query<{ event_type: string }>(
        `SELECT event_type FROM audit_ledger
          WHERE metadata->'pk'->>'id' = $1 ORDER BY created_at`,
        [id],
      );
      expect(ledger.map((r) => r.event_type)).toContain(
        "data.event_experts.insert",
      );
    });
  },
);
