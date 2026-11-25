import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ACTIONS_RUN_HOLD_MS,
  HOLD_REFUSED_EXIT,
  OPERATOR_HOLD_MS,
  SLOT_HOLD_PATH,
  actionsRunHold,
  clearHoldScript,
  convergeHoldCheck,
  holdRecord,
  holdRefusal,
  operatorHolder,
  parseHold,
  parseTakeResult,
  readHoldScript,
  reclaimHoldScript,
  slotHoldDecision,
  takeHoldScript,
} from "./slot-hold.mjs";

const T0 = Date.parse("2026-11-19T09:00:00Z");
const ME = operatorHolder({ user: "anton", host: "ws-1", pid: 4242 });
const OTHER = operatorHolder({ user: "agent", host: "ws-2", pid: 7 });

test("free: no hold on record → proceed", () => {
  assert.deepEqual(slotHoldDecision({ hold: null, now: T0, self: ME }), { action: "proceed" });
  assert.equal(parseHold(""), null);
  assert.equal(parseHold(undefined), null);
});

test("held: another holder's live hold → refuse, naming the holder and since when", () => {
  const hold = parseHold(JSON.stringify(holdRecord({ holder: OTHER, now: T0 })));
  const d = slotHoldDecision({ hold, now: T0 + 10 * 60 * 1000, self: ME });
  assert.equal(d.action, "refuse");
  assert.equal(d.holder, OTHER);
  assert.equal(d.since, "2026-11-19T09:00:00.000Z");
  assert.match(d.reason, /operator agent@ws-2 e2e:stage main \(pid 7\) since 2026-11-19T09:00:00.000Z/);
  assert.match(holdRefusal(d, "e2e:stage"), /^e2e:stage refuses: slot main is held by operator agent@ws-2/);
});

test("held: the converge (no self) refuses an operator hold too", () => {
  const hold = parseHold(JSON.stringify(holdRecord({ holder: OTHER, now: T0 })));
  assert.equal(slotHoldDecision({ hold, now: T0 + 1000 }).action, "refuse");
});

test("own hold → proceed", () => {
  const hold = parseHold(JSON.stringify(holdRecord({ holder: ME, now: T0 })));
  assert.equal(slotHoldDecision({ hold, now: T0 + 1000, self: ME }).action, "proceed");
});

test("stale: a hold past its bound → reclaim, naming whose hold it overrides", () => {
  const hold = parseHold(JSON.stringify(holdRecord({ holder: OTHER, now: T0 })));
  const atBound = slotHoldDecision({ hold, now: T0 + OPERATOR_HOLD_MS, self: ME });
  assert.equal(atBound.action, "reclaim");
  assert.match(atBound.reason, /operator agent@ws-2 .* went stale at 2026-11-19T11:00:00.000Z/);
  assert.equal(slotHoldDecision({ hold, now: T0 + OPERATOR_HOLD_MS - 1, self: ME }).action, "refuse");
});

test("an unreadable record never wedges the slot: reclaim", () => {
  for (const text of ["{", "[]", '{"slot":"main","holder":"x;rm -rf /","since":"a","until":"b"}']) {
    const hold = parseHold(text);
    assert.deepEqual(hold, { unreadable: true });
    assert.equal(slotHoldDecision({ hold, now: T0, self: ME }).action, "reclaim");
  }
});

test("holdRecord refuses a holder name with shell metacharacters", () => {
  assert.throws(() => holdRecord({ holder: "a'; rm -rf / #", now: T0 }), /bad slot holder/);
  assert.equal(operatorHolder({ user: "a'b$c", host: "h;x", pid: "z" }), "operator abc@hx e2e:stage main (pid 0)");
});

const run = (over) => ({
  databaseId: 44500619750,
  status: "in_progress",
  event: "workflow_run",
  createdAt: "2026-11-19T09:54:00Z",
  displayTitle: "Stage main 44fc3bddf",
  url: "https://github.com/o/r/actions/runs/44500619750",
  ...over,
});

test("Actions: a live stage.yml run of main holds the slot → the operator run refuses naming it", () => {
  const hold = actionsRunHold([run({ status: "completed", databaseId: 1 }), run()]);
  const d = slotHoldDecision({ hold, now: Date.parse("2026-11-19T10:20:00Z"), self: ME });
  assert.equal(d.action, "refuse");
  assert.match(d.reason, /Actions run 44500619750 \(Stage main 44fc3bddf, in_progress\)/);
  assert.match(d.reason, /since 2026-11-19T09:54:00.000Z/);
});

test("Actions: completed runs and PR-slot dispatches do not hold main", () => {
  assert.equal(actionsRunHold([]), null);
  assert.equal(actionsRunHold([run({ status: "completed" })]), null);
  assert.equal(actionsRunHold([run({ event: "workflow_dispatch" })]), null);
});

test("Actions: a run live past every job limit is stale → reclaim", () => {
  const hold = actionsRunHold([run()]);
  const now = Date.parse("2026-11-19T09:54:00Z") + ACTIONS_RUN_HOLD_MS;
  assert.equal(slotHoldDecision({ hold, now, self: ME }).action, "reclaim");
});

