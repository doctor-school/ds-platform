// tools/deploy/hotfix-ref.test.mjs — unit tests for the `--ref <sha>` hotfix
// deploy seams (Issue #1881). `node --test` (pnpm test:tools).

import test from "node:test";
import assert from "node:assert/strict";

import {
  parseRefFlag,
  parseCherryOutput,
  hotfixPreflightVerdict,
} from "./hotfix-ref.mjs";

const DEPLOYED = "1455bb9c1455bb9c1455bb9c1455bb9c1455bb9c";
const TARGET = "abcdef01abcdef01abcdef01abcdef01abcdef01";

// ── parseRefFlag ────────────────────────────────────────────────────────────

test("EARS-1: absent --ref yields the default (whole origin/main) deploy", () => {
  const r = parseRefFlag(["node", "prod.mjs"]);
  assert.equal(r.present, false);
  assert.equal(r.ref, null);
  assert.equal(r.error, null);
});

test("EARS-1.1: --ref <sha> parses and normalises to lowercase", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref", "ABCDEF01"]);
  assert.deepEqual(r, { present: true, ref: "abcdef01", error: null });
});

test("EARS-1.2: bare --ref is a usage error", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref"]);
  assert.equal(r.present, true);
  assert.equal(r.ref, null);
  assert.match(r.error, /requires a <sha> argument/);
});

test("EARS-1.3: --ref followed by another flag is a usage error", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref", "--skip-ci-check"]);
  assert.match(r.error, /requires a <sha> argument/);
});

test("EARS-1.4: a non-SHA --ref value (branch name / tag) is refused", () => {
  for (const bad of ["hotfix/1877-header", "release-2026.08.25-2", "zzz"]) {
    const r = parseRefFlag(["node", "prod.mjs", "--ref", bad]);
    assert.equal(r.ref, null, bad);
    assert.match(r.error, /commit SHA/, bad);
  }
});

test("EARS-1.5: --ref together with --rollback is a usage error", () => {
  const r = parseRefFlag([
    "node",
    "prod.mjs",
    "--ref",
    "abcdef01",
    "--rollback",
    "1455bb9c",
  ]);
  assert.match(r.error, /mutually exclusive/);
});

test("EARS-1.6: a repeated --ref is a usage error", () => {
  const r = parseRefFlag(["node", "prod.mjs", "--ref", "abcdef01", "--ref", "beef0001"]);
  assert.match(r.error, /only once/);
});

// ── parseCherryOutput ───────────────────────────────────────────────────────

test("EARS-2: `-` lines are cherry-picks of merged commits, `+` lines are not", () => {
  const out = `- ${TARGET}\n+ ${DEPLOYED}\n`;
  assert.deepEqual(parseCherryOutput(out), {
    unmatched: [DEPLOYED],
    matched: [TARGET],
  });
});

test("EARS-2.1: empty / noise output yields empty lists", () => {
  assert.deepEqual(parseCherryOutput(""), { unmatched: [], matched: [] });
  assert.deepEqual(parseCherryOutput(undefined), {
    unmatched: [],
    matched: [],
  });
  assert.deepEqual(parseCherryOutput("warning: something\n"), {
    unmatched: [],
    matched: [],
  });
});

// ── hotfixPreflightVerdict ──────────────────────────────────────────────────

test("EARS-3: a strict descendant whose commits are all cherry-picks passes", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: TARGET,
    targetIsDescendant: true,
    unmatched: [],
  });
  assert.deepEqual(v, { ok: true, error: null });
});

test("EARS-3.1: target == deployed SHA is refused (nothing to ship)", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: DEPLOYED,
    targetIsDescendant: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /already the deployed SHA/);
});

test("EARS-3.2: a target that is not a descendant of prod is refused", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: TARGET,
    targetIsDescendant: false,
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /not a descendant/);
});

test("EARS-3.3: an unmatched commit (not on origin/main) is refused, named", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: DEPLOYED,
    targetSha: TARGET,
    targetIsDescendant: true,
    unmatched: ["cafebabecafebabecafebabecafebabecafebabe"],
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /no equivalent on origin\/main/);
  assert.match(v.error, /cafebabecafe/);
});

test("EARS-3.4: an unresolvable deployed SHA is refused", () => {
  const v = hotfixPreflightVerdict({
    deployedSha: null,
    targetSha: TARGET,
    targetIsDescendant: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /cannot resolve the live deployed SHA/);
});
