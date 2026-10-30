import assert from "node:assert/strict";
import { test } from "node:test";

import { laneCandidate, openRuns, renderLane } from "./release-lane.mjs";

const sha = (n) => String(n).padStart(40, "0");
// main, newest first: sha(10) is head … sha(1) the oldest
const history = Array.from({ length: 10 }, (_, i) => sha(10 - i));
const reader = (states) => async (s) => states[s] ?? null;

test("the candidate is the newest stage-green main SHA, not main head", async () => {
  const states = {
    [sha(10)]: "pending",
    [sha(9)]: "failure",
    [sha(8)]: null,
    [sha(7)]: "success",
    [sha(5)]: "success",
  };
  const c = await laneCandidate({
    history,
    readState: reader(states),
    productionSha: sha(4),
  });
  assert.equal(c.sha, sha(7));
  assert.equal(c.behindHead, 3);
  assert.equal(c.relation, "ahead");
  assert.equal(c.walked, 4);
});

test("a candidate equal to or older than production is not releasable", async () => {
  const live = await laneCandidate({
    history,
    readState: reader({ [sha(6)]: "success" }),
    productionSha: sha(6),
  });
  assert.equal(live.relation, "live");
  const behind = await laneCandidate({
    history,
    readState: reader({ [sha(3)]: "success" }),
    productionSha: sha(6),
  });
  assert.equal(behind.relation, "behind");
  const unknown = await laneCandidate({
    history,
    readState: reader({ [sha(3)]: "success" }),
    productionSha: sha(99),
  });
  assert.equal(unknown.relation, "unknown");
});

test("no candidate: none green, or an unreadable status stops the walk", async () => {
  const none = await laneCandidate({
    history,
    readState: reader({}),
    productionSha: sha(1),
  });
  assert.equal(none.sha, null);
  assert.equal(none.walked, 10);
  assert.match(
    renderLane({
      productionSha: sha(1),
      head: sha(10),
      candidate: none,
      stage: [],
      images: [],
      deploy: [],
    }),
    /none — no green stage-suite in the newest 10/,
  );
  const blind = await laneCandidate({
    history,
    readState: async (s) => {
      if (s === sha(9)) throw new Error("HTTP 502");
      return s === sha(8) ? "success" : "failure";
    },
    productionSha: sha(1),
  });
  assert.equal(blind.sha, null);
  assert.deepEqual(blind.unreadable, { sha: sha(9), message: "HTTP 502" });
});

test("only unfinished runs are queued, oldest first; a pending deploy is flagged", () => {
  const run = (status, created_at, extra = {}) => ({
    status,
    created_at,
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: sha(10),
    html_url: "u",
    pull_requests: [],
    ...extra,
  });
  const deploy = openRuns([
    run("pending", "2026-10-30T10:05:00Z"),
    run("completed", "2026-10-30T09:00:00Z"),
    run("in_progress", "2026-10-30T10:00:00Z"),
  ]);
  assert.deepEqual(
    deploy.map((r) => r.status),
    ["in_progress", "pending"],
  );
  const text = renderLane({
    productionSha: sha(4),
    head: sha(10),
    candidate: {
      sha: sha(7),
      behindHead: 3,
      relation: "ahead",
      walked: 4,
      unreadable: null,
    },
    stage: [],
    images: [
      run("queued", "2026-10-30T10:01:00Z", {
        event: "pull_request",
        head_branch: "fix/1-x",
        pull_requests: [{ number: 1 }],
      }),
    ],
    deploy,
  });
  assert.match(
    text,
    /Release candidate: {2}0{39}7 \(3 commit\(s\) behind head; releasable/,
  );
  assert.match(
    text,
    /Image builds \(runtime-images\.yml\): 1\n {4}queued {6}000000000 {2}PR #1 \(fix\/1-x\)/,
  );
  assert.match(text, /Deploy queue \(deploy-prod\.yml\): 2/);
  assert.match(text, /a deploy is already pending/);
  assert.match(text, /Stage main \(stage\.yml\): idle/);
});
