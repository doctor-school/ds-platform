import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACADEMY_FIXTURE } from "@ds/auth-flow/test-support";

import type { AccountHostConfig } from "../host-config";

/**
 * 014 EARS-6 / rule S1 of the auth-flow standard (`packages/auth-flow/README.md`)
 * — the cabinet decides the GUEST on the server, before any paint (wave-4 gate
 * row 1). The decision runs in an async Server Component through the shared
 * `resolveServerAuth` read, and the guest is redirected carrying the host's
 * account route as the return target (gate D3).
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const resolveServerAuth = vi.fn();
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth: (...args: unknown[]) => resolveServerAuth(...args),
}));

vi.mock("./account-cabinet", () => ({
  AccountCabinet: () => null,
}));

import { AccountPage } from "./account-page";

const CONFIG: AccountHostConfig = {
  authFlow: ACADEMY_FIXTURE,
  eventsHref: "/account/events",
  congress: null,
};

beforeEach(() => {
  redirect.mockClear();
  resolveServerAuth.mockReset().mockResolvedValue({ status: "guest" });
});

describe("014 EARS-6: the account cabinet decides the guest on the server", () => {
  it("014 EARS-6.8: a guest is redirected to the host login carrying the account route, before anything renders", async () => {
    await expect(AccountPage({ config: CONFIG })).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faccount");
  });

  it("014 EARS-6.8: the guest branch composes no tree at all — no loading frame can be painted", async () => {
    await expect(AccountPage({ config: CONFIG })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    // One session read, then the throw: the page never reached its body.
    expect(resolveServerAuth).toHaveBeenCalledTimes(1);
  });

  it("014 EARS-6.8: a signed-in doctor gets the profile surface and no redirect", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "1", roles: ["doctor_guest"], mfa: false },
    });
    const tree = await AccountPage({ config: CONFIG });
    expect(tree).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
