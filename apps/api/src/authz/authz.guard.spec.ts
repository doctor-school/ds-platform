import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AuthzGuard } from "./authz.guard.js";
import { AUTHZ_KEY, type AuthzMeta } from "./authz.types.js";

/** Build a fake ExecutionContext whose handler carries `meta` and whose request carries `user`. */
function ctx(meta: AuthzMeta | undefined, user?: unknown): ExecutionContext {
  const handler = (): void => {};
  if (meta) Reflect.defineMetadata(AUTHZ_KEY, meta, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const guard = new AuthzGuard();

describe("AuthzGuard (runtime mirror, fail-closed)", () => {
  it("denies a handler with no @Authz metadata (fail-closed)", () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });

  it("allows a public endpoint without a subject", () => {
    const meta: AuthzMeta = {
      access: "public",
      check: "none",
      audit: "high-stakes",
      tests: ["EARS-5"],
    };
    expect(guard.canActivate(ctx(meta))).toBe(true);
  });

  it("denies an authenticated endpoint when no subject is present", () => {
    const meta: AuthzMeta = {
      access: "authenticated",
      roles: ["doctor_guest"],
      check: "fast-path",
      audit: "low-stakes",
      tests: ["EARS-10"],
    };
    expect(() => guard.canActivate(ctx(meta))).toThrow(UnauthorizedException);
  });

  it("allows an authenticated fast-path endpoint when the subject holds a required role", () => {
    const meta: AuthzMeta = {
      access: "authenticated",
      roles: ["doctor_guest"],
      check: "fast-path",
      audit: "low-stakes",
      tests: ["EARS-10"],
    };
    expect(guard.canActivate(ctx(meta, { roles: ["doctor_guest"] }))).toBe(true);
  });

  it("denies an authenticated fast-path endpoint when the subject lacks every required role", () => {
    const meta: AuthzMeta = {
      access: "authenticated",
      roles: ["doctor_guest"],
      check: "fast-path",
      audit: "low-stakes",
      tests: ["EARS-10"],
    };
    expect(() => guard.canActivate(ctx(meta, { roles: ["guest"] }))).toThrow(
      ForbiddenException,
    );
  });
});
