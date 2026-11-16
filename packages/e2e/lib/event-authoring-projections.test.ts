import { expect, it } from "vitest";
import {
  assertAuthoringTerminal,
  assertAuthoringRateIsolation,
  redactAuthoringPublicEvidence,
} from "./event-authoring-report.js";
it("removes signed public PDF query credentials and URL userinfo with explicit digest mapping", () => {
  const source = {
    items: [
      {
        id: "public-event",
        programPdfUrl:
          "https://fixture-user:fixture-password@storage.test/bucket/program.pdf?X-Amz-Credential=fixture-access-key&X-Amz-Signature=fixture-signature",
      },
    ],
  };
  const safe = redactAuthoringPublicEvidence(source);
  expect(safe.value).toEqual({
    items: [
      {
        id: "public-event",
        programPdfUrl: "https://storage.test/bucket/program.pdf",
      },
    ],
  });
  expect(source.items[0]!.programPdfUrl).toContain("fixture-signature");
  expect(safe.redactions).toEqual([
    {
      path: "$.items.0.programPdfUrl",
      rawUrlSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      querySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    },
  ]);
  expect(JSON.stringify(safe)).not.toMatch(
    /fixture-user|fixture-password|fixture-access-key|fixture-signature/,
  );
});

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
