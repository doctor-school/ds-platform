import { describe, expect, it } from "vitest";

import {
  buildBoardItemsPageQuery,
  buildDeleteItemMutation,
  buildPrProjectItemsQuery,
  ghGraphqlResult,
  parseBoardItemsPage,
  pickProjectItem,
} from "../../gh/lib/projects-v2.mjs";

/**
 * Unit cover for the shared Projects v2 GraphQL plumbing (#1140) — the query /
 * mutation builders, the item picker, the page parser, and the discriminated
 * `ghGraphqlResult` runner (via an injected spawn — no real subprocess). This is
 * the single-sourced plumbing behind set-board-status, pr:land's board-clear,
 * and backlog-triage's PR board sweep.
 */

describe("projects-v2 buildPrProjectItemsQuery() (#1140)", () => {
  it("builds a TARGETED per-PR query (pullRequest, not issue, not a board list)", () => {
    const q = buildPrProjectItemsQuery(1140);
    expect(q).toContain('repository(owner:"doctor-school",name:"ds-platform")');
    expect(q).toContain("pullRequest(number:1140)");
    expect(q).toContain("projectItems(first:10)");
    expect(q).toContain("project{id number title}");
    // targeted, never a full-board dump
    expect(q).not.toContain("item-list");
    expect(q).not.toContain("items(first");
  });

  it("rejects a non-integer / non-positive PR number (interpolated into the query)", () => {
    expect(() => buildPrProjectItemsQuery(0)).toThrow(/invalid PR number/);
    expect(() => buildPrProjectItemsQuery(-3)).toThrow(/invalid PR number/);
    expect(() => buildPrProjectItemsQuery(1.5)).toThrow(/invalid PR number/);
    expect(() => buildPrProjectItemsQuery('1){x}"' as never)).toThrow(
      /invalid PR number/,
    );
  });
});

describe("projects-v2 buildDeleteItemMutation() (#1140)", () => {
  it("builds the deleteProjectV2Item mutation from resolved ids", () => {
    const m = buildDeleteItemMutation("PVT_proj", "PVTI_item");
    expect(m).toContain("deleteProjectV2Item");
    expect(m).toContain('projectId:"PVT_proj"');
    expect(m).toContain('itemId:"PVTI_item"');
    expect(m).toContain("deletedItemId");
  });

  it("rejects empty or query-breaking ids (interpolation guard)", () => {
    expect(() => buildDeleteItemMutation("", "i")).toThrow(/invalid projectId/);
    expect(() => buildDeleteItemMutation("p", 'i"}{')).toThrow(/invalid itemId/);
    expect(() => buildDeleteItemMutation("p", null as never)).toThrow(
      /invalid itemId/,
    );
  });
});

describe("projects-v2 buildBoardItemsPageQuery() (#1140)", () => {
  it("first page: org-scoped projectV2 items, 100/page, PR fields, no cursor", () => {
    const q = buildBoardItemsPageQuery();
    expect(q).toContain('organization(login:"doctor-school")');
    expect(q).toContain("projectV2(number:1)");
    expect(q).toContain("items(first:100)");
    expect(q).toContain("pageInfo{hasNextPage endCursor}");
    expect(q).toContain("... on PullRequest{number state");
    expect(q).toContain("assignees(first:1){totalCount}");
    expect(q).toContain("milestone{title}");
    expect(q).not.toContain("after:");
  });

  it("subsequent page: embeds the opaque cursor", () => {
    const q = buildBoardItemsPageQuery("Y3Vyc29yOnYy");
    expect(q).toContain('after:"Y3Vyc29yOnYy"');
  });

  it("rejects a query-breaking cursor", () => {
    expect(() => buildBoardItemsPageQuery('x"}{')).toThrow(/invalid cursor/);
  });
});

describe("projects-v2 pickProjectItem() (#1140)", () => {
  const boardNode = { id: "PVTI_a", project: { number: 1, id: "PVT_1" } };
  const otherNode = { id: "PVTI_b", project: { number: 7, id: "PVT_7" } };

  it("picks the DS Platform (project 1) node by default", () => {
    expect(pickProjectItem([otherNode, boardNode])).toBe(boardNode);
  });

  it("returns null when absent / malformed", () => {
    expect(pickProjectItem([otherNode])).toBeNull();
    expect(pickProjectItem([])).toBeNull();
    expect(pickProjectItem(null)).toBeNull();
    expect(pickProjectItem([{ id: "x" }] as never)).toBeNull();
  });
});

describe("projects-v2 parseBoardItemsPage() (#1140)", () => {
  it("extracts nodes + pageInfo from a well-formed page", () => {
    const page = parseBoardItemsPage({
      organization: {
        projectV2: {
          items: {
            pageInfo: { hasNextPage: true, endCursor: "CUR" },
            nodes: [{ id: "PVTI_a" }],
          },
        },
      },
    });
    expect(page).toEqual({
      nodes: [{ id: "PVTI_a" }],
      hasNextPage: true,
      endCursor: "CUR",
    });
  });

  it("returns null when the shape is absent", () => {
    expect(parseBoardItemsPage(undefined)).toBeNull();
    expect(parseBoardItemsPage({})).toBeNull();
    expect(parseBoardItemsPage({ organization: { projectV2: {} } })).toBeNull();
  });
});

describe("projects-v2 ghGraphqlResult() (#1140)", () => {
  it("returns {ok:true,data} on a clean response (injected spawn, no subprocess)", () => {
    const spawn = () => ({ status: 0, stdout: '{"data":{"x":1}}', stderr: "" });
    const res = ghGraphqlResult("query{}", spawn);
    expect(res).toEqual({ ok: true, data: { x: 1 } });
  });

  it("NON-FATAL: surfaces a spawn error as {ok:false}, never exits", () => {
    const spawn = () => ({ status: null, error: new Error("gh missing") });
    const res = ghGraphqlResult("query{}", spawn);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/failed to spawn gh/);
  });

  it("NON-FATAL: non-zero exit → {ok:false} carrying stderr", () => {
    const spawn = () => ({ status: 1, stdout: "", stderr: "bad auth" });
    const res = ghGraphqlResult("query{}", spawn);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/exited 1.*bad auth/);
  });

  it("NON-FATAL: GraphQL-level errors → {ok:false}", () => {
    const spawn = () => ({
      status: 0,
      stdout: '{"errors":[{"message":"NOT_FOUND"}]}',
      stderr: "",
    });
    const res = ghGraphqlResult("query{}", spawn);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/GraphQL errors: NOT_FOUND/);
  });

  it("NON-FATAL: unparseable stdout → {ok:false}", () => {
    const spawn = () => ({ status: 0, stdout: "not json", stderr: "" });
    const res = ghGraphqlResult("query{}", spawn);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/could not parse/);
  });
});
