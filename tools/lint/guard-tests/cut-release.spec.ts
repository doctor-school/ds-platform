import { describe, expect, it } from "vitest";

// Pure seams exported from the L1 release-tag cutter (Issue #943, W3/L1 of #927).
// Importing them does NOT fire the script's `cutRelease()` I/O seam — it is guarded
// behind an entry-point check, the same idiom as tools/deploy/release-notes.mjs.
// The tag format `release-YYYY.MM.DD-<n>` (spec §D6) is deterministic and injected:
// `dateStr` is passed by the caller so the pure fn never reads the clock.
import {
  cutDeployRelease,
  latestReleaseTag,
  nextReleaseTag,
  parseReleaseTag,
  shouldCutDeployRelease,
} from "../../release/cut-release.mjs";

// ── parseReleaseTag (pure) ──────────────────────────────────────────────────
describe("cut-release — parseReleaseTag (pure)", () => {
  it("parses a well-formed tag into { date, ordinal }", () => {
    expect(parseReleaseTag("release-2026.07.15-3")).toEqual({
      date: "2026.07.15",
      ordinal: 3,
    });
  });

  it("returns null for a malformed / unrelated tag", () => {
    expect(parseReleaseTag("v1.2.3")).toBeNull();
    expect(parseReleaseTag("release-bogus")).toBeNull();
    expect(parseReleaseTag("release-2026.07.15")).toBeNull();
    expect(parseReleaseTag("release-2026.7.15-1")).toBeNull();
    expect(parseReleaseTag("")).toBeNull();
    expect(parseReleaseTag(undefined as unknown as string)).toBeNull();
  });
});

