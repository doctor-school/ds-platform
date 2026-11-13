import { describe, expect, it } from "vitest";

import {
  parseTrackQueues,
  renderTracksSection,
  resolveTrackQueues,
  type QueueIssue,
  type TrackQueueData,
} from "../../track-queues";

/**
 * #3942: the owner's order per product track lives in one docs file; bootstrap
 * and backlog:triage resolve it against live GitHub state and print the next
 * task per track, with Warnings rows for every way the queue can go stale.
 */
const FILE = `---
title: "Track queues"
---

# Track queues

\`\`\`yaml
academy:
  goal: Новая главная Академии
  queue: [10, 11, 12]
doctor:
  goal: Курс
  queue: [20, 21, 22]
\`\`\`
`;

const issue = (
  number: number,
  track: string,
  state: "open" | "closed" = "open",
): QueueIssue => ({ number, title: `Issue ${number}`, state, tracks: [track] });

const data = (over: Partial<TrackQueueData> = {}): TrackQueueData => ({
  issues: new Map(
    [
      issue(10, "track:academy"),
      issue(11, "track:academy"),
      issue(12, "track:academy"),
      issue(20, "track:doctor"),
      issue(21, "track:doctor"),
      issue(22, "track:doctor"),
    ].map((i) => [i.number, i]),
  ),
  claims: new Map(),
  blockers: new Map(),
  claimedOnTrack: new Map(),
  children: new Map(),
  parents: new Map(),
  ...over,
});

const parsed = () => {
  const p = parseTrackQueues(FILE);
  if (!p.ok) throw new Error(p.error);
  return p.tracks;
};

