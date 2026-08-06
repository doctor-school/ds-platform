import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import type { BotProtection } from "../../bot-protection/index.js";
import { LoginChallengeGuard } from "./login-challenge.guard.js";
import { LoginChallengePolicy } from "./login-challenge.policy.js";
import { LOGIN_CHALLENGED_KEY } from "./login-challenge.types.js";

function context(body: Record<string, unknown>): ExecutionContext {
  const handler = (): void => {};
  Reflect.defineMetadata(LOGIN_CHALLENGED_KEY, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ body, headers: {}, ip: "203.0.113.7" }),
    }),
  } as unknown as ExecutionContext;
}

function challengedPolicy(): LoginChallengePolicy {
  const policy = new LoginChallengePolicy(
    { threshold: 1, windowMs: 60_000 },
    () => 1_000,
  );
  policy.recordFailure("203.0.113.7");
  return policy;
}

describe("LoginChallengeGuard machine-readable contract", () => {
  it("EARS-17: a threshold challenge without a token returns BOT_PROTECTION_REQUIRED", async () => {
    const provider: BotProtection = {
      verify: async () => ({ ok: false, reason: "missing-token" }),
    };
    const guard = new LoginChallengeGuard(
      provider,
      challengedPolicy(),
      new Reflector(),
    );

    const error = await guard
      .canActivate(context({}))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: "BOT_PROTECTION_REQUIRED",
    });
  });

  it("EARS-17: a rejected one-time token returns BOT_PROTECTION_REJECTED", async () => {
    const provider: BotProtection = {
      verify: async () => ({ ok: false, reason: "validate-failed" }),
    };
    const guard = new LoginChallengeGuard(
      provider,
      challengedPolicy(),
      new Reflector(),
    );

    const error = await guard
      .canActivate(context({ captchaToken: "spent-token" }))
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      statusCode: 403,
      code: "BOT_PROTECTION_REJECTED",
    });
  });
});
