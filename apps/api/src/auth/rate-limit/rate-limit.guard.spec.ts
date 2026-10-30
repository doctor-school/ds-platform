import { HttpException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { RateLimitService } from "./rate-limit.service.js";
import {
  RATE_LIMITED_KEY,
  THROTTLED_PASSWORD_LOGIN_KEY,
  type RateLimitThresholds,
} from "./rate-limit.types.js";
import { InMemoryAuthAuditLog } from "../session/auth-audit.fake.js";

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
      new InMemoryAuthAuditLog(),
    );
  });

  async function call(ip: string, identifier?: string) {
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
      return { allowed: await guard.canActivate(context), header };
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(429);
      return { allowed: false, header };
    }
  }

  it("003 EARS-13: a per-IP refusal is a 429 whose Retry-After counts whole seconds to the window reset", async () => {
    for (let i = 0; i < thresholds.perIpPer15Min; i++)
      await call("203.0.113.7");
    now += 60_000 + 400; // 14 min minus 0.4 s left in the window
    const refused = await call("203.0.113.7");
    expect(refused.allowed).toBe(false);
    expect(refused.header).toHaveBeenCalledWith("Retry-After", "840");
  });

  it("003 EARS-13: Retry-After is never below one second", async () => {
    for (let i = 0; i < thresholds.perIpPer15Min; i++)
      await call("203.0.113.7");
    now += 15 * 60 * 1000 - 1;
    expect((await call("203.0.113.7")).header).toHaveBeenCalledWith(
      "Retry-After",
      "1",
    );
  });

  it("003 EARS-13: an identifier-keyed refusal carries no Retry-After (EARS-16)", async () => {
    await call("10.0.0.1", "user@ds.test");
    await call("10.0.0.2", "user@ds.test");
    const refused = await call("10.0.0.3", "user@ds.test");
    expect(refused.allowed).toBe(false);
    expect(refused.header).not.toHaveBeenCalled();
  });

  it("003 EARS-13: an allowed request carries no Retry-After", async () => {
    const ok = await call("203.0.113.7");
    expect(ok.allowed).toBe(true);
    expect(ok.header).not.toHaveBeenCalled();
  });
});

// 003 EARS-15 (#3539): a password login the limiter refuses is audited as
// `auth.login.failure` reason `throttled`; other refused doors are not logins.
describe("RateLimitGuard throttled password login (003 EARS-15)", () => {
  const thresholds: RateLimitThresholds = {
    perUserPer15Min: 2,
    perIpPer15Min: 100,
    perAsnPerHour: 100,
    scopedPerIpPer15Min: {},
  };

  function setup(passwordLogin: boolean) {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockImplementation((key) =>
      key === RATE_LIMITED_KEY
        ? true
        : key === THROTTLED_PASSWORD_LOGIN_KEY
          ? passwordLogin || undefined
          : undefined,
    );
    const audit = new InMemoryAuthAuditLog();
    const guard = new RateLimitGuard(
      new RateLimitService(thresholds, () => 1_700_000_000_000),
      reflector,
      audit,
    );
    const attempt = async (identifier: string) => {
      const context = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
          getRequest: () => ({
            ip: "10.0.0.1",
            headers: {},
            body: { identifier },
          }),
          getResponse: () => ({ header: vi.fn() }),
        }),
      } as unknown as ExecutionContext;
      try {
        return await guard.canActivate(context);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(429);
        return false;
      }
    };
    return { audit, attempt };
  }

  it("EARS-15: a throttled password login appends auth.login.failure with reason throttled", async () => {
    const { audit, attempt } = setup(true);
    expect(await attempt("user@ds.test")).toBe(true);
    expect(await attempt("user@ds.test")).toBe(true);
    expect(audit.events).toEqual([]);
    expect(await attempt("user@ds.test")).toBe(false);
    expect(audit.events).toEqual([
      { type: "LoginFailed", identifier: "user@ds.test", reason: "throttled" },
    ]);
  });

  it("EARS-15: a throttled door that is not a password login records no login failure", async () => {
    const { audit, attempt } = setup(false);
    for (let i = 0; i < 3; i++) await attempt("user@ds.test");
    expect(audit.events).toEqual([]);
  });
});
