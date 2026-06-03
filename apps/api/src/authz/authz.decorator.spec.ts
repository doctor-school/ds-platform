import { Controller, Get } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { Authz, Public } from "./authz.decorator.js";
import { AUTHZ_KEY, IS_PUBLIC_KEY, type AuthzMeta } from "./authz.types.js";

describe("@Authz / @Public decorators", () => {
  const meta: AuthzMeta = {
    access: "public",
    check: "none",
    audit: "high-stakes",
    tests: ["EARS-5"],
  };

  @Controller({ path: "fixture", version: "1" })
  class FixtureController {
    @Get("login")
    @Public()
    @Authz(meta)
    login(): void {}
  }

  const reflector = new Reflector();

  it("writes the AuthzMeta under AUTHZ_KEY so the guard/gate can read it", () => {
    const read = reflector.get<AuthzMeta>(
      AUTHZ_KEY,
      FixtureController.prototype.login,
    );
    expect(read).toEqual(meta);
  });

  it("marks @Public() handlers under IS_PUBLIC_KEY", () => {
    const isPublic = reflector.get<boolean>(
      IS_PUBLIC_KEY,
      FixtureController.prototype.login,
    );
    expect(isPublic).toBe(true);
  });
});
