import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mock } from "node:test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  pointsOperation,
  prepareDoctor,
  type PointsWorld,
  type EngineFact,
  type EngineResult,
} from "../lib/points-engine-originals.js";
import { bootPointsStarterApi } from "../lib/points-starter-original.js";
import { test } from "./points-engine-originals.steps.js";
import { fund, pricedEvent } from "./points-reserve-boundaries.steps.js";

const { Given, When, Then, Before, After } = createBdd(test);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const apiRequire = createRequire(resolve(root, "apps/api/package.json"));
const load = (name: string) =>
  import(pathToFileURL(resolve(root, "apps/api/dist", name)).href);
interface State {
  event?: string;
  registration?: EngineFact;
  reservePostings?: { id: string; amount: number; denomination: string }[];
  sweepAt?: Date;
  late?: EngineFact;
  lateResult?: EngineResult;
  campaign?: {
    year: number;
    realNow: string;
    publishedAt: string;
    publications: unknown[];
  };
  campaignResults?: { fact: EngineFact; answer: EngineResult }[];
  f?: string;
  g?: string;
  cutoff?: string;
  reason?: string;
  http?: Awaited<ReturnType<typeof bootPointsStarterApi>>;
  grant?: Record<string, unknown>;
  gBefore?: unknown[];
  again?: Record<string, unknown>;
  beforeRerun?: unknown[];
}
const states = new WeakMap<PointsWorld, State>();
function state(points: PointsWorld) {
  let value = states.get(points);
  if (!value) {
    value = {};
    states.set(points, value);
  }
  return value;
}
function receipt(points: PointsWorld, kind: string, data: unknown) {
  pointsOperation(
    "LIFECYCLE " +
      JSON.stringify({
        title: test.info().title,
        personId: points.personId,
        kind,
        data,
      }),
  );
}
async function hold(points: PointsWorld) {
  return (
    await points.handle.pool.query(
      "SELECT state,price,balance_part FROM points_reserves WHERE registration_id=$1",
      [state(points).registration!.attributes.registrationId],
    )
  ).rows[0];
}
async function debt(points: PointsWorld) {
  return (
    await points.handle.pool.query(
      "SELECT state,opened,netted,remaining FROM points_obligations WHERE registration_id=$1",
      [state(points).registration!.attributes.registrationId],
    )
  ).rows[0];
}
async function ownPostings(points: PointsWorld, eventId: string) {
  return (
    await points.handle.pool.query(
      "SELECT id,leg,denomination,amount,rule_id,rule_version,reverses_posting_id,occurred_at FROM points_postings WHERE event_id=$1 ORDER BY leg",
      [eventId],
    )
  ).rows;
}
async function journal(points: PointsWorld, eventId: string) {
  const rows = (
    await points.handle.pool.query(
      "SELECT type,person_id,ref_id AS ref,occurred_at,outcome,trace FROM points_facts WHERE event_id=$1",
      [eventId],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

Before("@points-lifecycle-boundaries", async ({ points }) => {
  points.ruleBookTouched = true;
});
After("@points-lifecycle-boundaries", async ({ points }) => {
  mock.timers.reset();
  await state(points).http?.close();
});
Given(
  '"A" holds a reserve with an advance on event "E2"',
  async ({ points }) => {
    await fund(points, 20);
    const own = state(points);
    own.event = await pricedEvent(points, 50, false, "advance");
    await points.handle.pool.query(
      "UPDATE events SET starts_at=$2 WHERE id=$1",
      [own.event, new Date(Date.now() - 26 * 3600_000)],
    );
    own.registration = points.registrationFact({
      registrationId: randomUUID(),
      personId: points.personId,
      itemRef: own.event,
      occurredAt: new Date(),
    });
    const answer = await points.engine.record(own.registration);
    expect(answer.outcome).toBe("applied");
    expect(await hold(points)).toEqual({
      state: "held",
      price: 50,
      balance_part: 20,
    });
    expect(await debt(points)).toEqual({
      state: "open",
      opened: 30,
      netted: 0,
      remaining: 30,
    });
    const rows = await ownPostings(
      points,
      own.registration.eventId + "#spend.reserve",
    );
    expect(rows.map((r) => r.amount).sort()).toEqual([20, 30]);
    own.reservePostings = rows;
    receipt(points, "advance-reserve", {
      registration: own.registration,
      hold: await hold(points),
      debt: await debt(points),
      postings: rows,
    });
  },
);
When(
  '"E2" ends and the 24-hour no-show window passes without "attendance.confirmed" for "A"',
  async ({ points }) => {
    const own = state(points);
    await points.handle.pool.query(
      "UPDATE events SET state='ended' WHERE id=$1",
      [own.event],
    );
    expect(
      (
        await points.handle.pool.query(
          "SELECT event_id FROM points_facts WHERE person_id=$1 AND ref_id=$2 AND type='attendance.confirmed'",
          [points.personId, own.event],
        )
      ).rows,
    ).toEqual([]);
    const { PointsNoShowSweep } = await load("points/points-no-show.sweep.js");
    const { SchedulerRegistry } = apiRequire("@nestjs/schedule");
    own.sweepAt = new Date();
    const sweep = new PointsNoShowSweep(
      points.handle.db,
      points.engine,
      points.rules,
      new SchedulerRegistry(),
    );
    expect(await sweep.runOnce(own.sweepAt)).toBeGreaterThanOrEqual(1);
    receipt(points, "no-show-sweep", {
      at: own.sweepAt.toISOString(),
      eventId: own.event,
      registrationId: own.registration!.attributes.registrationId,
    });
  },
);
Then(
  'the no-show sweep records "registration.no-show" and the hold is released by compensating postings',
  async ({ points }) => {
    const own = state(points),
      eventId = "no-show:" + own.registration!.attributes.registrationId;
    expect(await journal(points, eventId)).toMatchObject({
      type: "registration.no-show",
      person_id: points.personId,
      ref: own.event,
      outcome: "applied",
      occurred_at: own.sweepAt,
    });
    expect((await hold(points)).state).toBe("released");
    const reversals = await ownPostings(points, eventId + "#spend.release");
    expect(
      reversals
        .map((r) => ({
          target: r.reverses_posting_id,
          amount: r.amount,
          denomination: r.denomination,
        }))
        .sort((a, b) => String(a.target).localeCompare(String(b.target))),
    ).toEqual(
      own
        .reservePostings!.map((r) => ({
          target: r.id,
          amount: r.amount,
          denomination: r.denomination,
        }))
        .sort((a, b) => a.target.localeCompare(b.target)),
    );
    receipt(points, "compensation", {
      eventId,
      journal: await journal(points, eventId),
      reversals,
    });
  },
);
Then("the advance and its obligation are annulled", async ({ points }) => {
  expect(await debt(points)).toEqual({
    state: "annulled",
    opened: 30,
    netted: 0,
    remaining: 0,
  });
  expect(await points.ledger.readPersonAccount(points.personId)).toMatchObject({
    pul: { unit: "Pul", available: 20, reserved: 0 },
    advance: { open: 0, remaining: 0 },
  });
  receipt(points, "annulment", {
    debt: await debt(points),
    account: await points.ledger.readPersonAccount(points.personId),
  });
});
Then("no participation award is posted", async ({ points }) => {
  const rows = (
    await points.handle.pool.query(
      "SELECT p.id FROM points_postings p JOIN points_accounts a ON a.id=p.credit_account_id WHERE a.subject_id=$1 AND p.rule_id='accrual.participation'",
      [points.personId],
    )
  ).rows;
  expect(rows).toEqual([]);
  receipt(points, "no-participation-before-late", { rows });
});
When(
  '"attendance.confirmed" for "A" on "E2" arrives late',
  async ({ points }) => {
    const own = state(points);
    own.late = {
      type: "attendance.confirmed",
      eventId: "points-late:" + randomUUID(),
      personId: points.personId,
      ref: own.event!,
      occurredAt: new Date(),
      attributes: {
        registrationId: own.registration!.attributes.registrationId,
        presenceSharePercent: 80,
      },
    };
    own.lateResult = await points.engine.record(own.late);
  },
);
Then(
  'nothing is settled, the trace reads "no-open-hold" and the participation award is posted as late',
  async ({ points }) => {
    const own = state(points);
    expect(own.lateResult!.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "spend.settle",
          verdict: "no-open-hold",
        }),
      ]),
    );
    expect(own.lateResult!.applied.map((r) => r.ruleId)).toEqual([
      "accrual.participation",
    ]);
    expect(
      await ownPostings(points, own.late!.eventId + "#spend.settle"),
    ).toEqual([]);
    const rows = await ownPostings(
      points,
      own.late!.eventId + "#accrual.participation",
    );
    expect(
      rows
        .map((r) => ({ denomination: r.denomination, amount: r.amount }))
        .sort((a, b) => a.denomination.localeCompare(b.denomination)),
    ).toEqual([
      { denomination: "bre", amount: 2 },
      { denomination: "con", amount: 1 },
    ]);
    expect((await hold(points)).state).toBe("released");
    expect((await debt(points)).remaining).toBe(0);
    expect(own.late!.occurredAt.getTime()).toBeGreaterThanOrEqual(
      own.sweepAt!.getTime(),
    );
    expect(await journal(points, own.late!.eventId)).toMatchObject({
      type: "attendance.confirmed",
      ref: own.event,
      outcome: "applied",
      trace: own.lateResult!.trace,
    });
    receipt(points, "late-participation", {
      fact: own.late,
      result: own.lateResult,
      journal: await journal(points, own.late!.eventId),
      postings: rows,
      hold: await hold(points),
      debt: await debt(points),
    });
  },
);

