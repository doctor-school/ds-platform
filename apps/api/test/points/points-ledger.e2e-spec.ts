import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzle, type DrizzleHandle } from "@ds/db";
import type { PointsFact, PointsPostingLeg } from "@ds/schemas";
import { PointsLedgerService } from "../../src/points/points-ledger.service.js";
import { PointsLedgerError } from "../../src/points/points.errors.js";

// 025 ledger core (#3807) against a real Postgres migrated through 0058 —
// accounts (EARS-1), dedupe (EARS-4), overdraw serialisation (EARS-22),
// immutability + partitions + rule reference (EARS-27), frozen account
// (EARS-31). The service is constructed over a real drizzle handle (no Nest
// boot is needed for an in-process service). Postings are append-only, so the
// suite never tidies up: every person, rule and event id is unique per run and
// every read is scoped to them.
describe.skipIf(!process.env.DATABASE_URL)(
  "025 points ledger core (e2e)",
  () => {
    let handle: DrizzleHandle;
    let ledger: PointsLedgerService;
    const ruleId = `test-rule-${randomUUID()}`;

    function accrual(
      personId: string,
      overrides: Partial<PointsFact> & { pul?: number; bre?: number } = {},
    ): PointsFact {
      const { pul = 10, bre, ...fact } = overrides;
      const legs: PointsPostingLeg[] = [
        {
          leg: "accrual:pul",
          debit: { kind: "system", code: "issuance" },
          credit: { kind: "person", personId },
          denomination: "pul",
          amount: pul,
          ruleId,
          ruleVersion: 1,
        },
      ];
      if (bre !== undefined) {
        legs.push({
          leg: "accrual:bre",
          debit: { kind: "system", code: "issuance" },
          credit: { kind: "person", personId },
          denomination: "bre",
          amount: bre,
          ruleId,
          ruleVersion: 1,
        });
      }
      return {
        eventId: randomUUID(),
        occurredAt: new Date("2026-11-06T10:00:00Z"),
        legs,
        ...fact,
      };
    }

    function debit(personId: string, amount: number): PointsFact {
      return {
        eventId: `reserve:${randomUUID()}`,
        occurredAt: new Date("2026-11-06T11:00:00Z"),
        legs: [
          {
            leg: "reserve:balance",
            debit: { kind: "person", personId },
            credit: { kind: "system", code: "reserve" },
            denomination: "pul",
            amount,
            ruleId,
            ruleVersion: 1,
          },
        ],
      };
    }

    async function postingsOf(personId: string) {
      const { rows } = await handle.pool.query<{
        id: string;
        amount: number;
        recorded_at: Date;
      }>(
        `SELECT p.id, p.amount, p.recorded_at FROM points_postings p
       JOIN points_accounts a ON a.id IN (p.debit_account_id, p.credit_account_id)
       WHERE a.subject_kind = 'person' AND a.subject_id = $1
       ORDER BY p.id`,
        [personId],
      );
      return rows;
    }

    async function pulAvailable(personId: string): Promise<number> {
      const { rows } = await handle.pool.query<{ balance: string }>(
        `SELECT coalesce(sum(CASE WHEN p.credit_account_id = a.id THEN p.amount ELSE -p.amount END), 0) AS balance
       FROM points_accounts a
       JOIN points_postings p ON a.id IN (p.debit_account_id, p.credit_account_id)
       WHERE a.subject_kind = 'person' AND a.subject_id = $1 AND p.denomination = 'pul'`,
        [personId],
      );
      return Number(rows[0]!.balance);
    }

    beforeAll(async () => {
      handle = createDrizzle(process.env.DATABASE_URL!, { max: 10 });
      ledger = new PointsLedgerService(handle.db);
      await handle.pool.query(
        `INSERT INTO points_rule_versions (rule_id, version, parameters, effective_from)
       VALUES ($1, 1, '{}'::jsonb, '2026-01-01T00:00:00Z')`,
        [ruleId],
      );
    });

    afterAll(async () => {
      await handle.pool.end();
    });

    it("025 EARS-1: concurrent first needs open exactly one attention-points account per person", async () => {
      const personId = randomUUID();
      const resolved = await Promise.all(
        Array.from({ length: 8 }, () => ledger.resolvePersonAccount(personId)),
      );
      expect(new Set(resolved.map((a) => a.id)).size).toBe(1);
      const { rows } = await handle.pool.query(
        `SELECT id FROM points_accounts
       WHERE subject_kind = 'person' AND subject_id = $1 AND unit = 'attention_points'`,
        [personId],
      );
      expect(rows).toHaveLength(1);
      // A posting resolves the same account through the same API.
      const outcome = await ledger.post(accrual(personId));
      expect(outcome.status).toBe("posted");
      expect(outcome.postings[0]!.creditAccountId).toBe(resolved[0]!.id);
    });

    it("025 EARS-4: a replayed event id writes nothing and answers duplicate with the original postings", async () => {
      const personId = randomUUID();
      const fact = accrual(personId, { bre: 1 });
      const first = await ledger.post(fact);
      expect(first.status).toBe("posted");
      expect(first.postings).toHaveLength(2);
      const replay = await ledger.post(fact);
      expect(replay.status).toBe("duplicate");
      expect(replay.postings.map((p) => p.id).sort()).toEqual(
        first.postings.map((p) => p.id).sort(),
      );
      expect(await postingsOf(personId)).toHaveLength(2);
    });

    it("025 EARS-4: the same dedupe key under another event id is a duplicate across a month boundary", async () => {
      const personId = randomUUID();
      const dedupeKey = `${personId}:lesson:L1:lesson-completed`;
      const march = await ledger.post(
        accrual(personId, {
          dedupeKey,
          occurredAt: new Date("2026-03-20T09:00:00Z"),
        }),
      );
      expect(march.status).toBe("posted");
      // The offline sync replays it in April under another event id.
      const april = await ledger.post(
        accrual(personId, {
          dedupeKey,
          occurredAt: new Date("2026-04-02T09:00:00Z"),
        }),
      );
      expect(april.status).toBe("duplicate");
      expect(april.postings.map((p) => p.id)).toEqual(
        march.postings.map((p) => p.id),
      );
      expect(await postingsOf(personId)).toHaveLength(1);
    });

    it("025 EARS-4: concurrent facts with one dedupe key accrue once", async () => {
      const personId = randomUUID();
      const dedupeKey = `${personId}:lesson:L2:lesson-completed`;
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () =>
          ledger.post(accrual(personId, { dedupeKey })),
        ),
      );
      expect(outcomes.filter((o) => o.status === "posted")).toHaveLength(1);
      expect(outcomes.filter((o) => o.status === "duplicate")).toHaveLength(4);
      expect(await postingsOf(personId)).toHaveLength(1);
    });

    it("025 EARS-4: a duplicate is refused by the database constraint itself, not only by a read", async () => {
      const eventId = randomUUID();
      await handle.pool.query(
        `INSERT INTO points_posting_keys (event_id, dedupe_key, occurred_month) VALUES ($1, $2, '2026-03-01')`,
        [eventId, `k:${eventId}`],
      );
      await expect(
        handle.pool.query(
          `INSERT INTO points_posting_keys (event_id, occurred_month) VALUES ($1, '2026-04-01')`,
          [eventId],
        ),
      ).rejects.toMatchObject({ code: "23505" });
      await expect(
        handle.pool.query(
          `INSERT INTO points_posting_keys (event_id, dedupe_key, occurred_month) VALUES ($1, $2, '2026-04-01')`,
          [randomUUID(), `k:${eventId}`],
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });

    it("025 EARS-22: concurrent debits cannot overdraw available Pul", async () => {
      const personId = randomUUID();
      await ledger.post(accrual(personId, { pul: 50 }));
      const results = await Promise.allSettled([
        ledger.post(debit(personId, 50)),
        ledger.post(debit(personId, 50)),
        ledger.post(debit(personId, 50)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(refused).toHaveLength(2);
      for (const r of refused) {
        expect(r.reason).toBeInstanceOf(PointsLedgerError);
        expect((r.reason as PointsLedgerError).problem).toBe(
          "points-insufficient-pul",
        );
      }
      expect(await pulAvailable(personId)).toBe(0);
    });

    it("025 EARS-22: a refused debit writes nothing, not even its posting key", async () => {
      const personId = randomUUID();
      const fact = debit(personId, 1);
      await expect(ledger.post(fact)).rejects.toBeInstanceOf(PointsLedgerError);
      const { rows } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [fact.eventId],
      );
      expect(rows).toHaveLength(0);
    });

    it("025 EARS-27: a posting row refuses UPDATE and DELETE", async () => {
      const personId = randomUUID();
      const { postings } = await ledger.post(accrual(personId));
      const id = postings[0]!.id;
      await expect(
        handle.pool.query(
          `UPDATE points_postings SET amount = 999 WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        handle.pool.query(`DELETE FROM points_postings WHERE id = $1`, [id]),
      ).rejects.toThrow(/append-only/);
      const [row] = await postingsOf(personId);
      expect(row!.amount).toBe(10);
    });

    it("025 EARS-27: a posting without rule_id or with an unknown rule version is refused by constraint", async () => {
      const personId = randomUUID();
      const account = await ledger.resolvePersonAccount(personId);
      const issuance = await ledger.resolveSystemAccount("issuance");
      const eventId = randomUUID();
      await handle.pool.query(
        `INSERT INTO points_posting_keys (event_id, occurred_month) VALUES ($1, '2026-11-01')`,
        [eventId],
      );
      const insert = (
        rule: string | null,
        version: number | null,
        leg: string,
      ) =>
        handle.pool.query(
          `INSERT INTO points_postings (event_id, leg, debit_account_id, credit_account_id, denomination, amount, rule_id, rule_version, occurred_at)
         VALUES ($1, $2, $3, $4, 'pul', 10, $5, $6, '2026-11-06T10:00:00Z')`,
          [eventId, leg, issuance.id, account.id, rule, version],
        );
      await expect(insert(null, 1, "a")).rejects.toMatchObject({
        code: "23502",
      });
      await expect(insert(ruleId, null, "b")).rejects.toMatchObject({
        code: "23502",
      });
      await expect(insert(ruleId, 99, "c")).rejects.toMatchObject({
        code: "23503",
      });
      // And (event_id, leg) is unique.
      await insert(ruleId, 1, "d");
      await expect(insert(ruleId, 1, "d")).rejects.toMatchObject({
        code: "23505",
      });
    });

    it("025 EARS-27: postings land in the monthly partition of their occurred_at", async () => {
      const personId = randomUUID();
      const { postings } = await ledger.post(
        accrual(personId, { occurredAt: new Date("2026-03-15T12:00:00Z") }),
      );
      const { rows } = await handle.pool.query<{ partition: string }>(
        `SELECT tableoid::regclass::text AS partition FROM points_postings WHERE id = $1`,
        [postings[0]!.id],
      );
      expect(rows[0]!.partition).toBe("points_postings_y2026_m03");
      const { rows: parent } = await handle.pool.query<{ partstrat: string }>(
        `SELECT p.partstrat FROM pg_partitioned_table p
       JOIN pg_class c ON c.oid = p.partrelid WHERE c.relname = 'points_postings'`,
      );
      expect(parent[0]!.partstrat).toBe("r");
    });

    it("025 EARS-27: a fact dated more than a day ahead is refused with points-occurred-at-future and writes nothing", async () => {
      const personId = randomUUID();
      const fact = accrual(personId, {
        occurredAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      });
      const refusal = await ledger.post(fact).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(PointsLedgerError);
      expect((refusal as PointsLedgerError).problem).toBe(
        "points-occurred-at-future",
      );
      expect((refusal as PointsLedgerError).getStatus()).toBe(422);
      expect(await postingsOf(personId)).toHaveLength(0);
      const { rows } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [fact.eventId],
      );
      expect(rows).toHaveLength(0);
      // A small clock skew is still accepted.
      const skewed = await ledger.post(
        accrual(personId, { occurredAt: new Date(Date.now() + 60_000) }),
      );
      expect(skewed.status).toBe("posted");
    });

    it("025 EARS-27: the database refuses a posting dated more than a day past its recorded_at", async () => {
      const personId = randomUUID();
      const account = await ledger.resolvePersonAccount(personId);
      const issuance = await ledger.resolveSystemAccount("issuance");
      const eventId = randomUUID();
      const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      await handle.pool.query(
        `INSERT INTO points_posting_keys (event_id, occurred_month) VALUES ($1, date_trunc('month', $2::timestamptz)::date)`,
        [eventId, future],
      );
      await expect(
        handle.pool.query(
          `INSERT INTO points_postings (event_id, leg, debit_account_id, credit_account_id, denomination, amount, rule_id, rule_version, occurred_at)
         VALUES ($1, 'a', $2, $3, 'pul', 10, $4, 1, $5)`,
          [eventId, issuance.id, account.id, ruleId, future],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "points_postings_occurred_at_not_future_check",
      });
    });

    it("025 EARS-22: facts touching two new accounts in opposite order do not deadlock", async () => {
      const pairs = Array.from({ length: 12 }, () => [
        randomUUID(),
        randomUUID(),
      ]);
      const both = (first: string, second: string): PointsFact => ({
        eventId: randomUUID(),
        occurredAt: new Date("2026-11-06T10:00:00Z"),
        legs: [first, second].map((personId, i) => ({
          leg: `accrual:pul:${i}`,
          debit: { kind: "system" as const, code: "issuance" as const },
          credit: { kind: "person" as const, personId },
          denomination: "pul" as const,
          amount: 5,
          ruleId,
          ruleVersion: 1,
        })),
      });
      const results = await Promise.allSettled(
        pairs.flatMap(([a, b]) => [
          ledger.post(both(a!, b!)),
          ledger.post(both(b!, a!)),
        ]),
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(rejected.map((r) => String(r.reason))).toEqual([]);
      for (const [a, b] of pairs) {
        expect(await pulAvailable(a!)).toBe(10);
        expect(await pulAvailable(b!)).toBe(10);
      }
    });

    it("025 EARS-4: a replay of a recorded fact answers duplicate even after the account closed", async () => {
      const personId = randomUUID();
      const fact = accrual(personId);
      const first = await ledger.post(fact);
      await ledger.close(personId, new Date("2026-11-06T12:00:00Z"));
      const replay = await ledger.post(fact);
      expect(replay.status).toBe("duplicate");
      expect(replay.postings.map((p) => p.id)).toEqual(
        first.postings.map((p) => p.id),
      );
      expect(await postingsOf(personId)).toHaveLength(1);
    });

    it("025 EARS-4: post joins a caller's transaction, so the caller's rollback leaves nothing", async () => {
      const personId = randomUUID();
      const fact = accrual(personId);
      const rollback = new Error("caller rolls back");
      await expect(
        handle.db.transaction(async (tx) => {
          const outcome = await ledger.post(fact, tx);
          expect(outcome.status).toBe("posted");
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(await postingsOf(personId)).toHaveLength(0);
      const { rows } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [fact.eventId],
      );
      expect(rows).toHaveLength(0);
      // A refusal inside a caller's transaction rolls back only the fact.
      await handle.db.transaction(async (tx) => {
        await expect(
          ledger.post(debit(personId, 1), tx),
        ).rejects.toBeInstanceOf(PointsLedgerError);
        expect((await ledger.post(fact, tx)).status).toBe("posted");
      });
      expect(await postingsOf(personId)).toHaveLength(1);
    });

    it("025 EARS-31: a closed account refuses with points-account-closed and leaves prior postings unchanged", async () => {
      const personId = randomUUID();
      await ledger.post(accrual(personId, { bre: 1 }));
      const before = await postingsOf(personId);
      const closed = await ledger.close(
        personId,
        new Date("2026-11-06T12:00:00Z"),
      );
      expect(closed.closedAt).not.toBeNull();
      const fact = accrual(personId);
      const refusal = await ledger.post(fact).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(PointsLedgerError);
      expect((refusal as PointsLedgerError).problem).toBe(
        "points-account-closed",
      );
      expect(await postingsOf(personId)).toEqual(before);
      const { rows } = await handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [fact.eventId],
      );
      expect(rows).toHaveLength(0);
      // Closing again keeps the first closed_at.
      const again = await ledger.close(
        personId,
        new Date("2027-01-01T00:00:00Z"),
      );
      expect(again.closedAt?.toISOString()).toBe(
        closed.closedAt?.toISOString(),
      );
    });
  },
);
