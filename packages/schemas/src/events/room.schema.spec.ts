import { describe, expect, it } from "vitest";
import {
  RoomChatMessageSchema,
  RoomPresenceCountMessageSchema,
} from "./room.schema.js";

// 006 EARS-17 — the chat payload's author identity. A message carries the
// poster's own display name in `authorName`, shown to every participant; the
// field is nullish so both an unset name (`null`) and legacy history minted
// before the field existed (missing key) still parse and fall back to the tag.

const base = {
  id: "6f9b2f1e-8f1a-4b7e-9c3d-2a1b3c4d5e6f",
  authorTag: "B2",
  text: "Здравствуйте, коллеги!",
  at: "2026-07-13T10:00:00.000Z",
} as const;

describe("006 EARS-17 RoomChatMessage.authorName", () => {
  it("EARS-17: parses a message carrying the poster's own display name", () => {
    const parsed = RoomChatMessageSchema.parse({
      ...base,
      authorName: "Мария Кузнецова",
    });
    expect(parsed.authorName).toBe("Мария Кузнецова");
  });

  it("EARS-17: accepts authorName: null (poster has no display name set)", () => {
    const parsed = RoomChatMessageSchema.parse({ ...base, authorName: null });
    expect(parsed.authorName).toBeNull();
  });

  it("EARS-17: accepts a legacy payload with the key absent (no migration/backfill)", () => {
    // A message minted before the field existed has no authorName key at all;
    // a required-but-nullable field would drop it from the hydrated history pane.
    const parsed = RoomChatMessageSchema.parse(base);
    expect(parsed.authorName ?? null).toBeNull();
  });

  it("EARS-17: rejects an empty-string authorName (a name is a real value or absent, never blank)", () => {
    expect(
      RoomChatMessageSchema.safeParse({ ...base, authorName: "" }).success,
    ).toBe(false);
  });
});

// 006 EARS-5 — the realtime presence-count message rides the same room channel as
// chat, discriminated by its `type` literal. These two shapes must NEVER cross-parse
// (a chat message applied as a count, or vice-versa, would corrupt the header).
describe("006 EARS-5 RoomPresenceCountMessage discrimination", () => {
  const presence = {
    type: "presence-count",
    count: 3,
    at: "2026-07-13T10:00:00.000Z",
  } as const;

  it("EARS-5: parses a server-published presence-count message", () => {
    expect(RoomPresenceCountMessageSchema.parse(presence).count).toBe(3);
  });

  it("EARS-5: accepts a zero count (a room that just emptied out)", () => {
    expect(
      RoomPresenceCountMessageSchema.parse({ ...presence, count: 0 }).count,
    ).toBe(0);
  });

  it("EARS-5: a chat message is NOT a presence-count message (no cross-parse)", () => {
    expect(RoomPresenceCountMessageSchema.safeParse(base).success).toBe(false);
  });

  it("EARS-5: a presence-count message is NOT a chat message (no cross-parse)", () => {
    expect(RoomChatMessageSchema.safeParse(presence).success).toBe(false);
  });

  it("EARS-5: rejects a fractional / negative count (a distinct-doctor count is a non-negative integer)", () => {
    expect(
      RoomPresenceCountMessageSchema.safeParse({ ...presence, count: 1.5 })
        .success,
    ).toBe(false);
    expect(
      RoomPresenceCountMessageSchema.safeParse({ ...presence, count: -1 })
        .success,
    ).toBe(false);
  });
});
