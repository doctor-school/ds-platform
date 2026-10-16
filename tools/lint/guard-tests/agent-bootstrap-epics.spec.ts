import { describe, expect, it } from "vitest";

import {
  EPIC_CHILDREN_MAX,
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

  it("prints the sub-issue bar and marks the first ready child as next", () => {
    const lines = renderEpicsSection([
      epic({
        openChildren: [child(2071, [2500, 2501]), child(2072), child(2073)],
      }),
    ]);
    expect(lines).toEqual([
      "## Epics",
      "- #2020 epic: One code for two storefronts — 16/22 sub-issues closed",
      "  - blocked #2071 child 2071 — by #2500, #2501",
      "  - next → ready #2072 child 2072",
      "  - ready #2073 child 2073",
    ]);
  });

  it("prints no next marker when every open child is blocked", () => {
    const lines = renderEpicsSection([epic({ openChildren: [child(1, [9])] })]);
    expect(lines.join("\n")).not.toContain("next →");
  });

  it("truncates long titles and caps the open children list", () => {
    const long = "x".repeat(EPIC_TITLE_MAX + 20);
    const children = Array.from({ length: EPIC_CHILDREN_MAX + 3 }, (_, i) =>
      child(100 + i),
    );
    children[0] = { ...children[0], title: long };
    const lines = renderEpicsSection([
      epic({ title: `epic: ${long}`, openChildren: children }),
    ]);
    expect(lines[1]).toContain(`${"x".repeat(EPIC_TITLE_MAX - 7)}…`);
    expect(lines[1]).not.toContain("x".repeat(EPIC_TITLE_MAX));
    expect(lines[2]).toBe(
      `  - next → ready #100 ${"x".repeat(EPIC_TITLE_MAX - 1)}…`,
    );
    // head + epic line + EPIC_CHILDREN_MAX children + the "more" row
    expect(lines).toHaveLength(2 + EPIC_CHILDREN_MAX + 1);
    expect(lines.at(-1)).toBe("  - … +3 more");
  });
});
