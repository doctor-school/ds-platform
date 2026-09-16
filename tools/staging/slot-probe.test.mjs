import test from "node:test";
import assert from "node:assert/strict";

import { probeStageSlots, renderStageSlotSection } from "./slot-probe.mjs";

const HEAD = "162341f4c0de1234567890abcdef1234567890ab";

/** A `gh pr view` payload for an OPEN PR carrying one Stage-B request comment. */
function openPr(number, { comments = [], commits = [] } = {}) {
  return {
    state: "OPEN",
    headRefOid: HEAD,
    commits,
    comments,
  };
}

const REQUEST_BODY = `## Stage-B request\nslot: pr-${2229}\nhead: ${HEAD.slice(0, 8)}\n`;

test("box unreachable: the section degrades to `unavailable` and prints no slot rows", async () => {
  const probe = await probeStageSlots({
    readSlots: async () => {
      throw new Error(
        "ssh: connect to host nonexistent.invalid: no route\nextra noise",
      );
    },
    viewPr: async () =>
      assert.fail("gh must not be called when the box is unreachable"),
  });

  assert.equal(probe.rows.length, 0);
  assert.match(
    probe.error,
    /^ssh: connect to host nonexistent\.invalid: no route$/,
  );
  assert.deepEqual(
    probe.warnings.map((w) => w.source),
    ["stage-1 live slots"],
  );

  const lines = renderStageSlotSection(probe);
  assert.deepEqual(lines, [
    "stage-1: unavailable (ssh: connect to host nonexistent.invalid: no route)",
  ]);
  assert.equal(
    lines.some((l) => /0 slots|no live slots/.test(l)),
    false,
  );
});

test("the ssh probe is aborted when it outlives the bound", async () => {
  let seenSignal = null;
  const probe = await probeStageSlots({
    timeoutMs: 20,
    readSlots: async ({ signal }) => {
      seenSignal = signal;
      await new Promise((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
      });
      throw new Error("aborted");
    },
    viewPr: async () => assert.fail("gh must not be called after a timeout"),
  });

  assert.ok(seenSignal?.aborted, "readSlots must receive an aborted signal");
  assert.match(probe.error, /timed out/);
  assert.deepEqual(probe.rows, []);
});

test("a failing `gh pr view` reads gh-error, never no-open-pr", async () => {
  const probe = await probeStageSlots({
    readSlots: async () => ({ "pr-2229": {}, "pr-2205": {} }),
    viewPr: async (number) => {
      if (number === 2229) throw new Error("gh: HTTP 502");
      return openPr(number, {
        comments: [{ createdAt: "2026-09-16T10:05:00Z", body: REQUEST_BODY }],
      });
    },
  });

  const row = probe.rows.find((r) => r.slot === "pr-2229");
  assert.equal(row.status, "gh-error");
  assert.notEqual(row.status, "no-open-pr");
  assert.deepEqual(
    probe.warnings.map((w) => w.source),
    ["gh pr view 2229 (stage slot)"],
  );
  assert.match(renderStageSlotSection(probe).join("\n"), /pr-2229\s+gh-error/);
});

test("happy path: aligned rows, `main` persistent, a fresh request unflagged", async () => {
  const probe = await probeStageSlots({
    readSlots: async () => ({ main: {}, "pr-2229": {} }),
    viewPr: async (number) =>
      openPr(number, {
        comments: [{ createdAt: "2026-09-16T10:05:00Z", body: REQUEST_BODY }],
      }),
  });

  assert.equal(probe.error, null);
  assert.deepEqual(probe.warnings, []);
  assert.deepEqual(
    probe.rows.map((r) => r.status),
    ["persistent", "fresh"],
  );

  const lines = renderStageSlotSection(probe);
  assert.equal(lines.length, 3, "two rows plus the legend");
  // Aligned columns: every row line has its status starting at the same offset.
  const offsets = lines
    .slice(0, 2)
    .map((l) => l.indexOf(l.trim().split(/\s+/)[1]));
  assert.equal(new Set(offsets).size, 1);
  assert.equal(lines[0].startsWith("⚠"), false);
  assert.equal(lines[1].startsWith("⚠"), false);
});

test("a slot with no request is flagged", async () => {
  const probe = await probeStageSlots({
    readSlots: async () => ({ "pr-2229": {} }),
    viewPr: async (number) => openPr(number),
  });
  assert.equal(probe.rows[0].status, "no-request");
  assert.equal(renderStageSlotSection(probe)[0].startsWith("⚠"), true);
});

test("headPushedAt is the MAXIMUM committedDate, not the last list entry", async () => {
  const probe = await probeStageSlots({
    readSlots: async () => ({ "pr-2229": {} }),
    viewPr: async (number) =>
      openPr(number, {
        // A rebase can leave an older committedDate last in the list.
        commits: [
          { committedDate: "2026-09-16T12:00:00Z" },
          { committedDate: "2026-09-16T09:00:00Z" },
        ],
        comments: [
          // Headless request written BEFORE the newest commit ⇒ stale.
          {
            createdAt: "2026-09-16T11:00:00Z",
            body: "## Stage-B request\nslot: pr-2229\n",
          },
        ],
      }),
  });
  assert.equal(probe.rows[0].status, "stale-request");
});
