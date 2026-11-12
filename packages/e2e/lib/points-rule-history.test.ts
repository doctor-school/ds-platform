import { describe, expect, it } from "vitest";
import {
  assertSeedHistoryTransition,
  type SeedHistoryReceipt,
} from "./points-rule-history.js";

const defaultBody = { kind: "setting", value: 30 };
const changedBody = { kind: "setting", value: 50 };
const spec = {
  ruleId: "setting.presence.share",
  version: 1,
  body: defaultBody,
  changedBody,
};
function receipt(): SeedHistoryReceipt {
  const row = (
    version: number,
    parameters: Record<string, unknown>,
    published_by: string | null,
    effective_from: string,
  ) => ({
    rule_id: spec.ruleId,
    version,
    parameters,
    published_by,
    effective_from,
    kind: "setting",
    trigger_fact_types: [],
    created_at: effective_from,
  });
  const initial = row(1, defaultBody, null, new Date(0).toISOString());
  const publication = (
    version: number,
    parameters: Record<string, unknown>,
  ) => {
    const stored = row(
      version,
      parameters,
      "admin-id",
      "2026-11-12T10:00:00.001Z",
    );
    return {
      row: stored,
      audit: {
        id: String(version),
        event_type: "data.points_rule_versions.insert",
        subject_id: null,
        metadata: {
          source: "db-direct",
          table: "points_rule_versions",
          pk: { rule_id: spec.ruleId, version },
          diff: {
            parameters: { new: parameters },
            published_by: { new: "admin-id" },
          },
        },
      },
      startedAt: "2026-11-12T10:00:00.000Z",
      finishedAt: "2026-11-12T10:00:00.010Z",
    };
  };
  const publications = [
    publication(2, changedBody),
    publication(3, defaultBody),
  ];
  const snapshot = {
    accounts: [],
    journal: [],
    keys: [],
    postings: [{ amount: 10 }],
    holds: [],
    obligations: [],
  };
  return {
    ruleId: spec.ruleId,
    actorId: "admin-id",
    actorSub: "admin-sub",
    actor: { id: "admin-id", zitadel_sub: "admin-sub", role: "admin" },
    before: { rules: [initial], audits: [] },
    after: {
      rules: [initial, ...publications.map((p) => p.row)],
      audits: publications.map((p) => p.audit),
    },
    publications,
    financialBefore: snapshot,
    financialAfter: structuredClone(snapshot),
    pricesBefore: [],
    pricesAfter: [],
  };
}
describe("025 native forward seed restoration", () => {
  it("EARS-25/27/39/42: accepts exactly one native change and a forward default restoration", () => {
    expect(() => assertSeedHistoryTransition(receipt(), spec)).not.toThrow();
  });
  it("EARS-25/27/39/42: refuses mutation or loss of any old row or audit", () => {
    for (const target of ["rules", "audits"] as const) {
      const value = receipt();
      if (target === "audits") {
        value.before.audits.push({
          id: "old-audit",
          event_type: "seed",
          metadata: {},
        });
        value.after.audits.unshift({
          id: "old-audit",
          event_type: "changed",
          metadata: {},
        });
      } else
        value.after.rules[0] = {
          ...value.after.rules[0]!,
          parameters: { kind: "setting", value: 99 },
        };
      expect(() => assertSeedHistoryTransition(value, spec)).toThrow(/history/);
    }
  });
  it("EARS-25/39/42: refuses absent restoration, wrong default or an arbitrary changed body", () => {
    const absent = receipt();
    absent.publications.pop();
    absent.after.rules.pop();
    absent.after.audits.pop();
    const wrongDefault = receipt();
    wrongDefault.publications[1]!.row.parameters = changedBody;
    const wrongChange = receipt();
    wrongChange.publications[0]!.row.parameters = {
      kind: "setting",
      value: 999,
    };
    for (const value of [absent, wrongDefault, wrongChange])
      expect(() => assertSeedHistoryTransition(value, spec)).toThrow();
  });
  it("EARS-25/27/42: refuses missing, extra or duplicate publication receipts", () => {
    for (const delta of [-1, 1]) {
      const value = receipt();
      if (delta < 0) value.publications.shift();
      else value.publications.push(value.publications[0]!);
      expect(() => assertSeedHistoryTransition(value, spec)).toThrow();
    }
    const value = receipt();
    value.after.rules.push({ ...value.after.rules[2]!, version: 4 });
    expect(() => assertSeedHistoryTransition(value, spec)).toThrow(/history/);
  });
  it("EARS-25/27/42: refuses the wrong actor, identity, audit pk, version and backdating", () => {
    const mutations = [
      (v: SeedHistoryReceipt) => {
        v.actorSub = "";
      },
      (v: SeedHistoryReceipt) => {
        v.actorSub = "foreign-sub";
      },
      (v: SeedHistoryReceipt) => {
        v.ruleId = "foreign";
      },
      (v: SeedHistoryReceipt) => {
        v.publications[0]!.row.published_by = null;
      },
      (v: SeedHistoryReceipt) => {
        v.publications[0]!.row.version = 10;
      },
      (v: SeedHistoryReceipt) => {
        v.publications[0]!.audit.metadata = {
          pk: { rule_id: "foreign", version: 2 },
        };
      },
      (v: SeedHistoryReceipt) => {
        v.publications[0]!.row.effective_from = new Date(0).toISOString();
      },
    ];
    for (const mutate of mutations) {
      const value = receipt();
      mutate(value);
      expect(() => assertSeedHistoryTransition(value, spec)).toThrow();
    }
  });
  it("EARS-27/42: refuses a cleanup that changes any financial table or price", () => {
    for (const key of [
      "accounts",
      "journal",
      "keys",
      "postings",
      "holds",
      "obligations",
    ]) {
      const value = receipt();
      value.financialAfter[key] = [{ changed: true }];
      expect(() => assertSeedHistoryTransition(value, spec)).toThrow(
        /financial/,
      );
    }
    const value = receipt();
    value.pricesAfter.push({ pul_cost: 100 });
    expect(() => assertSeedHistoryTransition(value, spec)).toThrow(/prices/);
  });
});
