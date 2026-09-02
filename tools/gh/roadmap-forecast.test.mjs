import assert from "node:assert/strict";
import test from "node:test";

import {
  OWNER_OVERRIDE_MARKER,
  WINDOW_DAYS,
  addDays,
  buildDateMutation,
  buildTargetFieldQuery,
  forecastDays,
  forecastFor,
  hasOwnerOverride,
  inWindow,
  isGateTitle,
  isIsoDate,
  parseArgs,
  partitionDateTargets,
  releaseMilestoneTrack,
  renderForecastComment,
  renderPlanLine,
  throughputWindow,
} from "./roadmap-forecast.mjs";

// ── argv ─────────────────────────────────────────────────────────────────────

test("parseArgs: defaults are live-mode, system today", () => {
  const o = parseArgs([]);
  assert.deepEqual(o, { help: false, dryRun: false, today: null, error: null });
});

test("parseArgs: --dry-run and both --today spellings", () => {
  assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  assert.equal(parseArgs(["--today", "2026-09-02"]).today, "2026-09-02");
  assert.equal(parseArgs(["--today=2026-09-02"]).today, "2026-09-02");
});

test("parseArgs: fails closed on a bad date and on an unknown flag", () => {
  assert.match(parseArgs(["--today", "02.09.2026"]).error, /YYYY-MM-DD/);
  assert.match(parseArgs(["--today"]).error, /YYYY-MM-DD/);
  assert.match(parseArgs(["--write-everything"]).error, /unknown argument/);
});

test("isIsoDate rejects impossible calendar dates", () => {
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("2026-02-28"), true);
});

// ── window math ──────────────────────────────────────────────────────────────

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-09-02", 30), "2026-10-02");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("throughputWindow spans exactly WINDOW_DAYS inclusive days", () => {
  const w = throughputWindow("2026-09-02");
  assert.deepEqual(w, { since: "2026-08-06", until: "2026-09-02" });
  assert.equal(addDays(w.since, WINDOW_DAYS - 1), w.until);
});

test("inWindow is inclusive at both ends and ignores the clock time", () => {
  const w = throughputWindow("2026-09-02");
  assert.equal(inWindow("2026-08-06T23:59:00Z", w), true);
  assert.equal(inWindow("2026-09-02T00:00:00Z", w), true);
  assert.equal(inWindow("2026-08-05T23:59:00Z", w), false);
  assert.equal(inWindow("2026-09-03T00:00:00Z", w), false);
  assert.equal(inWindow(undefined, w), false);
});

// ── the forecast rule ────────────────────────────────────────────────────────

test("forecastDays: whole calendar days, rounded up", () => {
  // 9 open at 25 closed / 28d → 10.08 days → 11
  assert.equal(forecastDays({ remaining: 9, throughput: 25 }), 11);
  // an exact division stays exact
  assert.equal(forecastDays({ remaining: 2, throughput: 28, windowDays: 28 }), 2);
});

test("forecastDays: zero throughput and an empty milestone are UNDEFINED", () => {
  assert.equal(forecastDays({ remaining: 9, throughput: 0 }), null);
  assert.equal(forecastDays({ remaining: 0, throughput: 25 }), null);
  assert.equal(forecastDays({ remaining: 9, throughput: Number.NaN }), null);
});

test("forecastFor: target = today + days; undefined carries a reason", () => {
  assert.deepEqual(forecastFor({ today: "2026-09-02", remaining: 9, throughput: 25 }), {
    days: 11,
    targetDate: "2026-09-13",
    undefinedReason: null,
  });
  const zero = forecastFor({ today: "2026-09-02", remaining: 9, throughput: 0 });
  assert.equal(zero.targetDate, null);
  assert.match(zero.undefinedReason, /zero EARS throughput/);
  const empty = forecastFor({ today: "2026-09-02", remaining: 0, throughput: 25 });
  assert.equal(empty.targetDate, null);
  assert.match(empty.undefinedReason, /no open EARS children/);
});

// ── milestones, gates, overrides ─────────────────────────────────────────────

test("releaseMilestoneTrack picks only the track releases", () => {
  assert.equal(releaseMilestoneTrack("Академия R1 — Архив записей"), "track:academy");
  assert.equal(releaseMilestoneTrack("Витрина R1 — MVP витрины"), "track:doctor");
  assert.equal(releaseMilestoneTrack("Академия · Позже"), null);
  assert.equal(releaseMilestoneTrack("Platform ops & hardening"), null);
  assert.equal(releaseMilestoneTrack(null), null);
});

test("isGateTitle resolves the canonical and the legacy gate titles", () => {
  assert.equal(isGateTitle("gate: Академия R1 — Архив записей"), true);
  assert.equal(isGateTitle("Release 1 gate: Академия R1"), true);
  assert.equal(isGateTitle("[Академия][012] Архив записей"), false);
});