Given(
  'rules "campaign.lesson.double" of priority 10 and "campaign.lesson.bonus" of priority 5 share an exclusive group on "lesson.completed"',
  async ({ points }) => {
    const own = state(points);
    const realNow = new Date();
    const year = realNow.getUTCFullYear() - 1;
    const publishedAt = new Date(Date.UTC(year, 10, 1)).toISOString();
    own.campaign = {
      year,
      realNow: realNow.toISOString(),
      publishedAt,
      publications: [],
    };
    own.campaignResults = [];
    const admin = randomUUID(),
      actorSub = "points-campaign-admin:" + admin;
    points.ruleBookTouched = true;
    await points.handle.pool.query(
      "INSERT INTO users(id,zitadel_sub,email,role)VALUES($1,$2,$3,'admin')",
      [admin, actorSub, admin + "@points-campaign.invalid"],
    );
    try {
      mock.timers.enable({ apis: ["Date"], now: new Date(publishedAt) });
      for (const [ruleId, priority, pul] of [
        ["campaign.lesson.double", 10, 20],
        ["campaign.lesson.bonus", 5, 5],
      ] as const) {
        const parameters = {
          kind: "rule",
          label: ruleId,
          trigger: ["lesson.completed"],
          condition: { eq: [{ attr: "mode" }, "online"] },
          effect: {
            kind: "credit",
            beneficiary: "subject",
            amounts: { pul, bre: 0, con: 0 },
          },
          limits: [{ oncePer: ["subject", "ref"] }],
          validFrom: ruleId.endsWith("double") ? publishedAt : null,
          validUntil: ruleId.endsWith("double")
            ? new Date(Date.UTC(year, 11, 1)).toISOString()
            : null,
          active: true,
          stacking: { priority, exclusiveGroup: "campaign.lesson" },
        };
        const result = await points.rules.publish({
          ruleId,
          parameters,
          actorSub,
        });
        points.ownedRules.push({ ruleId, parameters, actorSub });
        expect(result.row.effectiveFrom.toISOString()).toBe(publishedAt);
        expect(result.row.parameters).toEqual(parameters);
        const stored = (
          await points.handle.pool.query(
            "SELECT rule_id,version,parameters,effective_from,published_by FROM points_rule_versions WHERE rule_id=$1 ORDER BY version DESC LIMIT 1",
            [ruleId],
          )
        ).rows;
        expect(stored).toEqual([
          {
            rule_id: ruleId,
            version: result.row.version,
            parameters,
            effective_from: new Date(publishedAt),
            published_by: admin,
          },
        ]);
        own.campaign.publications.push(result.row);
      }
    } finally {
      mock.timers.reset();
    }
    receipt(points, "campaign-published", own.campaign);
  },
);
Given(
  '"campaign.lesson.double" is valid only during November',
  async ({ points }) => {
    const campaign = state(points).campaign!;
    const rows = (
      await points.handle.pool.query(
        "SELECT parameters FROM points_rule_versions WHERE rule_id='campaign.lesson.double' ORDER BY version DESC LIMIT 1",
      )
    ).rows;
    expect(rows[0]!.parameters).toMatchObject({
      validFrom: new Date(Date.UTC(campaign.year, 10, 1)).toISOString(),
      validUntil: new Date(Date.UTC(campaign.year, 11, 1)).toISOString(),
      stacking: { priority: 10, exclusiveGroup: "campaign.lesson" },
    });
  },
);
async function campaignFact(points: PointsWorld, label: string, month: number) {
  const own = state(points),
    at = new Date(Date.UTC(own.campaign!.year, month, 15));
  const fact: EngineFact = {
    type: "lesson.completed",
    eventId: "points-campaign:" + randomUUID(),
    personId: points.personId,
    ref: label,
    occurredAt: at,
    attributes: { mode: "online" },
  };
  let answer: EngineResult;
  try {
    mock.timers.enable({ apis: ["Date"], now: at });
    answer = await points.engine.record(fact);
  } finally {
    mock.timers.reset();
  }
  own.campaignResults!.push({ fact, answer });
  receipt(points, "campaign-recorded", {
    observedAppNow: at.toISOString(),
    fact,
    answer,
  });
}
When(
  '"lesson.completed" for "A" on lesson "L6" is recorded in November',
  async ({ points }) => campaignFact(points, "L6", 10),
);
When(
  '"lesson.completed" for "A" on lesson "L7" is recorded in December',
  async ({ points }) => campaignFact(points, "L7", 11),
);
async function campaignVerdict(points: PointsWorld, first: boolean) {
  const { fact, answer } = state(points).campaignResults!.at(-1)!;
  const winner = first ? "campaign.lesson.double" : "campaign.lesson.bonus",
    loser = first ? "campaign.lesson.bonus" : "campaign.lesson.double";
  expect(answer.trace).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ruleId: winner, verdict: "applied" }),
      expect.objectContaining({
        ruleId: loser,
        verdict: first ? "superseded" : "not-valid",
      }),
    ]),
  );
  const rows = await ownPostings(points, fact.eventId + "#" + winner);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    rule_id: winner,
    denomination: "pul",
    amount: first ? 20 : 5,
    occurred_at: fact.occurredAt,
  });
  expect(await ownPostings(points, fact.eventId + "#" + loser)).toEqual([]);
  const stored = await journal(points, fact.eventId);
  expect(stored.trace).toEqual(answer.trace);
  expect(stored.occurred_at).toEqual(fact.occurredAt);
  receipt(points, "campaign-verified", {
    fact,
    journal: stored,
    postings: rows,
  });
}
Then(
  '"campaign.lesson.double" applies and "campaign.lesson.bonus" is traced "superseded"',
  async ({ points }) => campaignVerdict(points, true),
);
Then(
  '"campaign.lesson.double" is traced "not-valid" and "campaign.lesson.bonus" applies',
  async ({ points }) => campaignVerdict(points, false),
);

