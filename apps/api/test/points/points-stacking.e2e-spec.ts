import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type EngineHarness,
  engineHarness,
  publishRule,
  testFact,
  testRule,
  testRuleId,
} from "./engine-harness.js";

// 025 EARS-38 (#3838) — stacking: an exclusive group applies its highest
// priority member only (a tie to the lexically lowest rule id), resolved
// after conditions, validity and limits; ungrouped rules stack; a publish
// that stacks with another active credit rule is accepted with a warning.
describe.skipIf(!process.env.DATABASE_URL)("025 points stacking (e2e)", () => {
  let h: EngineHarness;

  beforeAll(() => {
    h = engineHarness();
  });

  afterAll(async () => {
    await h.handle.pool.end();
  });

  const verdicts = (result: Awaited<ReturnType<EngineHarness["engine"]["record"]>>) =>
    Object.fromEntries(result.trace.map((t) => [t.ruleId, t.verdict]));

  async function group(runId: string, members: Array<[string, number, boolean?]>) {
    const exclusiveGroup = `e2e.group.${runId.slice(0, 8)}`;
    for (const [ruleId, priority, oncePer] of members) {
      await publishRule(
        h.rules,
        ruleId,
        testRule(runId, {
          stacking: { priority, exclusiveGroup },
          limits: oncePer ? [{ oncePer: ["subject"] }] : [{ unlimited: true }],
        }),
      );
    }
  }

  it("025 EARS-38: an exclusive group applies only its highest priority, a tie broken by the lowest rule id; the rest are superseded", async () => {
    const runId = randomUUID();
    const base = testRuleId("e2e.stack");
    const [high, tie, low] = [`${base}.a`, `${base}.b`, `${base}.c`];
    await group(runId, [
      [tie, 10],
      [high, 10],
      [low, 5],
    ]);
    const result = await h.engine.record(testFact(runId));
    expect(verdicts(result)).toMatchObject({
      [high]: "applied",
      [tie]: "superseded",
      [low]: "superseded",
    });
    expect(result.trace.find((t) => t.ruleId === high)?.stacking).toBe("won");
  });

  it("025 EARS-38: a member its limit stopped never suppresses the next one", async () => {
    const runId = randomUUID();
    const base = testRuleId("e2e.stack");
    const [first, second] = [`${base}.a`, `${base}.b`];
    await group(runId, [
      [first, 10, true],
      [second, 5],
    ]);
    const personId = randomUUID();
    expect(verdicts(await h.engine.record(testFact(runId, personId)))).toMatchObject({
      [first]: "applied",
      [second]: "superseded",
    });
    expect(verdicts(await h.engine.record(testFact(runId, personId)))).toMatchObject({
      [first]: "limit-reached",
      [second]: "applied",
    });
  });

  it("025 EARS-38: rules with no group stack — each applies on its own — and the publish warns naming the other active credit rule", async () => {
    const runId = randomUUID();
    const a = testRuleId();
    const b = testRuleId();
    const first = await publishRule(h.rules, a, testRule(runId));
    expect(first.warnings).toContainEqual({
      code: "stacking",
      factType: "person.starter-bonus-eligible",
      otherRuleId: "accrual.starter-bonus",
    });
    const second = await publishRule(h.rules, b, testRule(runId));
    expect(second.warnings).toContainEqual({
      code: "stacking",
      factType: "person.starter-bonus-eligible",
      otherRuleId: a,
    });
    const result = await h.engine.record(testFact(runId));
    expect(verdicts(result)).toMatchObject({ [a]: "applied", [b]: "applied" });
  });
});
