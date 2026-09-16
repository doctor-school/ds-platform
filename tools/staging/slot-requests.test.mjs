import test from "node:test";
import assert from "node:assert/strict";

import { classifySlotRequests, parseRequestComment } from "./slot-requests.mjs";

const HEAD = "162341f4c0de1234567890abcdef1234567890ab";
const OLD_HEAD = "0badbeef00001234567890abcdef1234567890ab";

/** A PR entry with one request comment carrying `head`. */
function prWithHeadComment(head, commentHead) {
  return {
    headSha: head,
    headPushedAt: "2026-09-16T10:00:00Z",
    requestComments: [{ createdAt: "2026-09-16T10:05:00Z", head: commentHead }],
  };
}

test("fresh: the request comment pins the current head", () => {
  const out = classifySlotRequests({
    liveSlots: ["pr-2229"],
    prs: new Map([[2229, prWithHeadComment(HEAD, HEAD.slice(0, 8))]]),
  });
  assert.deepEqual(out, [
    { slot: "pr-2229", pr: 2229, status: "fresh", head: HEAD },
  ]);
});

test("fresh: no head in the comment, but it was written after the head was pushed", () => {
  const out = classifySlotRequests({
    liveSlots: ["pr-2229"],
    prs: new Map([
      [
        2229,
        {
          headSha: HEAD,
          headPushedAt: "2026-09-16T10:00:00Z",
          requestComments: [{ createdAt: "2026-09-16T10:00:00Z", head: null }],
        },
      ],
    ]),
  });
  assert.equal(out[0].status, "fresh");
});

test("stale-request: the request pins a head the PR has moved past", () => {
  const out = classifySlotRequests({
    liveSlots: ["pr-2205"],
    prs: new Map([[2205, prWithHeadComment(HEAD, OLD_HEAD.slice(0, 8))]]),
  });
  assert.equal(out[0].status, "stale-request");
});

test("stale-request: a headless request written before the current head was pushed", () => {
  const out = classifySlotRequests({
    liveSlots: ["pr-2205"],
    prs: new Map([
      [
        2205,
        {
          headSha: HEAD,
          headPushedAt: "2026-09-16T12:00:00Z",
          requestComments: [{ createdAt: "2026-09-16T10:05:00Z", head: null }],
        },
      ],
    ]),
  });
  assert.equal(out[0].status, "stale-request");
});

test("no-request: the slot is live and the PR carries no Stage-B request", () => {
  const out = classifySlotRequests({
    liveSlots: ["pr-2229"],
    prs: new Map([
      [
        2229,
        {
          headSha: HEAD,
          headPushedAt: "2026-09-16T10:00:00Z",
          requestComments: [],
        },
      ],
    ]),
  });
  assert.deepEqual(out, [
    { slot: "pr-2229", pr: 2229, status: "no-request", head: HEAD },
  ]);
});

test("no-open-pr: a slot whose PR is merged, closed or unknown", () => {
  const out = classifySlotRequests({
    liveSlots: ["pr-1999"],
    prs: new Map(),
  });
  assert.deepEqual(out, [
    { slot: "pr-1999", pr: 1999, status: "no-open-pr", head: null },
  ]);
});

test("main is persistent and is never flagged", () => {
  const out = classifySlotRequests({ liveSlots: ["main"], prs: new Map() });
  assert.deepEqual(out, [
    { slot: "main", pr: null, status: "persistent", head: null },
  ]);
});

test("a mixed list keeps the order it was given", () => {
  const prs = new Map([
    [2229, prWithHeadComment(HEAD, null)],
    [2205, prWithHeadComment(HEAD, OLD_HEAD)],
  ]);
  prs.get(2229).requestComments = [];
  const out = classifySlotRequests({
    liveSlots: ["pr-2229", "main", "pr-2205", "pr-1999"],
    prs,
  });
  assert.deepEqual(
    out.map((r) => [r.slot, r.status]),
    [
      ["pr-2229", "no-request"],
      ["main", "persistent"],
      ["pr-2205", "stale-request"],
      ["pr-1999", "no-open-pr"],
    ],
  );
});

test("parseRequestComment reads the heading and the head line", () => {
  const body = [
    "## Stage-B request",
    "",
    "slot: pr-2229",
    `head: ${HEAD}`,
    "academy: https://academy-pr-2229.stage.doctor.school",
  ].join("\n");
  assert.deepEqual(parseRequestComment(body), { head: HEAD });
});

test("parseRequestComment accepts a request with no head line", () => {
  assert.deepEqual(parseRequestComment("# Stage-B request\nslot: pr-1\n"), {
    head: null,
  });
});

test("parseRequestComment ignores a comment that merely mentions Stage-B", () => {
  assert.equal(parseRequestComment("Stage-B: GO\nStage-B-head: abc1234"), null);
  assert.equal(parseRequestComment(""), null);
  assert.equal(parseRequestComment(null), null);
});
