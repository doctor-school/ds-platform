// tools/deploy/api-env-test-token.test.mjs — Issue #2605.
//
// The second, independent production control for the bot-protection test
// token: `pnpm deploy:prod` refuses to deploy when api-prod's
// `/etc/ds-platform/api.env` defines `BOT_PROTECTION_TEST_TOKEN` with a
// non-empty value (the first control is the api's own boot refusal). The
// remote probe never prints the value; the verdict over its output is pure and
// fails closed on anything it cannot read.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { apiEnvTestTokenProbeScript, apiEnvTestTokenVerdict } from "./prod.mjs";

test("passes when the prod api env defines no test token", () => {
  assert.deepEqual(
    apiEnvTestTokenVerdict("api-env=readable\ntest-token-lines=0\n"),
    {
      ok: true,
    },
  );
});

test("refuses when the prod api env defines a non-empty test token", () => {
  const verdict = apiEnvTestTokenVerdict(
    "api-env=readable\ntest-token-lines=1\n",
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /BOT_PROTECTION_TEST_TOKEN/);
});

test("fails closed when the api env could not be read", () => {
  const verdict = apiEnvTestTokenVerdict("api-env=unreadable\n");
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /could not read/);
});

test("fails closed on probe output it does not recognise", () => {
  for (const output of [
    "",
    "garbage",
    "api-env=readable\n",
    "api-env=readable\ntest-token-lines=x\n",
  ]) {
    assert.equal(
      apiEnvTestTokenVerdict(output).ok,
      false,
      JSON.stringify(output),
    );
  }
});

test("the probe counts only non-empty assignments and never prints the value", () => {
  const script = apiEnvTestTokenProbeScript();
  assert.match(script, /\/etc\/ds-platform\/api\.env/);
  assert.match(script, /BOT_PROTECTION_TEST_TOKEN=/);
  assert.match(script, /grep -cE/);
  assert.doesNotMatch(script, /\bcat\b/);
});

test("the probe's pattern matches exactly the non-empty assignments (run under bash)", (t) => {
  const probe = spawnSync("bash", ["--version"], { encoding: "utf8" });
  if (probe.status !== 0) {
    t.skip("bash not available");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "api-env-"));
  const cases = [
    ["BOT_PROTECTION_TEST_TOKEN=\nOTHER=1\n", "0"],
    ["# BOT_PROTECTION_TEST_TOKEN=abc\n", "0"],
    ["XBOT_PROTECTION_TEST_TOKEN=abc\n", "0"],
    ["BOT_PROTECTION_TEST_TOKEN=abc\n", "1"],
    ["  export BOT_PROTECTION_TEST_TOKEN=abc\n", "1"],
  ];
  try {
    for (const [content, expected] of cases) {
      const file = join(dir, "api.env");
      writeFileSync(file, content);
      const script = apiEnvTestTokenProbeScript(
        file.replaceAll("\\", "/"),
      ).replaceAll("sudo ", "");
      const run = spawnSync("bash", ["-c", script], { encoding: "utf8" });
      assert.equal(
        run.stdout,
        `api-env=readable\ntest-token-lines=${expected}\n`,
        JSON.stringify(content),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