describe("track-queues reader (#3942)", () => {
  it("parses per-track goal + ordered Issue numbers, keyed by any track name", () => {
    const p = parseTrackQueues(FILE.replace("doctor:", "mobile:"));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.tracks).toEqual([
      {
        key: "academy",
        label: "track:academy",
        goal: "Новая главная Академии",
        items: [10, 11, 12],
      },
      {
        key: "mobile",
        label: "track:mobile",
        goal: "Курс",
        items: [20, 21, 22],
      },
    ]);
  });

  it("refuses a missing file and an unparsable or mis-shaped block", () => {
    expect(parseTrackQueues(null)).toEqual({
      ok: false,
      error: expect.stringContaining("missing"),
    });
    expect(parseTrackQueues("# no block").ok).toBe(false);
    expect(parseTrackQueues("```yaml\nacademy: [\n```").ok).toBe(false);
    expect(
      parseTrackQueues("```yaml\nacademy:\n  goal: x\n  queue: [a]\n```").ok,
    ).toBe(false);
    expect(parseTrackQueues("```yaml\nacademy:\n  queue: [1]\n```").ok).toBe(
      false,
    );
  });

  it("happy path: next = the first open unclaimed item", () => {
    const { tracks, warnings } = resolveTrackQueues(parsed(), data());
    expect(tracks.map((t) => t.next?.number)).toEqual([10, 20]);
    expect(warnings).toEqual([]);
  });

  it("skips closed items silently", () => {
    const d = data();
    d.issues.set(10, issue(10, "track:academy", "closed"));
    const { tracks, warnings } = resolveTrackQueues(parsed(), d);
    expect(tracks[0]!.next?.number).toBe(11);
    expect(warnings).toEqual([]);
  });

  it("a claimed head is in work; a second session gets the next unclaimed item", () => {
    const claim = {
      source: "start-comment" as const,
      ageMs: 7_200_000,
      session: "ds-platform-d5",
    };
    const { tracks } = resolveTrackQueues(
      parsed(),
      data({ claims: new Map([[20, claim]]) }),
    );
    expect(tracks[1]!.inWork.map((w) => w.number)).toEqual([20]);
    expect(tracks[1]!.next?.number).toBe(21);
    const out = renderTracksSection(tracks, "2026-11-11").join("\n");
    expect(out).toContain(
      "- in work #20 Issue 20 — IN-FLIGHT-ELSEWHERE (start-comment ds-platform-d5, age 2h)",
    );
    expect(out).toContain("- next #21 Issue 21");
  });

  it("prints each open blocker of the next item with its number, title and track", () => {
    const blockers = new Map([
      [10, [{ number: 99, title: "platform seam", track: "track:platform" }]],
    ]);
    const { tracks } = resolveTrackQueues(parsed(), data({ blockers }));
    expect(tracks[0]!.next?.number).toBe(10);
    const out = renderTracksSection(tracks, "2026-11-11");
    expect(out).toContain("### track:academy — Новая главная Академии");
    expect(out).toContain("  - blocked by #99 platform seam (track:platform)");
    expect(out.join("\n")).toContain("2026-11-11");
  });

  it("a failed blocked_by fetch renders the next item with blockers unknown, never as unblocked", () => {
    const { tracks } = resolveTrackQueues(
      parsed(),
      data({ blockers: new Map([[10, null]]) }),
    );
    expect(tracks[0]!.next?.number).toBe(10);
    expect(tracks[0]!.next?.blockers).toBeNull();
    const out = renderTracksSection(tracks, "2026-11-11");
    expect(out).toContain(
      "- next #10 Issue 10 — blockers unknown — see Warnings",
    );
    expect(out).not.toContain("- next #10 Issue 10");
  });

  it("warns (a) when a queue has fewer than two open items", () => {
    const d = data();
    d.issues.set(10, issue(10, "track:academy", "closed"));
    d.issues.set(11, issue(11, "track:academy", "closed"));
    const { warnings } = resolveTrackQueues(parsed(), d);
    expect(warnings).toEqual([
      {
        source: "track queue track:academy",
        message: expect.stringContaining("1 open item"),
      },
    ]);
  });

  it("warns (b) on product-track work claimed outside the queue and its blockers", () => {
    const blockers = new Map([
      [20, [{ number: 77, title: "seam", track: "track:doctor" }]],
    ]);
    const claimedOnTrack = new Map([
      [
        "track:doctor",
        [
          { number: 77, title: "seam" },
          { number: 55, title: "side quest" },
          { number: 21, title: "Issue 21" },
        ],
      ],
    ]);
    const { warnings } = resolveTrackQueues(
      parsed(),
      data({ blockers, claimedOnTrack }),
    );
    expect(warnings).toEqual([
      {
        source: "track queue track:doctor",
        message: expect.stringContaining("#55 side quest"),
      },
    ]);
  });

  it("warns (c) on a queue number with another track label or no Issue", () => {
    const d = data();
    d.issues.set(11, issue(11, "track:platform"));
    d.issues.set(12, null);
    const { tracks, warnings } = resolveTrackQueues(parsed(), d);
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("#11 carries track:platform"),
      expect.stringContaining("#12 does not exist"),
    ]);
    expect(tracks[0]!.next?.number).toBe(10);
  });

  it("an Issue whose state could not be read is unknown, never skipped as closed", () => {
    const d = data();
    d.issues.delete(10);
    const { tracks, warnings } = resolveTrackQueues(parsed(), d);
    expect(tracks[0]!.next).toBeUndefined();
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("#10 unreadable"),
    ]);
    expect(renderTracksSection(tracks, null).join("\n")).toContain(
      "- next (unknown — see Warnings)",
    );
  });

  it("renders (d) an unreadable source as unknown, and an empty queue as an owner question", () => {
    expect(renderTracksSection(null, null)).toEqual([
      "## Tracks",
      "(unknown — see Warnings)",
    ]);
    const d = data();
    for (const n of [10, 11, 12])
      d.issues.set(n, issue(n, "track:academy", "closed"));
    const { tracks } = resolveTrackQueues(parsed(), d);
    expect(tracks[0]!.next).toBeNull();
    expect(renderTracksSection(tracks, "2026-11-11").join("\n")).toContain(
      "- next (queue empty — ask the owner for the next order)",
    );
  });
});

