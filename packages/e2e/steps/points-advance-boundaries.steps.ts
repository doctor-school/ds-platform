import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  prepareDoctor,
  retirePointsEvents,
  type EngineFact,
  type PointsWorld,
} from "../lib/points-engine-originals.js";
import { test } from "./points-engine-originals.steps.js";
import {
  fund,
  pricedEvent,
  snapshot,
} from "./points-reserve-boundaries.steps.js";

const { Given, When, Then, After } = createBdd(test);
interface AdvanceCase {
  event?: string;
  otherPerson?: string;
  memberId?: string;
  organisationId?: string;
  facts: EngineFact[];
  before?: unknown;
  refused?: {
    problem: string;
    short: {
      shortfall: number;
      earnHint: { pulToEarn: number; lessonsNeeded: number };
    };
  };
}
const cases = new WeakMap<PointsWorld, AdvanceCase>();
function state(points: PointsWorld): AdvanceCase {
  let value = cases.get(points);
  if (!value) {
    value = { facts: [] };
    cases.set(points, value);
  }
  return value;
}
function registration(
  points: PointsWorld,
  item: string,
  personId = points.personId,
): EngineFact {
  const fact = points.registrationFact({
    registrationId: randomUUID(),
    personId,
    itemRef: item,
    occurredAt: new Date(),
  });
  state(points).facts.push(fact);
  return fact;
}
async function legs(points: PointsWorld, fact: EngineFact) {
  return (
    await points.handle.pool.query(
      `SELECT p.leg, p.amount, p.denomination, p.rule_id, p.rule_version,
      coalesce(d.system_code,d.subject_kind) AS debit, coalesce(c.system_code,c.subject_kind) AS credit,
      p.attributed_organisation_id, p.attributed_member_id
     FROM points_postings p JOIN points_accounts d ON d.id=p.debit_account_id
     JOIN points_accounts c ON c.id=p.credit_account_id
     WHERE p.event_id=$1 ORDER BY p.leg`,
      [`${fact.eventId}#spend.reserve`],
    )
  ).rows;
}
async function obligation(points: PointsWorld, fact: EngineFact) {
  const rows = (
    await points.handle.pool.query(
      "SELECT opened, netted, remaining, state FROM points_obligations WHERE registration_id=$1",
      [fact.attributes.registrationId],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  return rows[0];
}
async function completeSnapshot(points: PointsWorld) {
  const other = state(points).otherPerson;
  return {
    a: await snapshot(points),
    b: other ? await snapshot({ ...points, personId: other }) : null,
  };
}
function receipt(points: PointsWorld, phase: string, data: unknown) {
  appendFileSync(
    (process.env.E2E_POINTS_ADVANCE_REPORT ?? process.env.E2E_POINTS_OPS_LOG)!,
    JSON.stringify({
      phase,
      database: process.env.E2E_POINTS_DATABASE,
      personId: points.personId,
      data,
    }) + "\n",
  );
}
After("@points-advance-boundaries", async ({ points }) => {
  if (!points.ownedEventIds.length) return;
  const before = await completeSnapshot(points);
  await retirePointsEvents(points);
  const after = await completeSnapshot(points);
  expect(after).toEqual(before);
  receipt(points, "advance-owned-event-cleanup", {
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

Given('"A" has 20 Pul available', async ({ points }) => {
  await fund(points, 20);
});
Given('an advance-mode event "E2" priced 50 Pul', async ({ points }) => {
  state(points).event = await pricedEvent(points, 50, false, "advance");
});
When('"A" registers for "E2"', async ({ points }) => {
  expect(
    (await points.engine.record(registration(points, state(points).event!)))
      .outcome,
  ).toBe("applied");
});
Then(
  "20 Pul are reserved from the balance and 30 Pul are covered by an advance",
  async ({ points }) => {
    const fact = state(points).facts[0]!;
    const rows = await legs(points, fact);
    expect(rows).toEqual([
      {
        leg: "reserve:advance",
        amount: 30,
        denomination: "pul",
        rule_id: "spend.reserve",
        rule_version: points.seedVersions.get("spend.reserve"),
        debit: "advance",
        credit: "reserve",
        attributed_organisation_id: null,
        attributed_member_id: null,
      },
      {
        leg: "reserve:balance",
        amount: 20,
        denomination: "pul",
        rule_id: "spend.reserve",
        rule_version: points.seedVersions.get("spend.reserve"),
        debit: "person",
        credit: "reserve",
        attributed_organisation_id: null,
        attributed_member_id: null,
      },
    ]);
    expect(
      (
        await points.handle.pool.query(
          "SELECT balance_part, advance_part, price, state FROM points_reserves WHERE registration_id=$1",
          [fact.attributes.registrationId],
        )
      ).rows,
    ).toEqual([
      { balance_part: 20, advance_part: 30, price: 50, state: "held" },
    ]);
    receipt(points, "advance-split", rows);
  },
);
Then(
  '"A" has an open obligation of 30 Pul and the account reports no negative balance',
  async ({ points }) => {
    expect(await obligation(points, state(points).facts[0]!)).toEqual({
      opened: 30,
      netted: 0,
      remaining: 30,
      state: "open",
    });
    expect(
      await points.ledger.readPersonAccount(points.personId),
    ).toMatchObject({
      pul: { available: 0, reserved: 20 },
      advance: { open: 1, remaining: 30 },
    });
  },
);
When(
  '"lesson.completed" for "A" on lesson "L2" is recorded',
  async ({ points }) => {
    const fact = {
      type: "lesson.completed",
      eventId: `points-advance-lesson:${randomUUID()}`,
      personId: points.personId,
      ref: points.lessonId,
      occurredAt: new Date(),
      attributes: { mode: "online" },
    };
    state(points).facts.push(fact);
    expect((await points.engine.record(fact)).outcome).toBe("applied");
  },
);
Then(
  "10 Pul settle the obligation first and 20 Pul remain to be earned back",
  async ({ points }) => {
    const own = state(points);
    expect(await obligation(points, own.facts[0]!)).toEqual({
      opened: 30,
      netted: 10,
      remaining: 20,
      state: "open",
    });
    const rows = (
      await points.handle.pool.query(
        `SELECT p.leg, p.amount, coalesce(d.system_code,d.subject_kind) AS debit, coalesce(c.system_code,c.subject_kind) AS credit
     FROM points_postings p JOIN points_accounts d ON d.id=p.debit_account_id JOIN points_accounts c ON c.id=p.credit_account_id
     WHERE p.event_id=$1 ORDER BY p.leg`,
        [`${own.facts[1]!.eventId}#accrual.lesson`],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      leg: "accrual:pul",
      amount: 10,
      debit: "issuance",
      credit: "person",
    });
    expect(rows[1]).toMatchObject({
      amount: 10,
      debit: "person",
      credit: "advance",
    });
    expect(rows[1].leg).toMatch(/^obligation-settle:/);
    const account = await points.ledger.readPersonAccount(points.personId);
    expect(account).toMatchObject({
      pul: { available: 0, reserved: 20 },
      advance: { open: 1, remaining: 20 },
    });
    receipt(points, "advance-netted", { rows, account });
  },
);

Given(
  'doctor "B" arrived on a medical representative\'s personal link and has 20 Pul',
  async ({ points }) => {
    const own = state(points);
    own.otherPerson = randomUUID();
    await prepareDoctor(points, own.otherPerson);
    await fund(points, 20);
    await fund({ ...points, personId: own.otherPerson }, 20);
    own.memberId = randomUUID();
    await points.handle.pool.query(
      "INSERT INTO users (id,zitadel_sub,email,role) VALUES ($1,$2,$3,'doctor_verified')",
      [
        own.memberId,
        `points-representative:${own.memberId}`,
        `${own.memberId}@points-representative.invalid`,
      ],
    );
    own.organisationId = randomUUID();
    await points.handle.pool.query(
      "INSERT INTO organisations (id,slug,title) VALUES ($1,$2,$3)",
      [
        own.organisationId,
        `points-representative-${own.organisationId}`,
        "Представитель",
      ],
    );
    own.event = await pricedEvent(points, 50, false, "advance");
  },
);
When(
  '"B" registers for the advance-mode event "E2" priced 50 Pul',
  async ({ points }) => {
    const own = state(points);
    const plain = registration(points, own.event!);
    const attributed = registration(points, own.event!, own.otherPerson!);
    attributed.attribution = {
      organisationId: own.organisationId!,
      memberId: own.memberId!,
    };
    expect((await points.engine.record(plain)).outcome).toBe("applied");
    expect((await points.engine.record(attributed)).outcome).toBe("applied");
  },
);
Then(
  '"B" receives the same reserve and advance postings as "A"',
  async ({ points }) => {
    const own = state(points);
    const normalize = (rows: Awaited<ReturnType<typeof legs>>) =>
      rows.map(
        ({
          attributed_member_id: _member,
          attributed_organisation_id: _org,
          ...row
        }) => row,
      );
    const a = normalize(await legs(points, own.facts[0]!));
    const b = normalize(await legs(points, own.facts[1]!));
    expect(a).toHaveLength(2);
    expect(a.map(({ leg, amount }) => ({ leg, amount }))).toEqual([
      { leg: "reserve:advance", amount: 30 },
      { leg: "reserve:balance", amount: 20 },
    ]);
    expect(b).toEqual(a);
    for (const fact of own.facts)
      expect(await obligation(points, fact)).toEqual({
        opened: 30,
        netted: 0,
        remaining: 30,
        state: "open",
      });
  },
);
Then(
  "the postings carry the attribution of the medical representative only",
  async ({ points }) => {
    const own = state(points);
    const plain = await legs(points, own.facts[0]!);
    const attributed = await legs(points, own.facts[1]!);
    for (const row of plain)
      expect(row).toMatchObject({
        attributed_member_id: null,
        attributed_organisation_id: null,
      });
    for (const row of attributed)
      expect(row).toMatchObject({
        attributed_member_id: own.memberId,
        attributed_organisation_id: own.organisationId,
      });
    receipt(points, "advance-attribution", {
      plain,
      attributed,
      memberId: own.memberId,
      organisationId: own.organisationId,
    });
  },
);

Given(
  '"A" has 150 Pul of open obligations and 0 Pul available',
  async ({ points }) => {
    for (const cost of [100, 50]) {
      const item = await pricedEvent(points, cost, false, "advance");
      expect(
        (await points.engine.record(registration(points, item))).outcome,
      ).toBe("applied");
    }
    expect(
      await points.ledger.readPersonAccount(points.personId),
    ).toMatchObject({
      pul: { available: 0, reserved: 0 },
      advance: { open: 2, remaining: 150 },
    });
    expect(
      (await snapshot(points)).obligations
        .map((o: { remaining: number }) => o.remaining)
        .sort(),
    ).toEqual([100, 50].sort());
  },
);
When(
  '"A" asks to reserve for another advance-mode event priced 50 Pul',
  async ({ points }) => {
    const own = state(points);
    own.event = await pricedEvent(points, 50, false, "advance");
    own.before = await completeSnapshot(points);
    try {
      await points.engine.record(registration(points, own.event));
    } catch (error) {
      own.refused = error as NonNullable<AdvanceCase["refused"]>;
    }
  },
);
Then(
  'the reserve is refused with problem "points-threshold-short" and a shortfall of 50',
  async ({ points }) => {
    const own = state(points);
    expect(own.refused).toMatchObject({
      problem: "points-threshold-short",
      short: { shortfall: 50 },
    });
    expect(await completeSnapshot(points)).toEqual(own.before);
    const fact = own.facts[2]!;
    expect(
      (
        await points.handle.pool.query(
          `SELECT (SELECT count(*) FROM points_facts WHERE event_id=$1) AS journal,
      (SELECT count(*) FROM points_postings WHERE event_id LIKE $1 || '#%') AS postings,
      (SELECT count(*) FROM points_posting_keys WHERE event_id LIKE $1 || '#%') AS keys,
      (SELECT count(*) FROM points_reserves WHERE registration_id=$2) AS holds,
      (SELECT count(*) FROM points_obligations WHERE registration_id=$2) AS obligations`,
          [fact.eventId, fact.attributes.registrationId],
        )
      ).rows,
    ).toEqual([
      { journal: "0", postings: "0", keys: "0", holds: "0", obligations: "0" },
    ]);
  },
);
Then(
  "the earn hint states 200 Pul to earn and 20 lessons, the 150 Pul owed counted first",
  async ({ points }) => {
    expect(state(points).refused!.short.earnHint).toMatchObject({
      pulToEarn: 200,
      lessonsNeeded: 20,
    });
    const decision = await points.prices.gating(
      points.personId,
      state(points).event!,
    );
    expect(decision).toMatchObject({
      decision: "short",
      shortfall: 50,
      earnHint: { pulToEarn: 200, lessonsNeeded: 20 },
    });
    expect(await completeSnapshot(points)).toEqual(state(points).before);
    receipt(points, "advance-cap-refusal", decision);
  },
);
Then(
  'an open event and every lesson remain open to "A"',
  async ({ points }) => {
    const item = await pricedEvent(points, 50, false, "open");
    expect(await points.prices.gating(points.personId, item)).toMatchObject({
      decision: "open",
    });
    expect(
      await points.prices.gating(points.personId, `lesson:${randomUUID()}`),
    ).toMatchObject({ decision: "open" });
    expect(
      (await points.engine.record(registration(points, item))).outcome,
    ).toBe("no-effect");
    const fact = {
      type: "lesson.completed",
      eventId: `points-cap-lesson:${randomUUID()}`,
      personId: points.personId,
      ref: randomUUID(),
      occurredAt: new Date(),
      attributes: { mode: "online" },
    };
    expect((await points.engine.record(fact)).outcome).toBe("applied");
    const account = await points.ledger.readPersonAccount(points.personId);
    expect(account).toMatchObject({
      pul: { available: 0 },
      advance: { remaining: 140 },
    });
    receipt(points, "advance-cap-open", {
      event: item,
      lesson: fact.ref,
      account,
    });
  },
);
