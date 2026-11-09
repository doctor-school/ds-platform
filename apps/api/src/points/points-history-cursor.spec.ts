import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodePostingCursor,
  encodePostingCursor,
} from "./points-history-cursor.js";

describe("posting history cursor (025 EARS-46)", () => {
  it("EARS-46: a cursor round-trips its microsecond keyset position", () => {
    const position = {
      occurredAt: "2026-11-09T10:15:30.123456Z",
      id: randomUUID(),
    };
    const cursor = encodePostingCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePostingCursor(cursor)).toEqual(position);
  });

  it.each([
    ["not base64 JSON", "not-a-cursor"],
    ["a JSON object", Buffer.from("{}").toString("base64url")],
    [
      "a millisecond timestamp",
      Buffer.from(
        JSON.stringify(["2026-11-09T10:15:30.123Z", randomUUID()]),
      ).toString("base64url"),
    ],
    [
      "a non-uuid id",
      Buffer.from(
        JSON.stringify(["2026-11-09T10:15:30.123456Z", "x"]),
      ).toString("base64url"),
    ],
    [
      "an impossible date",
      Buffer.from(
        JSON.stringify(["2026-13-45T10:15:30.123456Z", randomUUID()]),
      ).toString("base64url"),
    ],
  ])("EARS-46: a cursor that is %s is refused", (_label, cursor) => {
    expect(decodePostingCursor(cursor)).toBeNull();
  });
});
