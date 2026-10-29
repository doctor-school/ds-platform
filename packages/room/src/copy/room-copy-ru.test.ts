import { describe, expect, it } from "vitest";

import {
  ROOM_COPY_CALLBACK_KEYS,
  ROOM_COPY_KEYS,
  readRoomCopyKey,
  type RoomCopy,
  type RoomCopyStrings,
} from "./room-copy";
import { ROOM_COPY_RU, ROOM_FORMATTERS_RU, roomCopyRu } from "./room-copy-ru";

/**
 * 006 EARS-10 — the room's default RU copy lives in the package (wave-4 gate
 * row 24, DEBT.md L129's promote-when remedy).
 *
 * The room renders no catalogue, so a contract key the default never fills is a
 * silently blank string in a live room: `undefined` renders as nothing and no
 * render test fails. This suite is that guard, plus the formatter parity the
 * Academy's ICU messages fixed (every expected string below is what
 * `room.presenceCount` / `chatUnread` / `liveDuration` / `avatarLabel` of the
 * Academy `messages/ru.json` produced through next-intl before #2073 PR 4.3).
 */

const NBSP = " ";

describe("006 EARS-10 ROOM_COPY_RU — the default RU room copy", () => {
  it("EARS-10: ROOM_COPY_RU supplies every RoomCopy key, non-empty", () => {
    const copy: RoomCopyStrings = ROOM_COPY_RU;
    const blank = ROOM_COPY_KEYS.filter((key) => {
      const value = readRoomCopyKey(copy, key);
      return typeof value !== "string" || value.trim() === "";
    });
    expect(blank).toEqual([]);
  });

  it("EARS-10: ROOM_COPY_RU carries no key outside the contract", () => {
    const flatten = (node: object, prefix = ""): string[] =>
      Object.entries(node).flatMap(([key, value]) =>
        value !== null && typeof value === "object"
          ? flatten(value as object, `${prefix}${key}.`)
          : [`${prefix}${key}`],
      );
    expect(flatten(ROOM_COPY_RU).sort()).toEqual([...ROOM_COPY_KEYS].sort());
  });

  it("EARS-7: the end card's link words are a part of its body sentence (owner 2026-10-29, #3468: no new text)", () => {
    expect(ROOM_COPY_RU.endedBody).toContain(`«${ROOM_COPY_RU.endedBodyLink}»`);
  });

  it("EARS-7: an ended room's empty chat says no messages were sent (owner 2026-10-29, #3468)", () => {
    expect(ROOM_COPY_RU.chatEmptyEnded).toBe("В этом эфире сообщений не было.");
  });

  it("EARS-10: the four display-name validation strings are the shared validation wording (D18)", () => {
    expect(ROOM_COPY_RU.errors).toEqual({
      displayNameRequired: "Введите имя и фамилию.",
      displayNameTooLong: "Слишком длинное имя — не более 100 символов.",
      required: "Заполните это поле.",
      fallback: "Проверьте введённое значение.",
    });
  });

  it("EARS-10: the access guidance is NOT part of the room copy (D22)", () => {
    expect(
      (ROOM_COPY_RU as unknown as Record<string, unknown>).accessGuidance,
    ).toBeUndefined();
  });

  it("EARS-10: roomCopyRu overrides only the brand-home label and adds the four formatters", () => {
    const copy: RoomCopy = roomCopyRu({ brandHome: "На главную" });
    expect(copy.brandHome).toBe("На главную");
    const { brandHome: _brand, ...rest } = copy;
    const { brandHome: _default, ...defaults } = ROOM_COPY_RU;
    expect(rest).toMatchObject(defaults);
    for (const key of ROOM_COPY_CALLBACK_KEYS) {
      expect(copy[key]).toBe(ROOM_FORMATTERS_RU[key]);
    }
  });
});

describe("006 EARS-10 ROOM_FORMATTERS_RU — parity with the Academy ICU messages", () => {
  const plural: Array<[number, string, string]> = [
    [0, "0 врачей в комнате", "0 новых сообщений"],
    [1, "1 врач в комнате", "1 новое сообщение"],
    [2, "2 врача в комнате", "2 новых сообщения"],
    [3, "3 врача в комнате", "3 новых сообщения"],
    [4, "4 врача в комнате", "4 новых сообщения"],
    [5, "5 врачей в комнате", "5 новых сообщений"],
    [11, "11 врачей в комнате", "11 новых сообщений"],
    [12, "12 врачей в комнате", "12 новых сообщений"],
    [14, "14 врачей в комнате", "14 новых сообщений"],
    [21, "21 врач в комнате", "21 новое сообщение"],
    [22, "22 врача в комнате", "22 новых сообщения"],
    [25, "25 врачей в комнате", "25 новых сообщений"],
    [101, "101 врач в комнате", "101 новое сообщение"],
    [111, "111 врачей в комнате", "111 новых сообщений"],
    [1000, `1${NBSP}000 врачей в комнате`, `1${NBSP}000 новых сообщений`],
    [1001, `1${NBSP}001 врач в комнате`, `1${NBSP}001 новое сообщение`],
    [12345, `12${NBSP}345 врачей в комнате`, `12${NBSP}345 новых сообщений`],
  ];

  it.each(plural)(
    "EARS-10: %i → «%s» / «%s» (one / few / many, grouped like ICU `#`)",
    (count, presence, unread) => {
      expect(ROOM_FORMATTERS_RU.presenceCount(count)).toBe(presence);
      expect(ROOM_FORMATTERS_RU.chatUnread(count)).toBe(unread);
    },
  );

  it("EARS-10: the live duration interpolates the minutes ungrouped, like the ICU simple argument", () => {
    expect(ROOM_FORMATTERS_RU.liveDuration(0)).toBe("· 0 мин");
    expect(ROOM_FORMATTERS_RU.liveDuration(21)).toBe("· 21 мин");
    expect(ROOM_FORMATTERS_RU.liveDuration(1000)).toBe("· 1000 мин");
  });

  it("EARS-10: the avatar label names the doctor", () => {
    expect(ROOM_FORMATTERS_RU.avatarLabel("Иван Петров")).toBe(
      "Ваш профиль: Иван Петров",
    );
  });
});
