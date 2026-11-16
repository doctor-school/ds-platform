import { expect, it } from "vitest";
import {
  assertAuthoringTerminal,
  assertAuthoringRateIsolation,
} from "./event-authoring-report.js";

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
it("rejects missing, shared or incompletely cleaned native rate evidence", () => {
  const key = "a".repeat(64),
    other = "b".repeat(64);
  const observed = {
    command: "native rate namespace witness",
    observed: true,
    disjoint: true,
    keySha256: key,
  };
  const cleanup = {
    command: "native rate namespace witness",
    action: "verified-absent",
    keySha256s: [key],
  };
  for (const ops of [
    [],
    [observed],
    [{ ...observed, disjoint: false }, cleanup],
    [observed, { ...cleanup, keySha256s: [other] }],
  ])
    expect(() => assertAuthoringRateIsolation(ops)).toThrow(/isolation/);
  expect(assertAuthoringRateIsolation([observed, cleanup])).toEqual({
    observedKeySha256s: [key],
    absentKeySha256s: [key],
  });
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
