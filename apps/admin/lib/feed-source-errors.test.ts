import { describe, expect, it } from "vitest";
import {
  FEED_SOURCE_ADDRESS_ERROR,
  FEED_SOURCE_ADDRESS_TAKEN_ERROR,
} from "@ds/schemas";
import {
  feedSourceAddressRefusal,
  feedSourceErrorKey,
} from "./feed-source-errors";

/**
 * 048 EARS-21 / EARS-22 — how a refused «Источники» write reaches the page:
 * an address refusal is the field's own sentence; everything else maps to a
 * banner key.
 */
describe("feed source refusals", () => {
  it("EARS-21: an address refusal is the server's RU field sentence", () => {
    for (const message of [
      FEED_SOURCE_ADDRESS_ERROR,
      FEED_SOURCE_ADDRESS_TAKEN_ERROR,
    ]) {
      expect(
        feedSourceAddressRefusal({
          errorCode: "VALIDATION_FAILED",
          fieldErrors: [{ path: "address", message }],
        }),
      ).toBe(message);
    }
  });

  it("EARS-21: a refusal no field owns is not an address refusal", () => {
    expect(
      feedSourceAddressRefusal({ errorCode: "PRECONDITION_FAILED" }),
    ).toBeNull();
    expect(
      feedSourceAddressRefusal({
        errorCode: "VALIDATION_FAILED",
        fieldErrors: [{ path: "platform", message: "x" }],
      }),
    ).toBeNull();
    expect(feedSourceAddressRefusal(undefined)).toBeNull();
  });

  it("EARS-22: a stale row, a repeated switch and a gone source get their own sentences", () => {
    const fallback = "feedSources.errors.disableFailed";
    expect(
      feedSourceErrorKey({ errorCode: "PRECONDITION_FAILED" }, fallback),
    ).toBe("feedSources.errors.stale");
    expect(
      feedSourceErrorKey({ errorCode: "INVALID_TRANSITION" }, fallback),
    ).toBe("feedSources.errors.invalidTransition");
    expect(
      feedSourceErrorKey({ errorCode: "RESOURCE_NOT_FOUND" }, fallback),
    ).toBe("feedSources.errors.notFound");
    expect(feedSourceErrorKey({ errorCode: "SOMETHING_ELSE" }, fallback)).toBe(
      fallback,
    );
  });
});
