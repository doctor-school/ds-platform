import { describe, expect, it } from "vitest";
import {
  CreateFeedSourceRequestSchema,
  FEED_SOURCE_ADDRESS_ERROR,
  FeedEntryAdminListSchema,
  FeedSourceAdminListSchema,
  FeedSourceEntriesQuerySchema,
  FEED_VK_SOURCE_ADDRESS_ERROR,
  FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR,
  feedSourceAddressTakenError,
  normalizeFeedSourceAddress,
  normalizeFeedSourceAddressFor,
  normalizeVkSourceAddress,
  vkAddressGroupId,
  vkVideoHref,
  vkWallPostHref,
  telegramPostHref,
  UpdateFeedSourceRequestSchema,
} from "./feed-source.js";

// 048 V-13 (#3993) — the source contract (EARS-20, EARS-21): the four address
// forms normalized to the lowercase public username, every other form and a
// private-channel invite link refused with the «Адрес канала» field error.

describe("048 feed source contract (V-13)", () => {
  it("048 EARS-21: the four address forms normalize to the lowercase public username", () => {
    for (const input of [
      "https://t.me/bbmacademy",
      "t.me/bbmacademy",
      "@bbmacademy",
      "bbmacademy",
      "  https://t.me/BBMAcademy  ",
      "T.ME/BbmAcademy",
      "@BBMACADEMY",
    ]) {
      expect(normalizeFeedSourceAddress(input), input).toBe("bbmacademy");
    }
    expect(normalizeFeedSourceAddress("bbm_academy_2026")).toBe(
      "bbm_academy_2026",
    );
    // 5 and 32 characters are the bounds.
    expect(normalizeFeedSourceAddress("abcde")).toBe("abcde");
    expect(normalizeFeedSourceAddress(`a${"b".repeat(31)}`)).toBe(
      `a${"b".repeat(31)}`,
    );
  });

  it("048 EARS-21: an invite link, another form or a username outside 5–32 Latin letters, digits and underscores starting with a letter is refused", () => {
    for (const input of [
      "https://t.me/+AbCdEfGh123",
      "t.me/+AbCdEfGh123",
      "https://t.me/joinchat/AbCdEfGh123",
      "https://t.me/bbmacademy/1201",
      "http://t.me/bbmacademy",
      "https://telegram.me/bbmacademy",
      "https://example.com/bbmacademy",
      "@@bbmacademy",
      "abcd",
      `a${"b".repeat(32)}`,
      "1bbmacademy",
      "_bbmacademy",
      "bbm-academy",
      "ббмакадеми",
      "",
      "   ",
    ]) {
      expect(normalizeFeedSourceAddress(input), input).toBeNull();
    }
  });

  it("048 EARS-21: a create request stores the normalized address for platform telegram and refuses another platform", () => {
    const ok = CreateFeedSourceRequestSchema.safeParse({
      platform: "telegram",
      address: "https://t.me/BBMAcademy",
    });
    expect(ok.success && ok.data).toEqual({
      platform: "telegram",
      address: "bbmacademy",
    });
    const academy = CreateFeedSourceRequestSchema.safeParse({
      platform: "academy",
      address: "bbmacademy",
    });
    expect(academy.success).toBe(false);
    const extra = CreateFeedSourceRequestSchema.safeParse({
      platform: "telegram",
      address: "bbmacademy",
      enabled: false,
    });
    expect(extra.success).toBe(false);
  });

  it("048 EARS-21: a refused address is a field error on `address` with the «Адрес канала» copy", () => {
    const res = CreateFeedSourceRequestSchema.safeParse({
      platform: "telegram",
      address: "https://t.me/+AbCdEfGh123",
    });
    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.error.issues).toHaveLength(1);
    expect(res.error.issues[0]).toMatchObject({
      path: ["address"],
      message: FEED_SOURCE_ADDRESS_ERROR,
    });
    expect(FEED_SOURCE_ADDRESS_ERROR).toBe(
      "Укажите адрес публичного канала в виде t.me/имя",
    );
    // The edit's rule is the stored source's platform's: the contract keeps
    // the trimmed input and the server normalizes it per platform.
    expect(
      UpdateFeedSourceRequestSchema.safeParse({ address: "" }).success,
    ).toBe(false);
    const editOk = UpdateFeedSourceRequestSchema.safeParse({
      address: " @Bbm_Academy ",
    });
    expect(editOk.success && editOk.data).toEqual({ address: "@Bbm_Academy" });
    expect(normalizeFeedSourceAddressFor("telegram", "@Bbm_Academy")).toBe(
      "bbm_academy",
    );
    expect(normalizeFeedSourceAddressFor("telegram", "t.me/+x")).toBeNull();
  });

  it("048 EARS-20: the admin list item carries platform, address, state, status with the check time and the post count", () => {
    const item = {
      id: "8d9c4b8e-1d2a-4f6b-9a3e-1b2c3d4e5f60",
      platform: "telegram",
      address: "bbmacademy",
      enabled: true,
      status: "unchecked",
      statusReason: null,
      checkedAt: null,
      entryCount: 0,
      version: 1,
      updatedAt: "2026-11-16T10:00:00.000Z",
    };
    const list = (data: unknown[]) =>
      FeedSourceAdminListSchema.safeParse({ data, vkCallsThisMonth: 0 });
    expect(list([item]).success).toBe(true);
    expect(list([]).success).toBe(true);
    expect(list([{ ...item, status: "broken" }]).success).toBe(false);
  });

  it("048 EARS-21: a Telegram entry links to https://t.me/<address>/<message id>", () => {
    expect(telegramPostHref("bbmacademy", 1201)).toBe(
      "https://t.me/bbmacademy/1201",
    );
  });
});

