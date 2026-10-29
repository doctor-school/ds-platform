import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const workflows = new URL("../../.github/workflows/", import.meta.url);
const read = (name) => readFileSync(new URL(name, workflows), "utf8");
const writers = ["registry-retention.yml", "runtime-images.yml"];
const lock = {
  group: "registry-images",
  queue: "max",
  "cancel-in-progress": false,
};

it("registry publishers and retention hold the same workflow-wide queued lock", () => {
  // A job-level lock would leave the snapshot, verification or manifest outside
  // the critical section; a ref-dependent group would not exclude other runs.
  for (const name of writers) {
    assert.deepEqual(parse(read(name)).concurrency, lock, name);
  }
});

it("every workflow holding the registry write/delete token participates in the lock", () => {
  const tokenHolders = readdirSync(fileURLToPath(workflows))
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => read(name).includes("secrets.REGISTRY_PUSH_TOKEN"))
    .sort();
  // Adding a writer requires explicitly extending the shared critical section.
  assert.deepEqual(tokenHolders, writers);
  for (const name of tokenHolders) {
    assert.deepEqual(parse(read(name)).concurrency, lock, name);
  }
});