test("hasOwnerOverride finds the marker on any body line, case-insensitively", () => {
  assert.equal(hasOwnerOverride(`intro\n${OWNER_OVERRIDE_MARKER}\noutro`), true);
  assert.equal(hasOwnerOverride(`  target date: OWNER-SET  `), true);
  assert.equal(hasOwnerOverride("Target date: 2026-09-13"), false);
  assert.equal(hasOwnerOverride("we should mark Target date: owner-set later"), false);
  assert.equal(hasOwnerOverride(undefined), false);
});

test("partitionDateTargets keeps features + gates and splits out owner-set", () => {
  const { writes, ownerSet } = partitionDateTargets([
    { number: 1, title: "[Академия][012] Архив записей", body: "", labels: [] },
    { number: 2, title: "[012] EARS-3: сохранить запись", body: "", labels: ["kind:ears-handler"] },
    { number: 3, title: "epic: Академия", body: "", labels: [] },
    { number: 4, title: "Release 1 gate: Академия R1", body: "", labels: [] },
    { number: 5, title: "[Витрина][020] Каталог", body: OWNER_OVERRIDE_MARKER, labels: [] },
    { number: 6, title: "chore: bump deps", body: "", labels: [] },
  ]);
  assert.deepEqual(
    writes.map((i) => i.number),
    [1, 4],
  );
  assert.deepEqual(
    ownerSet.map((i) => i.number),
    [5],
  );
});

// ── rendering ────────────────────────────────────────────────────────────────

const FORECAST = {
  milestone: "Академия R1 — Архив записей",
  track: "track:academy",
  today: "2026-09-02",
  windowDays: WINDOW_DAYS,
  since: "2026-08-06",
  until: "2026-09-02",
  remaining: 9,
  throughput: 25,
  days: 11,
  targetDate: "2026-09-13",
  undefinedReason: null,
  writes: [{ number: 1671, title: "Release 1 gate: Академия R1" }],
  ownerSet: [{ number: 1600, title: "[Академия][012] Архив" }],
};

test("renderForecastComment: English body, milestone quoted verbatim", () => {
  const body = renderForecastComment(FORECAST);
  assert.match(body, /### Roadmap forecast — 2026-09-02/);
  assert.match(body, /«Академия R1 — Архив записей» \(track:academy\)/);
  assert.match(body, /25 closed `kind:ears-handler` Issues in the trailing 28 days \(2026-08-06 … 2026-09-02\)/);
  assert.match(body, /\*\*Target date: 2026-09-13\*\* \(11 calendar days from 2026-09-02\)/);
  assert.match(body, /#1671/);
  assert.match(body, /owner-set \(skipped[^)]*\): #1600/);
  assert.match(body, /«Start date» is never written/);
});

test("renderForecastComment: an undefined forecast writes nothing and says why", () => {
  const body = renderForecastComment({
    ...FORECAST,
    remaining: 0,
    days: null,
    targetDate: null,
    undefinedReason: "no open EARS children — nothing to forecast",
    ownerSet: [],
  });
  assert.match(body, /\*\*Target date: undefined\*\* — no open EARS children/);
  assert.match(body, /No board date was written/);
  assert.doesNotMatch(body, /owner-set \(skipped/);
});

test("renderPlanLine is one line per milestone in both outcomes", () => {
  assert.equal(
    renderPlanLine(FORECAST),
    "  «Академия R1 — Архив записей» 9 open / 25 closed per 28d → Target 2026-09-13 (+11d) → #1671",
  );
  const line = renderPlanLine({ ...FORECAST, targetDate: null, days: null, undefinedReason: "zero" });
  assert.match(line, /Target UNDEFINED \(zero\)/);
});

// ── GraphQL builders ─────────────────────────────────────────────────────────

test("buildDateMutation writes a date value and rejects unsafe input", () => {
  const m = buildDateMutation("PVT_1", "PVTI_2", "PVTF_3", "2026-09-13");
  assert.match(m, /updateProjectV2ItemFieldValue\(input:\{projectId:"PVT_1",itemId:"PVTI_2",fieldId:"PVTF_3",value:\{date:"2026-09-13"\}\}\)/);
  assert.throws(() => buildDateMutation('PVT"', "PVTI_2", "PVTF_3", "2026-09-13"), /unsafe projectId/);
  assert.throws(() => buildDateMutation("PVT_1", "PVTI_2", "PVTF_3", "2026-13-40"), /unsafe date/);
});

test("buildTargetFieldQuery asks for the Target date field only", () => {
  const q = buildTargetFieldQuery();
  assert.match(q, /projectV2\(number:1\)\{id field\(name:"Target date"\)/);
  assert.doesNotMatch(q, /Start date/);
});
