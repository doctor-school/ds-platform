import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  postings,
  recordLesson,
  type PointsWorld,
} from "../lib/points-engine-originals.js";
import { test } from "./points-engine-originals.steps.js";

const { Given, When, Then } = createBdd(test);

async function completePostings(points: PointsWorld) {
  return (
    await points.handle.pool.query(
      `SELECT to_jsonb(p) AS posting FROM points_postings p
       WHERE p.debit_account_id IN (SELECT id FROM points_accounts WHERE subject_id=$1)
          OR p.credit_account_id IN (SELECT id FROM points_accounts WHERE subject_id=$1)
       ORDER BY p.event_id, p.leg`,
      [points.personId],
    )
  ).rows;
}

async function journal(points: PointsWorld) {
  return (
    await points.handle.pool.query(
      "SELECT to_jsonb(f) AS fact FROM points_facts f WHERE person_id=$1 ORDER BY event_id",
      [points.personId],
    )
  ).rows;
}

async function assertNoLedgerFact(points: PointsWorld, eventId: string) {
  expect(await postings(points, eventId)).toEqual([]);
  expect(
    (
      await points.handle.pool.query(
        "SELECT event_id FROM points_posting_keys WHERE event_id LIKE $1 || '#%'",
        [eventId],
      )
    ).rows,
  ).toEqual([]);
}

async function assertKeys(points: PointsWorld, expected: string[]) {
  expect(
    (
      await points.handle.pool.query(
        `SELECT dedupe_key FROM points_posting_keys
         WHERE event_id LIKE $1 || '#%' ORDER BY dedupe_key`,
        [points.facts[0]!.eventId],
      )
    ).rows
      .map((row) => row.dedupe_key)
      .sort(),
  ).toEqual([...expected].sort());
}

When(
  '"lesson.completed" for "A" on lesson "L1" is recorded from the doctor storefront',
  async ({ points }) => {
    await recordLesson(points, "online");
    points.answers.push(points.result!);
  },
);
When(
  '"lesson.completed" for "A" on lesson "L1" is recorded from the Academy with another event id',
  async ({ points }) => {
    await recordLesson(points, "online");
    expect(points.facts[1]!.eventId).not.toBe(points.facts[0]!.eventId);
    points.answers.push(points.result!);
    await assertNoLedgerFact(points, points.facts[1]!.eventId);
  },
);
When(
  'the mobile offline sync replays the first "lesson.completed" for "A" on lesson "L1"',
  async ({ points }) => {
    points.postingSnapshot = await completePostings(points);
    points.journalSnapshot = await journal(points);
    const replay = structuredClone(points.facts[0]!);
    points.facts.push(replay);
    points.answers.push(await points.engine.record(replay));
    expect(replay).toEqual(points.facts[0]);
    expect(await completePostings(points)).toEqual(points.postingSnapshot);
    expect(await journal(points)).toEqual(points.journalSnapshot);
  },
);
Then(
  'exactly one lesson award of 10 Pul and 1 Bre is posted for "A" on "L1"',
  async ({ points }) => {
    expect(await postings(points)).toEqual([
      {
        event_id: `${points.facts[0]!.eventId}#accrual.lesson`,
        rule_id: "accrual.lesson",
        rule_version: points.seedVersions.get("accrual.lesson"),
        denomination: "pul",
        amount: 10,
      },
      {
        event_id: `${points.facts[0]!.eventId}#accrual.lesson.any-mode`,
        rule_id: "accrual.lesson.any-mode",
        rule_version: points.seedVersions.get("accrual.lesson.any-mode"),
        denomination: "bre",
        amount: 1,
      },
    ]);
    await assertKeys(points, [
      `lesson.pul:${points.personId}:${points.lessonId}`,
      `lesson:${points.personId}:${points.lessonId}`,
    ]);
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id, outcome FROM points_facts WHERE person_id=$1 AND type='lesson.completed' ORDER BY received_at, event_id",
          [points.personId],
        )
      ).rows,
    ).toEqual([
      { event_id: points.facts[0]!.eventId, outcome: "applied" },
      { event_id: points.facts[1]!.eventId, outcome: "duplicate" },
    ]);
  },
);
Then('the second and third answers are "duplicate"', async ({ points }) => {
  expect(points.answers.map((answer) => answer.outcome)).toEqual([
    "applied",
    "duplicate",
    "duplicate",
  ]);
  expect(points.answers[2]!.applied).toEqual(points.answers[0]!.applied);
});

