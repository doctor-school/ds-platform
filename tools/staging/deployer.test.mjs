// tools/staging/deployer.test.mjs — Issue #2064 part 2a (staging tech spec §5
// «Converge», §8 step 4, §9).
//
// The regressions these lock: a fork or draft PR never gets a slot; a malformed pin
// never silently degrades to the live `main` head; `main` is never `down`ed; a slot
// whose GHCR tags are missing is SKIPPED and its existing slot left alone (a slow
// build must not become an outage); teardowns run before bring-ups so capacity frees
// first; an already-registered preview is not evicted by a newer PR; and one slot's
// failure never stops the others, while the tick still exits non-zero.
//
// All offline — GitHub, GHCR and the child process are injected. `tagsPresent` is a
// function so a test can answer per slot without a network.

import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEW_SLOT_CAP, SlotError, emptyRegistry, registerSlot } from "./slot.mjs";
import {
  GITHUB_API_VERSION,
  MANIFEST_ACCEPT,
  PIN_PATH,
  REPO,
  SLOT_CLI,
  capDesired,
  desiredSlots,
  ghcrTagProbePlan,
  parseArgs,
  parsePin,
  planTick,
  runTick,
  slotCommandArgv,
  tagsPresentFromResponses,
} from "./deployer.mjs";

const MAIN_SHA = "1111111111111111111111111111111111111111";
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function pull(number, overrides = {}) {
  return {
    number,
    draft: false,
    updated_at: `2026-09-${String(number).padStart(2, "0")}T00:00:00Z`,
    head: { sha: SHA_A, repo: { full_name: REPO } },
    ...overrides,
  };
}

function live(entries) {
  let registry = emptyRegistry();
  for (const [slot, sha] of Object.entries(entries)) {
    registry = registerSlot(registry, {
      slot,
      sha,
      redisDb: slot === "main" ? 0 : 1 + (Object.keys(registry.slots ?? {}).length % 15),
      hosts: [],
      updatedAt: "2026-09-10T00:00:00.000Z",
    });
  }
  return registry;
}

// --- desired state -----------------------------------------------------------

test("EARS: an open non-draft PR of this repository becomes a preview slot", () => {
  const desired = desiredSlots({ pulls: [pull(12)], mainHeadSha: MAIN_SHA });
  assert.deepEqual(desired, { main: MAIN_SHA, "pr-12": SHA_A });
});

test("a draft PR gets no slot", () => {
  const desired = desiredSlots({ pulls: [pull(12, { draft: true })], mainHeadSha: MAIN_SHA });
  assert.deepEqual(Object.keys(desired), ["main"]);
});

test("a fork PR gets no slot — its images can never be pushed to GHCR", () => {
  const fork = pull(12, { head: { sha: SHA_A, repo: { full_name: "someone/ds-platform" } } });
  const desired = desiredSlots({ pulls: [fork], mainHeadSha: MAIN_SHA });
  assert.deepEqual(Object.keys(desired), ["main"]);
});

test("previews are ordered by `updated_at`, newest first, after `main`", () => {
  const desired = desiredSlots({
    pulls: [
      pull(2, { updated_at: "2026-09-01T00:00:00Z" }),
      pull(9, { updated_at: "2026-09-09T00:00:00Z" }),
      pull(5, { updated_at: "2026-09-05T00:00:00Z" }),
    ],
    mainHeadSha: MAIN_SHA,
  });
  assert.deepEqual(Object.keys(desired), ["main", "pr-9", "pr-5", "pr-2"]);
});

test("a pin wins over the live `main` head", () => {
  const desired = desiredSlots({
    pulls: [],
    mainHeadSha: MAIN_SHA,
    pin: { sha: SHA_B },
  });
  assert.equal(desired.main, SHA_B);
});

test("a malformed pin fails closed and names the file, never degrading to the head", () => {
  assert.throws(() => parsePin("{ not json", PIN_PATH), (err) => {
    assert.ok(err instanceof SlotError);
    assert.match(err.message, /main-pin\.json/);
    return true;
  });
  assert.throws(
    () => parsePin(JSON.stringify({ sha: "abc" }), PIN_PATH),
    /does not hold a full commit SHA/,
  );
  assert.deepEqual(parsePin(JSON.stringify({ sha: SHA_B, pinnedAt: "x" })), {
    sha: SHA_B,
    pinnedAt: "x",
  });
});

