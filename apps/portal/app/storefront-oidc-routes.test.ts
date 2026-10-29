import { describe, expect, it, vi } from "vitest";

/**
 * 003 EARS-61 / EARS-62 — this storefront's entries and callback are thin
 * MOUNTS of the one core in `@ds/auth-flow/server` (ADR-0013 A1): the
 * behaviour is pinned once in `packages/auth-flow/src/server/storefront-oidc.test.ts`;
 * this tier pins only that the callback route names THIS host's OIDC binding.
 * The four doors are answered by the storefront gate (003 EARS-61 / 72), pinned
 * in the gate's own test.
 */
const core = vi.hoisted(() => ({
  storefrontCallback: vi.fn(async () => new Response(null, { status: 303 })),
}));
vi.mock("@ds/auth-flow/server", () => core);

import { ACADEMY_STOREFRONT_OIDC } from "@/lib/auth-flow.host-config";

import * as callback from "./auth/callback/route";

describe("storefront OIDC routes", () => {
  it("003 EARS-62: /auth/callback answers GET through the shared callback, and a POST goes to the same refusal", async () => {
    const get = new Request("https://storefront.example/auth/callback?code=c");
    await callback.GET(get);
    expect(core.storefrontCallback).toHaveBeenLastCalledWith(
      get,
      ACADEMY_STOREFRONT_OIDC,
    );
    const post = new Request("https://storefront.example/auth/callback", {
      method: "POST",
    });
    await callback.POST(post);
    expect(core.storefrontCallback).toHaveBeenLastCalledWith(
      post,
      ACADEMY_STOREFRONT_OIDC,
    );
  });
});
