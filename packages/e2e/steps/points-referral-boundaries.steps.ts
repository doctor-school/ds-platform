import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  parseGatingDecision,
  postings,
  prepareDoctor,
  retirePointsEvents,
  type EngineFact,
  type EngineResult,
  type PointsWorld,
} from "../lib/points-engine-originals.js";
import { test } from "./points-engine-originals.steps.js";
import { snapshot, unpricedEvent } from "./points-reserve-boundaries.steps.js";

const { Given, When, Then, After } = createBdd(test);
interface Invitee {
  personId: string;
  attribution: EngineFact;
  lesson?: EngineFact;
  result?: EngineResult;
}
interface Observation {
  eventId: string;
  personId: string;
  name: string;
  args: Readonly<Record<string, unknown>>;
  value: unknown;
}
interface ReferralCase {
  at: Date;
  invitees: Invitee[];
  event?: string;
  decision?: unknown;
  before?: unknown;
  observations?: Observation[];
}
const cases = new WeakMap<PointsWorld, ReferralCase>();
function state(points: PointsWorld): ReferralCase {
  let value = cases.get(points);
  if (!value) {
    value = { at: new Date(), invitees: [] };
    cases.set(points, value);
  }
  return value;
}
function receipt(points: PointsWorld, phase: string, data: unknown) {
  appendFileSync(
    process.env.E2E_POINTS_OPS_LOG!,
    JSON.stringify({
      phase,
      database: process.env.E2E_POINTS_DATABASE,
      personId: points.personId,
      data,
    }) + "\n",
  );
}
function moscowMonth(at: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}
async function lessonCount(points: PointsWorld, personId: string) {
  const { rows } = await points.handle.pool.query(
    "SELECT count(DISTINCT ref_id)::int AS count FROM points_facts WHERE person_id=$1 AND type='lesson.completed'",
    [personId],
  );
  return rows[0]!.count as number;
}
async function prepareInvitee(points: PointsWorld): Promise<Invitee> {
  const own = state(points);
  const personId = randomUUID();
  await prepareDoctor(points, personId);
  const attribution: EngineFact = {
    type: "referral.attributed",
    eventId: `points-referral-attributed:${randomUUID()}`,
    personId,
    ref: points.personId,
    occurredAt: own.at,
    attributes: {},
  };
  expect((await points.engine.record(attribution)).outcome).toBe("no-effect");
  expect(
    (
      await points.handle.pool.query(
        "SELECT type,person_id,ref_kind,ref_id FROM points_facts WHERE event_id=$1",
        [attribution.eventId],
      )
    ).rows,
  ).toEqual([
    {
      type: "referral.attributed",
      person_id: personId,
      ref_kind: "person",
      ref_id: points.personId,
    },
  ]);
  expect(await lessonCount(points, personId)).toBe(0);
  const invitee = { personId, attribution };
  own.invitees.push(invitee);
  return invitee;
}
function firstLesson(points: PointsWorld, invitee: Invitee): EngineFact {
  const fact: EngineFact = {
    type: "lesson.completed",
    eventId: `points-referral-lesson:${randomUUID()}`,
    personId: invitee.personId,
    ref: randomUUID(),
    occurredAt: state(points).at,
    attributes: { mode: "online" },
  };
  invitee.lesson = fact;
  return fact;
}
async function inviteeAward(points: PointsWorld, invitee: Invitee) {
  const fact = invitee.lesson!;
  const rows = await postings(
    { ...points, personId: invitee.personId },
    fact.eventId,
  );
  expect(
    rows.filter((row) => row.rule_id === "accrual.referral-invitee"),
  ).toEqual([
    {
      event_id: `${fact.eventId}#accrual.referral-invitee`,
      rule_id: "accrual.referral-invitee",
      rule_version: points.seedVersions.get("accrual.referral-invitee"),
      denomination: "pul",
      amount: 30,
    },
  ]);
  expect(rows.filter((row) => row.rule_id === "accrual.lesson")).toEqual([
    {
      event_id: `${fact.eventId}#accrual.lesson`,
      rule_id: "accrual.lesson",
      rule_version: points.seedVersions.get("accrual.lesson"),
      denomination: "pul",
      amount: 10,
    },
  ]);
  expect(
    (await points.ledger.readPersonAccount(invitee.personId)).pul.available,
  ).toBe(40);
  return rows;
}
async function inviterAwards(points: PointsWorld) {
  return (await postings(points)).filter(
    (row) => row.rule_id === "accrual.referral-inviter",
  );
}

