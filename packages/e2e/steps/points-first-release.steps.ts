import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { completePointsSnapshot } from "../lib/points-first-release.js";
import {
  pointsOperation,
  prepareDoctor,
  retirePointsEvents,
  type EngineFact,
  type PointsWorld,
} from "../lib/points-engine-originals.js";
import { pricedEvent } from "./points-reserve-boundaries.steps.js";
import { test } from "./points-engine-originals.steps.js";

const { Given, When, Then, After } = createBdd(test, {
  tags: "@points-first-release",
});
interface Case {
  actors: string[];
  facts: EngineFact[];
  item?: string;
  registration?: EngineFact;
  attendance?: EngineFact;
  older?: EngineFact;
  current?: EngineFact;
  before?: Awaited<ReturnType<typeof completePointsSnapshot>>;
  rejected?: EngineFact;
  refusal?: unknown;
}
const cases = new WeakMap<PointsWorld, Case>();
function state(p: PointsWorld): Case {
  let value = cases.get(p);
  if (!value) {
    value = { actors: [p.personId], facts: [] };
    cases.set(p, value);
  }
  return value;
}
const query = async (p: PointsWorld, sql: string, params: unknown[] = []) =>
  (await p.handle.pool.query(sql, params)).rows;
async function record(p: PointsWorld, fact: EngineFact) {
  state(p).facts.push(fact);
  pointsOperation("NATIVE points.record " + JSON.stringify(fact));
  return p.engine.record(fact);
}
async function fact(
  p: PointsWorld,
  type: string,
  attributes: Record<string, unknown> = {},
  ref?: string,
  personId = p.personId,
) {
  const value: EngineFact = {
    type,
    eventId: `points-first-release:${randomUUID()}`,
    personId,
    occurredAt: new Date(),
    attributes,
    ...(ref ? { ref } : {}),
  };
  await record(p, value);
  return value;
}
async function register(p: PointsWorld, item: string, personId = p.personId) {
  const value = p.registrationFact({
    registrationId: randomUUID(),
    personId,
    itemRef: item,
    occurredAt: new Date(),
  });
  await record(p, value);
  return value;
}
async function own(
  p: PointsWorld,
  table:
    | "points_facts"
    | "points_accounts"
    | "points_postings"
    | "points_reserves"
    | "points_obligations",
) {
  if (table === "points_facts")
    return query(
      p,
      "SELECT * FROM points_facts WHERE person_id=$1 ORDER BY event_id",
      [p.personId],
    );
  if (table === "points_accounts")
    return query(
      p,
      "SELECT * FROM points_accounts WHERE subject_kind='person' AND subject_id=$1 ORDER BY id",
      [p.personId],
    );
  if (table === "points_postings")
    return query(
      p,
      "SELECT * FROM points_postings WHERE event_id LIKE ANY(SELECT event_id || '#%' FROM points_facts WHERE person_id=$1) ORDER BY event_id,leg",
      [p.personId],
    );
  return query(
    p,
    `SELECT * FROM ${table} WHERE person_account_id IN (SELECT id FROM points_accounts WHERE subject_kind='person' AND subject_id=$1) ORDER BY ${table === "points_obligations" ? "opened_at,id" : "registration_id"}`,
    [p.personId],
  );
}
async function noAttempt(p: PointsWorld, f: EngineFact) {
  for (const table of [
    "points_facts",
    "points_posting_keys",
    "points_postings",
  ]) {
    expect(
      await query(
        p,
        `SELECT * FROM ${table} WHERE event_id=$1 OR event_id=$2 OR event_id LIKE $1 || '#%'`,
        [f.eventId, `${f.eventId}#spend.reserve`],
      ),
    ).toEqual([]);
  }
  for (const table of ["points_reserves", "points_obligations"])
    expect(
      await query(p, `SELECT * FROM ${table} WHERE registration_id=$1`, [
        f.attributes.registrationId,
      ]),
    ).toEqual([]);
}
After("@points-first-release", async ({ points: p }) => {
  const snapshot = await completePointsSnapshot(p.handle.pool);
  const prices = await query(
    p,
    "SELECT * FROM points_prices WHERE item_ref=ANY($1::text[]) ORDER BY item_ref",
    [p.ownedEventIds],
  );
  await retirePointsEvents(p);
  expect(
    await query(
      p,
      "SELECT id FROM events WHERE id=ANY($1::uuid[]) AND (record_status <> 'retired' OR deleted_at IS NULL)",
      [p.ownedEventIds],
    ),
  ).toEqual([]);
  const snapshotAfter = await completePointsSnapshot(p.handle.pool);
  const pricesAfter = await query(
    p,
    "SELECT * FROM points_prices WHERE item_ref=ANY($1::text[]) ORDER BY item_ref",
    [p.ownedEventIds],
  );
  expect(snapshotAfter).toEqual(snapshot);
  expect(pricesAfter).toEqual(prices);
  const events = await query(
    p,
    "SELECT id,record_status,deleted_at FROM events WHERE id=ANY($1::uuid[]) ORDER BY id",
    [p.ownedEventIds],
  );
  expect(events.map((row) => row.id).sort()).toEqual(
    [...p.ownedEventIds].sort(),
  );
  const file = process.env.E2E_POINTS_RESOURCE_REPORT;
  if (!file)
    throw new Error(
      "E2E_POINTS_RESOURCE_REPORT must name the native resource manifest",
    );
  appendFileSync(
    file,
    JSON.stringify({
      title: test.info().title,
      database: process.env.E2E_POINTS_DATABASE,
      applicationName: p.applicationName,
      ...state(p),
      eventIds: p.ownedEventIds,
      snapshot,
      cleanup: { events, snapshotAfter, prices, pricesAfter },
    }) + "\n",
  );
});

