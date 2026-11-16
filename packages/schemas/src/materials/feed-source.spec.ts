import { describe, expect, it } from "vitest";
import {
  CreateFeedSourceRequestSchema,
  FEED_SOURCE_ADDRESS_ERROR,
  FeedSourceAdminListSchema,
  normalizeFeedSourceAddress,
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
    const edit = UpdateFeedSourceRequestSchema.safeParse({
      address: "t.me/+x",
    });
    expect(edit.success).toBe(false);
    const editOk = UpdateFeedSourceRequestSchema.safeParse({
      address: "@Bbm_Academy",
    });
    expect(editOk.success && editOk.data).toEqual({ address: "bbm_academy" });
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
    expect(FeedSourceAdminListSchema.safeParse({ data: [item] }).success).toBe(
      true,
    );
    expect(FeedSourceAdminListSchema.safeParse({ data: [] }).success).toBe(
      true,
    );
    expect(
      FeedSourceAdminListSchema.safeParse({
        data: [{ ...item, status: "broken" }],
      }).success,
    ).toBe(false);
  });

  it("048 EARS-21: a Telegram entry links to https://t.me/<address>/<message id>", () => {
    expect(telegramPostHref("bbmacademy", 1201)).toBe(
      "https://t.me/bbmacademy/1201",
    );
  });
});
