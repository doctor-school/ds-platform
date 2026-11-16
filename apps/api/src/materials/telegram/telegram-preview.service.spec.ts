import { describe, expect, it } from "vitest";
import {
  PREVIEW_MAX_ATTEMPTS,
  PREVIEW_RETRY_WINDOW_MINUTES,
  previewRetryDelayMinutes,
} from "../feed-entries.repository.js";
import { sniffImageType } from "./telegram-preview.service.js";

describe("048 Telegram preview schedule", () => {
  it("048 EARS-29: the scheduled retries back off from 10 minutes and span at least 24 hours before the preview is failed", () => {
    expect(previewRetryDelayMinutes(0)).toBe(0);
    expect(previewRetryDelayMinutes(1)).toBe(10);
    expect(previewRetryDelayMinutes(2)).toBe(20);
    expect(previewRetryDelayMinutes(3)).toBe(40);
    expect(previewRetryDelayMinutes(20)).toBe(240);
    let waited = 0;
    for (let n = 1; n < PREVIEW_MAX_ATTEMPTS; n += 1) {
      waited += previewRetryDelayMinutes(n);
    }
    expect(waited).toBeGreaterThanOrEqual(PREVIEW_RETRY_WINDOW_MINUTES);
    // One fewer attempt would not span the window: the bound is the smallest.
    expect(
      waited - previewRetryDelayMinutes(PREVIEW_MAX_ATTEMPTS - 1),
    ).toBeLessThan(PREVIEW_RETRY_WINDOW_MINUTES);
  });

  it("048 EARS-29: a downloaded file's type is read from its bytes, and a non-image is refused", () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(
      sniffImageType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
      ),
    ).toBe("image/png");
    expect(sniffImageType(Buffer.from("RIFF0000WEBPVP8 ", "latin1"))).toBe(
      "image/webp",
    );
    expect(sniffImageType(Buffer.from("<html>"))).toBeNull();
  });
});
