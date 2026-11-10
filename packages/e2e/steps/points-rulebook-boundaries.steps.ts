import { createHash, randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  pointsOperation,
  postings,
  type PointsWorld,
  type RulePublication,
} from "../lib/points-engine-originals.js";
import { test } from "./points-engine-originals.steps.js";
import { unpricedEvent } from "./points-reserve-boundaries.steps.js";

const { When, Then } = createBdd(test);
interface State {
  adminId: string;
  actorSub: string;
  publication?: RulePublication;
  before?: { rules: unknown[]; audits: unknown[] };
  problem?:
    | {
        problem: string;
        fieldErrors?: { path: string; message: string }[];
        errorCode: string;
      }
    | undefined;
  expectedPath?: string | undefined;
}
const states = new WeakMap<PointsWorld, State>();
function receipt(
  points: PointsWorld,
  kind: string,
  data: Record<string, unknown>,
) {
  pointsOperation(
    "RULEBOOK " +
      JSON.stringify({
        title: test.info().title,
        personId: points.personId,
        kind,
        ...data,
      }),
  );
}
async function state(points: PointsWorld): Promise<State> {
  let own = states.get(points);
  if (own) return own;
  points.ruleBookTouched = true;
  const adminId = randomUUID();
  const actorSub = `points-rulebook-admin:${adminId}`;
  await points.handle.pool.query(
    "INSERT INTO users (id,zitadel_sub,email,role) VALUES ($1,$2,$3,'admin')",
    [adminId, actorSub, `${adminId}@points-rulebook.invalid`],
  );
  expect(
    (
      await points.handle.pool.query(
        "SELECT id,zitadel_sub,role FROM users WHERE id=$1",
        [adminId],
      )
    ).rows,
  ).toEqual([{ id: adminId, zitadel_sub: actorSub, role: "admin" }]);
  own = { adminId, actorSub };
  states.set(points, own);
  receipt(points, "preauthorized-admin-fixture", {
    adminId,
    actorSub,
    boundary: "direct-service",
    authorizationAcceptance: false,
  });
  return own;
}
function body(trigger: string) {
  return {
    kind: "rule",
    label: "025 original owned reward",
    trigger: [trigger],
    effect: {
      kind: "credit",
      beneficiary: "subject",
      amounts: { pul: 0, bre: 2, con: 0 },
    },
    limits: [{ oncePer: ["subject", "ref"] }],
    validFrom: null,
    validUntil: null,
    active: true,
    stacking: { priority: 0, exclusiveGroup: null },
  };
}
async function snapshot(points: PointsWorld) {
  return {
    rules: (
      await points.handle.pool.query(
        "SELECT * FROM points_rule_versions ORDER BY rule_id, version",
      )
    ).rows,
    audits: (
      await points.handle.pool.query(
        "SELECT * FROM audit_ledger WHERE event_type LIKE 'data.points_rule_versions.%' ORDER BY id",
      )
    ).rows,
  };
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function publish(
  points: PointsWorld,
  ruleId: string,
  parameters: Record<string, unknown>,
) {
  const own = await state(points);
  const input = { ruleId, parameters, actorSub: own.actorSub };
  const before = new Date();
  const publication = await points.rules.publish(input);
  // Register ownership immediately after success, before any assertion (025 EARS-25).
  points.ownedRules.push(input);
  own.publication = publication;
  expect(publication.row).toMatchObject({
    ruleId,
    version: 1,
    kind: "rule",
    parameters,
    triggerFactTypes: parameters.trigger,
    publishedBy: own.adminId,
  });
  expect(publication.row.effectiveFrom.getTime()).toBeGreaterThanOrEqual(
    before.getTime(),
  );
  expect(publication.row.effectiveFrom.getTime()).toBeLessThanOrEqual(
    Date.now(),
  );
  const stored = (
    await points.handle.pool.query(
      "SELECT rule_id, version, kind, parameters, trigger_fact_types, effective_from, published_by FROM points_rule_versions WHERE rule_id=$1 ORDER BY version",
      [ruleId],
    )
  ).rows;
  expect(stored).toEqual([
    {
      rule_id: ruleId,
      version: 1,
      kind: "rule",
      parameters,
      trigger_fact_types: parameters.trigger,
      effective_from: publication.row.effectiveFrom,
      published_by: own.adminId,
    },
  ]);
  const audits = (
    await points.handle.pool.query(
      `SELECT subject_id, event_type, metadata FROM audit_ledger
     WHERE event_type='data.points_rule_versions.insert' AND metadata->'pk'->>'rule_id'=$1 AND metadata->'pk'->>'version'='1'`,
      [ruleId],
    )
  ).rows;
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    subject_id: null,
    event_type: "data.points_rule_versions.insert",
    metadata: { source: "db-direct" },
  });
  receipt(points, "published-version", {
    stored,
    audits,
    warnings: publication.warnings,
  });
}
async function reject(
  points: PointsWorld,
  parameters: Record<string, unknown>,
  expectedPath?: string,
  ruleId = `e2e.original.invalid.${randomUUID()}`,
) {
  const own = await state(points);
  own.before = await snapshot(points);
  own.expectedPath = expectedPath;
  own.problem = undefined;
  try {
    await points.rules.publish({ ruleId, parameters, actorSub: own.actorSub });
    if (ruleId.startsWith("e2e.original.invalid.")) {
      points.ownedRules.push({ ruleId, parameters, actorSub: own.actorSub });
    }
  } catch (error) {
    own.problem = error as State["problem"];
  }
  expect(own.problem).toBeTruthy();
}
async function assertRejected(points: PointsWorld, problem: string) {
  const own = await state(points);
  expect(own.problem?.problem).toBe(problem);
  if (own.expectedPath)
    expect(own.problem?.fieldErrors?.map((issue) => issue.path)).toEqual([
      own.expectedPath,
    ]);
  const after = await snapshot(points);
  expect(after).toEqual(own.before);
  receipt(points, "publish-refused-without-write", {
    problem: own.problem?.problem,
    errorCode: own.problem?.errorCode,
    fieldErrors: own.problem?.fieldErrors ?? [],
    beforeSha256: hash(own.before),
    afterSha256: hash(after),
    rules: after.rules.length,
    audits: after.audits.length,
    unchanged: true,
  });
}

