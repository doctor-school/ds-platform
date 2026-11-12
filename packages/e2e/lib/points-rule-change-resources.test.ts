import { expect, it } from "vitest";
import {
  assertPointsRuleChangeResources,
  pointsRuleChanges,
  type RuleChangeResource,
} from "./points-engine-report.js";
import type { SeedChange } from "./points-rule-history.js";
const seeds: SeedChange[] = [
  {
    ruleId: "accrual.lesson",
    version: 2,
    body: {
      kind: "rule",
      trigger: ["lesson.completed"],
      effect: { amounts: { pul: 10 } },
    },
    changedBody: {
      kind: "rule",
      trigger: ["lesson.completed"],
      effect: { amounts: { pul: 15 } },
    },
  },
  {
    ruleId: "setting.presence.share",
    version: 1,
    body: { kind: "setting", value: 30 },
    changedBody: { kind: "setting", value: 50 },
  },
  {
    ruleId: "accrual.starter-bonus",
    version: 1,
    body: {
      kind: "rule",
      trigger: ["person.starter-bonus-eligible"],
      active: true,
    },
    changedBody: {
      kind: "rule",
      trigger: ["person.starter-bonus-eligible"],
      active: false,
    },
  },
];
function resources(): RuleChangeResource[] {
  return seeds.map((seed, index) => {
    const stored = (
      version: number,
      parameters: Record<string, unknown>,
      actor: string | null,
    ) => ({
      rule_id: seed.ruleId,
      version,
      parameters,
      published_by: actor,
      kind: String(parameters.kind),
      trigger_fact_types: (parameters.trigger ?? []) as string[],
      effective_from: actor
        ? "2026-11-12T00:00:00.001Z"
        : new Date(0).toISOString(),
    });
    const initial = stored(seed.version, seed.body, null);
    const publications = [seed.changedBody, seed.body].map((body, i) => ({
      row: stored(seed.version + i + 1, body, "admin-id"),
      startedAt: "2026-11-12T00:00:00.000Z",
      finishedAt: "2026-11-12T00:00:00.010Z",
      audit: {
        id: String(i),
        event_type: "data.points_rule_versions.insert",
        subject_id: null,
        metadata: {
          table: "points_rule_versions",
          source: "db-direct",
          pk: { rule_id: seed.ruleId, version: seed.version + i + 1 },
          diff: {
            parameters: { new: body },
            published_by: { new: "admin-id" },
          },
        },
      },
    }));
    const financial = {
      accounts: [],
      journal: [],
      postings: [],
      keys: [],
      holds: [],
      obligations: [],
    };
    const eventIds = index === 1 ? ["owned-event"] : [];
    return {
      title: pointsRuleChanges[index]!,
      personId: "person-id",
      applicationName: "points-ds_dev_3989-case" + index,
      database: "ds_dev_3989",
      eventIds,
      history: {
        ruleId: seed.ruleId,
        actorId: "admin-id",
        actorSub: "admin-sub",
        actor: { id: "admin-id", zitadel_sub: "admin-sub", role: "admin" },
        before: { rules: [initial], audits: [] },
        after: {
          rules: [initial, ...publications.map((p) => p.row)],
          audits: publications.map((p) => p.audit),
        },
        publications,
        financialBefore: financial,
        financialAfter: structuredClone(financial),
        pricesBefore: [],
        pricesAfter: [],
      },
      cleanup: {
        financialBefore: financial,
        financialAfter: structuredClone(financial),
        pricesBefore: [],
        pricesAfter: [],
        events: eventIds.map((id) => ({
          id,
          record_status: "retired",
          deleted_at: "2026-11-12T00:00:00Z",
        })),
      },
    };
  });
}
const log = (rows: unknown[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n");
it("EARS-25/27/39/42/43: requires the exact-three restored rule resources", () => {
  expect(() =>
    assertPointsRuleChangeResources(log(resources()), seeds),
  ).not.toThrow();
});
it("EARS-25/27/39/42/43: refuses missing, duplicate and unknown receipts", () => {
  const rows = resources();
  for (const invalid of [
    [],
    rows.slice(1),
    [...rows, rows[0]],
    [rows[0], rows[0], rows[2]],
    [{ ...rows[0], title: "foreign" }, ...rows.slice(1)],
  ])
    expect(() =>
      assertPointsRuleChangeResources(log(invalid), seeds),
    ).toThrow();
});
it("EARS-25/27/39/42/43: refuses wrong runtime, rule, actor and active-event identity", () => {
  const mutations = [
    (rows: RuleChangeResource[]) => {
      rows[0]!.database = "ds_test";
    },
    (rows: RuleChangeResource[]) => {
      rows[0]!.applicationName = "foreign";
    },
    (rows: RuleChangeResource[]) => {
      rows[0]!.history.ruleId = "foreign";
    },
    (rows: RuleChangeResource[]) => {
      rows[0]!.history.actorSub = "wrong-sub";
    },
    (rows: RuleChangeResource[]) => {
      rows[1]!.cleanup.events[0]!.record_status = "published";
    },
    (rows: RuleChangeResource[]) => {
      rows[1]!.cleanup.events[0]!.id = "foreign";
    },
    (rows: RuleChangeResource[]) => {
      rows[1]!.eventIds = [];
    },
  ];
  for (const mutate of mutations) {
    const rows = resources();
    mutate(rows);
    expect(() => assertPointsRuleChangeResources(log(rows), seeds)).toThrow();
  }
});
it("EARS-25/27/39/42/43: refuses altered old history and missing restoration/default body", () => {
  const mutations = [
    (rows: RuleChangeResource[]) => {
      rows[0]!.history.after.rules[0] = {
        ...rows[0]!.history.after.rules[0]!,
        version: 999,
      };
    },
    (rows: RuleChangeResource[]) => {
      rows[0]!.history.publications.pop();
    },
    (rows: RuleChangeResource[]) => {
      rows[0]!.history.publications[1]!.row.parameters = seeds[0]!.changedBody;
    },
  ];
  for (const mutate of mutations) {
    const rows = resources();
    mutate(rows);
    expect(() => assertPointsRuleChangeResources(log(rows), seeds)).toThrow();
  }
});
it("EARS-27/42: refuses changed financial cleanup or prices", () => {
  for (const key of [
    "accounts",
    "journal",
    "postings",
    "keys",
    "holds",
    "obligations",
  ]) {
    const rows = resources();
    rows[1]!.cleanup.financialAfter[key] = [{ changed: true }];
    expect(() => assertPointsRuleChangeResources(log(rows), seeds)).toThrow(
      /financial/,
    );
  }
  const rows = resources();
  rows[0]!.cleanup.pricesAfter.push({ changed: true });
  expect(() => assertPointsRuleChangeResources(log(rows), seeds)).toThrow(
    /prices/,
  );
});
