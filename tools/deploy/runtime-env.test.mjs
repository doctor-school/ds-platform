// tools/deploy/runtime-env.test.mjs — Issue #1468.
//
// Before any production state change, the release proves that api-prod's
// `/etc/ds-platform/api.env` carries every runtime variable the runtime-env
// contract (`packages/schemas/src/runtime-env/runtime-env-contract.json`, read
// from the shipped SHA's tree) requires: present, non-empty, not a template
// placeholder. The probe prints names and states only; the verdict is pure and
// fails closed on anything it cannot read. 2026-08-25: the api was swapped onto
// a box without LIFECYCLE_IMPACT_TOKEN_SECRET and crash-looped behind a 502.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { remoteBash } from "./lib/remote.mjs";
import {
  DEPLOY_PLAN,
  REDEPLOY_SKIPPED_STEPS,
  RUNTIME_ENV_CONTRACT_PATH,
  apiEnvRuntimeEnvProbeScript,
  apiEnvRuntimeEnvVerdict,
  deployPlan,
  parseRuntimeEnvContract,
  requiredRuntimeEnv,
} from "./prod.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const CONTRACT_TEXT = readFileSync(
  join(REPO_ROOT, ...RUNTIME_ENV_CONTRACT_PATH.split("/")),
  "utf8",
);
const CONTRACT = parseRuntimeEnvContract(CONTRACT_TEXT);
const SOURCE = readFileSync(join(import.meta.dirname, "prod.mjs"), "utf8");
const ALL_SERVICES = [
  "ds-api",
  "ds-portal",
  "ds-admin",
  "ds-doctor",
  "ds-login",
].map((image) => ({ image }));
const PRE_LOGIN = ALL_SERVICES.filter((s) => s.image !== "ds-login");

const bash = spawnSync(
  "bash",
  ["-c", "command -v grep && command -v sed && command -v tail"],
  { encoding: "utf8" },
);
const SKIP_SHELL = bash.status !== 0 && "needs bash";

/**
 * Run the probe against a fixture env file (`sudo` stripped, as the test-token test
 * does) exactly as the ssh transport runs it: the box is handed `remoteBash()` and
 * the script on stdin, so the shell mode (`bash --norc -euo pipefail`) is the real one.
 */