describe("track queues hold outcome Issues — a parent expands to its next open child (#4053)", () => {
  const kids = (...spec: Array<[number, "open" | "closed"]>) =>
    spec.map(([n, s]) => issue(n, "track:academy", s));

  it("a parent with open children: next = its first open child, rendered as a step of the parent", () => {
    const children = new Map([
      [10, kids([30, "closed"], [31, "open"], [32, "open"])],
    ]);
    const { tracks, warnings } = resolveTrackQueues(
      parsed(),
      data({ children }),
    );
    expect(tracks[0]!.next).toMatchObject({
      number: 31,
      parent: { number: 10, title: "Issue 10" },
    });
    expect(warnings).toEqual([]);
    expect(renderTracksSection(tracks, "2026-11-13").join("\n")).toContain(
      "- next #31 Issue 31 — step of #10 Issue 10",
    );
  });

  it("skips a blocked first child for the first unblocked one; claims apply to children", () => {
    const claim = {
      source: "worktree" as const,
      ageMs: 60_000,
    };
    const children = new Map([
      [10, kids([30, "open"], [31, "open"], [32, "open"])],
    ]);
    const blockers = new Map([
      [31, [{ number: 99, title: "seam", track: "track:platform" }]],
    ]);
    const claimedOnTrack = new Map([
      ["track:academy", [{ number: 30, title: "Issue 30" }]],
    ]);
    const { tracks, warnings } = resolveTrackQueues(
      parsed(),
      data({
        children,
        blockers,
        claims: new Map([[30, claim]]),
        claimedOnTrack,
      }),
    );
    expect(tracks[0]!.inWork.map((w) => w.number)).toEqual([30]);
    expect(tracks[0]!.next?.number).toBe(32);
    // a claimed child of a queued parent is queue work, not work outside it
    expect(warnings).toEqual([]);
  });

  it("all open children blocked: next = the first open child with its blockers", () => {
    const children = new Map([[10, kids([30, "open"], [31, "open"])]]);
    const blockers = new Map([
      [30, [{ number: 98, title: "a", track: null }]],
      [31, [{ number: 99, title: "b", track: null }]],
    ]);
    const { tracks } = resolveTrackQueues(
      parsed(),
      data({ children, blockers }),
    );
    expect(tracks[0]!.next?.number).toBe(30);
    expect(renderTracksSection(tracks, "2026-11-13")).toContain(
      "  - blocked by #98 a (no track)",
    );
  });

  it("an open parent whose children are all closed warns (owner question) and yields to the next item", () => {
    const children = new Map([[10, kids([30, "closed"], [31, "closed"])]]);
    const { tracks, warnings } = resolveTrackQueues(
      parsed(),
      data({ children }),
    );
    expect(tracks[0]!.next?.number).toBe(11);
    expect(warnings).toEqual([
      {
        source: "track queue track:academy",
        message:
          "#10 is open with no open sub-issues — open the next slice or close it (ask the owner)",
      },
    ]);
  });

  it("an unreadable sub-issue list makes the item unknown, never a leaf", () => {
    const { tracks } = resolveTrackQueues(
      parsed(),
      data({ children: new Map([[10, null]]) }),
    );
    expect(tracks[0]!.next).toBeUndefined();
  });

  it("a closed step queued instead of its open, unqueued parent warns", () => {
    const d = data({
      parents: new Map([
        [10, { number: 40, title: "Feed epic", state: "open" as const }],
      ]),
    });
    d.issues.set(10, issue(10, "track:academy", "closed"));
    const { tracks, warnings } = resolveTrackQueues(parsed(), d);
    expect(tracks[0]!.next?.number).toBe(11);
    expect(warnings).toEqual([
      {
        source: "track queue track:academy",
        message: "#10 is a step of #40 Feed epic — queue #40 instead",
      },
    ]);
  });

  it("a plain closed leaf (no parent, or a closed / queued parent) is skipped silently", () => {
    const d = data({
      parents: new Map([
        [10, null],
        [11, { number: 41, title: "done", state: "closed" as const }],
        [12, { number: 20, title: "Issue 20", state: "open" as const }],
      ]),
    });
    d.issues.set(10, issue(10, "track:academy", "closed"));
    d.issues.set(11, issue(11, "track:academy", "closed"));
    d.issues.set(12, issue(12, "track:academy", "closed"));
    const { warnings } = resolveTrackQueues(parsed(), d);
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining("0 open items"),
    ]);
  });

  it("an open leaf with a parent is a legitimate queue item, no step warning", () => {
    const { tracks, warnings } = resolveTrackQueues(
      parsed(),
      data({
        parents: new Map([
          [10, { number: 40, title: "epic", state: "open" as const }],
        ]),
      }),
    );
    expect(tracks[0]!.next?.number).toBe(10);
    expect(warnings).toEqual([]);
  });
});
