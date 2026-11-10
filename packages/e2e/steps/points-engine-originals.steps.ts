import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { createBdd, test as base } from "playwright-bdd";
import {
  assertSeedDefaults,
  postings,
  pointsOperation,
  prepareDoctor,
  recordLesson,
  retirePointsRules,
  retirePointsEvents,
  startPointsWorld,
  type PointsWorld,
} from "../lib/points-engine-originals.js";

export const test = base.extend<{ points: PointsWorld }>({
  // eslint-disable-next-line no-empty-pattern -- playwright-bdd detects this fixture signature
  points: async ({}, use) => {
    const world = await startPointsWorld();
    try {
      await use(world);
    } finally {
      try {
        await retirePointsRules(world);
      } finally {
        try {
          if (world.ruleBookTouched) await retirePointsEvents(world);
        } finally {
          await world.handle.pool.end();
        }
      }
    }
  },
});
const { Given, When, Then } = createBdd(test);

Given(
  "the rule book holds the seeded engine rules and settings with the PRD defaults",
  async ({ points }) => {
    await assertSeedDefaults(points);
    pointsOperation(
      "BACKGROUND " +
        JSON.stringify({
          title: test.info().title,
          clause: "seed-defaults",
          personId: points.personId,
          applicationName: points.applicationName,
          verified: true,
        }),
    );
  },
);
Given(
  'a doctor "A" of specialty "Кардиология" with a verified phone',
  async ({ points }) => {
    await prepareDoctor(points);
    pointsOperation(
      "BACKGROUND " +
        JSON.stringify({
          title: test.info().title,
          clause: "doctor-specialty-phone",
          personId: points.personId,
          applicationName: points.applicationName,
          verified: true,
        }),
    );
  },
);
When(
  '"lesson.completed" for "A" on lesson "L5" is recorded with mode "offline"',
  async ({ points }) => {
    await recordLesson(points, "offline");
  },
);
Then(
  'a posting of 1 Bre and no Pul is written under rule "accrual.lesson.any-mode"',
  async ({ points }) => {
    expect(points.result?.outcome).toBe("applied");
    expect(await postings(points, points.facts[0]!.eventId)).toEqual([
      {
        event_id: `${points.facts[0]!.eventId}#accrual.lesson.any-mode`,
        rule_id: "accrual.lesson.any-mode",
        rule_version: points.seedVersions.get("accrual.lesson.any-mode"),
        denomination: "bre",
        amount: 1,
      },
    ]);
  },
);
When(
  '"lesson.completed" for "A" on lesson "L5" is recorded with mode "online" and another event id',
  async ({ points }) => {
    await recordLesson(points, "online");
    expect(points.facts[1]!.eventId).not.toBe(points.facts[0]!.eventId);
  },
);
Then(
  '10 Pul are posted under rule "accrual.lesson" and "accrual.lesson.any-mode" is traced "limit-reached"',
  async ({ points }) => {
    expect(await postings(points, points.facts[1]!.eventId)).toEqual([
      {
        event_id: `${points.facts[1]!.eventId}#accrual.lesson`,
        rule_id: "accrual.lesson",
        rule_version: points.seedVersions.get("accrual.lesson"),
        denomination: "pul",
        amount: 10,
      },
    ]);
    expect(
      points.result?.trace.find(
        (entry) => entry.ruleId === "accrual.lesson.any-mode",
      )?.verdict,
    ).toBe("limit-reached");
  },
);
Then('"A" has 10 Pul and 1 Bre from lesson "L5"', async ({ points }) => {
  const rows = (
    await points.handle.pool.query(
      `SELECT p.denomination, sum(p.amount)::int AS amount FROM points_postings p
     JOIN points_accounts a ON a.id=p.credit_account_id JOIN points_facts f ON p.event_id LIKE f.event_id || '#%'
     WHERE a.subject_id=$1 AND f.ref_id=$2 GROUP BY p.denomination ORDER BY p.denomination`,
      [points.personId, points.lessonId],
    )
  ).rows;
  expect(rows).toEqual([
    { denomination: "bre", amount: 1 },
    { denomination: "pul", amount: 10 },
  ]);
});
When(
  '"lesson.completed" for "A" on lesson "L5" is recorded with mode "offline" and a third event id',
  async ({ points }) => {
    await recordLesson(points, "offline");
    expect(new Set(points.facts.map((fact) => fact.eventId)).size).toBe(3);
  },
);
Then('the answer is "duplicate" and nothing is posted', async ({ points }) => {
  expect(points.result?.outcome).toBe("duplicate");
  expect(await postings(points)).toEqual(points.before);
  expect(await postings(points, points.facts[2]!.eventId)).toEqual([]);
});
When(
  'a producer records "lesson.completed" for "A" with an attribute "pul" of 100',
  async ({ points }) => {
    const fact = {
      type: "lesson.completed",
      eventId: `points-original-invalid:${randomUUID()}`,
      personId: points.personId,
      ref: points.lessonId,
      occurredAt: new Date(),
      attributes: { mode: "online", pul: 100 },
    };
    points.facts.push(fact);
    points.before = await postings(points);
    try {
      await points.engine.record(fact);
    } catch (error) {
      points.refused = error;
    }
  },
);
Then(
  "the call throws and no journal row and no posting are written",
  async ({ points }) => {
    expect(points.refused).toMatchObject({ name: "PointsFactRefusedError" });
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id FROM points_facts WHERE event_id=$1",
          [points.facts[0]!.eventId],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id FROM points_posting_keys WHERE event_id LIKE $1 || '#%'",
          [points.facts[0]!.eventId],
        )
      ).rows,
    ).toEqual([]);
    expect(await postings(points)).toEqual(points.before);
  },
);
When('"referral.attributed" for "A" is recorded', async ({ points }) => {
  const fact = {
    type: "referral.attributed",
    eventId: `points-original-referral:${randomUUID()}`,
    personId: points.personId,
    ref: randomUUID(),
    occurredAt: new Date(),
    attributes: {},
  };
  points.facts.push(fact);
  points.before = await postings(points);
  points.result = await points.engine.record(fact);
});
Then(
  'the outcome is "no-effect" and no posting is written',
  async ({ points }) => {
    expect(points.result?.outcome).toBe("no-effect");
    expect(points.result?.applied).toEqual([]);
    expect(await postings(points)).toEqual(points.before);
    expect(await postings(points, points.facts[0]!.eventId)).toEqual([]);
  },
);
Then(
  "the journal row holds the fact and its evaluation trace",
  async ({ points }) => {
    const fact = points.facts[0]!;
    expect(
      (
        await points.handle.pool.query(
          `SELECT event_id, type, person_id, ref_kind, ref_id, attributes, occurred_at, outcome, trace
     FROM points_facts WHERE event_id=$1`,
          [fact.eventId],
        )
      ).rows,
    ).toEqual([
      {
        event_id: fact.eventId,
        type: fact.type,
        person_id: fact.personId,
        ref_kind: "person",
        ref_id: fact.ref,
        attributes: fact.attributes,
        occurred_at: fact.occurredAt,
        outcome: "no-effect",
        trace: points.result!.trace,
      },
    ]);
  },
);