test("an unusable `main` commit is refused rather than converged on", () => {
  assert.throws(() => desiredSlots({ pulls: [], mainHeadSha: undefined }), SlotError);
});

// --- capacity ----------------------------------------------------------------

test("four desired previews with two registered keep the incumbents plus the newest waiting one", () => {
  const desired = desiredSlots({
    pulls: [
      pull(1, { updated_at: "2026-09-01T00:00:00Z" }),
      pull(2, { updated_at: "2026-09-02T00:00:00Z" }),
      pull(3, { updated_at: "2026-09-03T00:00:00Z" }),
      pull(4, { updated_at: "2026-09-04T00:00:00Z" }),
    ],
    mainHeadSha: MAIN_SHA,
  });
  const registry = live({ main: MAIN_SHA, "pr-1": SHA_A, "pr-2": SHA_A });
  const { desired: capped, waiting } = capDesired(desired, registry, PREVIEW_SLOT_CAP);
  assert.deepEqual(Object.keys(capped).sort(), ["main", "pr-1", "pr-2", "pr-4"].sort());
  assert.deepEqual(waiting, ["pr-3"]);
});

test("incumbency beats recency: a live old preview is never evicted for a newer PR", () => {
  const desired = desiredSlots({
    pulls: [
      pull(1, { updated_at: "2026-01-01T00:00:00Z" }),
      pull(2, { updated_at: "2026-09-02T00:00:00Z" }),
      pull(3, { updated_at: "2026-09-03T00:00:00Z" }),
      pull(4, { updated_at: "2026-09-04T00:00:00Z" }),
    ],
    mainHeadSha: MAIN_SHA,
  });
  const registry = live({ "pr-1": SHA_A });
  const { desired: capped, waiting } = capDesired(desired, registry, PREVIEW_SLOT_CAP);
  assert.ok(Object.hasOwn(capped, "pr-1"));
  assert.deepEqual(waiting, ["pr-2"]);
});

// --- the tick plan -----------------------------------------------------------

test("EARS: a fresh box with one open PR whose images exist plans exactly one `up`", () => {
  const desired = desiredSlots({ pulls: [pull(12)], mainHeadSha: MAIN_SHA });
  const plan = planTick({ desired, registry: emptyRegistry(), tagsPresent: () => true });
  assert.deepEqual(
    plan.map((entry) => [entry.slot, entry.action]),
    [
      ["main", "up"],
      ["pr-12", "up"],
    ],
  );
});

test("a closed PR's slot is `down`ed, and the downs come before the ups", () => {
  const desired = desiredSlots({ pulls: [pull(12)], mainHeadSha: MAIN_SHA });
  const registry = live({ main: MAIN_SHA, "pr-99": SHA_B });
  const plan = planTick({ desired, registry, tagsPresent: () => true });
  assert.equal(plan[0].slot, "pr-99");
  assert.equal(plan[0].action, "down");
  assert.ok(plan.findIndex((e) => e.action === "up") > 0);
});

test("a PR turned back to draft is `down`ed like a closed one", () => {
  const desired = desiredSlots({ pulls: [pull(12, { draft: true })], mainHeadSha: MAIN_SHA });
  const registry = live({ "pr-12": SHA_A });
  const plan = planTick({ desired, registry, tagsPresent: () => true });
  assert.deepEqual(
    plan.filter((entry) => entry.action === "down").map((entry) => entry.slot),
    ["pr-12"],
  );
});

test("a moved head is a `sync`, and an unchanged one is a `skip`", () => {
  const desired = desiredSlots({ pulls: [pull(12, { head: { sha: SHA_B, repo: { full_name: REPO } } })], mainHeadSha: MAIN_SHA });
  const registry = live({ main: MAIN_SHA, "pr-12": SHA_A });
  const plan = planTick({ desired, registry, tagsPresent: () => true });
  const bySlot = Object.fromEntries(plan.map((entry) => [entry.slot, entry]));
  assert.equal(bySlot["pr-12"].action, "sync");
  assert.match(bySlot["pr-12"].reason, /head moved/);
  assert.equal(bySlot.main.action, "skip");
});