Given(
  'doctors "F" and "G" registered before the engine and "F" never received the registration grant',
  async ({ points }) => {
    const own = state(points);
    own.f = randomUUID();
    own.g = randomUUID();
    own.cutoff = "2026-02-01T00:00:00.000Z";
    for (const id of [own.f, own.g]) {
      await prepareDoctor(points, id);
      await points.handle.pool.query(
        "UPDATE users SET created_at=$2, role='doctor_guest' WHERE id=$1",
        [id, "2026-01-15T00:00:00.000Z"],
      );
    }
    expect(
      await points.handle.pool
        .query("SELECT id FROM points_postings WHERE event_id LIKE $1", [
          "%" + own.f + "%",
        ])
        .then((r) => r.rows),
    ).toEqual([]);
    const grants = (
      await points.handle.pool.query(
        "SELECT p.id FROM points_postings p JOIN points_accounts a ON a.id=p.credit_account_id WHERE a.subject_id=$1 AND p.rule_id IN('accrual.registration','accrual.starter-bonus')",
        [own.f],
      )
    ).rows;
    expect(grants).toEqual([]);
    receipt(points, "legacy-doctors", {
      f: own.f,
      g: own.g,
      cutoff: own.cutoff,
      registeredAt: "2026-01-15T00:00:00.000Z",
      fPriorGrant: grants,
    });
  },
);
Given('"G" already received the registration grant', async ({ points }) => {
  const own = state(points);
  await points.engine.record({
    type: "account.registered",
    eventId: "points-old-registered:" + randomUUID(),
    personId: own.g!,
    occurredAt: new Date(),
    attributes: {},
  });
  own.gBefore = (
    await points.handle.pool.query(
      "SELECT p.* FROM points_postings p JOIN points_accounts a ON a.id=p.credit_account_id WHERE a.subject_id=$1 ORDER BY p.id",
      [own.g],
    )
  ).rows;
  expect(own.gBefore).toEqual([
    expect.objectContaining({
      rule_id: "accrual.registration",
      denomination: "pul",
      amount: 20,
    }),
  ]);
});
When(
  "an admin runs the starter-bonus grant with a reason and an instant after both registrations",
  async ({ points }) => {
    const own = state(points);
    own.http = await bootPointsStarterApi(points);
    own.reason = "025 original " + randomUUID();
    own.grant = await own.http.run({
      registeredBefore: own.cutoff!,
      reason: own.reason,
    });
    receipt(points, "starter-http", {
      actorSub: own.http.actorSub,
      reason: own.reason,
      registeredBefore: own.cutoff,
      result: own.grant,
      boundary:
        "actual-HTTP-controller-and-guard; externalIdP/factor setup only",
    });
  },
);
Then(
  '"F" receives 20 Pul under rule "accrual.starter-bonus" and "G" receives nothing',
  async ({ points }) => {
    const own = state(points);
    const f = (
      await points.handle.pool.query(
        "SELECT p.rule_id,p.denomination,p.amount FROM points_postings p JOIN points_accounts a ON a.id=p.credit_account_id WHERE a.subject_id=$1 ORDER BY p.rule_id",
        [own.f],
      )
    ).rows;
    expect(f).toEqual([
      { rule_id: "accrual.starter-bonus", denomination: "pul", amount: 20 },
    ]);
    expect(
      (
        await points.handle.pool.query(
          "SELECT p.* FROM points_postings p JOIN points_accounts a ON a.id=p.credit_account_id WHERE a.subject_id=$1 ORDER BY p.id",
          [own.g],
        )
      ).rows,
    ).toEqual(own.gBefore);
    expect(own.grant).toMatchObject({
      applied: 1,
      duplicate: 1,
      noEffect: 0,
      skipped: 0,
    });
    for (const [person, outcome] of [
      [own.f, "applied"],
      [own.g, "duplicate"],
    ]) {
      expect(
        (
          await points.handle.pool.query(
            "SELECT person_id,type,outcome,attributes FROM points_facts WHERE event_id=$1",
            ["starter-bonus:" + person],
          )
        ).rows,
      ).toEqual([
        {
          person_id: person,
          type: "person.starter-bonus-eligible",
          outcome,
          attributes: { runId: own.grant!.runId },
        },
      ]);
    }
    receipt(points, "starter-postings", {
      f,
      grant: own.grant,
      gUnchanged: true,
    });
  },
);
Then(
  "audit records name the admin, the reason, the instant and the counts",
  async ({ points }) => {
    const own = state(points),
      run = own.grant!;
    const audits = (
      await points.handle.pool.query(
        "SELECT event_type,subject_id,metadata FROM audit_ledger WHERE event_type LIKE 'points.starter-bonus.%' AND metadata->>'runId'=$1 ORDER BY created_at,event_type DESC",
        [run.runId],
      )
    ).rows;
    expect(audits).toEqual([
      {
        event_type: "points.starter-bonus.started",
        subject_id: own.http!.actorSub,
        metadata: {
          runId: run.runId,
          reason: own.reason,
          registeredBefore: own.cutoff,
        },
      },
      {
        event_type: "points.starter-bonus.completed",
        subject_id: own.http!.actorSub,
        metadata: {
          runId: run.runId,
          applied: 1,
          duplicate: 1,
          noEffect: 0,
          skipped: 0,
        },
      },
    ]);
    receipt(points, "starter-audit", { audits });
  },
);

When("the admin runs the grant again", async ({ points }) => {
  const own = state(points);
  own.beforeRerun = (
    await points.handle.pool.query("SELECT * FROM points_postings ORDER BY id")
  ).rows;
  own.again = await own.http!.run({
    registeredBefore: own.cutoff!,
    reason: own.reason! + " rerun",
  });
});
Then(
  'every doctor answers "duplicate" and no posting is written',
  async ({ points }) => {
    const own = state(points);
    expect(own.again).toMatchObject({
      applied: 0,
      duplicate: 2,
      noEffect: 0,
      skipped: 0,
    });
    expect(
      (
        await points.handle.pool.query(
          "SELECT * FROM points_postings ORDER BY id",
        )
      ).rows,
    ).toEqual(own.beforeRerun);
    receipt(points, "starter-rerun", {
      again: own.again,
      postingsUnchanged: true,
      eligibleDoctorIds: [own.f, own.g],
    });
  },
);
