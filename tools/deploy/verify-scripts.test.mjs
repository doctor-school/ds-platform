// tools/deploy/verify-scripts.test.mjs — Issue #1905.
//
// Locks the GENERATED on-box shell of the two deploy verify gates
// (`verifyRunningSha`, `verifyImagesBoot` in prod.mjs) — before these seams a
// quoting / line-continuation regression in the per-service fragments was
// discoverable only by running a real prod deploy. `node --test` (pnpm test:tools).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  API_PROD_COMPOSE_PATH,
  bootProbeSet,
  deployServiceSet,
} from "./service-set.mjs";
import {
  CONTAINER_PREFIX,
  bootProbeScript,
  verifyRunningShaScript,
} from "./verify-scripts.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SHA = "abcdef01abcdef01abcdef01abcdef01abcdef01";

/** The CURRENT tree's service set — the `origin/main` deploy target. */
const CURRENT = deployServiceSet(
  readFileSync(join(REPO_ROOT, ...API_PROD_COMPOSE_PATH.split("/")), "utf8"),
);

/**
 * The 3-service shape of 1455bb9c (the live prod SHA the first `--ref` hotfix
 * built on, before #1860 added `doctor`), trimmed to what the parser reads —
 * the same shape as `PRE_DOCTOR_COMPOSE` in service-set.test.mjs.
 */
const PRE_DOCTOR = deployServiceSet(`name: ds-api-prod

services:
  caddy:
    image: caddy:2

  api:
    image: ds-api:\${DEPLOY_SHA:-local}
    env_file: [/etc/ds-platform/api.env]

  portal:
    image: ds-portal:\${DEPLOY_SHA:-local}
    environment:
      PORT: "3001"

  admin:
    image: ds-admin:\${DEPLOY_SHA:-local}
    environment:
      PORT: "3002"
`);

const hasBash =
  spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

function assertBashSyntax(script) {
  const r = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(
    r.status,
    0,
    `bash -n rejected the generated script:\n${r.stderr}`,
  );
}

test("1905: the fixtures are the 4-probed current set and the 3-service pre-doctor set", () => {
  assert.deepEqual(
    PRE_DOCTOR.map((s) => s.name),
    ["api", "portal", "admin"],
  );
  assert.ok(CURRENT.some((s) => s.name === "doctor"));
});

for (const [label, services] of [
  ["current", CURRENT],
  ["pre-doctor", PRE_DOCTOR],
]) {
  test(`1905: verifyRunningShaScript inspects every ${label} container and asserts its SHA-tagged image`, () => {
    const script = verifyRunningShaScript(SHA, services);
    for (const s of services) {
      const container = `${CONTAINER_PREFIX}${s.name}-1`;
      assert.ok(
        script.includes(
          `sudo docker inspect ${container} --format '{{.Config.Image}}'`,
        ),
        `image read for ${container}`,
      );
      assert.ok(
        script.includes(
          `sudo docker inspect ${container} --format '{{.State.Health.Status}}'`,
        ),
        `health read for ${container}`,
      );
      assert.ok(
        script.includes(`= "ds-${s.name}:${SHA}" ]`),
        `image equality for ${s.name}`,
      );
    }
    const inspects = script.match(/sudo docker inspect /g) ?? [];
    assert.equal(inspects.length, services.length * 2);
    // One `[ img ] && [ health ]` pair per service, chained with `\` continuations.
    assert.equal(
      (script.match(/ \\\n {5}&& /g) ?? []).length,
      services.length - 1,
    );
    assert.match(script, /^deadline=\$\(\( \$\(date \+%s\) \+ 240 \)\)\n/);
  });

  test(`1905: bootProbeScript emits one probe line per ${label} probed service with its port`, () => {
    const probed = bootProbeSet(services);
    const script = bootProbeScript(SHA, probed);
    const lines = script.split("\n").filter((l) => l.startsWith("probe "));
    assert.deepEqual(
      lines,
      probed.map((s) => `probe ${s.name} ${s.image} ${s.port}`),
    );
    assert.ok(script.includes(`"$repo:${SHA}"`));
    assert.equal(
      lines.some((l) => l.startsWith("probe api ")),
      false,
      "the api is never boot-probed",
    );
  });

  test(
    `1905: the generated ${label} scripts are valid bash`,
    { skip: !hasBash && "bash not on PATH" },
    () => {
      assertBashSyntax(verifyRunningShaScript(SHA, services));
      assertBashSyntax(bootProbeScript(SHA, bootProbeSet(services)));
    },
  );
}

test("1905: the current set probes portal, admin, doctor and login on their pinned ports", () => {
  const lines = bootProbeScript(SHA, bootProbeSet(CURRENT))
    .split("\n")
    .filter((l) => l.startsWith("probe "));
  assert.deepEqual(lines, [
    "probe portal ds-portal 3001",
    "probe admin ds-admin 3002",
    "probe doctor ds-doctor 3004",
    "probe login ds-login 3005",
  ]);
});

test("1905: the pre-doctor set carries no doctor fragment in either script", () => {
  const verify = verifyRunningShaScript(SHA, PRE_DOCTOR);
  const boot = bootProbeScript(SHA, bootProbeSet(PRE_DOCTOR));
  assert.equal(verify.includes("doctor"), false);
  assert.equal(boot.includes("doctor"), false);
  assert.match(
    verify,
    /state="api=\$api_img\(\$api_h\) portal=\$portal_img\(\$portal_h\) admin=\$admin_img\(\$admin_h\)"/,
  );
});

test("1905: a hyphenated service name becomes a valid shell variable prefix", () => {
  const script = verifyRunningShaScript(SHA, [
    { name: "sms-aero", image: "ds-sms-aero" },
  ]);
  assert.ok(
    script.includes(
      `  sms_aero_img=$(sudo docker inspect ${CONTAINER_PREFIX}sms-aero-1 `,
    ),
  );
  assert.ok(script.includes(`[ "$sms_aero_img" = "ds-sms-aero:${SHA}" ]`));
  if (hasBash) assertBashSyntax(script);
});
