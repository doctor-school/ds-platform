import { ROOM_COPY_KEYS, readRoomCopyKey } from "@ds/room";
import { describe, expect, it } from "vitest";

import ru from "../../../../messages/ru.json";
import { buildRoomCopyStrings } from "./copy";

/**
 * 006 EARS-10 — the academy host supplies EVERY room copy key from its own
 * catalogue (#1722 D19 / D22).
 *
 * The shared room unit renders no catalogue, so a key the contract declares but
 * the host never maps is a silently blank string in a live room: `undefined`
 * renders as nothing and no render test fails. This suite is the guard — it
 * drives the real `messages/ru.json` through the real mapping and asserts
 * exhaustiveness, non-emptiness, and that each key carries its OWN catalogue
 * value (a key mapped to its neighbour's value is present, wrong and green).
 */

const read = (node: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (cursor, segment) => (cursor as Record<string, unknown> | undefined)?.[segment],
      node,
    );

const room = ru.room as unknown;
const validation = (ru.errors as { validation: unknown }).validation;

const copy = buildRoomCopyStrings(
  (key) => read(room, key) as string,
  (key) => read(validation, key) as string,
);

describe("006 EARS-10 academy room copy — the host's half of the injection contract", () => {
  it("EARS-10: the academy host supplies every RoomCopy key, non-empty", () => {
    const blank = ROOM_COPY_KEYS.filter((key) => {
      const value = readRoomCopyKey(copy, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(blank).toEqual([]);
  });

  it("EARS-10: every key carries its own catalogue value, never a neighbour's", () => {
    for (const key of ROOM_COPY_KEYS) {
      const source = key.startsWith("errors.")
        ? read(validation, key.slice("errors.".length))
        : read(room, key);
      expect(readRoomCopyKey(copy, key), key).toBe(source);
    }
  });

  it("EARS-10: the four display-name validation strings come from errors.validation, not the room namespace (D18)", () => {
    expect(copy.errors.displayNameRequired).toBe(
      (validation as Record<string, string>).displayNameRequired,
    );
    expect(read(room, "errors")).toBeUndefined();
  });

  it("EARS-10: room.accessGuidance is NOT part of the room copy contract (D22)", () => {
    expect(read(room, "accessGuidance.title")).toEqual(expect.any(String));
    expect(
      ROOM_COPY_KEYS.filter((key) => key.startsWith("accessGuidance")),
    ).toEqual([]);
    expect((copy as unknown as Record<string, unknown>).accessGuidance).toBeUndefined();
  });
});
