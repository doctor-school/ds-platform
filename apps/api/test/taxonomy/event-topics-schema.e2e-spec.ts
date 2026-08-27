import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// 012 EARS-11 (#1293) — the DB half of the event↔topic relationship
// (012-design §2, §3, §6). Talks to Postgres directly via pg.Pool (no Nest
// boot), the same pattern as the sibling `*-schema.e2e-spec.ts` files.
//
// Every assertion here is about a constraint the DATABASE enforces, not one the
// service happens to check — because the retained-relationship rule has to hold
// against a hand-written statement, a future migration and a second writer, not
// only against the code path this slice ships.
//
// Two load-bearing choices this file pins:
//
// 1. The pair uniqueness is NOT partial. A partial unique index
//    (`WHERE status = 'active'`) would let a retired relationship be shadowed by
//    a fresh row for the same pair — exactly the re-insert the vertical exists
//    to prevent.
// 2. `events.specialties[]` is a SEPARATE axis (012-requirements EARS-11 and the
//    «different axes and never synchronize» invariant): classifying an event
//    under a topic, and retiring that classification again, must leave the
//    array byte-for-byte identical at the STORAGE level, with no trigger or
//    cascade quietly maintaining it.

describe.skipIf(!process.env.DATABASE_URL)(
  "012 EARS-11 — event_topics schema, retained identity and audit capture (e2e)",
  () => {
    let pool: pg.Pool;
    const createdEvents: string[] = [];
    const createdTopics: string[] = [];

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    });

    afterEach(async () => {
      for (const id of createdEvents.splice(0)) {
        await pool.query("DELETE FROM event_topics WHERE event_id = $1", [id]);
        await pool.query("DELETE FROM events WHERE id = $1", [id]);
      }
      for (const id of createdTopics.splice(0)) {
        await pool.query("DELETE FROM event_topics WHERE topic_id = $1", [id]);
        await pool.query("DELETE FROM directions WHERE id = $1", [id]);
      }
    });

    afterAll(async () => {
      await pool.end();
    });

    async function insertEvent(specialties: string[] = ["cardiology"]): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO events (slug, title, school, starts_at, duration_min, specialties)
         VALUES ($1, $2, 'Кардиология', now(), 90, $3)
         RETURNING id`,
        [`e-1293-${randomUUID()}`, "ХСН 1293", specialties],
      );
      createdEvents.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function insertTopic(): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO directions (slug, title)
         VALUES ($1, 'Аритмология 1293')
         RETURNING id`,
        [`t-1293-${randomUUID()}`],
      );
      createdTopics.push(rows[0]!.id);
      return rows[0]!.id;
    }

    async function relate(eventId: string, topicId: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO event_topics (event_id, topic_id)
         VALUES ($1, $2) RETURNING id`,
        [eventId, topicId],
      );
      return rows[0]!.id;
    }

    it("012 EARS-11: when a classification is created, the system shall persist one retained row with a stable id, active status and version 1", async () => {
      const id = await relate(await insertEvent(), await insertTopic());
      const { rows } = await pool.query(
        `SELECT status, version, deleted_at FROM event_topics WHERE id = $1`,
        [id],
      );
      expect(rows[0]).toMatchObject({
        status: "active",
        version: 1,
        deleted_at: null,
      });
    });

    it("012 EARS-11: the system shall refuse a second row for a pair that already exists, whether the existing one is active OR retired", async () => {
      const eventId = await insertEvent();
      const topicId = await insertTopic();
      const id = await relate(eventId, topicId);

      await expect(relate(eventId, topicId)).rejects.toThrow(
        /event_topics_pair_key|duplicate key/i,
      );

      // Retiring it does NOT release the pair: a restore must move this row.
      await pool.query(
        `UPDATE event_topics SET status = 'retired', deleted_at = now() WHERE id = $1`,
        [id],
      );
      await expect(relate(eventId, topicId)).rejects.toThrow(
        /event_topics_pair_key|duplicate key/i,
      );
    });

    it("012 EARS-11: the system shall refuse a row whose status and deletion timestamp disagree, in either direction", async () => {
      const id = await relate(await insertEvent(), await insertTopic());

      await expect(
        pool.query(`UPDATE event_topics SET status = 'retired' WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/event_topics_retired_iff_deleted/);

      await expect(
        pool.query(`UPDATE event_topics SET deleted_at = now() WHERE id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/event_topics_retired_iff_deleted/);
    });

    it("012 EARS-11: the system shall refuse a non-positive version — the ETag a client quotes must always name a real revision", async () => {
      const id = await relate(await insertEvent(), await insertTopic());
      await expect(
        pool.query(`UPDATE event_topics SET version = 0 WHERE id = $1`, [id]),
      ).rejects.toThrow(/event_topics_version_positive/);
    });

    it("012 EARS-11: the system shall refuse to physically remove an endpoint that a classification still references", async () => {
      const eventId = await insertEvent();
      const topicId = await insertTopic();
      await relate(eventId, topicId);

      await expect(
        pool.query("DELETE FROM events WHERE id = $1", [eventId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
      await expect(
        pool.query("DELETE FROM directions WHERE id = $1", [topicId]),
      ).rejects.toThrow(/violates foreign key constraint/i);
    });

    it("012 EARS-11: the two axes shall never synchronize — relating and retiring a topic shall leave events.specialties byte-for-byte unchanged at the storage level", async () => {
      const specialties = ["cardiology", "therapy"];
      const eventId = await insertEvent(specialties);
      const topicId = await insertTopic();

      // The literal server-side rendering of the array, not a driver-decoded
      // JS value: a trigger that appended, reordered or re-cased an element
      // would change THIS string even where a deep-equal on the parsed array
      // still passed.
      const read = async (): Promise<string> => {
        const { rows } = await pool.query<{ raw: string }>(
          "SELECT specialties::text AS raw FROM events WHERE id = $1",
          [eventId],
        );
        return rows[0]!.raw;
      };

      const before = await read();
      const id = await relate(eventId, topicId);
      expect(await read()).toBe(before);

      await pool.query(
        `UPDATE event_topics SET status = 'retired', deleted_at = now(), version = version + 1 WHERE id = $1`,
        [id],
      );
      expect(await read()).toBe(before);
    });

    it("012 EARS-16: when a classification is created and then retired, the system shall capture both changes in the audit ledger", async () => {
      const id = await relate(await insertEvent(), await insertTopic());
      await pool.query(
        `UPDATE event_topics SET status = 'retired', deleted_at = now(), version = version + 1 WHERE id = $1`,
        [id],
      );
      // The 010 trail addresses a row by its `data.<table>.<op>` event type and
      // the primary key it carries in `metadata -> 'pk'` — the ledger has no
      // per-entity column, so this is the shape every audit suite reads.
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM audit_ledger
          WHERE event_type LIKE 'data.event_topics.%'
            AND metadata -> 'pk' ->> 'id' = $1`,
        [id],
      );
      // The row-change trigger is what writes these — a domain table opts IN to
      // feature 010's capture, and a classification is domain data.
      expect(Number(rows[0]!.count)).toBeGreaterThanOrEqual(2);
    });

    it("012 EARS-11: the reverse traversal shall be index-backed — a topic's events must not require a sequential scan", async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'event_topics' AND indexname = 'event_topics_topic_id_idx'`,
      );
      expect(rows).toHaveLength(1);
    });
  },
);
