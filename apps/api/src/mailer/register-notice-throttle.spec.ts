import { describe, expect, it } from "vitest";
import {
  InMemoryRegisterNoticeThrottle,
  noticeThrottleKey,
  REGISTER_NOTICE_TTL_SECONDS,
} from "./register-notice-throttle.js";

const PEPPER = "unit-test-pepper";

describe("EARS-23: register-notice per-address throttle", () => {
  it("EARS-23: when a notice is acquired, the first within the window shall be allowed and the second suppressed", async () => {
    const throttle = new InMemoryRegisterNoticeThrottle(PEPPER);
    expect(await throttle.tryAcquire("owner@ds.test")).toBe(true);
    expect(await throttle.tryAcquire("owner@ds.test")).toBe(false);
  });

  it("EARS-23: when the throttle window has elapsed, a later notice shall be allowed again", async () => {
    let now = 1_000_000;
    const throttle = new InMemoryRegisterNoticeThrottle(PEPPER, () => now);
    expect(await throttle.tryAcquire("owner@ds.test")).toBe(true);
    now += REGISTER_NOTICE_TTL_SECONDS * 1000 + 1;
    expect(await throttle.tryAcquire("owner@ds.test")).toBe(true);
  });

  it("EARS-23: the throttle keys two different addresses independently", async () => {
    const throttle = new InMemoryRegisterNoticeThrottle(PEPPER);
    expect(await throttle.tryAcquire("a@ds.test")).toBe(true);
    expect(await throttle.tryAcquire("b@ds.test")).toBe(true);
  });

  it("EARS-23: the key is a non-reversible HMAC over the lowercased email (not the raw address)", () => {
    const key = noticeThrottleKey("Owner@DS.test", PEPPER);
    expect(key).toMatch(/^register-notice:[0-9a-f]{64}$/);
    expect(key).not.toContain("owner@ds.test");
    // Case-insensitive: the lowercased email produces the same key.
    expect(key).toBe(noticeThrottleKey("owner@ds.test", PEPPER));
  });
});
