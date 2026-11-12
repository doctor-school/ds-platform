import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { completePointsSnapshot } from "../lib/points-first-release.js";
import {
  pointsOperation,
  postings,
  publishSeedChange,
  recordLesson,
  retirePointsEvents,
  retirePointsRules,
  type PointsWorld,
} from "../lib/points-engine-originals.js";
import { bootPointsStarterApi } from "../lib/points-starter-original.js";
import { unpricedEvent } from "./points-reserve-boundaries.steps.js";
import { test } from "./points-engine-originals.steps.js";

const { Given, When, Then, After } = createBdd(test, {
  tags: "@points-rule-changes",
});
interface Case {
  actorId?: string;
  actorSub?: string;
  oldEventId?: string;
  oldSnapshot?: unknown;
  participation?: unknown[];
  refusalBefore?: unknown;
  api?: Awaited<ReturnType<typeof bootPointsStarterApi>>;
  response?: Awaited<
    ReturnType<Awaited<ReturnType<typeof bootPointsStarterApi>>["runRaw"]>
  >;
}
const cases = new WeakMap<PointsWorld, Case>();
function state(p: PointsWorld): Case {
  let own = cases.get(p);
  if (!own) {
    own = {};
    cases.set(p, own);
  }
  return own;
}
const query = async (p: PointsWorld, sql: string, params: unknown[] = []) =>
  (await p.handle.pool.query(sql, params)).rows;
function receipt(p: PointsWorld, kind: string, data: Record<string, unknown>) {
  pointsOperation(
    "RULE_CHANGE " +
      JSON.stringify({
        title: test.info().title,
        applicationName: p.applicationName,
        personId: p.personId,
        kind,
        ...data,
      }),
  );
}
async function admin(p: PointsWorld) {
  const own = state(p);
  if (!own.actorId) {
    own.actorId = randomUUID();
    own.actorSub = "points-rule-change-admin:" + own.actorId;
    await query(
      p,
      "INSERT INTO users(id,zitadel_sub,email,role) VALUES($1,$2,$3,'admin')",
      [own.actorId, own.actorSub, own.actorId + "@points-rule-change.invalid"],
    );
    expect(
      await query(p, "SELECT id,zitadel_sub,role FROM users WHERE id=$1", [
        own.actorId,
      ]),
    ).toEqual([{ id: own.actorId, zitadel_sub: own.actorSub, role: "admin" }]);
    receipt(p, "preauthorized-admin-fixture", {
      actorId: own.actorId,
      actorSub: own.actorSub,
      authorizationAcceptance: false,
    });
  }
  return own as Case & { actorId: string; actorSub: string };
}
async function publish(p: PointsWorld, ruleId: string) {
  const own = await admin(p);
  const financialBefore = await completePointsSnapshot(p.handle.pool);
  const result = await publishSeedChange(p, ruleId, own.actorId, own.actorSub);
  expect(await completePointsSnapshot(p.handle.pool)).toEqual(financialBefore);
  receipt(p, "native-publication-no-replay", {
    publication: result.row,
    financialBefore,
    financialAfter: await completePointsSnapshot(p.handle.pool),
  });
  return result;
}
async function oldFact(p: PointsWorld) {
  const eventId = state(p).oldEventId!;
  return {
    facts: await query(
      p,
      "SELECT * FROM points_facts WHERE event_id=$1 ORDER BY event_id",
      [eventId],
    ),
    postings: await query(
      p,
      "SELECT * FROM points_postings WHERE event_id LIKE $1 || '#%' ORDER BY event_id,leg",
      [eventId],
    ),
    keys: await query(
      p,
      "SELECT * FROM points_posting_keys WHERE event_id LIKE $1 || '#%' ORDER BY event_id",
      [eventId],
    ),
  };
}
After("@points-rule-changes", async ({ points: p }) => {
  try {
    const financialBefore = await completePointsSnapshot(p.handle.pool);
    const pricesBefore = await query(
      p,
      "SELECT * FROM points_prices ORDER BY item_ref",
    );
    await retirePointsRules(p);
    await retirePointsEvents(p);
    const financialAfter = await completePointsSnapshot(p.handle.pool);
    const pricesAfter = await query(
      p,
      "SELECT * FROM points_prices ORDER BY item_ref",
    );
    expect(financialAfter).toEqual(financialBefore);
    expect(pricesAfter).toEqual(pricesBefore);
    const events = await query(
      p,
      "SELECT id,record_status,deleted_at FROM events WHERE id=ANY($1::uuid[]) ORDER BY id",
      [p.ownedEventIds],
    );
    expect(events.map((row) => row.id).sort()).toEqual(
      [...p.ownedEventIds].sort(),
    );
    expect(
      events.every(
        (row) =>
          row.record_status === "retired" && row.deleted_at instanceof Date,
      ),
    ).toBe(true);
    expect(p.seedCleanupReceipt).toBeTruthy();
    const file = process.env.E2E_POINTS_RESOURCE_REPORT;
    if (!file)
      throw new Error(
        "E2E_POINTS_RESOURCE_REPORT is required for native history/cleanup proof",
      );
    appendFileSync(
      file,
      JSON.stringify({
        title: test.info().title,
        database: process.env.E2E_POINTS_DATABASE,
        applicationName: p.applicationName,
        personId: p.personId,
        eventIds: p.ownedEventIds,
        history: p.seedCleanupReceipt,
        cleanup: {
          financialBefore,
          financialAfter,
          pricesBefore,
          pricesAfter,
          events,
        },
      }) + "\n",
    );
  } finally {
    await state(p).api?.close();
  }
});