describe("048 «Публикации» contract (EARS-32)", () => {
  it("048 EARS-32: the page query defaults its size, refuses an unknown key, and a row carries one of the three states", () => {
    expect(FeedSourceEntriesQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      FeedSourceEntriesQuerySchema.safeParse({ limit: "101" }).success,
    ).toBe(false);
    expect(FeedSourceEntriesQuerySchema.safeParse({ page: "2" }).success).toBe(
      false,
    );
    const row = {
      id: "0b6c2f4e-6f1a-4c3e-9a1d-2f8e4b7c9d10",
      kind: "post",
      text: "Пост",
      publishedAt: "2026-11-17T00:00:00.000Z",
      hidden: false,
      href: "https://t.me/bbmacademy/1",
      version: 1731801600000000,
    };
    const source = {
      id: "1b6c2f4e-6f1a-4c3e-9a1d-2f8e4b7c9d10",
      platform: "telegram",
      address: "bbmacademy",
      enabled: true,
      status: "ok",
      statusReason: null,
      checkedAt: null,
      entryCount: 1,
      version: 1,
      updatedAt: "2026-11-17T00:00:00.000Z",
    };
    for (const state of ["in_feed", "hidden", "source_off", "removed"]) {
      expect(
        FeedEntryAdminListSchema.safeParse({
          source,
          data: [{ ...row, state }],
          nextCursor: null,
        }).success,
      ).toBe(true);
    }
    expect(
      FeedEntryAdminListSchema.safeParse({
        source,
        data: [{ ...row, state: "deleted" }],
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});

// 048 V-24 (#4004) — the VK address rule (EARS-38): the five forms normalized
// to the lowercase screen name (`club<id>` / `public<id>` included), a wall,
// post, video or user page link refused with the «Адрес сообщества» copy.
describe("048 VK source contract (V-24)", () => {
  it("048 EARS-38: the five VK address forms normalize to the lowercase screen name", () => {
    for (const input of [
      "https://vk.com/bbm.academy",
      "vk.com/bbm.academy",
      "https://vk.ru/bbm.academy",
      "vk.ru/bbm.academy",
      "bbm.academy",
      "  VK.RU/BBM.Academy  ",
    ]) {
      expect(normalizeVkSourceAddress(input), input).toBe("bbm.academy");
    }
    expect(normalizeVkSourceAddress("vk.com/club123456")).toBe("club123456");
    expect(normalizeVkSourceAddress("public123456")).toBe("public123456");
    expect(normalizeVkSourceAddress("ab")).toBe("ab");
    expect(normalizeVkSourceAddress("a".repeat(32))).toBe("a".repeat(32));
    expect(vkAddressGroupId("club123456")).toBe(123456);
    expect(vkAddressGroupId("public7")).toBe(7);
    expect(vkAddressGroupId("bbm.academy")).toBeNull();
  });

  it("048 EARS-38: a wall, post, video or user page link, another host or a malformed name is refused", () => {
    for (const input of [
      "https://vk.com/wall-123456_789",
      "vk.com/bbm.academy?w=wall-123456_789",
      "https://vk.com/video-123456_456239017",
      "https://vk.com/bbm.academy/wall",
      "https://vk.com/id12345",
      "id12345",
      "http://vk.com/bbm.academy",
      "https://m.vk.com/bbm.academy",
      "https://example.com/bbm.academy",
      "@bbm.academy",
      "a",
      "a".repeat(33),
      "bbm-academy",
      "ббм",
      "",
    ]) {
      expect(normalizeVkSourceAddress(input), input).toBeNull();
    }
  });

  it("048 EARS-38: a VK create request stores the screen name; a refused one is a field error with the «Адрес сообщества» copy", () => {
    const ok = CreateFeedSourceRequestSchema.safeParse({
      platform: "vk",
      address: "vk.ru/BBM.Academy",
    });
    expect(ok.success && ok.data).toEqual({
      platform: "vk",
      address: "bbm.academy",
    });
    const wall = CreateFeedSourceRequestSchema.safeParse({
      platform: "vk",
      address: "https://vk.com/wall-1_2",
    });
    expect(wall.success).toBe(false);
    if (wall.success) return;
    expect(wall.error.issues).toHaveLength(1);
    expect(wall.error.issues[0]).toMatchObject({
      path: ["address"],
      message: FEED_VK_SOURCE_ADDRESS_ERROR,
    });
    expect(FEED_VK_SOURCE_ADDRESS_ERROR).toBe(
      "Укажите адрес сообщества в виде vk.com/имя",
    );
    expect(feedSourceAddressTakenError("vk")).toBe(
      FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR,
    );
    expect(FEED_VK_SOURCE_ADDRESS_TAKEN_ERROR).toBe(
      "Это сообщество уже есть в списке",
    );
    // A Telegram username with a dot is no Telegram address.
    expect(
      CreateFeedSourceRequestSchema.safeParse({
        platform: "telegram",
        address: "bbm.academy",
      }).success,
    ).toBe(false);
  });

  it("048 EARS-41, EARS-42: VK permalinks are built from the bound community id", () => {
    expect(vkWallPostHref(123456, 789)).toBe("https://vk.com/wall-123456_789");
    expect(vkVideoHref(123456, 456239017)).toBe(
      "https://vk.com/video-123456_456239017",
    );
  });
});
