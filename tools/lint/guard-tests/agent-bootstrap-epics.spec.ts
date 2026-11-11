import { describe, expect, it } from "vitest";

import {
  EPIC_TITLE_MAX,
  renderEpicsSection,
  type EpicChild,
  type EpicRow,
} from "../../agent-bootstrap";

/**
 * #2957: an epic carries no milestone — its progress is the native sub-issue
 * bar. `pnpm bootstrap` prints every open epic with that bar and the readiness
 * of each open child, so the session entry never loses the goal.
 */
describe("agent-bootstrap ## Epics (#2957)", () => {
  const child = (number: number, blockedBy: number[] = []): EpicChild => ({
    number,
    title: `child ${number}`,
    blockedBy,
  });
  const epic = (over: Partial<EpicRow> = {}): EpicRow => ({
    number: 2020,
    title: "epic: One code for two storefronts",
    completed: 16,
    total: 22,
    openChildren: [],
    ...over,
  });

  it("prints (none) when the fetch succeeded and no epic is open", () => {
    expect(renderEpicsSection([])).toEqual(["## Epics", "(none)"]);
  });

  it("prints unknown, never (none), when the source failed", () => {
    expect(renderEpicsSection(null)).toEqual([
      "## Epics",
      "(unknown — see Warnings)",
    ]);
  });

  it("prints the sub-issue bar and open/blocked counts, no child to pick (#3560, #3942)", () => {
    const lines = renderEpicsSection([
      epic({
        openChildren: [child(2071, [2500, 2501]), child(2072), child(2073)],
      }),
    ]);
    expect(lines).toEqual([
      "## Epics",
      "Progress only — the next task comes from `## Tracks`.",
      "- #2020 epic: One code for two storefronts — 16/22 sub-issues closed, 3 open (1 blocked)",
    ]);
  });

  it("truncates long titles", () => {
    const long = "x".repeat(EPIC_TITLE_MAX + 20);
    const lines = renderEpicsSection([epic({ title: `epic: ${long}` })]);
    expect(lines[2]).toContain(`${"x".repeat(EPIC_TITLE_MAX - 7)}…`);
    expect(lines[2]).not.toContain("x".repeat(EPIC_TITLE_MAX));
    expect(lines).toHaveLength(3);
  });
});