test("missing images `skip` the slot and leave an existing one untouched", () => {
  const desired = desiredSlots({ pulls: [pull(12)], mainHeadSha: MAIN_SHA });
  const registry = live({ main: MAIN_SHA, "pr-12": SHA_A });
  const plan = planTick({
    desired,
    registry,
    tagsPresent: (slot) => (slot === "pr-12" ? "images not published (api: HTTP 404)" : true),
  });
  const entry = plan.find((candidate) => candidate.slot === "pr-12");
  assert.equal(entry.action, "skip");
  assert.match(entry.reason, /images not published/);
  assert.ok(!plan.some((candidate) => candidate.action === "down"));
});

test("`main` is never `down`ed, even when it is somehow not in the desired set", () => {
  const registry = live({ main: MAIN_SHA });
  const plan = planTick({ desired: {}, registry, tagsPresent: () => true });
  assert.deepEqual(plan, []);
});

// --- the GHCR probe ----------------------------------------------------------

test("the tag probe is anonymous, asks for all three manifest media types, and covers every image", () => {
  const plan = ghcrTagProbePlan("pr-12", SHA_A);
  assert.equal(plan.length, 5);
  for (const image of plan) {
    assert.match(image.token.url, /^https:\/\/ghcr\.io\/token\?service=ghcr\.io&scope=repository:doctor-school\/ds-platform\//);
    assert.ok(!("Authorization" in image.token.headers));
    assert.equal(image.manifest.headers.Accept, MANIFEST_ACCEPT);
    assert.match(image.manifest.url, /\/manifests\/pr-12-aaaaaaa$/);
  }
});

test("only 200 is «present»: 401, 404 and a network error are all «tags missing»", () => {
  assert.equal(
    tagsPresentFromResponses([{ app: "api", status: 200 }]).present,
    true,
  );
  for (const result of [
    { app: "api", status: 404 },
    { app: "api", status: 401 },
    { app: "api", error: "getaddrinfo ENOTFOUND ghcr.io" },
  ]) {
    const verdict = tagsPresentFromResponses([result, { app: "portal", status: 200 }]);
    assert.equal(verdict.present, false);
    assert.match(verdict.reason, /images not published/);
  }
});

// --- the executor ------------------------------------------------------------

test("a converge entry becomes an argv of the `ds-slot` wrapper; `down` carries no SHA", () => {
  assert.deepEqual(slotCommandArgv({ slot: "pr-12", action: "up", sha: SHA_A }), [
    SLOT_CLI,
    "up",
    "pr-12",
    SHA_A,
  ]);
  assert.deepEqual(slotCommandArgv({ slot: "pr-12", action: "down", sha: SHA_A }), [
    SLOT_CLI,
    "down",
    "pr-12",
  ]);
  assert.throws(() => slotCommandArgv({ slot: "pr-12", action: "skip" }), SlotError);
});

test("one slot's failure does not stop the others, and the tick reports it", async () => {
  const ran = [];
  const plan = [
    { slot: "pr-1", action: "up", sha: SHA_A, reason: "not registered" },
    { slot: "pr-2", action: "up", sha: SHA_A, reason: "not registered" },
    { slot: "pr-3", action: "skip", sha: SHA_A, reason: "already on aaaaaaa" },
  ];
  const { failures } = await runTick(plan, {
    exec: (argv) => {
      ran.push(argv.join(" "));
      if (argv.includes("pr-1")) throw new Error("migrate exited 1");
    },
  });
  assert.deepEqual(ran, [
    `${SLOT_CLI} up pr-1 ${SHA_A}`,
    `${SLOT_CLI} up pr-2 ${SHA_A}`,
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].slot, "pr-1");
  assert.match(failures[0].message, /migrate exited 1/);
});

test("the log names the slot and the action of every failure (§9 journal row)", async () => {
  const lines = [];
  await runTick([{ slot: "pr-1", action: "sync", sha: SHA_A, reason: "head moved from bbbbbbb" }], {
    log: (line) => lines.push(line),
    exec: () => {
      throw new Error("pull failed");
    },
  });
  assert.ok(lines.some((line) => /FAILED sync pr-1: pull failed/.test(line)));
});

// --- the CLI -----------------------------------------------------------------

test("the deployer CLI takes exactly `tick`", () => {
  assert.deepEqual(parseArgs(["tick"]), { command: "tick" });
  assert.throws(() => parseArgs([]), SlotError);
  assert.throws(() => parseArgs(["tick", "pr-1"]), SlotError);
  assert.throws(() => parseArgs(["converge"]), SlotError);
});

test("the GitHub API version is pinned", () => {
  assert.equal(GITHUB_API_VERSION, "2022-11-28");
});
