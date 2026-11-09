import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeFactJournalCursor,
  decodePostingCursor,
  encodeFactJournalCursor,
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

describe("fact journal cursor (025 EARS-45)", () => {
  it("EARS-45: a cursor round-trips its microsecond keyset position with a text event id", () => {
    const position = {
      receivedAt: "2026-11-10T08:01:02.654321Z",
      eventId: `lesson.completed:${randomUUID()}#x`,
    };
    const cursor = encodeFactJournalCursor(position);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeFactJournalCursor(cursor)).toEqual(position);
  });

  it.each([
    ["not base64 JSON", "not-a-cursor"],
    [
      "a posting cursor shape with an empty id",
      Buffer.from(JSON.stringify(["2026-11-10T08:01:02.654321Z", ""])).toString(
        "base64url",
      ),
    ],
    [
      "a millisecond timestamp",
      Buffer.from(JSON.stringify(["2026-11-10T08:01:02.654Z", "e"])).toString(
        "base64url",
      ),
    ],
    [
      "an impossible date",
      Buffer.from(
        JSON.stringify(["2026-13-45T08:01:02.654321Z", "e"]),
      ).toString("base64url"),
    ],
  ])("EARS-45: %s is not a cursor this route issued", (_label, cursor) => {
    expect(decodeFactJournalCursor(cursor)).toBeNull();
  });
});
