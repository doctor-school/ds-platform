// tools/deploy/lib/remote.test.mjs — unit tests for the shared SSH/ship
// primitives extracted from tools/deploy/prod.mjs (Issue #2194), so the staging
// slot tool ships a tree over exactly the channel production ships one.
// `node --test` (pnpm test:tools).
//
// The production call is the DEFAULT call: its rendered remote script must stay
// byte-identical to the text prod.mjs rendered before the move. The end-to-end
// proof that the rendered script still behaves lives in
// tools/lint/guard-tests/deploy-ship-tree.spec.ts, which executes it in a real
// POSIX shell; these tests pin the text contract itself.

import test from "node:test";
import assert from "node:assert/strict";

import { shipTreeCommand, sshBaseArgs } from "./remote.mjs";

const PROD_PRESERVED = "infra/deploy/compose/api-prod/.env";

// ── shipTreeCommand — the production default ────────────────────────────────

test("2194: the default call still ships into production's live tree", () => {
  const script = shipTreeCommand();
  assert.match(script, /^set -eu\nlive="\$HOME\/ds-platform"\n/);
});

test("2194: the default call still carries the api-prod .env forward", () => {
  const script = shipTreeCommand();
  assert.ok(script.includes(`preserved_rel="${PROD_PRESERVED}"`));
  assert.ok(script.includes('if [ -f "$live/$preserved_rel" ]; then'));
  assert.ok(
    script.includes('mkdir -p "$stage/infra/deploy/compose/api-prod"'),
    "the preserved file's directory is created inside the staging tree",
  );
  assert.ok(
    script.includes('cp -p "$live/$preserved_rel" "$stage/$preserved_rel"'),
  );
});

test("2194: production ships straight into $HOME — no parent mkdir", () => {
  assert.ok(!shipTreeCommand().includes('mkdir -p "$(dirname "$live")"'));
});

test("2194: the EMERGENCY notice keeps printf's literal newline escape", () => {
  // A lost backslash here turns the format string into a real newline at JS
  // parse time, so printf would emit `%s` unsubstituted on the recovery path —
  // the one line an operator reads when a swap failed mid-deploy.
  assert.ok(
    shipTreeCommand().includes(
      "printf 'EMERGENCY: previous deploy tree remains recoverable at %s\\n' \"$previous\" >&2",
    ),
  );
});

test("2194: the script ends on the trap disarm, with no trailing newline", () => {
  assert.ok(shipTreeCommand().endsWith("trap - EXIT HUP INT TERM"));
});

// ── shipTreeCommand — a staging slot ────────────────────────────────────────

test("2194: a slot ships into its own tree under $HOME/ds-platform.slots", () => {
  const script = shipTreeCommand({
    liveDir: "$HOME/ds-platform.slots/pr-42",
    preserved: [],
  });
  assert.match(script, /^set -eu\nlive="\$HOME\/ds-platform\.slots\/pr-42"\n/);
});

test("2194: a nested live tree gets its parent created before the swap", () => {
  const script = shipTreeCommand({
    liveDir: "$HOME/ds-platform.slots/pr-42",
    preserved: [],
  });
  const parent = script.indexOf('mkdir -p "$(dirname "$live")"');
  const stage = script.indexOf('mkdir -p "$stage"');
  assert.ok(parent !== -1, "the slot parent directory is created");
  assert.ok(parent < stage, "the parent is created before the staging tree");
});

test("2194: a slot preserves nothing from the previous tree", () => {
  const script = shipTreeCommand({
    liveDir: "$HOME/ds-platform.slots/pr-42",
    preserved: [],
  });
  assert.ok(!script.includes("preserved_rel"));
  assert.ok(!script.includes(PROD_PRESERVED));
  assert.ok(!script.includes("cp -p"));
});

test("2194: several preserved files each get their own shell variable", () => {
  const script = shipTreeCommand({
    liveDir: "$HOME/ds-platform.slots/pr-42",
    preserved: ["a/one.env", "b/two.env"],
  });
  assert.ok(script.includes('preserved_rel="a/one.env"'));
  assert.ok(script.includes('preserved_rel_1="b/two.env"'));
  assert.ok(
    script.includes('cp -p "$live/$preserved_rel" "$stage/$preserved_rel"'),
  );
  assert.ok(
    script.includes('cp -p "$live/$preserved_rel_1" "$stage/$preserved_rel_1"'),
  );
});

// ── sshBaseArgs ─────────────────────────────────────────────────────────────

test("2194: every ssh channel keeps the #905 keepalive flags and the host last", () => {
  assert.deepEqual(sshBaseArgs("ds-api-prod"), [
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "ds-api-prod",
  ]);
});
