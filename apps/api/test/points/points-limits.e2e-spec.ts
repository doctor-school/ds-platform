import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type EngineHarness,
  engineHarness,
  postingsOf,
  publishRule,
  testFact,
  testRule,
  testRuleId,
} from "./engine-harness.js";

// 025 EARS-36 (limits) and EARS-37 (validity window, active) of the engine
// (#3838). The Europe/Moscow period arithmetic of `countPer` is pinned by
// src/points/engine/period.spec.ts: a rule version applies only to facts at
// or after its publication (EARS-42), so a test cannot date a fact into an
// earlier Moscow month. Isolation: see engine-harness.ts.
describe.skipIf(!process.env.DATABASE_URL)("025 points limits and validity (e2e)", () => {
  let h: EngineHarness;

  beforeAll(() => {
    h = engineHarness();
  });

  afterAll(async () => {
    await h.handle.pool.end();
  });

  const verdictOf = (
    result: Awaited<ReturnType<EngineHarness["engine"]["record"]>>,
    ruleId: string,
  ) => result.trace.find((t) => t.ruleId === ruleId)?.verdict;

  it("025 EARS-36: oncePer(subject) credits once per person; a shared limit key lets two rules grant at most one of themselves", async () => {
    const runId = randomUUID();
    const once = testRuleId();
    await publishRule(
      h.rules,
      once,
      testRule(runId, { limits: [{ oncePer: ["subject"] }] }),
    );
    const sharedA = testRuleId("e2e.shared-a");
    const sharedB = testRuleId("e2e.shared-b");
    const key = `e2e.key.${runId.slice(0, 8)}`;
    for (const id of [sharedA, sharedB]) {
      await publishRule(
        h.rules,
        id,
        testRule(runId, { limits: [{ oncePer: ["subject"], key }] }),
      );
    }
    const personId = randomUUID();
    const first = await h.engine.record(testFact(runId, personId));
    expect(verdictOf(first, once)).toBe("applied");
    const shared = [verdictOf(first, sharedA), verdictOf(first, sharedB)];
    expect(shared.sort()).toEqual(["applied", "limit-reached"]);
    const second = await h.engine.record(testFact(runId, personId));
    expect(verdictOf(second, once)).toBe("limit-reached");
    expect(verdictOf(second, sharedA)).toBe("limit-reached");
    expect(verdictOf(second, sharedB)).toBe("limit-reached");
    expect(second.outcome).toBe("duplicate");
    // Another person is not limited by the first one's key.
    const other = await h.engine.record(testFact(runId));
    expect(verdictOf(other, once)).toBe("applied");
  });

  it("025 EARS-36: countPer(subject, day, n) applies n times per Moscow day, then traces limit-reached; n may be a setting", async () => {
    const runId = randomUUID();
    const literal = testRuleId();
    await publishRule(
      h.rules,
      literal,
      testRule(runId, {
        limits: [{ countPer: { scope: ["subject"], period: "day", n: 2 } }],
      }),
    );
    const fromSetting = testRuleId();
    await publishRule(
      h.rules,
      fromSetting,
      testRule(runId, {
        // setting.reserve.limitedSeats.max is seeded at 3.
        limits: [
          {
            countPer: {
              scope: ["subject"],
              period: "day",
              n: { setting: "setting.reserve.limitedSeats.max" },
            },
          },
        ],
      }),
    );
    const personId = randomUUID();
    const verdicts: Array<[string | undefined, string | undefined]> = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await h.engine.record(testFact(runId, personId));
      verdicts.push([verdictOf(r, literal), verdictOf(r, fromSetting)]);
    }
    expect(verdicts).toEqual([
      ["applied", "applied"],
      ["applied", "applied"],
      ["limit-reached", "applied"],
      ["limit-reached", "limit-reached"],
    ]);
    // Counted per subject: another person starts from zero.
    expect(verdictOf(await h.engine.record(testFact(runId)), literal)).toBe("applied");
  });

  it("025 EARS-36: countPer over a scope no person lock covers is serialised — N concurrent facts of distinct persons under a cap of k apply exactly k times", async () => {
    // The scope `runId` is shared by every fact of this test while each fact
    // locks only its own subject, so without the limit-scope lock the
    // count-then-compare of concurrent facts would exceed the cap
    // (the EARS-11 referral-cap shape: many invitees, one counted scope).
    const runId = randomUUID();
    const ruleId = testRuleId();
    const k = 3;
    const n = 8;
    await publishRule(
      h.rules,
      ruleId,
      testRule(runId, {
        limits: [{ countPer: { scope: ["runId"], period: "day", n: k } }],
      }),
    );
    const results = await Promise.all(
      Array.from({ length: n }, () => h.engine.record(testFact(runId))),
    );
    const verdicts = results.map((r) => verdictOf(r, ruleId));
    expect(verdicts.filter((v) => v === "applied")).toHaveLength(k);
    expect(verdicts.filter((v) => v === "limit-reached")).toHaveLength(n - k);
    const { rows } = await h.handle.pool.query<{ n: string }>(
      `SELECT count(distinct event_id) AS n FROM points_postings WHERE rule_id = $1`,
      [ruleId],
    );
    expect(Number(rows[0]?.n)).toBe(k);
  });

  it("025 EARS-36: a credit without a limit is refused at publish; concurrentOpen waits for the spend slice", async () => {
    const runId = randomUUID();
    await expect(
      publishRule(h.rules, testRuleId(), testRule(runId, { limits: [] })),
    ).rejects.toMatchObject({
      errorCode: "POINTS_RULE_PARAMETERS_INVALID",
      fieldErrors: [expect.objectContaining({ path: "limits" })],
    });
    await expect(
      publishRule(
        h.rules,
        testRuleId(),
        testRule(runId, {
          limits: [{ concurrentOpen: { n: 1, filter: { limitedSeats: true } } }],
        }),
      ),
    ).rejects.toMatchObject({
      fieldErrors: [expect.objectContaining({ path: "limits.0.concurrentOpen" })],
    });
  });

  it("025 EARS-37: the window [validFrom, validUntil) is inclusive at its start and exclusive at its end", async () => {
    const runId = randomUUID();
    const ruleId = testRuleId();
    const validFrom = new Date(Date.now() + 60_000);
    const validUntil = new Date(validFrom.getTime() + 60_000);
    await publishRule(
      h.rules,
      ruleId,
      testRule(runId, {
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
      }),
    );
    const at = async (occurredAt: Date) =>
      verdictOf(await h.engine.record(testFact(runId, randomUUID(), { occurredAt })), ruleId);
    expect(await at(new Date(validFrom.getTime() - 1))).toBe("not-valid");
    expect(await at(validFrom)).toBe("applied");
    expect(await at(new Date(validUntil.getTime() - 1))).toBe("applied");
    expect(await at(validUntil)).toBe("not-valid");
  });

  it("025 EARS-37: publishing a version with active: false stops the very next fact, with no release", async () => {
    const runId = randomUUID();
    const ruleId = testRuleId();
    await publishRule(h.rules, ruleId, testRule(runId));
    const before = await h.engine.record(testFact(runId));
    expect(verdictOf(before, ruleId)).toBe("applied");
    await publishRule(h.rules, ruleId, testRule(runId, { active: false }));
    const f = testFact(runId);
    const after = await h.engine.record(f);
    expect(verdictOf(after, ruleId)).toBe("inactive");
    expect(
      (await postingsOf(h.handle, f.eventId)).filter((r) => r.rule_id === ruleId),
    ).toHaveLength(0);
  });
});
