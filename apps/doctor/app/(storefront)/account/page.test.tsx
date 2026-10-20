import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountPage, type AccountPageProps } from "@ds/account/page";

import { DOCTOR_ACCOUNT, DOCTOR_AUTH_FLOW } from "@/lib/auth-flow.host-config";
import { DOCTOR_CONGRESS_SECTION } from "@/lib/congress-submissions.host-config";
import { DOCTOR_EVENTS_STOREFRONT } from "@/lib/events-storefront.host-config";

/**
 * 017 #1958 — the server half of `doctor.school/account`: who is let in.
 *
 * Since #2073 (wave-4 PR 4.2) `/account` is a mount of `@ds/account`: the route
 * file hands the package page the doctor host config and nothing else. This
 * suite pins the mount and drives the mounted page with the REAL doctor config,
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
// Only the session read is doubled: the shared carry helper the bounce is built
// with keeps the REAL codec it imports from this same module.
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth: (...args: unknown[]) => resolveServerAuth(...args),
}));

import DoctorAccountRoute, { dynamic, metadata } from "./page";

/** The route's single mount element. */
function mount(): ReactElement<AccountPageProps> {
  const tree = DoctorAccountRoute();
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

describe("#2073: /account is a mount of @ds/account with the doctor host config", () => {
  it("the route renders the package page with DOCTOR_ACCOUNT and nothing else, per visitor", () => {
    const tree = mount();
    expect(tree.type).toBe(AccountPage);
    expect(tree.props).toEqual({ config: DOCTOR_ACCOUNT });
    expect(dynamic).toBe("force-dynamic");
  });

  it("gate row 18: the tab title is «Личный кабинет — Doctor.School», the same on both storefronts", () => {
    expect(metadata.title).toBe("Личный кабинет — Doctor.School");
  });

  it("the doctor config carries its auth-flow config, its events-storefront «Мои события» route and its congress section", () => {
    expect(DOCTOR_ACCOUNT.authFlow).toBe(DOCTOR_AUTH_FLOW);
    expect(DOCTOR_ACCOUNT.eventsHref).toBe(
      DOCTOR_EVENTS_STOREFRONT.routes.accountEvents,
    );
    expect(DOCTOR_ACCOUNT.congress).toEqual({
      path: DOCTOR_CONGRESS_SECTION.path,
    });
  });
});

describe("017 EARS-1: the doctor cabinet decides the guest on the server", () => {
  it("017 EARS-1: a guest is redirected to the door carrying ?returnTo=/account, and the cabinet never renders", async () => {
    const tree = mount();
    await expect(AccountPage(tree.props)).rejects.toThrow(
      "NEXT_REDIRECT:/login?returnTo=%2Faccount",
    );
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Faccount");
    expect(resolveServerAuth).toHaveBeenCalledTimes(1);
  });

  it("017 EARS-1: a signed-in doctor gets the account screen and no redirect", async () => {
    resolveServerAuth.mockResolvedValue({
      status: "doctor",
      claims: { sub: "doctor-1", roles: ["doctor"], mfa: false },
    });
    const tree = mount();
    expect(await AccountPage(tree.props)).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});