Given(
  '"A" received a lesson award under rule "accrual.lesson" version 2',
  async ({ points: p }) => {
    await recordLesson(p, "online");
    const own = state(p);
    own.oldEventId = p.facts[0]!.eventId;
    expect(
      (await postings(p, own.oldEventId)).filter(
        (row) => row.rule_id === "accrual.lesson",
      ),
    ).toEqual([
      {
        event_id: own.oldEventId + "#accrual.lesson",
        rule_id: "accrual.lesson",
        rule_version: 2,
        denomination: "pul",
        amount: 10,
      },
    ]);
    own.oldSnapshot = await oldFact(p);
    receipt(p, "original-v2-award", {
      eventId: own.oldEventId,
      snapshot: own.oldSnapshot,
    });
  },
);
When(
  'an admin publishes "accrual.lesson" version 3 with 15 Pul',
  async ({ points: p }) => {
    expect((await publish(p, "accrual.lesson")).row.version).toBe(3);
  },
);
When(
  '"lesson.completed" for "A" on lesson "L3" is recorded',
  async ({ points: p }) => {
    p.lessonId = randomUUID();
    await recordLesson(p, "online");
  },
);
Then("the new posting carries version 3 and 15 Pul", async ({ points: p }) => {
  const eventId = p.facts.at(-1)!.eventId;
  expect(p.result?.outcome).toBe("applied");
  expect(
    (await postings(p, eventId)).filter(
      (row) => row.rule_id === "accrual.lesson",
    ),
  ).toEqual([
    {
      event_id: eventId + "#accrual.lesson",
      rule_id: "accrual.lesson",
      rule_version: 3,
      denomination: "pul",
      amount: 15,
    },
  ]);
  receipt(p, "new-v3-award", {
    fact: p.facts.at(-1),
    result: p.result,
    postings: await postings(p, eventId),
  });
});
Then(
  "the earlier posting still carries version 2 and 10 Pul and its fact is not re-evaluated",
  async ({ points: p }) => {
    const after = await oldFact(p);
    expect(after).toEqual(state(p).oldSnapshot);
    receipt(p, "original-fact-key-posting-immutable", {
      before: state(p).oldSnapshot,
      after,
    });
  },
);
When(
  'an admin publishes "setting.presence.share" version 2 with 50',
  async ({ points: p }) => {
    state(p).participation = await query(
      p,
      "SELECT * FROM points_rule_versions WHERE rule_id='accrual.participation' ORDER BY version",
    );
    expect((await publish(p, "setting.presence.share")).row.version).toBe(2);
  },
);
When(
  '"attendance.confirmed" for "A" on event "E6" is recorded with a presence share of 45 %',
  async ({ points: p }) => {
    const fact = {
      type: "attendance.confirmed",
      eventId: "points-threshold:" + randomUUID(),
      personId: p.personId,
      ref: await unpricedEvent(p),
      occurredAt: new Date(),
      attributes: { presenceSharePercent: 45, registrationId: null },
    };
    p.facts.push(fact);
    p.result = await p.engine.record(fact);
  },
);
Then(
  'no participation award is posted and the trace reads "condition-false"',
  async ({ points: p }) => {
    const fact = p.facts.at(-1)!;
    expect(await postings(p, fact.eventId)).toEqual([]);
    expect(p.result?.trace).toContainEqual(
      expect.objectContaining({
        ruleId: "accrual.participation",
        version: p.seedVersions.get("accrual.participation"),
        verdict: "condition-false",
      }),
    );
    expect(
      await query(
        p,
        "SELECT * FROM points_rule_versions WHERE rule_id='accrual.participation' ORDER BY version",
      ),
    ).toEqual(state(p).participation);
    const journal = await query(
      p,
      "SELECT * FROM points_facts WHERE event_id=$1",
      [fact.eventId],
    );
    expect(journal).toHaveLength(1);
    expect(journal[0]!.trace).toEqual(p.result!.trace);
    receipt(p, "setting-without-credit-version", {
      fact,
      journal,
      result: p.result,
      participationBefore: state(p).participation,
      participationAfter: await query(
        p,
        "SELECT * FROM points_rule_versions WHERE rule_id='accrual.participation' ORDER BY version",
      ),
    });
  },
);
Given('"accrual.starter-bonus" is deactivated', async ({ points: p }) => {
  const own = state(p);
  own.api = await bootPointsStarterApi(p);
  own.actorSub = own.api.actorSub;
  const users = await query(p, "SELECT id FROM users WHERE zitadel_sub=$1", [
    own.actorSub,
  ]);
  expect(users).toHaveLength(1);
  own.actorId = users[0]!.id;
  const at = new Date();
  const active = (
    await p.rules.candidatesFor("person.starter-bonus-eligible", at)
  ).filter(
    (c) =>
      c.rule.active &&
      (c.rule.validFrom === null ||
        Date.parse(String(c.rule.validFrom)) <= +at) &&
      (c.rule.validUntil === null ||
        Date.parse(String(c.rule.validUntil)) > +at),
  );
  expect(active.map((c) => ({ ruleId: c.ruleId, version: c.version }))).toEqual(
    [
      {
        ruleId: "accrual.starter-bonus",
        version: p.seedVersions.get("accrual.starter-bonus"),
      },
    ],
  );
  receipt(p, "exact-active-starter-catalog", { active });
  await publish(p, "accrual.starter-bonus");
  expect(
    (
      await p.rules.candidatesFor("person.starter-bonus-eligible", new Date())
    ).filter((c) => c.rule.active),
  ).toEqual([]);
});
async function refusalSnapshot(p: PointsWorld) {
  return {
    financial: await completePointsSnapshot(p.handle.pool),
    audits: await query(p, "SELECT * FROM audit_ledger ORDER BY id"),
  };
}
When("an admin runs the starter-bonus grant", async ({ points: p }) => {
  const own = state(p);
  own.refusalBefore = await refusalSnapshot(p);
  own.response = await own.api!.runRaw({
    registeredBefore: new Date().toISOString(),
    reason: "025 inactive starter original " + randomUUID(),
  });
});
Then(
  'the run is refused with problem "points-starter-bonus-no-rule" and no fact is recorded',
  async ({ points: p }) => {
    const own = state(p),
      response = own.response!;
    expect(response.statusCode, response.payload).toBe(422);
    expect(response.json()).toMatchObject({
      errorCode: "POINTS_STARTER_BONUS_NO_RULE",
      type: expect.stringMatching(/\/points-starter-bonus-no-rule$/),
    });
    const after = await refusalSnapshot(p);
    expect(after).toEqual(own.refusalBefore);
    receipt(p, "starter-refusal-without-run-fact-audit", {
      status: response.statusCode,
      problem: response.json(),
      before: own.refusalBefore,
      after,
    });
  },
);
