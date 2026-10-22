import { describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-61 / EARS-62 — this storefront's entries and callback are thin
 * MOUNTS of the one core in `@ds/auth-flow/server` (ADR-0013 A1): the
 * behaviour is pinned once in `packages/auth-flow/src/server/storefront-oidc.test.ts`;
 * this tier pins only that every route names THIS host's OIDC binding and its
 * own entry.
 */
const core = vi.hoisted(() => ({
  storefrontEntry: vi.fn(async () => new Response(null, { status: 303 })),
  storefrontCallback: vi.fn(async () => new Response(null, { status: 303 })),
}));
vi.mock("@ds/auth-flow/server", () => core);

import { DOCTOR_STOREFRONT_OIDC } from "@/lib/auth-flow.host-config";

import * as callback from "./auth/callback/route";
import * as login from "./(auth)/login/route";
import * as register from "./(auth)/register/route";
import * as reset from "./(auth)/reset/route";
import * as verify from "./(auth)/verify/route";

describe("storefront OIDC routes", () => {
  it("003 EARS-61: /login, /register, /reset and /verify are GET entries into the shared core with this host's client", async () => {
    const request = new Request("https://storefront.example/login");
    for (const [entry, route] of [
      ["login", login],
      ["register", register],
      ["reset", reset],
      ["verify", verify],
    ] as const) {
      await route.GET(request);
      expect(core.storefrontEntry).toHaveBeenLastCalledWith(
        request,
        DOCTOR_STOREFRONT_OIDC,
        entry,
      );
      expect(Object.keys(route)).toEqual(["GET"]);
    }
    expect(DOCTOR_STOREFRONT_OIDC.client).toBe("doctor");
  });

  it("003 EARS-62: /auth/callback answers GET through the shared callback, and a POST goes to the same refusal", async () => {
    const get = new Request("https://storefront.example/auth/callback?code=c");
    await callback.GET(get);
    expect(core.storefrontCallback).toHaveBeenLastCalledWith(
      get,
      DOCTOR_STOREFRONT_OIDC,
    );
    const post = new Request("https://storefront.example/auth/callback", {
      method: "POST",
    });
    await callback.POST(post);
    expect(core.storefrontCallback).toHaveBeenLastCalledWith(
      post,
      DOCTOR_STOREFRONT_OIDC,
    );
  });
});
