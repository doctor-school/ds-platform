import { describe, expect, it } from "vitest";

import { recommend } from "../../agent-bootstrap";

/**
 * Unit cover for `agent-bootstrap.ts`'s pure `recommend()` (#306). The script's
 * only side-effect-free seam — guarded behind an entry-point check so importing
 * it here does NOT fire `main()` / its `gh` + `git` subprocesses.
 *
 * The retro driver (#306): an empty ready/working/awaiting bucket set must never
 * read as "clean slate / nothing to do" while open issues exist — the buckets are
 * a label-driven view, not the backlog (AGENTS.md §3.5).
 */
const NO_PRS = { mine: [], others: [] };
const issue = (number: number) => ({ number, title: `Issue ${number}` });

describe("agent-bootstrap recommend()", () => {
  it("empty buckets + open issues > 0 → triage nudge, NOT clean slate", () => {
    const msg = recommend([], [], NO_PRS, [], 11);
    expect(msg).toContain("TRIAGE");
    expect(msg).toContain("11 open issue");
    expect(msg).not.toMatch(/clean slate/i);
    expect(msg).not.toMatch(/nothing to do/i);
  });

  it("empty buckets + zero open issues → genuine clean slate", () => {
    const msg = recommend([], [], NO_PRS, [], 0);
    expect(msg).toMatch(/clean slate/i);
    expect(msg).not.toContain("TRIAGE");
  });

  it("ready queue populated → still recommends the ready queue (no regression)", () => {
    const msg = recommend([], [], NO_PRS, [issue(42), issue(43)], 5);
    expect(msg).toContain("#42");
    expect(msg).not.toContain("TRIAGE");
  });

  it("active working item wins over the open-count triage nudge", () => {
    const msg = recommend([issue(7)], [], NO_PRS, [], 9);
    expect(msg).toContain("Resume #7");
    expect(msg).not.toContain("TRIAGE");
  });

  it("non-author PRs win over the open-count triage nudge", () => {
    const msg = recommend(
      [],
      [],
      { mine: [], others: [{ number: 99, title: "dep bump" }] },
      [],
      9,
    );
    expect(msg).toContain("non-author PR");
    expect(msg).not.toContain("TRIAGE");
  });

  it("awaiting-review wins over the open-count triage nudge", () => {
    const msg = recommend([], [issue(3)], NO_PRS, [], 9);
    expect(msg).toContain("Address review on Issue #3");
    expect(msg).not.toContain("TRIAGE");
  });
});
