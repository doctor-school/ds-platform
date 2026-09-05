import { ROOM_COPY_KEYS, readRoomCopyKey } from "@ds/room";
import { describe, expect, it } from "vitest";

import { ROOM_COPY } from "./copy";

/**
 * 006 EARS-10 (#1722 D19 / D22) — the doctor host supplies EVERY room copy key.
 *
 * The shared room unit renders no catalogue, so a key the contract declares but
 * this host never states is a silently blank string in a live room: `undefined`
 * renders as nothing and no render test fails. `satisfies RoomCopyStrings` in
 * `copy.ts` catches a MISSING key at compile time; this suite additionally
 * catches an EMPTY one and pins the two D22/D18 exclusions, which types cannot
 * express.
 */
describe("006 EARS-10 doctor room copy — the host's half of the injection contract", () => {
  it("006 EARS-10: the doctor room copy const satisfies the whole RoomCopy contract, every key non-empty", () => {
    const blank = ROOM_COPY_KEYS.filter((key) => {
      const value = readRoomCopyKey(ROOM_COPY, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(blank).toEqual([]);
  });

  it("006 EARS-10: the const declares no key outside the contract (D22 — accessGuidance belongs to the event page)", () => {
    const declared = new Set<string>();
    const walk = (node: Record<string, unknown>, prefix = "") => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "string") declared.add(path);
        else walk(value as Record<string, unknown>, path);
      }
    };
    walk(ROOM_COPY as unknown as Record<string, unknown>);

    expect([...declared].sort()).toEqual([...ROOM_COPY_KEYS].sort());
    expect(
      (ROOM_COPY as unknown as Record<string, unknown>).accessGuidance,
    ).toBeUndefined();
  });
});
