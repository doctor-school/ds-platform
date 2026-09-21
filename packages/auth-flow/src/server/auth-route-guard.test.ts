import { describe, expect, it, vi } from "vitest";

import type { AuthFlowRoutes } from "../host-config";
import { guardAuthRoute, resolveAuthRouteGuard } from "./auth-route-guard";

/**
 * The ONE authenticated-visitor guard of the shared auth flow (wave-1 gate rows
 * 26-28, Q3; #2027 PR 1.4).
 *
 * The behaviour is #675's: an already-authenticated visitor must never be shown
 * an auth form, and `/reset` is the deliberate exemption 003 EARS-28 pins (the
 * `/account` change-password action hands off there, so a signed-in doctor has
 * to be able to finish it). What changes here is WHERE the decision is taken -
 * on the server, before paint, instead of the Academy's client `useEffect` -
 * which is why the decision is a pure function with its own cases and the
 * `redirect` effect is a one-line wrapper over it.
 */

const routes: AuthFlowRoutes = {
  login: "/login",
  register: "/register",
  verify: "/verify",
  reset: "/reset",
  account: "/account",
  allowAuthenticated: ["/reset"],
  eventPathTemplate: "/webinars/:slug",
};

describe("003 EARS-28 shared signed-in auth-route guard", () => {
  it("003 EARS-28.1: a GUEST is rendered every auth route, guarded ones included", () => {
    for (const pathname of ["/login", "/register", "/verify", "/reset"]) {
      expect(
        resolveAuthRouteGuard({ authenticated: false, pathname, routes }),
      ).toEqual({ action: "render" });
    }
  });

  it("003 EARS-28.2: an authenticated visitor is sent off every guarded auth route to the account route", () => {
    for (const pathname of ["/login", "/register", "/verify"]) {
      expect(
        resolveAuthRouteGuard({ authenticated: true, pathname, routes }),
      ).toEqual({ action: "redirect", to: "/account" });
    }
  });

  it("003 EARS-28.3: /reset stays open to an authenticated visitor via allowAuthenticated", () => {
    expect(
      resolveAuthRouteGuard({
        authenticated: true,
        pathname: "/reset",
        routes,
      }),
    ).toEqual({ action: "render" });
  });

  it("003 EARS-28.3: the exemption is host DATA - a host that exempts nothing closes /reset too", () => {
    expect(
      resolveAuthRouteGuard({
        authenticated: true,
        pathname: "/reset",
        routes: { ...routes, allowAuthenticated: [] },
      }),
    ).toEqual({ action: "redirect", to: "/account" });
  });

  it("003 EARS-28.4: a trailing slash is the same route - it can never smuggle a form past the guard", () => {
    expect(
      resolveAuthRouteGuard({
        authenticated: true,
        pathname: "/login/",
        routes,
      }),
    ).toEqual({ action: "redirect", to: "/account" });
    expect(
      resolveAuthRouteGuard({
        authenticated: true,
        pathname: "/reset/",
        routes,
      }),
    ).toEqual({ action: "render" });
  });

  it("003 EARS-28.5: a resolved landing wins over the account default, but only when it is a real target", () => {
    expect(
      resolveAuthRouteGuard({
        authenticated: true,
        pathname: "/login",
        routes,
        landing: "/events/ahilles-042",
      }),
    ).toEqual({ action: "redirect", to: "/events/ahilles-042" });
    expect(
      resolveAuthRouteGuard({
        authenticated: true,
        pathname: "/login",
        routes,
        landing: null,
      }),
    ).toEqual({ action: "redirect", to: "/account" });
  });

  it("003 EARS-28.2: the effect wrapper hands the decision to Next redirect, and renders otherwise", () => {
    const redirectImpl = vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }) as unknown as (to: string) => never;

    expect(() =>
      guardAuthRoute(
        { authenticated: true, pathname: "/login", routes },
        redirectImpl,
      ),
    ).toThrow(/NEXT_REDIRECT/);
    expect(redirectImpl).toHaveBeenCalledWith("/account");

    (redirectImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    expect(() =>
      guardAuthRoute(
        { authenticated: false, pathname: "/login", routes },
        redirectImpl,
      ),
    ).not.toThrow();
    expect(redirectImpl).not.toHaveBeenCalled();
  });
});
