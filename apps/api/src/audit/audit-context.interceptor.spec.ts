import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { defer, lastValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { getAuditContext } from "./audit-context.js";
import {
  AuditContextInterceptor,
  deriveSource,
} from "./audit-context.interceptor.js";

// 010 EARS-3/5 (#1088). Unit-pins the interceptor: (1) the route→source
// derivation, and (2) that the downstream handler actually runs inside the
// AsyncLocalStorage scope — `defer(() => getAuditContext())` reads the store on
// SUBSCRIBE, so it sees the context only if the Observable-wrap propagates it
// (the reliability crux of the ALS approach).

function httpContext(req: unknown): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const readStoreHandler: CallHandler = {
  handle: () => defer(() => of(getAuditContext())),
};

describe("AuditContextInterceptor (010 EARS-3/5)", () => {
  it("deriveSource: an /admin/ route is admin-ui, every other route is portal-api", () => {
    expect(deriveSource("/v1/admin/events")).toBe("admin-ui");
    expect(deriveSource("/v1/admin/events/abc/publish")).toBe("admin-ui");
    expect(deriveSource("/v1/me/display-name")).toBe("portal-api");
    expect(deriveSource("/v1/events/abc/registration")).toBe("portal-api");
    expect(deriveSource("/v1/auth/register")).toBe("portal-api");
  });

  it("runs the downstream handler inside the store with the actor sub + derived source", async () => {
    const interceptor = new AuditContextInterceptor();
    const ctx = httpContext({
      user: { sub: "sub-123" },
      url: "/v1/admin/events",
    });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, readStoreHandler),
    );
    expect(result).toEqual({ actorSub: "sub-123", source: "admin-ui" });
  });

  it("actor sub is null for an unauthenticated request (concrete source, no fabricated actor)", async () => {
    const interceptor = new AuditContextInterceptor();
    const ctx = httpContext({ url: "/v1/auth/register" });
    const result = await lastValueFrom(
      interceptor.intercept(ctx, readStoreHandler),
    );
    expect(result).toEqual({ actorSub: null, source: "portal-api" });
  });

  it("passes a non-HTTP context through with no store (→ the write degrades to db-direct)", async () => {
    const interceptor = new AuditContextInterceptor();
    const ctx = { getType: () => "rpc" } as unknown as ExecutionContext;
    const result = await lastValueFrom(
      interceptor.intercept(ctx, readStoreHandler),
    );
    expect(result).toBeUndefined();
  });
});