After("@points-referral-boundaries", async ({ points }) => {
  if (!points.ownedEventIds.length) return;
  const before = await snapshot(points);
  await retirePointsEvents(points);
  const after = await snapshot(points);
  expect(after).toEqual(before);
  receipt(points, "referral-owned-event-cleanup", {
    eventIds: points.ownedEventIds,
    retired: points.ownedEventIds.length,
    beforeSha256: createHash("sha256")
      .update(JSON.stringify(before))
      .digest("hex"),
    afterSha256: createHash("sha256")
      .update(JSON.stringify(after))
      .digest("hex"),
    ledgerUnchanged: true,
  });
});
When(
  'the gating decision of an open event is requested for "A"',
  async ({ points }) => {
    const own = state(points);
    own.event = await unpricedEvent(points);
    expect(
      (
        await points.handle.pool.query(
          "SELECT item_ref FROM points_prices WHERE item_ref=$1",
          [own.event],
        )
      ).rows,
    ).toEqual([]);
    own.before = await snapshot(points);
    own.decision = await points.prices.gating(points.personId, own.event);
  },
);
Then(
  "the response carries a pulCost of 0 in Pul and no field stating that the event is free",
  async ({ points }) => {
    const own = state(points);
    expect(parseGatingDecision(own.decision)).toEqual(own.decision);
    expect(own.decision).toEqual({
      itemRef: own.event,
      mode: "open",
      pulCost: 0,
      unit: "Pul",
      decision: "open",
      reservedFromBalance: 0,
      coveredByAdvance: 0,
      shortfall: 0,
    });
    expect(await snapshot(points)).toEqual(own.before);
    receipt(points, "unpriced-pul-quote", {
      eventId: own.event,
      priceRows: 0,
      decision: own.decision,
      financialStateUnchanged: true,
    });
  },
);

Given(
  '"A" has received 5 referral awards this calendar month',
  async ({ points }) => {
    const own = state(points);
    for (let index = 0; index < 5; index += 1) {
      const invitee = await prepareInvitee(points);
      const fact = firstLesson(points, invitee);
      invitee.result = await points.engine.record(fact);
      expect(invitee.result.outcome).toBe("applied");
      await inviteeAward(points, invitee);
      const rows = (await inviterAwards(points)).filter(
        (row) => row.event_id === `${fact.eventId}#accrual.referral-inviter`,
      );
      expect(rows).toEqual([
        {
          event_id: `${fact.eventId}#accrual.referral-inviter`,
          rule_id: "accrual.referral-inviter",
          rule_version: points.seedVersions.get("accrual.referral-inviter"),
          denomination: "bre",
          amount: 2,
        },
        {
          event_id: `${fact.eventId}#accrual.referral-inviter`,
          rule_id: "accrual.referral-inviter",
          rule_version: points.seedVersions.get("accrual.referral-inviter"),
          denomination: "pul",
          amount: 30,
        },
      ]);
    }
    const rows = await inviterAwards(points);
    expect(new Set(rows.map((row) => row.event_id)).size).toBe(5);
    expect(rows).toHaveLength(10);
    const months = (
      await points.handle.pool.query(
        "SELECT event_id,to_char(occurred_at AT TIME ZONE 'Europe/Moscow','YYYY-MM') AS month FROM points_facts WHERE event_id=ANY($1::text[]) ORDER BY event_id",
        [
          own.invitees.flatMap((invitee) => [
            invitee.attribution.eventId,
            invitee.lesson!.eventId,
          ]),
        ],
      )
    ).rows;
    expect(months).toHaveLength(10);
    for (const row of months) expect(row.month).toBe(moscowMonth(own.at));
    own.before = await snapshot(points);
    receipt(points, "five-monthly-referral-awards", {
      month: moscowMonth(own.at),
      invitees: own.invitees.map((invitee) => invitee.personId),
      postings: rows,
      months,
    });
  },
);
When(
  'a sixth invitee of "A" verifies the phone and completes a first lesson',
  async ({ points }) => {
    const invitee = await prepareInvitee(points);
    invitee.result = await points.engine.record(firstLesson(points, invitee));
    expect(invitee.result.outcome).toBe("applied");
  },
);
Then("the invitee receives 30 Pul", async ({ points }) => {
  const invitee = state(points).invitees[5]!;
  const rows = await inviteeAward(points, invitee);
  receipt(points, "sixth-invitee-referral-award", {
    personId: invitee.personId,
    fact: invitee.lesson,
    postings: rows,
  });
});
Then(
  'no referral award is posted to "A" for that invitee and the inviter rule is traced "limit-reached"',
  async ({ points }) => {
    const own = state(points);
    const invitee = own.invitees[5]!;
    expect(
      invitee.result!.trace.find(
        (entry) => entry.ruleId === "accrual.referral-inviter",
      )?.verdict,
    ).toBe("limit-reached");
    expect(await postings(points, invitee.lesson!.eventId)).toEqual([]);
    expect(await snapshot(points)).toEqual(own.before);
    const journal = (
      await points.handle.pool.query(
        "SELECT trace FROM points_facts WHERE event_id=$1",
        [invitee.lesson!.eventId],
      )
    ).rows;
    expect(journal).toEqual([{ trace: invitee.result!.trace }]);
    receipt(points, "inviter-monthly-cap-refusal", {
      month: moscowMonth(own.at),
      inviteeId: invitee.personId,
      factId: invitee.lesson!.eventId,
      trace: invitee.result!.trace,
      inviterAwardEvents: new Set(
        (await inviterAwards(points)).map((row) => row.event_id),
      ).size,
      inviterFinancialStateUnchanged: true,
    });
  },
);

