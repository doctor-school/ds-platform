import { isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 046 EARS-4 — the section's route mount: the guest decision on the server and
 * the host handed to the section. The section UI itself is asserted in
 * `ui/congress-section.test.tsx`.
 */

const { redirect, resolveServerAuth } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  resolveServerAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: "__Host-ds_session=x" }),
}));
vi.mock("@ds/auth-flow/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ds/auth-flow/server")>()),
  resolveServerAuth,
}));

import { CongressSection } from "../ui";
import { CongressSectionRoute } from "./section-route";

const AUTH = {
  routes: {
    login: "/login",
    register: "/register",
    verify: "/verify",
    reset: "/reset",
    account: "/account",
    allowAuthenticated: ["/reset"],
    eventPathTemplate: "/events/:slug",
  },
} as const;

const HOST = {
  path: "/account/congress",
  accountHref: "/account",
  eventHrefPrefix: "/events/",
  fillingGuideHref: "https://orthobio.ru/participants/zapolnit-zayavku",
} as const;

beforeEach(() => {
  redirect.mockClear();
  resolveServerAuth.mockReset();
});

describe("CongressSectionRoute", () => {
  it("046 EARS-4: a guest is sent to the login carrying the section as the return target", async () => {
    resolveServerAuth.mockResolvedValue({ status: "guest" });

    await expect(
      CongressSectionRoute({ auth: AUTH, host: HOST }),
    ).rejects.toThrow("NEXT_REDIRECT:/login?returnTo=%2Faccount%2Fcongress");
  });

  it("046 EARS-4: a signed-in account gets the section with the same door as its sign-in link", async () => {
    resolveServerAuth.mockResolvedValue({ status: "doctor", claims: {} });

    const tree = (await CongressSectionRoute({
      auth: AUTH,
      host: HOST,
    })) as ReactElement<{ children: ReactElement[] }>;
    const el = tree.props.children[1] as ReactElement<{ host: unknown }>;

    expect(isValidElement(el)).toBe(true);
    expect(el.type).toBe(CongressSection);
    expect(el.props.host).toEqual({
      accountHref: "/account",
      eventHrefPrefix: "/events/",
      fillingGuideHref: "https://orthobio.ru/participants/zapolnit-zayavku",
      signInHref: "/login?returnTo=%2Faccount%2Fcongress",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("003 EARS-73: the signed-in render declares the section's own guest bounce for the return re-check", async () => {
    resolveServerAuth.mockResolvedValue({ status: "doctor", claims: {} });

    const tree = (await CongressSectionRoute({
      auth: AUTH,
      host: HOST,
    })) as ReactElement<{ children: ReactElement[] }>;
    const marker = tree.props.children[0] as ReactElement<
      Record<string, unknown>
    >;

    expect(marker.type).toBe("span");
    expect(marker.props).toEqual({
      "data-guest-bounce": "/login?returnTo=%2Faccount%2Fcongress",
      hidden: true,
    });
  });
});
