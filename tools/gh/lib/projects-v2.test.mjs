// tools/gh/lib/projects-v2.test.mjs — unit checks for the board-items page
// query and its truncation detection (#1730, deferred review item from #1762).
// No I/O: the query builder and the parsers are pure, so importing this module
// spawns nothing. Platform-agnostic (CI is Linux).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIELD_VALUES_PAGE_SIZE,
  LABELS_PAGE_SIZE,
  boardNodeTruncations,
  buildBoardItemsPageQuery,
  formatBoardTruncation,
  parseBoardItemsPage,
} from "./projects-v2.mjs";

/** One board-items node in the shape the GraphQL query returns. */
function node({
  number = 42,
  typename = "Issue",
  labelsTotal = 3,
  fieldValuesTotal = 2,
} = {}) {
  return {
    id: "PVTI_x",
    fieldValues: { totalCount: fieldValuesTotal, nodes: [] },
    content: {
      __typename: typename,
      number,
      state: "OPEN",
      title: "t",
      milestone: null,
      labels: { totalCount: labelsTotal, nodes: [] },
      parent: null,
    },
  };
}

function page(nodes) {
  return {
    organization: {
      projectV2: {
        items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
      },
    },
  };
}

test("the page query asks both connections for totalCount at the named page size", () => {
  const q = buildBoardItemsPageQuery();
  assert.match(q, new RegExp(`fieldValues\\(first:${FIELD_VALUES_PAGE_SIZE}\\)\\{totalCount`));
  assert.match(q, new RegExp(`labels\\(first:${LABELS_PAGE_SIZE}\\)\\{totalCount`));
  // The missing-target / missing-start preconditions (board-design spec 3.2)
  // are read from the milestone due date, the sub-issue rollup and the Status.
  assert.match(q, /milestone[{]title dueOn[}]/);
  assert.match(q, /subIssuesSummary[{]total completed[}]/);
  assert.match(q, /on ProjectV2ItemFieldSingleSelectValue[{]name/);
});

test("a node inside both page sizes reports no truncation", () => {
  assert.deepEqual(boardNodeTruncations(node()), []);
  // Exactly at the page size is complete, not truncated.
  assert.deepEqual(
    boardNodeTruncations(
      node({ labelsTotal: LABELS_PAGE_SIZE, fieldValuesTotal: FIELD_VALUES_PAGE_SIZE }),
    ),
    [],
  );
});

test("each over-page connection is its own truncation row", () => {
  const out = boardNodeTruncations(
    node({
      number: 1495,
      labelsTotal: LABELS_PAGE_SIZE + 1,
      fieldValuesTotal: FIELD_VALUES_PAGE_SIZE + 4,
    }),
  );
  assert.deepEqual(out, [
    {
      number: 1495,
      connection: "fieldValues",
      totalCount: FIELD_VALUES_PAGE_SIZE + 4,
      pageSize: FIELD_VALUES_PAGE_SIZE,
    },
    {
      number: 1495,
      connection: "labels",
      totalCount: LABELS_PAGE_SIZE + 1,
      pageSize: LABELS_PAGE_SIZE,
    },
  ]);
});

test("a missing totalCount is not read as a truncation", () => {
  const n = node();
  delete n.fieldValues.totalCount;
  delete n.content.labels.totalCount;
  assert.deepEqual(boardNodeTruncations(n), []);
  assert.deepEqual(boardNodeTruncations(undefined), []);
});

test("a PullRequest item is checked on fieldValues alone (it carries no labels connection)", () => {
  const pr = node({ number: 1760, typename: "PullRequest" });
  delete pr.content.labels;
  pr.fieldValues.totalCount = FIELD_VALUES_PAGE_SIZE + 1;
  assert.deepEqual(boardNodeTruncations(pr), [
    {
      number: 1760,
      connection: "fieldValues",
      totalCount: FIELD_VALUES_PAGE_SIZE + 1,
      pageSize: FIELD_VALUES_PAGE_SIZE,
    },
  ]);
});

test("parseBoardItemsPage aggregates the truncations of every node on the page", () => {
  const parsed = parseBoardItemsPage(
    page([
      node({ number: 1, labelsTotal: LABELS_PAGE_SIZE + 2 }),
      node({ number: 2 }),
      node({ number: 3, fieldValuesTotal: FIELD_VALUES_PAGE_SIZE + 1 }),
    ]),
  );
  assert.equal(parsed.nodes.length, 3);
  assert.deepEqual(
    parsed.truncations.map((t) => [t.number, t.connection]),
    [
      [1, "labels"],
      [3, "fieldValues"],
    ],
  );
});

test("a clean page carries an empty truncation list, and an absent shape stays null", () => {
  assert.deepEqual(parseBoardItemsPage(page([node()])).truncations, []);
  assert.equal(parseBoardItemsPage({}), null);
});

test("formatBoardTruncation names the Issue, the connection and both counts", () => {
  assert.equal(
    formatBoardTruncation({
      number: 1495,
      connection: "labels",
      totalCount: 31,
      pageSize: 30,
    }),
    "#1495: labels truncated (totalCount 31 > page 30)",
  );
  assert.equal(
    formatBoardTruncation({
      number: null,
      connection: "fieldValues",
      totalCount: 21,
      pageSize: 20,
    }),
    "(unknown item): fieldValues truncated (totalCount 21 > page 20)",
  );
});
