import { describe, expect, it } from "vitest";

import {
  buildProjectItemsQuery,
  buildStatusMutation,
  KNOWN,
  knownIdWarnings,
  pickProjectItem,
  resolveStatusOption,
  VALID_STATUS,
} from "../../gh/set-board-status.mjs";

/**
 * set-board-status — unit cover for `tools/gh/set-board-status.mjs`'s pure
 * seams (#993).
 *
 * The setter resolves a Projects v2 item via ONE targeted per-issue GraphQL
 * query (`issue(number:N){projectItems…}`) instead of paging the entire board
 * (`gh project item-list --limit 1000` burned hundreds of points of the
 * 5000/hr quota shared across all sessions). The impure half (gh spawns, the
 * mutation) is exercised live; query construction, item picking, option
 * resolution, and the known-id cross-check WARN are unit-tested here on the
 * established guard-test harness (pattern: merge-gate.spec.ts).
 */

/** A realistic projectItems.nodes fixture: the issue sits on two projects. */
const dsPlatformNode = {
  id: "PVTI_item_on_board",
  project: {
    id: KNOWN.projectId,
    number: 1,
    title: "DS Platform",
    field: {
      id: KNOWN.statusFieldId,
      name: "Status",
      options: [
        { id: "f75ad846", name: "Todo" },
        { id: "47fc9ee4", name: "In Progress" },
        { id: "f7f44e89", name: "Review" },
        { id: "98236657", name: "Done" },
      ],
    },
  },
};

const otherProjectNode = {
  id: "PVTI_item_elsewhere",
  project: { id: "PVT_other", number: 7, title: "Some Other Board", field: null },
};

describe("set-board-status buildProjectItemsQuery() (#993)", () => {
  it("builds a targeted per-issue query — repository/issue/projectItems, never a board-wide list", () => {
    const q = buildProjectItemsQuery(993);
    expect(q).toContain('repository(owner:"doctor-school",name:"ds-platform")');
    expect(q).toContain("issue(number:993)");
    expect(q).toContain("projectItems(first:10)");
    // the whole point of #993: no full-board item-list anywhere on the hot path
    expect(q).not.toContain("item-list");
    expect(q).not.toContain("items(first");
  });

  it("asks for everything the mutation needs in the one call (item id, project id, Status field + options)", () => {
    const q = buildProjectItemsQuery(1000);
    expect(q).toContain("project{id number title");
    expect(q).toContain('field(name:"Status")');
    expect(q).toContain("ProjectV2SingleSelectField");
    expect(q).toContain("options{id name}");
  });

  it("rejects a non-integer / non-positive issue number (the number is interpolated into the query)", () => {
    expect(() => buildProjectItemsQuery(0)).toThrow(/invalid issue number/);
    expect(() => buildProjectItemsQuery(-5)).toThrow(/invalid issue number/);
    expect(() => buildProjectItemsQuery(1.5)).toThrow(/invalid issue number/);
    // injection guard: strings never reach the query
    expect(() => buildProjectItemsQuery('1){x}"')).toThrow(/invalid issue number/);
  });
});

describe("set-board-status pickProjectItem() (#993)", () => {
  it("finds the item when the issue is on the board", () => {
    expect(pickProjectItem([dsPlatformNode], 1)).toBe(dsPlatformNode);
  });

  it("picks the project-1 item when the issue sits on multiple projects", () => {
    expect(pickProjectItem([otherProjectNode, dsPlatformNode], 1)).toBe(
      dsPlatformNode,
    );
  });

  it("returns null when the issue is not on the board (empty or foreign-project-only nodes)", () => {
    expect(pickProjectItem([], 1)).toBeNull();
    expect(pickProjectItem([otherProjectNode], 1)).toBeNull();
  });

  it("returns null for malformed input (missing nodes / project-less items)", () => {
    expect(pickProjectItem(null, 1)).toBeNull();
    expect(pickProjectItem(undefined, 1)).toBeNull();
    expect(pickProjectItem([{ id: "PVTI_x" }], 1)).toBeNull();
  });
});

describe("set-board-status resolveStatusOption() (#993)", () => {
  const options = dsPlatformNode.project.field.options;

  it("resolves every valid status name to its option", () => {
    for (const name of VALID_STATUS) {
      const option = resolveStatusOption(options, name);
      expect(option?.name).toBe(name);
      expect(option?.id).toBe(KNOWN.options[name as keyof typeof KNOWN.options]);
    }
  });

  it("returns null for an unknown status", () => {
    expect(resolveStatusOption(options, "Cancelled")).toBeNull();
    expect(resolveStatusOption(options, "done")).toBeNull(); // exact-name match only
  });

  it("returns null when options are absent", () => {
    expect(resolveStatusOption(undefined, "Done")).toBeNull();
    expect(resolveStatusOption(null, "Done")).toBeNull();
  });
});

describe("set-board-status knownIdWarnings() (#993)", () => {
  const resolvedClean = {
    projectId: KNOWN.projectId,
    statusFieldId: KNOWN.statusFieldId,
    options: dsPlatformNode.project.field.options,
  };

  it("is silent when the live-resolved ids match the documented constants", () => {
    expect(knownIdWarnings(resolvedClean)).toEqual([]);
  });

  it("WARNs on a project-id mismatch, naming both values", () => {
    const warnings = knownIdWarnings({ ...resolvedClean, projectId: "PVT_new" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PVT_new");
    expect(warnings[0]).toContain(KNOWN.projectId);
    expect(warnings[0]).toContain("using resolved value");
  });

  it("WARNs on a field-id mismatch", () => {
    const warnings = knownIdWarnings({
      ...resolvedClean,
      statusFieldId: "PVTSSF_new",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("PVTSSF_new");
    expect(warnings[0]).toContain(KNOWN.statusFieldId);
  });

  it("WARNs per drifted option id, naming the option", () => {
    const warnings = knownIdWarnings({
      ...resolvedClean,
      options: [
        { id: "deadbeef", name: "Done" },
        { id: "f75ad846", name: "Todo" },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Done"');
    expect(warnings[0]).toContain("deadbeef");
  });

  it("does not WARN on an option name the constants do not document", () => {
    const warnings = knownIdWarnings({
      ...resolvedClean,
      options: [...resolvedClean.options, { id: "abc123", name: "Blocked" }],
    });
    expect(warnings).toEqual([]);
  });
});

describe("set-board-status buildStatusMutation() (#993)", () => {
  it("builds the updateProjectV2ItemFieldValue mutation from the resolved ids", () => {
    const m = buildStatusMutation(
      KNOWN.projectId,
      "PVTI_item_on_board",
      KNOWN.statusFieldId,
      "98236657",
    );
    expect(m).toContain("updateProjectV2ItemFieldValue");
    expect(m).toContain(`projectId:"${KNOWN.projectId}"`);
    expect(m).toContain('itemId:"PVTI_item_on_board"');
    expect(m).toContain(`fieldId:"${KNOWN.statusFieldId}"`);
    expect(m).toContain('singleSelectOptionId:"98236657"');
  });

  it("rejects empty or query-breaking id values (interpolation guard)", () => {
    expect(() => buildStatusMutation("", "i", "f", "o")).toThrow(/invalid projectId/);
    expect(() =>
      buildStatusMutation("PVT_x", 'i"}{', "f", "o"),
    ).toThrow(/invalid itemId/);
    // non-string ids never reach the mutation
    expect(() => buildStatusMutation("PVT_x", "i", null, "o")).toThrow(
      /invalid fieldId/,
    );
  });
});
