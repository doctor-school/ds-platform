import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 014 EARS-6 / rule S1 of the auth-flow standard (`packages/auth-flow/README.md`)
 * — the Academy cabinet decides the GUEST on the server, before any paint.
 *
 * Until this change `/account` was a `"use client"` surface: it rendered the
 * «Загружаем ваш профиль…» frame, fetched the profile, and only then bounced a
 * guest with `router.replace`. The visitor saw a frame of a page they were never
 * allowed to see, and the bounce cost a full client round-trip. The decision now
 * runs in an async Server Component through the SAME `resolveServerAuth` read the
 * auth layouts and the doctor cabinet branch on, and the guest is redirected
 * carrying `/account` as the return target — the shared carry the sibling
 * `/account/events` surface already makes.
 *
 * The signed-in profile surface itself stays a client child
 * (`./account-profile`): the inline display-name edit, the EARS-9 silent refresh
 * and logout are interactive, and the server decision is about WHO may see it.
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

vi.mock("./account-profile", () => ({
  AccountProfile: () => null,
}));

import AccountPage from "./page";

beforeEach(() => {
  redirect.mockClear();
  resolveServerAuth.mockReset().mockResolvedValue({ status: "guest" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("014 EARS-6: the Academy cabinet decides the guest on the server", () => {
  it("014 EARS-6.8: a guest is redirected to /login carrying /account, before anything renders", async () => {
    await expect(AccountPage()).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faccount");
  });

  it("014 EARS-6.8: the guest branch composes no tree at all — no loading frame can be painted", async () => {
    await expect(AccountPage()).rejects.toThrow(/NEXT_REDIRECT/);
    // One session read, then the throw: the page never reached its body.
    expect(resolveServerAuth).toHaveBeenCalledTimes(1);
  });

  it("014 EARS-6.8: a signed-in doctor gets the profile surface and no redirect", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "1", roles: ["doctor_guest"], mfa: false },
    });
    const tree = await AccountPage();
    expect(tree).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