Given(
  'invitee "F" of "A" has a verified phone and no completed lesson',
  async ({ points }) => {
    await prepareInvitee(points);
  },
);
When(
  '"lesson.completed" for "F" on lesson "L8" is recorded',
  async ({ points }) => {
    const own = state(points);
    const invitee = own.invitees[0]!;
    const fact = firstLesson(points, invitee);
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id FROM points_facts WHERE event_id=$1",
          [fact.eventId],
        )
      ).rows,
    ).toEqual([]);
    const { JournalPredicateResolver } = (await import(
      new URL(
        "../../../apps/api/dist/points/engine/predicates.js",
        import.meta.url,
      ).href
    )) as {
      JournalPredicateResolver: {
        prototype: {
          resolve(
            name: string,
            args: Readonly<Record<string, unknown>>,
          ): Promise<unknown>;
        };
      };
    };
    const prototype = JournalPredicateResolver.prototype;
    const original = prototype.resolve;
    const observations: Observation[] = [];
    // 025 EARS-34 needs the in-flight value; a post-record query sees a different journal.
    prototype.resolve = function (name, args) {
      return original.call(this, name, args).then((value) => {
        const current = Reflect.get(this, "fact") as EngineFact;
        if (
          name === "person.completedLessons" &&
          current.eventId === fact.eventId &&
          current.personId === invitee.personId
        ) {
          observations.push({
            eventId: current.eventId,
            personId: current.personId,
            name,
            args,
            value,
          });
        }
        return value;
      });
    };
    try {
      invitee.result = await points.engine.record(fact);
    } finally {
      prototype.resolve = original;
    }
    expect(prototype.resolve).toBe(original);
    own.observations = observations;
    expect(invitee.result.outcome).toBe("applied");
  },
);
Then(
  '"person.completedLessons" reads 1 for that evaluation',
  async ({ points }) => {
    const own = state(points);
    const invitee = own.invitees[0]!;
    expect(own.observations!.length).toBeGreaterThan(0);
    for (const observation of own.observations!) {
      expect(observation).toEqual({
        eventId: invitee.lesson!.eventId,
        personId: invitee.personId,
        name: "person.completedLessons",
        args: {},
        value: 1,
      });
    }
    receipt(points, "current-lesson-predicate-observation", {
      beforeCompletedLessons: 0,
      observations: own.observations,
      restored: true,
    });
  },
);
Then(
  '"F" receives 30 Pul under "accrual.referral-invitee" on that same fact',
  async ({ points }) => {
    const invitee = state(points).invitees[0]!;
    const fact = invitee.lesson!;
    const rows = await inviteeAward(points, invitee);
    expect(await lessonCount(points, invitee.personId)).toBe(1);
    expect(
      (
        await points.handle.pool.query(
          "SELECT type,person_id,ref_id FROM points_facts WHERE event_id=$1",
          [fact.eventId],
        )
      ).rows,
    ).toEqual([
      {
        type: "lesson.completed",
        person_id: invitee.personId,
        ref_id: fact.ref,
      },
    ]);
    receipt(points, "same-first-fact-referral-award", {
      fact,
      completedLessons: 1,
      postings: rows,
      trace: invitee.result!.trace,
    });
  },
);
