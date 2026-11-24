import { describe, expect, it } from "vitest";
import { stageEntryUnavailableOrigin } from "./storefront-entry";

describe("stage storefront entry-unavailable origin", () => {
  it("uses the corresponding gated fixture for each stage storefront", () => {
    expect(
      stageEntryUnavailableOrigin("academy", "https://academy-main.stage.test"),
    ).toBe("https://academy-entry-unavailable-main.stage.test");
    expect(
      stageEntryUnavailableOrigin("doctor", "https://doctor-pr-42.stage.test/"),
    ).toBe("https://doctor-entry-unavailable-pr-42.stage.test");
    expect(
      stageEntryUnavailableOrigin("academy", "http://localhost:3001"),
    ).toBeUndefined();
    expect(
      stageEntryUnavailableOrigin("academy", "https://doctor-pr-42.stage.test"),
    ).toBeUndefined();
  });

  it("accepts only a plain IPv4 loopback origin for a PR fixture", () => {
    const preview = "https://academy-pr-42.stage.test";
    expect(
      stageEntryUnavailableOrigin("academy", preview, "http://127.0.0.1:38021"),
    ).toBe("http://127.0.0.1:38021");
    for (const tunnel of [
      "https://127.0.0.1:38021",
      "http://localhost:38021",
      "http://127.0.0.1:38021/path",
      "http://127.0.0.1",
    ]) {
      expect(() =>
        stageEntryUnavailableOrigin("academy", preview, tunnel),
      ).toThrow(/PR slot.*loopback/);
    }
    expect(() =>
      stageEntryUnavailableOrigin(
        "academy",
        "https://academy-main.stage.test",
        "http://127.0.0.1:38021",
      ),
    ).toThrow(/PR slot.*loopback/);
  });
});
