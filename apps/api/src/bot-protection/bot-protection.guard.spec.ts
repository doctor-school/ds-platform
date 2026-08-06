import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import {
  BOT_PROTECTION_TOKEN_FIELD,
  BOT_PROTECTION_TOKEN_HEADER,
  BotProtectionGuard,
} from "./bot-protection.guard.js";
import {
  BOT_PROTECTED_KEY,
  type BotProtection,
  type BotProtectionAction,
  type BotProtectionResult,
} from "./bot-protection.types.js";

/** Build a fake ExecutionContext whose handler carries `action` and whose request is `req`. */
function ctx(
  action: BotProtectionAction | undefined,
  req: unknown,
): ExecutionContext {
  const handler = (): void => {};
  if (action) Reflect.defineMetadata(BOT_PROTECTED_KEY, action, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** A swappable provider double — records its call so we can assert the contract. */
function fakeProvider(result: BotProtectionResult): {
  provider: BotProtection;
  calls: Array<[string, BotProtectionAction, string]>;
} {
  const calls: Array<[string, BotProtectionAction, string]> = [];
  return {
    calls,
    provider: {
      verify(token, action, clientIp) {
        calls.push([token, action, clientIp]);
        return Promise.resolve(result);
      },
    },
  };
}

const reflector = new Reflector();

describe("BotProtectionGuard (additive, fail-closed)", () => {
  it("is a no-op on a handler without @BotProtected", async () => {
    const { provider, calls } = fakeProvider({ ok: false });
    const guard = new BotProtectionGuard(provider, reflector);
    await expect(guard.canActivate(ctx(undefined, {}))).resolves.toBe(true);
    expect(calls).toHaveLength(0); // provider never consulted
  });

  it("EARS-17: delegates a missing token and returns the stable REQUIRED code", async () => {
    const { provider, calls } = fakeProvider({
      ok: false,
      reason: "missing-token",
    });
    const guard = new BotProtectionGuard(provider, reflector);
    const error = await guard
      .canActivate(ctx("register", { headers: {}, body: {} }))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: "BOT_PROTECTION_REQUIRED",
    });
    // The empty token reaches the provider — the missing-token decision lives
    // there (so a disabled provider can still pass), not in the guard.
    expect(calls).toEqual([["", "register", ""]]);
  });

  it("lets a missing token through when the provider accepts it (disabled provider in dev)", async () => {
    const { provider } = fakeProvider({
      ok: true,
      reason: "bot-protection-disabled",
    });
    const guard = new BotProtectionGuard(provider, reflector);
    await expect(
      guard.canActivate(ctx("register", { headers: {}, body: {} })),
    ).resolves.toBe(true);
  });

  it("EARS-17: returns the stable REJECTED code for an invalid token", async () => {
    const { provider } = fakeProvider({ ok: false, reason: "validate-failed" });
    const guard = new BotProtectionGuard(provider, reflector);
    const error = await guard
      .canActivate(
        ctx("password-reset", {
          headers: { [BOT_PROTECTION_TOKEN_HEADER]: "bad-token" },
          ip: "203.0.113.7",
        }),
      )
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: "BOT_PROTECTION_REJECTED",
    });
  });

  it("passes the token, action, and client IP to the provider on a header token", async () => {
    const { provider, calls } = fakeProvider({ ok: true });
    const guard = new BotProtectionGuard(provider, reflector);
    await expect(
      guard.canActivate(
        ctx("login-challenge", {
          headers: { [BOT_PROTECTION_TOKEN_HEADER]: "good-token" },
          ip: "203.0.113.9",
        }),
      ),
    ).resolves.toBe(true);
    expect(calls).toEqual([["good-token", "login-challenge", "203.0.113.9"]]);
  });

  it("falls back to the body field when no header token is present", async () => {
    const { provider, calls } = fakeProvider({ ok: true });
    const guard = new BotProtectionGuard(provider, reflector);
    await expect(
      guard.canActivate(
        ctx("register", {
          headers: {},
          body: { [BOT_PROTECTION_TOKEN_FIELD]: "body-token" },
          ip: "203.0.113.4",
        }),
      ),
    ).resolves.toBe(true);
    expect(calls[0]?.[0]).toBe("body-token");
  });

  it("EARS-17: never leaks the provider reason in the stable response", async () => {
    const { provider } = fakeProvider({ ok: false, reason: "secret-internal" });
    const guard = new BotProtectionGuard(provider, reflector);
    const error = await guard
      .canActivate(
        ctx("register", {
          headers: { [BOT_PROTECTION_TOKEN_HEADER]: "t" },
          ip: "203.0.113.1",
        }),
      )
      .catch((caught) => caught);
    const response = (error as ForbiddenException).getResponse();
    expect(response).toMatchObject({ code: "BOT_PROTECTION_REJECTED" });
    expect(JSON.stringify(response)).not.toContain("secret-internal");
  });
});
