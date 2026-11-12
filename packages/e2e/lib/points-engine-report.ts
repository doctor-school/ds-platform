import assert from "node:assert/strict";
import { isPointsApplicationName } from "./points-application-name.js";
import { assertOperationalReport } from "../api-probes/operational-report.js";
import {
  assertSeedHistoryTransition,
  type SeedChange,
  type SeedHistoryReceipt,
} from "./points-rule-history.js";

export const pointsRecordBoundaries = [
  "The same lesson reported from two storefronts and an offline sync accrues once",
  "A closed account accepts no posting",
  "A completed module accrues all three units once",
] as const;

export const pointsReserveBoundaries = [
  "A fourth concurrent limited-seat reserve is refused",
  "A quote equals the enforced decision and writes nothing",
  "Concurrent reserves never overdraw the balance",
] as const;

export const pointsAdvanceBoundaries = [
  "Advance covers the shortfall and later earnings settle it",
  "A doctor who arrived on a medical representative's link gets the same conditions",
  "Beyond the advance cap the event behaves as threshold",
] as const;

export const pointsReferralBoundaries = [
  "Pul amounts never read as money",
  "Referral awards stop for the inviter above the monthly cap",
  "The invitee's first completed lesson counts itself for the referral",
] as const;

export const pointsRulebookBoundaries = [
  "An admin attaches a new reward to an existing fact type without a release",
  "A rule reading an undeclared or ill-typed operand is refused at publish",
  "Publishing a second stacking credit rule warns the admin",
] as const;

export const pointsLifecycleBoundaries = [
  "A no-show releases the reserve and annuls the advance",
  "Exclusive campaign rules apply only the highest priority one inside their window",
  "Doctors registered before the engine receive the starter bonus once",
] as const;

export const pointsFirstRelease = [
  "Registration to the first event",
  "Releasing a partly netted obligation returns the netted Pul",
  "Pul of a doctor without a verified phone cannot be spent",
] as const;

export const pointsRuleChanges = [
  "Re-tuning a rule applies to new postings only",
  "A setting changes a threshold without a rule version",
  "The starter-bonus grant needs an active rule",
] as const;
export function assertPointsRuleChangesReport(value: unknown): void {
  assertOperationalReport(value, pointsRuleChanges, "admin");
}

export interface RuleChangeResource {
  title: string;
  applicationName: string;
  database: string;
  personId: string;
  eventIds: string[];
  history: SeedHistoryReceipt;
  cleanup: {
    financialBefore: Record<string, unknown[]>;
    financialAfter: Record<string, unknown[]>;
    pricesBefore: unknown[];
    pricesAfter: unknown[];
    events: { id: string; record_status: string; deleted_at: string }[];
  };
}
export function assertPointsRuleChangeResources(
  log: string,
  seeds: readonly SeedChange[],
): void {
  const rows = log
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RuleChangeResource);
  assert.equal(rows.length, 3, "Missing rule-change cleanup receipt");
  const expectedIds = [
    "accrual.lesson",
    "setting.presence.share",
    "accrual.starter-bonus",
  ];
  const seen = new Set<string>();
  for (const row of rows) {
    const title = row.title.replace(/ @host:admin$/, "");
    const index = pointsRuleChanges.indexOf(
      title as (typeof pointsRuleChanges)[number],
    );
    assert(
      index >= 0 && !seen.has(title),
      "Unexpected or repeated rule-change cleanup identity",
    );
    seen.add(title);
    assert(
      ["ds_dev_3989", "ds_points_originals_3989"].includes(row.database),
      "Outside owned rule-change database",
    );
    assert(
      isPointsApplicationName(row.database, row.applicationName) &&
        row.personId,
      "Wrong rule-change runtime identity",
    );
    assert.equal(
      row.history.ruleId,
      expectedIds[index],
      "Wrong rule-change seed identity",
    );
    const seed = seeds.find((seed) => seed.ruleId === expectedIds[index]);
    assert(seed, "Missing authoritative seed contract");
    assertSeedHistoryTransition(row.history, seed);
    const cleanup = row.cleanup;
    for (const key of [
      "accounts",
      "journal",
      "keys",
      "postings",
      "holds",
      "obligations",
    ])
      assert(
        Array.isArray(cleanup.financialBefore[key]) &&
          Array.isArray(cleanup.financialAfter[key]),
        "Missing rule-change financial snapshot",
      );
    assert.deepEqual(
      cleanup.financialBefore,
      row.history.financialBefore,
      "Cleanup financial witnesses differ",
    );
    assert.deepEqual(
      cleanup.financialAfter,
      cleanup.financialBefore,
      "Event cleanup changed financial history",
    );
    assert.deepEqual(
      cleanup.pricesBefore,
      row.history.pricesBefore,
      "Cleanup price witnesses differ",
    );
    assert.deepEqual(
      cleanup.pricesAfter,
      cleanup.pricesBefore,
      "Event cleanup changed prices",
    );
    assert.equal(
      row.eventIds.length,
      index === 1 ? 1 : 0,
      "Missing/extra rule-change owned event",
    );
    assert.equal(
      new Set(row.eventIds).size,
      row.eventIds.length,
      "Repeated rule-change owned event",
    );
    assert.deepEqual(
      cleanup.events.map((event) => event.id).sort(),
      [...row.eventIds].sort(),
      "Wrong cleanup owned events",
    );
    for (const event of cleanup.events)
      assert(
        event.record_status === "retired" &&
          Number.isFinite(Date.parse(event.deleted_at)),
        "Active rule-change event leaked",
      );
  }
}