Given('the account of "A" is closed for erasure', async ({ points }) => {
  await recordLesson(points, "online");
  points.postingSnapshot = await completePostings(points);
  expect(points.postingSnapshot).toHaveLength(2);
  points.journalSnapshot = await journal(points);
  const closed = await points.ledger.close(points.personId, new Date());
  expect(closed.closedAt).toBeInstanceOf(Date);
});
When('"lesson.completed" for "A" is recorded', async ({ points }) => {
  points.lessonId = randomUUID();
  try {
    await recordLesson(points, "online");
  } catch (error) {
    points.refused = error;
  }
});
Then(
  'it is refused with problem "points-account-closed"',
  async ({ points }) => {
    expect(points.refused).toMatchObject({ problem: "points-account-closed" });
    const fact = points.facts[1]!;
    await assertNoLedgerFact(points, fact.eventId);
    expect(await journal(points)).toEqual(points.journalSnapshot);
  },
);
Then('every existing posting of "A" is unchanged', async ({ points }) => {
  expect(await completePostings(points)).toEqual(points.postingSnapshot);
});

When(
  '"module.completed" for "A" on module "M1" is recorded twice',
  async ({ points }) => {
    const ref = randomUUID();
    for (let index = 0; index < 2; index += 1) {
      const fact = {
        type: "module.completed",
        eventId: `points-original-module:${randomUUID()}`,
        personId: points.personId,
        ref,
        occurredAt: new Date(),
        attributes: { mode: "online" },
      };
      points.facts.push(fact);
      points.answers.push(await points.engine.record(fact));
      if (index === 0) points.postingSnapshot = await completePostings(points);
    }
    expect(points.facts[1]!.eventId).not.toBe(points.facts[0]!.eventId);
  },
);
Then(
  'exactly one module award of 20 Pul, 3 Bre and 1 Con is posted for "A" on "M1"',
  async ({ points }) => {
    const first = points.facts[0]!;
    expect(await postings(points)).toEqual([
      {
        event_id: `${first.eventId}#accrual.module`,
        rule_id: "accrual.module",
        rule_version: points.seedVersions.get("accrual.module"),
        denomination: "pul",
        amount: 20,
      },
      {
        event_id: `${first.eventId}#accrual.module.any-mode`,
        rule_id: "accrual.module.any-mode",
        rule_version: points.seedVersions.get("accrual.module.any-mode"),
        denomination: "bre",
        amount: 3,
      },
      {
        event_id: `${first.eventId}#accrual.module.any-mode`,
        rule_id: "accrual.module.any-mode",
        rule_version: points.seedVersions.get("accrual.module.any-mode"),
        denomination: "con",
        amount: 1,
      },
    ]);
    expect(points.answers.map((answer) => answer.outcome)).toEqual([
      "applied",
      "duplicate",
    ]);
    expect(await completePostings(points)).toEqual(points.postingSnapshot);
    await assertNoLedgerFact(points, points.facts[1]!.eventId);
    await assertKeys(points, [
      `module.pul:${points.personId}:${first.ref}`,
      `module:${points.personId}:${first.ref}`,
    ]);
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id, ref_id, outcome FROM points_facts WHERE person_id=$1 AND type='module.completed' ORDER BY received_at, event_id",
          [points.personId],
        )
      ).rows,
    ).toEqual([
      { event_id: first.eventId, ref_id: first.ref, outcome: "applied" },
      {
        event_id: points.facts[1]!.eventId,
        ref_id: first.ref,
        outcome: "duplicate",
      },
    ]);
  },
);
