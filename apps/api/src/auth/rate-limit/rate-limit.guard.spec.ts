import { HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";
import type { RateLimitThresholds } from "./rate-limit.types.js";

// 003 EARS-13 (#3379): a refusal of a window keyed by the client address names
// when that window reopens; an identifier-keyed refusal names nothing (EARS-16).
describe("RateLimitGuard Retry-After (003 EARS-13)", () => {
  const thresholds: RateLimitThresholds = {
    perUserPer15Min: 2,
    perIpPer15Min: 3,
    perAsnPerHour: 100,
    scopedPerIpPer15Min: {},
  };
  let now: number;
  let guard: RateLimitGuard;

  beforeEach(() => {
    now = 1_700_000_000_000;
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    guard = new RateLimitGuard(
      new RateLimitService(thresholds, () => now),
      reflector,
    );
  });

  function call(ip: string, identifier?: string) {
    const header = vi.fn();
    const request = { ip, headers: {}, body: identifier ? { identifier } : {} };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ header }),
      }),
    } as unknown as ExecutionContext;
    try {
      return { allowed: guard.canActivate(context), header };
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
      return { allowed: false, header };
    }
  }

  it("003 EARS-13: a per-IP refusal is a 429 whose Retry-After counts whole seconds to the window reset", () => {
    for (let i = 0; i < thresholds.perIpPer15Min; i++) call("203.0.113.7");
    now += 60_000 + 400; // 14 min minus 0.4 s left in the window
    const refused = call("203.0.113.7");
    expect(refused.allowed).toBe(false);
    expect(refused.header).toHaveBeenCalledWith("Retry-After", "840");
  });

  it("003 EARS-13: Retry-After is never below one second", () => {
    for (let i = 0; i < thresholds.perIpPer15Min; i++) call("203.0.113.7");
    now += 15 * 60 * 1000 - 1;
    expect(call("203.0.113.7").header).toHaveBeenCalledWith("Retry-After", "1");
  });

  it("003 EARS-13: an identifier-keyed refusal carries no Retry-After (EARS-16)", () => {
    call("10.0.0.1", "user@ds.test");
    call("10.0.0.2", "user@ds.test");
    const refused = call("10.0.0.3", "user@ds.test");
    expect(refused.allowed).toBe(false);
    expect(refused.header).not.toHaveBeenCalled();
  });

  it("003 EARS-13: an allowed request carries no Retry-After", () => {
    const ok = call("203.0.113.7");
    expect(ok.allowed).toBe(true);
    expect(ok.header).not.toHaveBeenCalled();
  });
});
