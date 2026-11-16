import { expect, it } from "vitest";
import { assertAuthoringTerminal } from "./event-authoring-report.js";

it("rejects every outstanding nested public projection pagination marker", () => {
  for (const [key, value] of Object.entries({
    nextCursor: "cursor",
    hasMore: true,
    hasNextPage: true,
    remaining: 1,
    nextCount: 1,
    nextFrom: "2026-12-01",
  }))
    expect(() =>
      assertAuthoringTerminal({ data: [{ pagination: { [key]: value } }] }),
    ).toThrow(/terminal/);
});
it("accepts actual exhausted envelopes and unpaginated collections", () => {
  expect(() =>
    assertAuthoringTerminal({
      data: [],
      pagination: { nextCursor: null, hasMore: false },
      remaining: 0,
      nextCount: 0,
      nextFrom: null,
    }),
  ).not.toThrow();
  expect(() => assertAuthoringTerminal([{ id: "public" }])).not.toThrow();
});