// ── nextReleaseTag (pure) ───────────────────────────────────────────────────
describe("cut-release — nextReleaseTag (pure)", () => {
  it("first tag of a day (empty tag list) → -1", () => {
    expect(nextReleaseTag([], "2026.07.15")).toBe("release-2026.07.15-1");
  });

  it("same-day increment off the existing tags → max+1", () => {
    expect(
      nextReleaseTag(
        ["release-2026.07.15-1", "release-2026.07.15-2"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-3");
  });

  it("cross-day isolation: yesterday's tags do not raise today's ordinal → -1", () => {
    expect(
      nextReleaseTag(
        ["release-2026.07.14-1", "release-2026.07.14-9"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-1");
  });

  it("malformed / unrelated tags are ignored", () => {
    expect(
      nextReleaseTag(
        ["v1.2.3", "release-bogus", "release-2026.07.15-1", "not-a-tag"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-2");
  });

  it("non-contiguous ordinals → max+1, not count+1", () => {
    expect(
      nextReleaseTag(
        ["release-2026.07.15-1", "release-2026.07.15-4"],
        "2026.07.15",
      ),
    ).toBe("release-2026.07.15-5");
  });

  it("non-array tag input → -1 (defensive)", () => {
    expect(nextReleaseTag(undefined as unknown as string[], "2026.07.15")).toBe(
      "release-2026.07.15-1",
    );
  });
});

// ── latestReleaseTag (pure) — #996/§10.5, Option A ──────────────────────────
describe("cut-release — latestReleaseTag (pure)", () => {
  it("empty / no matching tags → null", () => {
    expect(latestReleaseTag([])).toBeNull();
    expect(latestReleaseTag(["v1.2.3", "not-a-tag"])).toBeNull();
    expect(latestReleaseTag(undefined as unknown as string[])).toBeNull();
  });

  it("single tag → that tag", () => {
    expect(latestReleaseTag(["release-2026.07.15-1"])).toBe(
      "release-2026.07.15-1",
    );
  });

  it("picks the most recent by (date, ordinal) across days, order-independent", () => {
    expect(
      latestReleaseTag([
        "release-2026.07.15-2",
        "release-2026.07.16-1",
        "release-2026.07.14-9",
      ]),
    ).toBe("release-2026.07.16-1");
  });

  it("ordinal is compared numerically, not lexically (-10 beats -2)", () => {
    expect(
      latestReleaseTag(["release-2026.07.16-2", "release-2026.07.16-10"]),
    ).toBe("release-2026.07.16-10");
  });

  it("malformed / unrelated tags are ignored", () => {
    expect(
      latestReleaseTag([
        "v1.2.3",
        "release-bogus",
        "release-2026.07.16-1",
        "release-2026.7.16-9",
      ]),
    ).toBe("release-2026.07.16-1");
  });
});

// ── shouldCutDeployRelease (pure, non-empty-range guard) — #996/§10.5 ────────
describe("cut-release — shouldCutDeployRelease (pure)", () => {
  it("no prior release tag (first ever release) → cut", () => {
    expect(
      shouldCutDeployRelease({
        latestReleaseSha: null,
        deployedSha: "abc1234",
      }).cut,
    ).toBe(true);
  });

  it("no deployed SHA → skip (defensive)", () => {
    expect(
      shouldCutDeployRelease({
        latestReleaseSha: "aaa",
        deployedSha: "",
      }).cut,
    ).toBe(false);
  });

  it("redeploy of an already-released SHA (equal → empty range) → skip", () => {
    expect(
      shouldCutDeployRelease({
        latestReleaseSha: "deadbeef",
        deployedSha: "deadbeef",
        releaseIsAncestor: true,
      }).cut,
    ).toBe(false);
  });

  it("deployed SHA NOT a descendant of the latest release (behind / diverged) → skip", () => {
    expect(
      shouldCutDeployRelease({
        latestReleaseSha: "aaaa111",
        deployedSha: "bbbb222",
        releaseIsAncestor: false,
      }).cut,
    ).toBe(false);
  });

  // The single load-bearing case (spec §10.5, sanity-checked against a concrete
  // forward deploy per feedback_sanity_check_formal_notation_before_review): the
  // latest release (447c3c5, current prod) is a strict ancestor of the deployed
  // SHA (d565767 = #994 on origin/main) → range `latestReleaseSha..deployedSha`
  // is non-empty → CUT. The #998 review caught the operands inverted; this pins
  // the corrected direction so a regression can't reintroduce the empty-cut bug.
  it("forward deploy: latest release is a strict ancestor of the deployed SHA → cut", () => {
    const decision = shouldCutDeployRelease({
      latestReleaseSha: "447c3c5",
      deployedSha: "d565767",
      releaseIsAncestor: true,
    });
    expect(decision.cut).toBe(true);
    expect(decision.reason).toMatch(/new commits/i);
  });
});

// ── cutDeployRelease (I/O seam, injected `run`) — target-SHA plumbing ────────
// The seam never throws and returns { cut, tag?, reason }. We inject a fake `run`
// that routes each `git`/`gh` invocation to a canned result and records the calls,
// so we can assert the range-guard branch taken AND that `gh release create`
// targets the DEPLOYED sha (not local HEAD) with the right tag id.
type RunResult = { status: number | null; stdout?: string; stderr?: string };
function fakeRun(
  routes: Array<{ match: RegExp; result: RunResult }>,
  calls: string[],
) {
  return (cmd: string, args: string[]): RunResult => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push(line);
    for (const r of routes) if (r.match.test(line)) return r.result;
    return { status: 0, stdout: "" };
  };
}

const AT_2026_07_16 = new Date(Date.UTC(2026, 6, 16));
// 40-hex SHAs so the seam's `targetSha` shape guard accepts them.
const LATEST_SHA = `447c3c5${"a".repeat(33)}`;
const DEPLOYED_SHA = `d565767${"b".repeat(33)}`;

describe("cut-release — cutDeployRelease (I/O seam)", () => {
  it("forward deploy cuts release-YYYY.MM.DD-n AT the deployed sha", () => {
    const calls: string[] = [];
    const run = fakeRun(
      [
        { match: /^git fetch --tags/, result: { status: 0 } },
        {
          match: /^git tag -l release-\*/,
          result: { status: 0, stdout: "release-2026.07.15-1\n" },
        },
        {
          match: /^git rev-list -n 1 release-2026\.07\.15-1/,
          result: { status: 0, stdout: `${LATEST_SHA}\n` },
        },
        { match: /^git merge-base --is-ancestor/, result: { status: 0 } },
        { match: /^gh release create/, result: { status: 0 } },
      ],
      calls,
    );
    const res = cutDeployRelease({
      targetSha: DEPLOYED_SHA,
      now: AT_2026_07_16,
      run,
    });
    expect(res.cut).toBe(true);
    expect(res.tag).toBe("release-2026.07.16-1");
    // target-SHA plumbing: gh release create targets the DEPLOYED sha, not HEAD.
    expect(
      calls.includes(
        `gh release create release-2026.07.16-1 --generate-notes --target ${DEPLOYED_SHA} --title release-2026.07.16-1`,
      ),
    ).toBe(true);
  });

  it("redeploy of an already-released sha cuts nothing (empty range, skip green)", () => {
    const calls: string[] = [];
    const run = fakeRun(
      [
        { match: /^git fetch --tags/, result: { status: 0 } },
        {
          match: /^git tag -l release-\*/,
          result: { status: 0, stdout: "release-2026.07.16-1\n" },
        },
        {
          match: /^git rev-list -n 1 release-2026\.07\.16-1/,
          result: { status: 0, stdout: `${DEPLOYED_SHA}\n` },
        },
        { match: /^gh release create/, result: { status: 0 } },
      ],
      calls,
    );
    const res = cutDeployRelease({ targetSha: DEPLOYED_SHA, run });
    expect(res.cut).toBe(false);
    expect(calls.some((c) => c.startsWith("gh release create"))).toBe(false);
    // equal SHA short-circuits before the ancestry probe.
    expect(calls.some((c) => c.startsWith("git merge-base"))).toBe(false);
  });

  it("first-ever release (no release-* tags) → cuts at the deployed sha, no rev-list", () => {
    const calls: string[] = [];
    const run = fakeRun(
      [
        { match: /^git fetch --tags/, result: { status: 0 } },
        { match: /^git tag -l release-\*/, result: { status: 0, stdout: "" } },
        { match: /^gh release create/, result: { status: 0 } },
      ],
      calls,
    );
    const res = cutDeployRelease({
      targetSha: DEPLOYED_SHA,
      now: AT_2026_07_16,
      run,
    });
    expect(res.cut).toBe(true);
    expect(res.tag).toBe("release-2026.07.16-1");
    expect(calls.some((c) => c.startsWith("git rev-list"))).toBe(false);
  });

  it("deployed sha not a descendant of the latest release → skip green", () => {
    const calls: string[] = [];
    const run = fakeRun(
      [
        { match: /^git fetch --tags/, result: { status: 0 } },
        {
          match: /^git tag -l release-\*/,
          result: { status: 0, stdout: "release-2026.07.16-1\n" },
        },
        {
          match: /^git rev-list -n 1 release-2026\.07\.16-1/,
          result: { status: 0, stdout: `${LATEST_SHA}\n` },
        },
        { match: /^git merge-base --is-ancestor/, result: { status: 1 } },
        { match: /^gh release create/, result: { status: 0 } },
      ],
      calls,
    );
    const res = cutDeployRelease({ targetSha: DEPLOYED_SHA, run });
    expect(res.cut).toBe(false);
    expect(res.reason).toMatch(/ancestor/i);
    expect(calls.some((c) => c.startsWith("gh release create"))).toBe(false);
  });

  it("an invalid / missing target sha skips green and touches no git/gh", () => {
    const calls: string[] = [];
    const run = fakeRun([], calls);
    const res = cutDeployRelease({ targetSha: "", run });
    expect(res.cut).toBe(false);
    expect(res.reason).toMatch(/target SHA/i);
    expect(calls).toHaveLength(0);
  });

  it("never throws — a failing gh release create returns { cut:false }", () => {
    const calls: string[] = [];
    const run = fakeRun(
      [
        { match: /^git fetch --tags/, result: { status: 0 } },
        { match: /^git tag -l release-\*/, result: { status: 0, stdout: "" } },
        {
          match: /^gh release create/,
          result: { status: 1, stderr: "boom" },
        },
      ],
      calls,
    );
    const res = cutDeployRelease({
      targetSha: DEPLOYED_SHA,
      now: AT_2026_07_16,
      run,
    });
    expect(res.cut).toBe(false);
    expect(res.reason).toMatch(/gh release create failed/i);
  });
});
