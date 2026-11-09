import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PointsFactRefusedError } from "../../src/points/engine/points-engine.service.js";
import { PointsLedgerError } from "../../src/points/points.errors.js";
import {
  type EngineHarness,
  engineHarness,
  journalOf,
  postingsOf,
  publishRule,
  pulOf,
  testFact,
  testRule,
  testRuleId,
  verifyPhone,
} from "./engine-harness.js";

// 025 engine `record` (#3838) — amended EARS-3 (every matching rule, one
// ledger fact per applied rule, one journal row, PointsCredited per credited
// person after COMMIT), EARS-33 (outcomes, the catalog refuses a fact,
// producer transaction contract) and EARS-35 (credit/debit; debit-side first,
// a refusing debit voids the fact; settle with no hold). Isolation: see
// engine-harness.ts.
describe.skipIf(!process.env.DATABASE_URL)("025 points engine record (e2e)", () => {
  let h: EngineHarness;

  beforeAll(() => {
    h = engineHarness();
  });

  afterAll(async () => {
    await h.handle.pool.end();
  });

  async function countWhere(sql: string, value: string): Promise<number> {
    const { rows } = await h.handle.pool.query<{ n: string }>(sql, [value]);
    return Number(rows[0]?.n ?? 0);
  }

  it("025 EARS-3: two matching rules on one fact write two ledger facts <event>#<rule>, each with its legs, rule id/version, action, project and output; one journal row; one PointsCredited after COMMIT", async () => {
    const runId = randomUUID();
    const ruleId = testRuleId();
    const published = await publishRule(h.rules, ruleId, testRule(runId));
    const projectId = (
      await h.handle.pool.query<{ id: string }>(`SELECT id FROM projects LIMIT 1`)
    ).rows[0]?.id;
    const personId = randomUUID();
    const output = { type: "module", id: randomUUID() };
    const f = testFact(runId, personId, {
      ...(projectId ? { projectId } : {}),
      output,
    });
    const before = h.credited.length;

    const result = await h.engine.record(f);

    expect(result.outcome).toBe("applied");
    expect(result.applied.map((a) => a.ruleId).sort()).toEqual(
      ["accrual.starter-bonus", ruleId].sort(),
    );
    const rows = await postingsOf(h.handle, f.eventId);
    expect(rows.map((r) => [r.event_id, r.leg, r.denomination, r.amount])).toEqual(
      [
        [`${f.eventId}#accrual.starter-bonus`, "accrual:pul", "pul", 20],
        [`${f.eventId}#${ruleId}`, "accrual:bre", "bre", 5],
      ],
    );
    for (const row of rows) {
      expect(row.debit_code).toBe("issuance");
      expect(row.credit_subject).toBe(personId);
      expect(row.action).toBe("person.starter-bonus-eligible");
      expect(row.project_id).toBe(projectId ?? null);
      expect(row.output_type).toBe("module");
      expect(row.output_id).toBe(output.id);
    }
    const own = rows.find((r) => r.rule_id === ruleId)!;
    expect(own.rule_version).toBe(published.row.version);
    expect(own.dedupe_key).toBeNull();
    expect(
      rows.find((r) => r.rule_id === "accrual.starter-bonus")!.dedupe_key,
    ).toBe(`welcome:${personId}`);
    expect(await journalOf(h.handle, f.eventId)).toHaveLength(1);
    expect(h.credited.slice(before)).toEqual([
      {
        personId,
        eventId: f.eventId,
        postings: expect.arrayContaining([
          { denomination: "pul", amount: 20 },
          { denomination: "bre", amount: 5 },
        ]),
      },
    ]);
  });

  it("025 EARS-3: a credit to the person a predicate names (person.referrer) credits that person, and each credited person gets its own PointsCredited", async () => {
    const runId = randomUUID();
    const ruleId = testRuleId();
    await publishRule(
      h.rules,
      ruleId,
      testRule(runId, {
        effect: {
          kind: "credit",
          beneficiary: { pred: "person.referrer" },
          amounts: { pul: 0, bre: 2, con: 0 },
        },
      }),
    );
    const inviter = randomUUID();
    const invitee = randomUUID();
    await h.engine.record({
      type: "referral.attributed",
      eventId: `e2e-referral:${randomUUID()}`,
      personId: invitee,
      ref: inviter,
      occurredAt: new Date(),
      attributes: {},
    });
    const before = h.credited.length;
    const f = testFact(runId, invitee);
    await h.engine.record(f);
    const own = (await postingsOf(h.handle, f.eventId)).find(
      (r) => r.rule_id === ruleId,
    )!;
    expect(own.credit_subject).toBe(inviter);
    expect(
      h.credited
        .slice(before)
        .map((e) => e.personId)
        .sort(),
    ).toEqual([invitee, inviter].sort());
  });

  it("025 EARS-33: outcomes — applied, then duplicate on the replayed event id (nothing written), and no-effect for a fact no rule applies to (still journaled)", async () => {
    const runId = randomUUID();
    const f = testFact(runId);
    expect((await h.engine.record(f)).outcome).toBe("applied");
    const postings = (await postingsOf(h.handle, f.eventId)).length;
    const before = h.credited.length;
    const replay = await h.engine.record(f);
    expect(replay.outcome).toBe("duplicate");
    expect(replay.applied.map((a) => a.ruleId)).toEqual(["accrual.starter-bonus"]);
    expect(replay.applied[0]!.postings).toHaveLength(1);
    expect((await postingsOf(h.handle, f.eventId)).length).toBe(postings);
    expect(h.credited.length).toBe(before);

    const unrewarded = {
      type: "referral.attributed" as const,
      eventId: `e2e-referral:${randomUUID()}`,
      personId: randomUUID(),
      ref: randomUUID(),
      occurredAt: new Date(),
      attributes: {},
    };
    const none = await h.engine.record(unrewarded);
    expect(none.outcome).toBe("no-effect");
    expect(none.applied).toEqual([]);
    const [row] = await journalOf(h.handle, unrewarded.eventId);
    expect(row?.outcome).toBe("no-effect");
  });

  it("025 EARS-33: the catalog refuses a fact with an amount, a rule id, an unknown type or attribute, a missing or forbidden ref — it throws and writes nothing", async () => {
    const runId = randomUUID();
    const refused = [
      { ...testFact(runId), amount: 100 },
      { ...testFact(runId), ruleId: "accrual.lesson" },
      { ...testFact(runId), type: "lesson.purchased" },
      testFact(runId, randomUUID(), { attributes: { runId, amount: 100 } }),
      testFact(runId, randomUUID(), { attributes: { runId, sponsorId: randomUUID() } }),
      testFact(runId, randomUUID(), { ref: randomUUID() }),
      testFact(runId, randomUUID(), {
        type: "lesson.completed",
        attributes: { mode: "online" },
      }),
    ];
    for (const f of refused) {
      await expect(h.engine.record(f as never)).rejects.toBeInstanceOf(
        PointsFactRefusedError,
      );
      expect(
        await countWhere(`SELECT count(*) AS n FROM points_facts WHERE event_id = $1`, f.eventId),
      ).toBe(0);
      expect(
        await countWhere(
          `SELECT count(*) AS n FROM points_posting_keys WHERE event_id LIKE $1 || '#%'`,
          f.eventId,
        ),
      ).toBe(0);
    }
  });

  it("025 EARS-33: inside a producer's transaction nothing is published before publishAfterCommit, then exactly once", async () => {
    const f = testFact(randomUUID());
    const before = h.credited.length;
    const result = await h.handle.db.transaction((tx) => h.engine.record(tx, f));
    expect(h.credited.length).toBe(before);
    await result.publishAfterCommit();
    await result.publishAfterCommit();
    expect(h.credited.length).toBe(before + 1);
  });

  it("025 EARS-33: after a producer's rollback the fact is neither journaled, posted nor published", async () => {
    const f = testFact(randomUUID());
    const before = h.credited.length;
    await expect(
      h.handle.db.transaction(async (tx) => {
        await h.engine.record(tx, f);
        throw new Error("producer rolls back");
      }),
    ).rejects.toThrow("producer rolls back");
    expect(await journalOf(h.handle, f.eventId)).toHaveLength(0);
    expect(await postingsOf(h.handle, f.eventId)).toHaveLength(0);
    expect(h.credited.length).toBe(before);
  });

  it("025 EARS-35: a debit applies before the credits of the same fact — a refusing debit voids the fact's credit and writes nothing, journal included", async () => {
    const runId = randomUUID();
    await publishRule(
      h.rules,
      testRuleId(),
      testRule(runId, { effect: { kind: "debit", amounts: { pul: 10 } } }),
    );
    const personId = randomUUID();
    await verifyPhone(h.engine, personId);
    const f = testFact(runId, personId);
    // The starter bonus (+20) would cover the debit, but the debit runs first.
    const error = await h.engine.record(f).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PointsLedgerError);
    expect((error as PointsLedgerError).errorCode).toBe("POINTS_INSUFFICIENT_PUL");
    expect(await journalOf(h.handle, f.eventId)).toHaveLength(0);
    expect(await postingsOf(h.handle, f.eventId)).toHaveLength(0);
    expect(await pulOf(h.handle, personId)).toBe(0);
  });

  it("025 EARS-35: a debit with Pul available posts person → sink under its own ledger fact", async () => {
    const debitRun = randomUUID();
    const debitRule = testRuleId();
    await publishRule(
      h.rules,
      debitRule,
      testRule(debitRun, { effect: { kind: "debit", amounts: { pul: 10 } } }),
    );
    const personId = randomUUID();
    await verifyPhone(h.engine, personId);
    await h.engine.record(testFact(randomUUID(), personId)); // starter bonus +20
    expect(await pulOf(h.handle, personId)).toBe(20);
    const f = testFact(debitRun, personId);
    const result = await h.engine.record(f);
    expect(result.applied).toEqual([
      expect.objectContaining({ ruleId: debitRule, effect: "debit" }),
    ]);
    const [row] = await postingsOf(h.handle, f.eventId);
    expect(row).toMatchObject({
      leg: "debit:pul",
      debit_subject: personId,
      credit_code: "sink",
      amount: 10,
    });
    expect(await pulOf(h.handle, personId)).toBe(10);
  });

  it("025 EARS-35: a debit for a person whose phone is not verified is refused with points-phone-unverified, nothing written", async () => {
    const runId = randomUUID();
    await publishRule(
      h.rules,
      testRuleId(),
      testRule(runId, { effect: { kind: "debit", amounts: { pul: 1 } } }),
    );
    const f = testFact(runId);
    const error = await h.engine.record(f).catch((e: unknown) => e);
    expect((error as PointsLedgerError).errorCode).toBe("POINTS_PHONE_UNVERIFIED");
    expect((error as PointsLedgerError).getStatus()).toBe(422);
    expect(await journalOf(h.handle, f.eventId)).toHaveLength(0);
  });

  it("025 EARS-35: a settle with no open hold is a no-op traced no-open-hold, while the fact's credit applies", async () => {
    const f = {
      type: "attendance.confirmed" as const,
      eventId: `e2e-attendance:${randomUUID()}`,
      personId: randomUUID(),
      ref: randomUUID(),
      occurredAt: new Date(),
      attributes: { presenceSharePercent: 80, registrationId: randomUUID() },
    };
    const result = await h.engine.record(f);
    expect(result.outcome).toBe("applied");
    const settle = result.trace.find((t) => t.ruleId === "spend.settle");
    expect(settle?.verdict).toBe("no-open-hold");
    expect(result.applied.map((a) => a.ruleId)).toEqual(["accrual.participation"]);
    const legs = (await postingsOf(h.handle, f.eventId)).map((r) => r.leg);
    expect(legs).toEqual(["accrual:bre", "accrual:con"]);
  });
});
