// tools/staging/units.test.mjs — Issue #2064 part 2a.
//
// The systemd units are the one part of this step with no other reader: a typo in
// `ExecStart=` or a dropped `Type=oneshot` is invisible to `node --check`, to
// eslint and to every other test here, and it surfaces on the box as a unit that
// fails to start or — far worse — a 60-second timer that quietly overlaps itself.
// So the unit FILES are parsed and asserted like any other artefact this repo
// generates. A typo fails CI, not the box.
//
// Path-agnostic (CI is Linux, the authoring workstation is Windows): every path is
// derived from `import.meta.url`, never from `process.cwd()`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { SLOT_CLI } from "./deployer.mjs";

const UNIT_DIR = new URL("../../infra/deploy/systemd/", import.meta.url);

/**
 * A deliberately small systemd unit reader.
 *
 * Enough of the format for the assertions below: `[Section]` headers, `Key=Value`
 * lines, `#`/`;` comments, repeated keys collected as a list (systemd allows several
 * `ExecStart=` lines and the difference matters). No continuation lines — if a unit
 * here ever needs one, this parser must learn about it rather than silently mis-read
 * the file.
 */
function parseUnit(name) {
  const text = readFileSync(fileURLToPath(new URL(name, UNIT_DIR)), "utf8");
  assert.ok(!/\\\r?\n/.test(text), `${name} uses a line continuation this parser cannot read`);
  const sections = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = header[1];
      sections[current] = sections[current] ?? {};
      continue;
    }
    assert.ok(current, `${name}: "${line}" appears before any [Section]`);
    const eq = line.indexOf("=");
    assert.ok(eq > 0, `${name}: "${line}" is not a Key=Value line`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    (sections[current][key] ??= []).push(value);
  }
  return sections;
}

const one = (sections, section, key) => {
  const values = sections[section]?.[key];
  assert.ok(values, `missing ${section}.${key}`);
  assert.equal(values.length, 1, `${section}.${key} is set ${values.length} times`);
  return values[0];
};

test("EARS: the deployer service is a oneshot that execs the wrapper's `tick`", () => {
  const unit = parseUnit("ds-slot-deployer.service");
  assert.equal(one(unit, "Service", "Type"), "oneshot");
  assert.equal(one(unit, "Service", "ExecStart"), "/usr/local/bin/ds-slot-deployer tick");
  assert.equal(one(unit, "Service", "TimeoutStartSec"), "900");
  assert.equal(one(unit, "Service", "User"), "root");
});

test("the deployer service sources its environment through the wrapper, never `EnvironmentFile=`", () => {
  // systemd's parser and bash's `set -a; . stage.env` disagree about quoting — the
  // box keeps ONE env-sourcing path and it is bash's, inside the wrapper.
  const unit = parseUnit("ds-slot-deployer.service");
  assert.equal(unit.Service.EnvironmentFile, undefined);
});

test("the deployer waits for Docker: a tick before the daemon is up converges nothing", () => {
  const unit = parseUnit("ds-slot-deployer.service");
  assert.match(one(unit, "Unit", "Requires"), /docker\.service/);
  assert.match(one(unit, "Unit", "After"), /docker\.service/);
});

test("EARS: the deployer timer fires every 60 seconds and does not replay missed ticks", () => {
  const unit = parseUnit("ds-slot-deployer.timer");
  assert.equal(one(unit, "Timer", "Unit"), "ds-slot-deployer.service");
  assert.equal(one(unit, "Timer", "OnBootSec"), "60");
  assert.equal(one(unit, "Timer", "OnUnitActiveSec"), "60");
  assert.equal(one(unit, "Timer", "AccuracySec"), "5");
  assert.equal(one(unit, "Timer", "Persistent"), "false");
  assert.equal(one(unit, "Install", "WantedBy"), "timers.target");
});

test("`OnUnitActiveSec` (not `OnCalendar`) is what keeps two ticks from overlapping", () => {
  // The interval is measured from the END of the previous run, so a tick that
  // overruns its minute absorbs the ticks it overruns instead of racing them. An
  // `OnCalendar=*:*:0/60` schedule would queue them up.
  const unit = parseUnit("ds-slot-deployer.timer");
  assert.equal(unit.Timer.OnCalendar, undefined);
});

test("EARS: the gc service execs `ds-slot gc` and its timer runs nightly at 03:30", () => {
  const service = parseUnit("ds-slot-gc.service");
  assert.equal(one(service, "Service", "Type"), "oneshot");
  assert.equal(one(service, "Service", "ExecStart"), `${SLOT_CLI} gc`);

  const timer = parseUnit("ds-slot-gc.timer");
  assert.equal(one(timer, "Timer", "Unit"), "ds-slot-gc.service");
  assert.equal(one(timer, "Timer", "OnCalendar"), "*-*-* 03:30:00");
  assert.equal(one(timer, "Timer", "Persistent"), "true");
  assert.equal(one(timer, "Install", "WantedBy"), "timers.target");
});

test("neither `.service` is enabled on its own — the timers own both schedules", () => {
  for (const name of ["ds-slot-deployer.service", "ds-slot-gc.service"]) {
    const unit = parseUnit(name);
    assert.equal(unit.Install?.WantedBy, undefined, `${name} must not be WantedBy anything`);
  }
});
