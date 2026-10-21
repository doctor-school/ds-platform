import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPage, type AccountPageProps } from "@ds/account/page";

import {
  ACADEMY_ACCOUNT,
  ACADEMY_AUTH_FLOW,
} from "../../lib/auth-flow.host-config";
import { ACADEMY_EVENTS_STOREFRONT } from "../../lib/events-storefront.host-config";

/**
 * 014 EARS-6 / rule S1 of the auth-flow standard (`packages/auth-flow/README.md`)
 * — the Academy cabinet decides the GUEST on the server, before any paint.
 *
 * Since #2073 (wave-4 PR 4.1) `/account` is a mount of `@ds/account`: the route
 * file hands the package page the Academy host config and nothing else. This
 * suite pins the mount and drives the mounted page with the REAL Academy config,
 * so the guest bounce this host emits stays `/login?returnTo=%2Faccount`; the
 * cabinet itself is asserted in `packages/account/src/ui/*.test.tsx`.
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

import AccountRoute, { metadata } from "./page";

/** The route's single mount element. */
function mount(): ReactElement<AccountPageProps> {
  const tree = AccountRoute();
  if (!isValidElement<AccountPageProps>(tree)) {
    throw new Error("the /account route renders no element");
  }
  return tree;
}

beforeEach(() => {
  redirect.mockClear();
  resolveServerAuth.mockReset().mockResolvedValue({ status: "guest" });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("#2073: /account is a mount of @ds/account with the Academy host config", () => {
  it("the route renders the package page with ACADEMY_ACCOUNT and nothing else", () => {
    const tree = mount();
    expect(tree.type).toBe(AccountPage);
    expect(tree.props).toEqual({ config: ACADEMY_ACCOUNT });
  });

  it("gate row 18: the tab title is «Личный кабинет — Doctor.School», the same on both storefronts", () => {
    expect(metadata.title).toBe("Личный кабинет — Doctor.School");
  });

  it("the Academy config carries its auth-flow config, its events-storefront «Мои события» route and no congress section", () => {
    expect(ACADEMY_ACCOUNT.authFlow).toBe(ACADEMY_AUTH_FLOW);
    expect(ACADEMY_ACCOUNT.eventsHref).toBe(
      ACADEMY_EVENTS_STOREFRONT.routes.accountEvents,
    );
    expect(ACADEMY_ACCOUNT.congress).toBeNull();
  });
});

describe("014 EARS-6: the Academy cabinet decides the guest on the server", () => {
  it("014 EARS-6.8: a guest is redirected to /login carrying /account, before anything renders", async () => {
    const tree = mount();
    await expect(AccountPage(tree.props)).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faccount");
    // One session read, then the throw: the page never reached its body.
    expect(resolveServerAuth).toHaveBeenCalledTimes(1);
  });

  it("014 EARS-6.8: a signed-in doctor gets the profile surface and no redirect", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "1", roles: ["doctor_guest"], mfa: false },
    });
    const tree = mount();
    expect(await AccountPage(tree.props)).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