Given('doctor "A" has no points account', async ({ points: p }) => {
  expect(await own(p, "points_accounts")).toEqual([]);
  expect(await own(p, "points_facts")).toEqual([]);
});
When(
  'the facts "account.registered" and "phone.verified" for "A" are recorded',
  async ({ points: p }) => {
    await fact(p, "account.registered");
    await fact(p, "phone.verified");
  },
);
Then(
  'exactly one attention-points account exists for "A"',
  async ({ points: p }) => {
    expect(await own(p, "points_accounts")).toHaveLength(1);
  },
);
Then(
  '"A" has 20 Pul available, each posting carrying rule "accrual.registration" version 2',
  async ({ points: p }) => {
    expect((await p.ledger.readPersonAccount(p.personId)).pul.available).toBe(
      20,
    );
    expect(
      (await own(p, "points_postings")).map((row) => ({
        rule: row.rule_id,
        version: row.rule_version,
        amount: row.amount,
        denomination: row.denomination,
      })),
    ).toEqual([
      {
        rule: "accrual.registration",
        version: 2,
        amount: 20,
        denomination: "pul",
      },
    ]);
  },
);
When(
  'the fact "profile.verified" for "A" is recorded',
  async ({ points: p }) => {
    await fact(p, "profile.verified");
  },
);
Then('"A" has 50 Pul available and 2 Bre', async ({ points: p }) => {
  const account = await p.ledger.readPersonAccount(p.personId);
  expect(account.pul.available).toBe(50);
  expect(account.bre).toBe(2);
});
When(
  '"A" registers for a threshold-mode event "E" priced 50 Pul',
  async ({ points: p }) => {
    state(p).item = await pricedEvent(p, 50);
    state(p).registration = await register(p, state(p).item!);
  },
);
Then(
  'a reserve of 50 Pul is posted and "A" has 0 Pul available and 50 Pul reserved',
  async ({ points: p }) => {
    expect((await p.ledger.readPersonAccount(p.personId)).pul).toEqual({
      unit: "Pul",
      available: 0,
      reserved: 50,
    });
    expect(await own(p, "points_reserves")).toEqual([
      expect.objectContaining({
        registration_id: state(p).registration!.attributes.registrationId,
        state: "held",
        price: 50,
        balance_part: 50,
      }),
    ]);
  },
);
When(
  '"attendance.confirmed" is recorded for "A" on "E" with a presence share of 45 %',
  async ({ points: p }) => {
    state(p).attendance = await fact(
      p,
      "attendance.confirmed",
      {
        registrationId: state(p).registration!.attributes.registrationId,
        presenceSharePercent: 45,
      },
      state(p).item,
    );
  },
);
Then("the hold is settled once", async ({ points: p }) => {
  expect(await own(p, "points_reserves")).toEqual([
    expect.objectContaining({ state: "settled" }),
  ]);
  expect(
    await query(p, "SELECT leg,amount FROM points_postings WHERE event_id=$1", [
      state(p).attendance!.eventId + "#spend.settle",
    ]),
  ).toEqual([{ leg: "settle:pul", amount: 50 }]);
  const before = await completePointsSnapshot(p.handle.pool);
  await record(p, state(p).attendance!);
  await record(p, state(p).registration!);
  expect(await completePointsSnapshot(p.handle.pool)).toEqual(before);
});
Then('"A" has 0 Pul, 4 Bre and 1 Con', async ({ points: p }) => {
  const account = await p.ledger.readPersonAccount(p.personId);
  expect(account.pul).toEqual({ unit: "Pul", available: 0, reserved: 0 });
  expect(account.bre).toBe(4);
  expect(account.con).toBe(1);
});

