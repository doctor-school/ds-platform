import { describe, expect, it } from "vitest";
import {
  FEED_VK_MONTHLY_CALL_WARN,
  FEED_VK_SOURCE_ADDRESS_ERROR,
  FEED_SOURCE_ADDRESS_ERROR,
} from "@ds/schemas";
import {
  feedSourceAddressFieldError,
  feedSourceAddressLabel,
  vkCallsNearCap,
} from "./feed-source-address";

/**
 * 048 EARS-21 / EARS-38 / EARS-44 — how «Источники» names a source and when
 * the month's VK call line turns into a warning.
 */
describe("feed source address", () => {
  it("EARS-38: a VK source is listed as vk.com/<имя>, a Telegram one as t.me/<имя>", () => {
    expect(feedSourceAddressLabel("vk", "bbm.academy")).toBe(
      "vk.com/bbm.academy",
    );
    expect(feedSourceAddressLabel("telegram", "bbmacademy")).toBe(
      "t.me/bbmacademy",
    );
  });

  it("EARS-38: the field refuses an address of another form with its platform's sentence", () => {
    expect(feedSourceAddressFieldError("vk", "vk.com/wall-211000111_501")).toBe(
      FEED_VK_SOURCE_ADDRESS_ERROR,
    );
    expect(feedSourceAddressFieldError("vk", "https://vk.ru/BBM.Academy")).toBe(
      true,
    );
    expect(feedSourceAddressFieldError("telegram", "t.me/+AbCdEf")).toBe(
      FEED_SOURCE_ADDRESS_ERROR,
    );
    expect(feedSourceAddressFieldError("telegram", "t.me/bbmacademy")).toBe(
      true,
    );
  });

  it("EARS-44: the month's VK calls warn from 8 000 on", () => {
    expect(vkCallsNearCap(FEED_VK_MONTHLY_CALL_WARN - 1)).toBe(false);
    expect(vkCallsNearCap(FEED_VK_MONTHLY_CALL_WARN)).toBe(true);
    expect(vkCallsNearCap(10_000)).toBe(true);
  });
});
