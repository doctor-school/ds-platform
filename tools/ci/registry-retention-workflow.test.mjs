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

// runtime-images.yml: main / hotfix / dispatch runs hold the lock; a pull_request run
// takes a per-PR cancelling group (#3561) and is safe outside the lock only because
// its digests are unique to one head (the revision label below).
const publisherConcurrency = {
  group:
    "${{ github.event_name == 'pull_request' && format('runtime-images-pr-{0}', github.event.pull_request.number) || 'registry-images' }}",
  queue: "${{ github.event_name == 'pull_request' && 'single' || 'max' }}",
  "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
};
const expected = {
  "registry-retention.yml": lock,
  "runtime-images.yml": publisherConcurrency,
};

it("retention and every non-PR publisher run hold the same workflow-wide queued lock", () => {
  // A job-level lock would leave the snapshot, verification or manifest outside
  // the critical section; a ref-dependent group would not exclude other runs.
  for (const name of writers) {
    assert.deepEqual(parse(read(name)).concurrency, expected[name], name);
  }
});

it("a PR image run outside the lock builds digests unique to its head (#3144)", () => {
  // Without the head SHA in the image config an image-neutral push re-tags the old
  // head's digest, which a concurrent retention run may be deleting.
  const build = parse(read("runtime-images.yml")).jobs.build.steps.find(
    (step) => step.id === "build",
  );
  assert.equal(
    build.with.labels,
    "${{ github.event_name == 'pull_request' && format('org.opencontainers.image.revision={0}', needs.plan.outputs.sha) || '' }}",
  );
});

it("every workflow holding the registry write/delete token participates in the lock", () => {
  const tokenHolders = readdirSync(fileURLToPath(workflows))
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => read(name).includes("secrets.REGISTRY_PUSH_TOKEN"))
    .sort();
  // Adding a writer requires explicitly extending the shared critical section.
  assert.deepEqual(tokenHolders, writers);
  for (const name of tokenHolders) {
    assert.deepEqual(parse(read(name)).concurrency, expected[name], name);
  }
});