// The box scripts run for real in a scratch dir (as root on the box; here the
// test user owns the dir). Two takes, a reclaim race and a foreign clear are the cases.
const bash = (script) => {
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const scratch = () => mkdtempSync(path.join(tmpdir(), "slot-hold-")).replace(/\\/g, "/");
const onDisk = (dir) => {
  try {
    return readFileSync(`${dir}/main.json`, "utf8").trim();
  } catch {
    return "";
  }
};

test("box scripts: the read prints the record through sudo, or nothing", () => {
  assert.equal(readHoldScript(), `if sudo test -f ${SLOT_HOLD_PATH}; then sudo cat ${SLOT_HOLD_PATH}; fi`);
});

test("S1: the take is create-if-absent — the second of two takes is told who holds", () => {
  const dir = scratch();
  const mine = holdRecord({ holder: ME, now: T0 });
  const other = holdRecord({ holder: OTHER, now: T0 });
  assert.deepEqual(parseTakeResult(bash(takeHoldScript(mine, dir))), { taken: true });
  const second = parseTakeResult(bash(takeHoldScript(other, dir)));
  assert.equal(second.taken, false);
  assert.equal(parseHold(second.held).holder, ME);
  assert.equal(parseHold(onDisk(dir)).holder, ME, "the first take stands");
});

test("S1: a reclaim replaces only the stale record it decided on", () => {
  const dir = scratch();
  const stale = holdRecord({ holder: OTHER, now: T0 - OPERATOR_HOLD_MS - 1 });
  bash(takeHoldScript(stale, dir));
  const staleText = onDisk(dir);
  const mine = holdRecord({ holder: ME, now: T0 });
  assert.deepEqual(parseTakeResult(bash(reclaimHoldScript(staleText, mine, dir))), { taken: true });
  assert.equal(parseHold(onDisk(dir)).holder, ME);
  // A second reclaimer that decided on the same stale record loses: the hold is now mine.
  const late = holdRecord({ holder: OTHER, now: T0 });
  const lost = parseTakeResult(bash(reclaimHoldScript(staleText, late, dir)));
  assert.equal(lost.taken, false);
  assert.equal(parseHold(lost.held).holder, ME);
  assert.equal(parseHold(onDisk(dir)).holder, ME, "the fresh hold is put back");
  // A reclaim of a record that is gone takes the free slot.
  const free = scratch();
  assert.deepEqual(parseTakeResult(bash(reclaimHoldScript(staleText, mine, free))), { taken: true });
});

test("S1: a clear drops its own record only", () => {
  const dir = scratch();
  const mine = holdRecord({ holder: ME, now: T0 });
  bash(takeHoldScript(mine, dir));
  bash(clearHoldScript(holdRecord({ holder: OTHER, now: T0 }), dir));
  assert.equal(parseHold(onDisk(dir)).holder, ME);
  bash(clearHoldScript(mine, dir));
  assert.equal(onDisk(dir), "");
  assert.deepEqual(readdirSync(dir), [], "no temp or aside file is left behind");
});

test("parseTakeResult: anything but `taken` / `held` is an error", () => {
  assert.throws(() => parseTakeResult("garbage"), /unexpected answer/);
});

test("converge path: a live operator hold refuses the converge, naming the holder", () => {
  const text = JSON.stringify(holdRecord({ holder: OTHER, now: T0 }));
  const live = convergeHoldCheck({ text, now: T0 + 60_000, command: "up" });
  // B2: the note the release driver records for `status stage-main`, which stage.yml prints.
  assert.deepEqual(live.failureNote, {
    phase: "slot-hold",
    reason: "slot main is held by operator agent@ws-2 e2e:stage main (pid 7) since 2026-11-19T09:00:00.000Z",
  });
  assert.ok(live.failureNote.reason.length <= 160);
  assert.match(live.refusal, /^slot up main refuses: slot main is held by operator agent@ws-2 e2e:stage main \(pid 7\) since 2026-11-19T09:00:00.000Z/);
  assert.deepEqual(convergeHoldCheck({ text: "", now: T0, command: "up" }), {});
  const stale = convergeHoldCheck({ text, now: T0 + OPERATOR_HOLD_MS, command: "sync" });
  assert.equal(stale.refusal, undefined);
  assert.match(stale.note, /went stale .*; the converge proceeds$/);
});

test("the Actions stale bound is the converge and suite job limits of stage.yml plus 15 min", () => {
  const yml = readFileSync(new URL("../../.github/workflows/stage.yml", import.meta.url), "utf8");
  const limit = (job) => {
    const body = yml.split(new RegExp(`^  ${job}:$`, "m"))[1].split(/^ {2}[a-z-]+:$/m)[0];
    return Number(body.match(/^ {4}timeout-minutes: (\d+)$/m)[1]);
  };
  assert.equal(ACTIONS_RUN_HOLD_MS, (limit("converge") + limit("suite") + 15) * 60 * 1000);
});

test("B1: a hold refusal has its own exit code, apart from e2e:stage's 1 and 2", () => {
  assert.equal(HOLD_REFUSED_EXIT, 3);
});