Given(
  '"A" holds a reserve on advance-mode event "E4" with an obligation "O1" of 30 Pul',
  async ({ points: p }) => {
    await fact(p, "phone.verified");
    state(p).item = await pricedEvent(p, 30, false, "advance");
    state(p).older = await register(
      p,
      await pricedEvent(p, 20, false, "advance"),
    );
    state(p).registration = await register(p, state(p).item!);
    expect((await own(p, "points_obligations"))[1]).toMatchObject({
      opened: 30,
      remaining: 30,
    });
  },
);
Given(
  'an older obligation "O0" of 20 Pul is open for "A"',
  async ({ points: p }) => {
    const rows = await own(p, "points_obligations");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      registration_id: state(p).older!.attributes.registrationId,
      opened: 20,
      remaining: 20,
    });
    expect(rows[1]).toMatchObject({
      registration_id: state(p).registration!.attributes.registrationId,
      opened: 30,
      remaining: 30,
    });
    expect(+rows[0].opened_at).toBeLessThan(+rows[1].opened_at);
    pointsOperation("FIFO " + JSON.stringify(rows));
  },
);
Given(
  'later lessons netted 20 Pul to "O0" and 10 Pul to "O1"',
  async ({ points: p }) => {
    for (let i = 0; i < 3; i++)
      await fact(p, "lesson.completed", { mode: "online" }, randomUUID());
    const rows = await own(p, "points_obligations");
    expect(rows[0]).toMatchObject({
      netted: 20,
      remaining: 0,
      state: "netted",
    });
    expect(rows[1]).toMatchObject({ netted: 10, remaining: 20 });
    state(p).before = await completePointsSnapshot(p.handle.pool);
  },
);
When('"A" cancels the registration on "E4"', async ({ points: p }) => {
  // 025 design E / Verification 18: engine intake only; producer remains #3884.
  state(p).current = await fact(
    p,
    "registration.cancelled",
    { registrationId: state(p).registration!.attributes.registrationId },
    state(p).item,
  );
});
Then(
  'the advance of "O1" and its own 10 Pul netting leg are reversed',
  async ({ points: p }) => {
    const before = state(p).before!;
    const old = (await own(p, "points_obligations"))[0];
    const current = (await own(p, "points_obligations"))[1];
    const reversals = await query(
      p,
      "SELECT * FROM points_postings WHERE event_id=$1 ORDER BY leg",
      [state(p).current!.eventId + "#spend.release"],
    );
    const advance = await query(
      p,
      "SELECT * FROM points_postings WHERE event_id=$1 AND leg='reserve:advance'",
      [state(p).registration!.eventId + "#spend.reserve"],
    );
    const netting = await query(
      p,
      "SELECT * FROM points_postings WHERE leg=$1 ORDER BY event_id",
      [`obligation-settle:${current.id}`],
    );
    expect(advance).toHaveLength(1);
    expect(advance[0].amount).toBe(30);
    expect(netting.reduce((n, row) => n + row.amount, 0)).toBe(10);
    expect(reversals.map((row) => row.reverses_posting_id).sort()).toEqual(
      [...advance, ...netting].map((row) => row.id).sort(),
    );
    expect(reversals.map((row) => row.amount).sort((a, b) => a - b)).toEqual([
      10, 30,
    ]);
    const after = await completePointsSnapshot(p.handle.pool);
    for (const key of ["journal", "postings", "keys"] as const)
      for (const row of before[key]) expect(after[key]).toContainEqual(row);
    expect(
      await query(p, "SELECT * FROM points_postings WHERE leg=$1", [
        `obligation-settle:${old.id}`,
      ]),
    ).toHaveLength(2);
  },
);
Then(
  '"O1" reports a remaining debt of 0 and "O0" stays netted with 0 Pul remaining',
  async ({ points: p }) => {
    const rows = await own(p, "points_obligations");
    expect(rows[0]).toMatchObject({
      netted: 20,
      remaining: 0,
      state: "netted",
    });
    expect(rows[1]).toMatchObject({ remaining: 0, state: "annulled" });
    expect(state(p).before!.obligations).toContainEqual(rows[0]);
  },
);
Then(
  '"A" has the Pul available as if the registration on "E4" had never been made',
  async ({ points: p }) => {
    const control = randomUUID();
    state(p).actors.push(control);
    await prepareDoctor(p, control);
    await register(p, await pricedEvent(p, 20, false, "advance"), control);
    for (let i = 0; i < 3; i++)
      await fact(
        p,
        "lesson.completed",
        { mode: "online" },
        randomUUID(),
        control,
      );
    expect((await p.ledger.readPersonAccount(p.personId)).pul.available).toBe(
      10,
    );
    expect((await p.ledger.readPersonAccount(control)).pul.available).toBe(10);
    const before = await completePointsSnapshot(p.handle.pool);
    await record(p, state(p).current!);
    expect(await completePointsSnapshot(p.handle.pool)).toEqual(before);
  },
);