When(
  'an admin publishes the new rule "accrual.webinar-feedback" crediting 2 Bre on "event.rated" once per subject and ref',
  async ({ points }) => {
    await state(points);
    const existing = (
      await points.handle.pool.query(
        "SELECT version FROM points_rule_versions WHERE rule_id=$1",
        ["accrual.webinar-feedback"],
      )
    ).rows;
    expect(
      existing,
      "literal version 1 requires a fresh owned database",
    ).toEqual([]);
    receipt(points, "fresh-feedback-precondition", {
      ruleId: "accrual.webinar-feedback",
      versions: existing,
    });
    await publish(points, "accrual.webinar-feedback", body("event.rated"));
  },
);
When('"event.rated" for "A" on event "E5" is recorded', async ({ points }) => {
  const fact = {
    type: "event.rated",
    eventId: `points-rulebook-rated:${randomUUID()}`,
    personId: points.personId,
    ref: await unpricedEvent(points),
    occurredAt: new Date(),
    attributes: {},
  };
  points.facts.push(fact);
  points.result = await points.engine.record(fact);
});
Then(
  'postings of rule "accrual.webinar-feedback" version 1 and of rule "accrual.rating" are both written',
  async ({ points }) => {
    const fact = points.facts[0]!;
    expect(points.result?.outcome).toBe("applied");
    const rows = await postings(points, fact.eventId);
    expect(rows).toEqual([
      {
        event_id: `${fact.eventId}#accrual.rating`,
        rule_id: "accrual.rating",
        rule_version: points.seedVersions.get("accrual.rating"),
        denomination: "bre",
        amount: 1,
      },
      {
        event_id: `${fact.eventId}#accrual.webinar-feedback`,
        rule_id: "accrual.webinar-feedback",
        rule_version: 1,
        denomination: "bre",
        amount: 2,
      },
    ]);
    const journal = (
      await points.handle.pool.query(
        "SELECT type,person_id,ref_kind,ref_id,attributes,outcome FROM points_facts WHERE event_id=$1",
        [fact.eventId],
      )
    ).rows;
    expect(journal).toEqual([
      {
        type: "event.rated",
        person_id: points.personId,
        ref_kind: "item",
        ref_id: fact.ref,
        attributes: {},
        outcome: "applied",
      },
    ]);
    receipt(points, "dual-rating-postings", {
      fact,
      journal,
      postings: rows,
      applied: points.result?.applied,
    });
  },
);
When(
  'an admin publishes a rule on "lesson.completed" whose condition reads the attribute "sponsorId"',
  async ({ points }) => {
    await reject(
      points,
      {
        ...body("lesson.completed"),
        condition: { eq: [{ attr: "sponsorId" }, "x"] },
      },
      "condition.eq.0.attr",
    );
  },
);
Then(
  'the request is refused with problem "points-rule-parameters-invalid" naming the field path',
  async ({ points }) => {
    await assertRejected(points, "points-rule-parameters-invalid");
  },
);
When(
  'an admin publishes a rule on "lesson.completed" comparing the attribute "mode" with the integer 3',
  async ({ points }) => {
    await reject(
      points,
      { ...body("lesson.completed"), condition: { eq: [{ attr: "mode" }, 3] } },
      "condition.eq",
    );
  },
);
When(
  'an admin publishes a new version of the retired rule "cap.engagement"',
  async ({ points }) => {
    await reject(points, body("lesson.completed"), undefined, "cap.engagement");
  },
);
Then(
  'the request is refused with problem "points-rule-retired"',
  async ({ points }) => {
    await assertRejected(points, "points-rule-retired");
  },
);
When(
  'an admin publishes an active credit rule on "lesson.completed" with no exclusive group',
  async ({ points }) => {
    await publish(
      points,
      `e2e.original.stacking.${randomUUID()}`,
      body("lesson.completed"),
    );
  },
);
Then(
  'the version is stored and the answer carries a stacking warning naming "accrual.lesson"',
  async ({ points }) => {
    const own = await state(points);
    expect(own.publication?.warnings).toContainEqual({
      code: "stacking",
      factType: "lesson.completed",
      otherRuleId: "accrual.lesson",
    });
    receipt(points, "stored-stacking-warning", {
      row: own.publication?.row,
      warnings: own.publication?.warnings,
    });
  },
);