function probe(content, names) {
  const dir = mkdtempSync(join(tmpdir(), "ds-1468-"));
  try {
    const file = join(dir, "api.env");
    writeFileSync(file, content);
    const script = apiEnvRuntimeEnvProbeScript(
      names,
      file.replaceAll("\\", "/"),
    ).replaceAll("sudo ", "");
    const run = spawnSync("bash", ["-c", remoteBash()], {
      input: script,
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A complete fixture: every contract variable with a real-looking value. */
function completeEnv(names) {
  return (
    names
      .map(
        (n) =>
          `${n}=${n === "DATABASE_URL" ? "postgresql://ds:pw@192.168.0.10:5432/ds_prod" : "real-value-" + n.length}`,
      )
      .join("\n") + "\n"
  );
}

test("1468: the contract names the boot-fatal secrets; the record key only for a release shipping ds-login", () => {
  const always = requiredRuntimeEnv(CONTRACT, PRE_LOGIN);
  for (const name of [
    "DATABASE_URL",
    "AUDIT_IDENTIFIER_PEPPER",
    "LIFECYCLE_IMPACT_TOKEN_SECRET",
    "ACADEMY_PUBLIC_ORIGIN",
    "DOCTOR_PUBLIC_ORIGIN",
  ]) {
    assert.ok(always.includes(name), name);
  }
  assert.equal(always.includes("SIGN_IN_RECORD_KEY"), false);
  assert.ok(
    requiredRuntimeEnv(CONTRACT, ALL_SERVICES).includes("SIGN_IN_RECORD_KEY"),
  );
  assert.equal(CONTRACT.envFile, "/etc/ds-platform/api.env");
});

test("1468: a malformed contract refuses (names must be shell-safe, containers known)", () => {
  for (const bad of [
    "not json",
    "{}",
    JSON.stringify({
      envFile: "/etc/ds-platform/api.env",
      variables: [{ name: "x;rm -rf", containers: ["api"], ref: "r" }],
    }),
    JSON.stringify({
      envFile: "/etc/ds-platform/api.env",
      variables: [{ name: "OK_NAME", containers: ["nope"], ref: "r" }],
    }),
    JSON.stringify({
      envFile: "/etc/ds-platform/api.env",
      variables: [{ name: "OK_NAME", containers: ["api"] }],
    }),
    JSON.stringify({
      envFile: "/etc/ds-platform/api.env",
      variables: [{ name: "OK_NAME", containers: ["api"], ref: "r", when: {} }],
    }),
  ]) {
    assert.throws(
      () => parseRuntimeEnvContract(bad),
      /runtime-env contract/,
      bad,
    );
  }
});

test("1468: the verdict passes only when every required name is ok", () => {
  const names = ["A_ONE", "B_TWO"];
  assert.deepEqual(
    apiEnvRuntimeEnvVerdict(
      "api-env=readable\nvar=A_ONE:ok\nvar=B_TWO:ok\n",
      names,
    ),
    { ok: true },
  );
  const refused = apiEnvRuntimeEnvVerdict(
    "api-env=readable\nvar=A_ONE:absent\nvar=B_TWO:placeholder\n",
    names,
  );
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /A_ONE \(absent\), B_TWO \(placeholder\)/);
  assert.match(refused.reason, /Nothing was changed/);
});

test("1468: the verdict fails closed on unreadable or unrecognised probe output", () => {
  const names = ["A_ONE"];
  for (const output of [
    "",
    "garbage",
    "api-env=unreadable\n",
    "api-env=readable\n",
    "api-env=readable\nvar=A_ONE:weird\n",
    "api-env=readable\nvar=OTHER:ok\n",
  ]) {
    const verdict = apiEnvRuntimeEnvVerdict(output, names);
    assert.equal(verdict.ok, false, JSON.stringify(output));
    assert.match(verdict.reason, /Nothing was changed/);
  }
});

test("1468: the probe never prints the file or a value", () => {
  const script = apiEnvRuntimeEnvProbeScript(["A_ONE"]);
  assert.match(script, /\/etc\/ds-platform\/api\.env/);
  assert.doesNotMatch(script, /\bcat\b/);
  assert.doesNotMatch(script, /echo[^\n]*\$v/);
  assert.throws(() => apiEnvRuntimeEnvProbeScript(["bad name"]), /runtime-env/);
});

test(
  "1468: the probe classifies absent / empty / placeholder / ok on the last assignment (run under bash)",
  { skip: SKIP_SHELL },
  () => {
    const cases = [
      ["OTHER=1\n", "absent"],
      ["# A_ONE=real\n", "absent"],
      ["XA_ONE=real\n", "absent"],
      ["A_ONE=\n", "empty"],
      ['A_ONE=""\n', "empty"],
      ["A_ONE=   \n", "empty"],
      ["A_ONE=<openssl-rand-hex-32>\n", "placeholder"],
      ["A_ONE=postgresql://ds:<db-password>@h/db\n", "placeholder"],
      ["A_ONE=real\n", "ok"],
      ['  export A_ONE="SMS Aero"\n', "ok"],
      ["A_ONE=real\nA_ONE=\n", "empty"],
      ["A_ONE=\nA_ONE=real\n", "ok"],
    ];
    for (const [content, state] of cases) {
      assert.equal(
        probe(content, ["A_ONE"]),
        `api-env=readable\nvar=A_ONE:${state}\n`,
        JSON.stringify(content),
      );
    }
    const secret = "s3cr3t-value-never-printed";
    assert.doesNotMatch(
      probe(`A_ONE=${secret}\n`, ["A_ONE"]),
      new RegExp(secret),
    );
  },
);

test(
  "1468 regression (2026-08-25): an api.env without LIFECYCLE_IMPACT_TOKEN_SECRET is refused by name",
  { skip: SKIP_SHELL },
  () => {
    const names = requiredRuntimeEnv(CONTRACT, PRE_LOGIN);
    const fixture = completeEnv(
      names.filter((n) => n !== "LIFECYCLE_IMPACT_TOKEN_SECRET"),
    );
    const verdict = apiEnvRuntimeEnvVerdict(probe(fixture, names), names);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /LIFECYCLE_IMPACT_TOKEN_SECRET \(absent\)/);
    assert.match(verdict.reason, /Nothing was changed/);
    for (const other of names.filter(
      (n) => n !== "LIFECYCLE_IMPACT_TOKEN_SECRET",
    )) {
      assert.doesNotMatch(
        verdict.reason,
        new RegExp(`\\b${other}\\b`),
        `${other} is not named`,
      );
    }
    assert.deepEqual(
      apiEnvRuntimeEnvVerdict(probe(completeEnv(names), names), names),
      { ok: true },
    );
  },
);

test("1468: the runtime-env phase runs before the first state change, in release and redeploy", () => {
  // Every phase before runtime-env only reads; runtime-config-backup is the first write.
  const READ_ONLY_BEFORE = ["preflight", "test-token", "service-set"];
  const at = DEPLOY_PLAN.indexOf("runtime-env");
  assert.deepEqual(DEPLOY_PLAN.slice(0, at), READ_ONLY_BEFORE);
  assert.ok(at < DEPLOY_PLAN.indexOf("runtime-config-backup"));
  assert.equal(REDEPLOY_SKIPPED_STEPS.includes("runtime-env"), false);
  for (const plan of [
    deployPlan(),
    deployPlan({ local: true }),
    deployPlan({ local: true, redeploy: true }),
  ]) {
    assert.ok(plan.includes("runtime-env"));
    assert.ok(
      plan.indexOf("runtime-env") < plan.indexOf("runtime-config-backup"),
    );
  }
  const body = SOURCE.slice(SOURCE.indexOf("async function deploy("));
  assert.match(
    body,
    /walk\.phase\("runtime-env"\);\s*await assertProdApiEnvCarriesRuntimeEnv\(sha, services\);/,
  );
  assert.ok(
    body.indexOf('walk.phase("runtime-env")') <
      body.indexOf('walk.phase("runtime-config-backup")'),
  );
  // The contract enforced is the shipped SHA's own (the extracted tree on the box, `git show` otherwise).
  const gate = SOURCE.slice(
    SOURCE.indexOf("async function assertProdApiEnvCarriesRuntimeEnv("),
  );
  assert.match(
    gate.slice(0, 800),
    /targetFile\(sha, RUNTIME_ENV_CONTRACT_PATH\)/,
  );
  // The record-key probe is folded into this gate, not kept twice.
  assert.doesNotMatch(SOURCE, /assertProdApiEnvHasRecordKey|record-key-lines/);
});

// --- template parity: infra/deploy/api.env.example ⇔ the contract ----------

/** Each uncommented assignment with its directly preceding contiguous comment block. */
function templateEntries(text) {
  const entries = new Map();
  let block = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) {
      block.push(line);
      continue;
    }
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m)
      entries.set(m[1], {
        value: m[2],
        required: block.some((l) => /\bREQUIRED\b/.test(l)),
      });
    block = [];
  }
  return entries;
}

test("1468: api.env.example lists every contract variable and marks exactly the contract set REQUIRED", () => {
  const entries = templateEntries(
    readFileSync(join(REPO_ROOT, "infra", "deploy", "api.env.example"), "utf8"),
  );
  const contract = CONTRACT.variables.map((v) => v.name);
  for (const name of contract) {
    const entry = entries.get(name);
    assert.ok(entry, `${name} is an uncommented line of api.env.example`);
    assert.notEqual(
      entry.value.trim(),
      "",
      `${name} carries a value or a <placeholder>`,
    );
    assert.equal(entry.required, true, `${name} is marked REQUIRED`);
  }
  const markedRequired = [...entries]
    .filter(([, e]) => e.required)
    .map(([n]) => n);
  assert.deepEqual(
    markedRequired.sort(),
    [...contract].sort(),
    "REQUIRED marks == the contract",
  );
});