Given('doctor "J" has 30 Pul and no verified phone', async ({ points: p }) => {
  const j = randomUUID();
  state(p).actors.push(j);
  await query(
    p,
    "INSERT INTO users(id,zitadel_sub,email,phone_verified,role) VALUES($1,$2,$3,false,'doctor_verified')",
    [j, `points-first-release:${j}`, `${j}@points-original.invalid`],
  );
  expect(
    await query(p, "SELECT phone_verified FROM users WHERE id=$1", [j]),
  ).toEqual([{ phone_verified: false }]);
  await fact(p, "module.completed", { mode: "online" }, randomUUID(), j);
  await fact(p, "lesson.completed", { mode: "online" }, randomUUID(), j);
  expect((await p.ledger.readPersonAccount(j)).pul.available).toBe(30);
});
When(
  '"J" registers for a threshold-mode event priced 20 Pul',
  async ({ points: p }) => {
    const item = await pricedEvent(p, 20);
    const j = state(p).actors[1]!;
    const f = p.registrationFact({
      registrationId: randomUUID(),
      personId: j,
      itemRef: item,
      occurredAt: new Date(),
    });
    state(p).rejected = f;
    state(p).before = await completePointsSnapshot(p.handle.pool);
    try {
      await record(p, f);
    } catch (error) {
      state(p).refusal = error;
    }
  },
);
Then(
  'the registration is refused with problem "points-phone-unverified" and nothing is written',
  async ({ points: p }) => {
    expect(state(p).refusal).toMatchObject({
      problem: "points-phone-unverified",
    });
    await noAttempt(p, state(p).rejected!);
    expect(await completePointsSnapshot(p.handle.pool)).toEqual(
      state(p).before,
    );
  },
);