export function assertPointsEngineResources(
  log: string,
  seeds: readonly SeedChange[],
): void {
  const rows = log
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { title: string });
  const titles = rows.map((row) => row.title.replace(/ @host:admin$/, ""));
  assert.deepEqual(
    [...titles].sort(),
    [...pointsFirstRelease, ...pointsRuleChanges].sort(),
    "Missing, duplicate or unknown engine cleanup receipt",
  );
  const lines = (expected: readonly string[]) =>
    rows
      .filter((row) =>
        expected.includes(row.title.replace(/ @host:admin$/, "")),
      )
      .map((row) => JSON.stringify(row))
      .join("\n");
  assertPointsFirstReleaseResources(lines(pointsFirstRelease));
  assertPointsRuleChangeResources(lines(pointsRuleChanges), seeds);
}

export function assertPointsFirstReleaseReport(value: unknown): void {
  assertOperationalReport(value, pointsFirstRelease, "admin");
}

export function assertPointsFirstReleaseResources(log: string): void {
  const rows = log
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(
    rows.length,
    pointsFirstRelease.length,
    "Missing cleanup receipt",
  );
  const seen = new Set<string>();
  for (const row of rows) {
    const title = String(row.title).replace(/ @host:admin$/, "");
    const index = pointsFirstRelease.indexOf(
      title as (typeof pointsFirstRelease)[number],
    );
    assert(
      index >= 0 && !seen.has(title),
      "Unexpected or repeated cleanup identity",
    );
    seen.add(title);
    assert(
      row.applicationName && row.database,
      "Missing cleanup runtime identity",
    );
    assert(Array.isArray(row.eventIds), "Missing owned event identities");
    assert.equal(row.eventIds.length, [1, 3, 1][index], "Missing owned event");
    assert.equal(
      new Set(row.eventIds).size,
      row.eventIds.length,
      "Repeated owned event",
    );
    const cleanup = row.cleanup;
    assert(cleanup && Array.isArray(cleanup.events), "Missing cleanup receipt");
    assert.deepEqual(
      cleanup.events.map((event: { id: string }) => event.id).sort(),
      [...row.eventIds].sort(),
      "Cleanup event identities differ",
    );
    for (const event of cleanup.events) {
      assert.equal(
        event.record_status,
        "retired",
        "Owned event is still active",
      );
      assert(
        typeof event.deleted_at === "string" &&
          Number.isFinite(Date.parse(event.deleted_at)),
        "Owned event is not soft-deleted",
      );
    }
    for (const key of [
      "accounts",
      "journal",
      "keys",
      "postings",
      "holds",
      "obligations",
    ]) {
      assert(Array.isArray(row.snapshot?.[key]), "Missing financial snapshot");
    }
    assert.deepEqual(
      cleanup.snapshotAfter,
      row.snapshot,
      "Cleanup changed financial history",
    );
    assert(Array.isArray(cleanup.prices), "Missing prices snapshot");
    assert.deepEqual(
      cleanup.prices
        .map((price: { item_ref: string }) => price.item_ref)
        .sort(),
      [...row.eventIds].sort(),
      "Missing owned price",
    );
    assert.deepEqual(
      cleanup.pricesAfter,
      cleanup.prices,
      "Cleanup changed prices",
    );
  }
}

export const pointsEngineOriginals = [
  "An offline lesson earns Bre only and never a second Bre",
  "A producer fact carrying an amount is refused and writes nothing",
  "A fact no rule applies to is journaled with no effect",
  ...pointsRecordBoundaries,
  ...pointsReserveBoundaries,
  ...pointsAdvanceBoundaries,
  ...pointsReferralBoundaries,
  ...pointsRulebookBoundaries,
  ...pointsLifecycleBoundaries,
  ...pointsFirstRelease,
  ...pointsRuleChanges,
] as const;

export function assertPointsEngineReport(value: unknown): void {
  assertOperationalReport(value, pointsEngineOriginals, "admin");
}

export function assertPointsRecordBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsRecordBoundaries, "admin");
}

export function assertPointsReserveBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsReserveBoundaries, "admin");
}

export function assertPointsAdvanceBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsAdvanceBoundaries, "admin");
}

export function assertPointsReferralBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsReferralBoundaries, "admin");
}

export function assertPointsRulebookBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsRulebookBoundaries, "admin");
}

export function assertPointsLifecycleBoundariesReport(value: unknown): void {
  assertOperationalReport(value, pointsLifecycleBoundaries, "admin");
}

export function assertPointsBackgrounds(
  log: string,
  titles: readonly string[],
): void {
  const groups = new Map<
    string,
    { clause: string; personId: string; applicationName: string }[]
  >();
  for (const line of log.split(/\r?\n/).filter(Boolean)) {
    const entry = JSON.parse(line.replace(/^\uFEFF/, "")) as {
      command?: string;
    };
    if (!entry.command?.startsWith("BACKGROUND ")) continue;
    const row = JSON.parse(entry.command.slice(11)) as {
      title: string;
      clause: string;
      personId: string;
      applicationName: string;
      verified: boolean;
    };
    const title = row.title.replace(/ @host:admin$/, "");
    if (
      !titles.includes(title) ||
      row.verified !== true ||
      !row.personId ||
      !row.applicationName
    )
      throw new Error("Invalid Background receipt");
    const group = groups.get(title) ?? [];
    group.push(row);
    groups.set(title, group);
  }
  for (const title of titles) {
    const pair = groups.get(title);
    if (
      !pair ||
      pair.length !== 2 ||
      pair[0]!.clause !== "seed-defaults" ||
      pair[1]!.clause !== "doctor-specialty-phone" ||
      pair[0]!.personId !== pair[1]!.personId ||
      pair[0]!.applicationName !== pair[1]!.applicationName
    )
      throw new Error(
        "Missing, repeated or unordered Background receipt: " + title,
      );
  }
}
