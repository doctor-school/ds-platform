import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POINTS_ENGINE_SEED } from "@ds/schemas";
import { PointsLedgerError } from "../../src/points/points.errors.js";
import {
  type EngineHarness,
  engineHarness,
  postingsOf,
  publishRule,
  testFact,
  testRule,
  testRuleId,
} from "./engine-harness.js";

// 025 rule book (#3808, rewritten for the engine by #3838) against a real
// Postgres migrated through 0060 — the version of a rule id that applies to a
// fact (amended EARS-3), the settings (EARS-39), the publish contract at the
// service level (amended EARS-25; the HTTP route, its authz and audit live in
// points-admin-rules.e2e-spec), version immutability and EARS-12 at the
// ledger. Isolation: see engine-harness.ts.
describe.skipIf(!process.env.DATABASE_URL)("025 rule book (e2e)", () => {
  let h: EngineHarness;

  beforeAll(() => {
    h = engineHarness();
  });

  afterAll(async () => {
    await h.handle.pool.end();
  });

  async function versionsOf(ruleId: string): Promise<number> {
    const { rows } = await h.handle.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM points_rule_versions WHERE rule_id = $1`,
      [ruleId],
    );
    return Number(rows[0]!.n);
  }

  it("025 EARS-3: a fact type's candidates are the version-2 seed rules — never a 0059 version 1, never a setting", async () => {
    const lesson = await h.rules.candidatesFor("lesson.completed", new Date());
    const ids = lesson.map((c) => c.ruleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "accrual.lesson",
        "accrual.lesson.any-mode",
        "accrual.referral-inviter",
        "accrual.referral-invitee",
      ]),
    );
    expect(ids).toEqual([...ids].sort());
    const seeded = new Map(POINTS_ENGINE_SEED.map((s) => [s.ruleId, s]));
    for (const c of lesson.filter((c) => seeded.has(c.ruleId))) {
      expect(c.version).toBe(seeded.get(c.ruleId)!.version);
      expect(c.rule).toEqual(seeded.get(c.ruleId)!.body);
    }
    // A back-dated fact still finds the epoch seed.
    const old = await h.rules.candidatesFor(
      "lesson.completed",
      new Date("2000-01-01T00:00:00Z"),
    );
    expect(old.find((c) => c.ruleId === "accrual.lesson")?.version).toBe(2);
  });

  it("025 EARS-39: the settings active at an instant are read from their versions", async () => {
    const settings = await h.rules.settingsAt(new Date());
    for (const seed of POINTS_ENGINE_SEED.filter((s) => s.body.kind === "setting")) {
      expect(typeof settings[seed.ruleId as keyof typeof settings], seed.ruleId).toBe(
        "number",
      );
    }
    expect(Object.keys(settings).every((id) => id.startsWith("setting."))).toBe(true);
  });

  it("025 EARS-3 / EARS-25: a fact evaluates the version active at its occurredAt — a fact dated before a later version keeps the earlier one", async () => {
    const runId = randomUUID();
    const ruleId = testRuleId();
    const v1 = await publishRule(h.rules, ruleId, testRule(runId));
    const switchAt = new Date(Date.now() + 2_000);
    const v2 = await publishRule(
      h.rules,
      ruleId,
      testRule(runId, {
        effect: {
          kind: "credit",
          beneficiary: "subject",
          amounts: { pul: 0, bre: 7, con: 0 },
        },
      }),
      switchAt,
    );
    expect(v2.row.version).toBe(v1.row.version + 1);
    const before = testFact(runId, randomUUID(), { occurredAt: new Date() });
    const after = testFact(runId, randomUUID(), {
      occurredAt: new Date(switchAt.getTime() + 1_000),
    });
    await h.engine.record(before);
    await h.engine.record(after);
    const own = async (eventId: string) =>
      (await postingsOf(h.handle, eventId)).find((r) => r.rule_id === ruleId)!;
    expect(await own(before.eventId)).toMatchObject({
      rule_version: v1.row.version,
      amount: 5,
    });
    expect(await own(after.eventId)).toMatchObject({
      rule_version: v2.row.version,
      amount: 7,
    });
  });

  it("025 EARS-25: a new admin slug is stored as version 1 with its kind and trigger columns, published by the actor", async () => {
    const ruleId = testRuleId();
    const published = await publishRule(h.rules, ruleId, testRule(randomUUID()));
    expect(published.row).toMatchObject({
      ruleId,
      version: 1,
      kind: "rule",
      triggerFactTypes: ["person.starter-bonus-eligible"],
      publishedBy: null,
    });
  });

  it("025 EARS-25: publish refuses a retired id, an invalid body, a catalog violation and a past effectiveFrom, storing nothing", async () => {
    await expect(
      publishRule(h.rules, "advance.cap", { kind: "setting", value: 150 }),
    ).rejects.toMatchObject({ errorCode: "POINTS_RULE_RETIRED" });
    const ruleId = testRuleId();
    const runId = randomUUID();
    const refusals: Array<[unknown, string]> = [
      [{ ...testRule(runId), sponsorId: "x" }, ""],
      [{ kind: "setting", value: 3 }, "kind"],
      [
        testRule(runId, {
          effect: { kind: "debit", amounts: { bre: 1 } as never },
        }),
        "effect.amounts",
      ],
      [testRule(runId, { trigger: ["lesson.purchased" as never] }), "trigger.0"],
      [testRule(runId, { condition: { eq: [{ attr: "amount" }, 1] } }), "condition.eq.0.attr"],
      [testRule(runId, { limits: [{ oncePer: ["ref"] }] }), "limits.0.oncePer.0"],
      [
        testRule(runId, {
          effect: {
            kind: "credit",
            beneficiary: "subject",
            amounts: { pul: 501, bre: 0, con: 0 },
          },
        }),
        "effect.amounts.pul",
      ],
    ];
    for (const [body, path] of refusals) {
      const error = await publishRule(h.rules, ruleId, body).catch((e: unknown) => e);
      expect(error, path).toBeInstanceOf(PointsLedgerError);
      expect((error as PointsLedgerError).errorCode, path).toBe(
        "POINTS_RULE_PARAMETERS_INVALID",
      );
      expect(
        (error as PointsLedgerError).fieldErrors?.map((e) => e.path),
        path,
      ).toContain(path);
    }
    await expect(
      publishRule(h.rules, ruleId, testRule(runId), new Date(Date.now() - 60_000)),
    ).rejects.toMatchObject({ errorCode: "POINTS_RULE_EFFECTIVE_FROM_PAST" });
    expect(await versionsOf(ruleId)).toBe(0);
  });

  it("025 EARS-25: a version keeps the kind of the id's earlier versions", async () => {
    const ruleId = testRuleId();
    await publishRule(h.rules, ruleId, testRule(randomUUID()));
    // The id namespace decides the body schema, so a setting body on a rule id
    // is refused at its `kind` field.
    await expect(
      publishRule(h.rules, ruleId, { kind: "setting", value: 1 }),
    ).rejects.toMatchObject({
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({ path: "kind" }),
      ]),
    });
    expect(await versionsOf(ruleId)).toBe(1);
  });

  it("025 EARS-25: concurrent publishes of one id get distinct consecutive versions", async () => {
    const ruleId = testRuleId();
    const body = testRule(randomUUID());
    const published = await Promise.all(
      Array.from({ length: 4 }, () => publishRule(h.rules, ruleId, body)),
    );
    const versions = published.map((p) => p.row.version).sort((a, b) => a - b);
    expect(versions).toEqual([1, 2, 3, 4]);
  });

  it("025 EARS-25: a stored version is immutable — UPDATE of its body or trigger and DELETE are refused by the database", async () => {
    await expect(
      h.handle.pool.query(
        `UPDATE points_rule_versions SET parameters = '{}' WHERE rule_id = 'accrual.lesson' AND version = 2`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      h.handle.pool.query(
        `UPDATE points_rule_versions SET trigger_fact_types = '{}' WHERE rule_id = 'accrual.lesson' AND version = 2`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      h.handle.pool.query(
        `DELETE FROM points_rule_versions WHERE rule_id = 'accrual.lesson' AND version = 1`,
      ),
    ).rejects.toThrow(/append-only/);
  });

  it("025 EARS-12: every credit leg moves issuance → person; no recorded fact debits Bre or Con from a person account", async () => {
    const f = {
      type: "module.completed" as const,
      eventId: `e2e-module:${randomUUID()}`,
      personId: randomUUID(),
      ref: randomUUID(),
      occurredAt: new Date(),
      attributes: { mode: "online" },
    };
    await h.engine.record(f);
    const rows = await postingsOf(h.handle, f.eventId);
    expect(rows.map((r) => [r.denomination, r.amount]).sort()).toEqual(
      [
        ["bre", 3],
        ["con", 1],
        ["pul", 20],
      ].sort(),
    );
    for (const row of rows) {
      expect(row.credit_kind).toBe("person");
      expect(row.debit_kind).toBe("system");
    }
  });

  it("025 EARS-12: the ledger refuses a leg debiting Bre or Con from a person (penalty or conversion) and writes nothing", async () => {
    const personId = randomUUID();
    for (const legs of [
      [{ leg: "penalty:bre", denomination: "bre" as const }],
      [{ leg: "convert:con", denomination: "con" as const }],
    ]) {
      const eventId = `forbidden:${randomUUID()}`;
      const error = await h.ledger
        .post({
          eventId,
          occurredAt: new Date(),
          legs: legs.map((l) => ({
            ...l,
            debit: { kind: "person" as const, personId },
            credit: { kind: "system" as const, code: "sink" as const },
            amount: 1,
            ruleId: "manual-correction",
            ruleVersion: 1,
          })),
        })
        .catch((e: unknown) => e);
      expect((error as PointsLedgerError).errorCode).toBe("POINTS_BRE_CON_DEBIT");
      expect((error as PointsLedgerError).getStatus()).toBe(422);
      const { rows: keys } = await h.handle.pool.query(
        `SELECT 1 FROM points_posting_keys WHERE event_id = $1`,
        [eventId],
      );
      expect(keys).toHaveLength(0);
    }
  });

  it("025 EARS-12: a compensating reversal of a specific earlier credit may debit Bre", async () => {
    const personId = randomUUID();
    const runId = randomUUID();
    await publishRule(h.rules, testRuleId(), testRule(runId));
    const result = await h.engine.record(testFact(runId, personId));
    const bre = result.applied
      .flatMap((a) => a.postings)
      .find((p) => p.denomination === "bre")!;
    const reversal = await h.ledger.post({
      eventId: `reversal:${randomUUID()}`,
      occurredAt: new Date(),
      legs: [
        {
          leg: "reversal:bre",
          debit: { kind: "person", personId },
          credit: { kind: "system", code: "issuance" },
          denomination: "bre",
          amount: bre.amount,
          ruleId: bre.ruleId,
          ruleVersion: bre.ruleVersion,
          reverses: { postingId: bre.id, occurredAt: bre.occurredAt },
        },
      ],
    });
    expect(reversal.status).toBe("posted");
  });
});
