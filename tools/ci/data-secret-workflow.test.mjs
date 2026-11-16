// Issue #4068: data-secret.yml, the data-box secret rotation on the release path
// (spec §5 «Data-prod verbs.» → secret-apply).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

import { parse } from "yaml";

const read = (name) =>
  readFileSync(
    new URL(`../../.github/workflows/${name}`, import.meta.url),
    "utf8",
  );
const wf = parse(read("data-secret.yml"));
const job = wf.jobs["data-secret"];
const step = (name) => job.steps.find((s) => s.name === name);

it("4068: holds the release's concurrency group and Environment, never cancelled", () => {
  assert.deepEqual(wf.concurrency, parse(read("deploy-prod.yml")).concurrency);
  assert.deepEqual(job.environment, { name: "production", deployment: false });
  assert.deepEqual(wf.permissions, { contents: "read" });
});

it("4068: apply needs the owner's word, a full SHA and one base64 ciphertext line — and echoes none of them back", () => {
  const check = step("Check the inputs");
  assert.match(check.run, /owner_quote is empty/);
  assert.match(check.run, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(check.run, /\^\[A-Za-z0-9\+\/\]\+=\{0,2\}\$/);
  assert.doesNotMatch(
    check.run,
    /echo[^\n]*\$(CIPHERTEXT|OWNER_QUOTE)\b(?!\})/,
  );
  assert.equal(job.steps.indexOf(check), 0, "the first step");
});

it("4068: no workflow secret or input carries a data-box value: the ssh key pair only", () => {
  const text = read("data-secret.yml");
  assert.deepEqual([...new Set(text.match(/secrets\.[A-Z_]+/g))].sort(), [
    "secrets.PROD_SSH_KEY",
    "secrets.PROD_SSH_KNOWN_HOSTS",
  ]);
  assert.deepEqual(Object.keys(wf.on.workflow_dispatch.inputs), [
    "action",
    "sha",
    "owner_quote",
    "ciphertext",
  ]);
});

it("4068: apply calls only the relay verbs, closes the attempt with finish and always removes the key", () => {
  const apply = step("Apply, poll and close the rotation");
  assert.equal(apply.if, "inputs.action == 'apply'");
  const verbs = [...apply.run.matchAll(/box "([a-z-]+) prod/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(verbs, [
    "data-secret-apply",
    "data-secret-status",
    "data-secret-finish",
  ]);
  assert.match(
    apply.run,
    /node tools\/deploy\/data-secret\.mjs verdict "\$SHA"/,
  );
  assert.match(
    step("Print the intake certificate").run,
    /"data-secret-recipient prod"/,
  );
  assert.equal(step("Remove the ssh key").if, "always()");
});
