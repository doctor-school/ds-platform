import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #675 / 003 EARS-28 — the Academy's four auth routes are guarded on the SERVER.
 *
 * The DECISION («who may see an auth route») is proved once in
 * `packages/auth-flow/src/server/auth-route-guard.test.ts`. What only this tier
 * can prove is the WIRING, and the wiring is where the realistic defect lives:
 * four near-identical layouts each have to hand the guard THEIR OWN pathname
 * against the ONE host route table, and a copy-pasted `pathname` would silently
 * make `/register` inherit `/reset`'s exemption.
 *
 * So nothing is stubbed between the layout and the package: the real
 * `resolveServerAuth` runs against a stubbed `fetch`, and the real guard runs
 * against `ACADEMY_AUTH_ROUTES`. Only the two Next request-scoped primitives
 * (`headers()`, `redirect()`) are mocked, because there is no request here.
 */

const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

const incoming = { headers: new Headers() };
vi.mock("next/headers", () => ({
  headers: async () => incoming.headers,
}));

import { VerifyRoute } from "@ds/auth-flow/verify/route";

import { ACADEMY_AUTH_FLOW } from "@/lib/auth-flow.host-config";

import ResetLayout from "./reset/layout";

const SIGNED_IN = new Headers({ cookie: "__Host-ds_session=abc" });
const GUEST = new Headers();

const fetchMock = vi.fn();

beforeEach(() => {
  redirect.mockClear();
  fetchMock.mockReset();
  // A session read that succeeds: the cookie-less case never reaches it.
  fetchMock.mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ sub: "u1", roles: ["doctor_guest"], mfa: false }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// `/login`, `/register` and `/verify` have no layout any more: #2027 PR 1.5,
// 1.6 and 1.7 retired them, because `LoginRoute` / `RegisterRoute` /
// `VerifyRoute` (`@ds/auth-flow/*/route`) run the #675 guard inside the route
// itself. `/verify` stays in this table as the MOUNT the page renders, over the
// shipped `ACADEMY_AUTH_FLOW`, so the wiring (this host's own pathname against
// its own route table) is still proved at this tier; the login and register
// mounts are pinned by 017 #1955.20 / #1955.24 in
// `packages/auth-flow/src/login/login-route.test.tsx` and by #675 in
// `packages/auth-flow/src/register/register-route.test.tsx`.
const verifyMount = () =>
  VerifyRoute({ config: ACADEMY_AUTH_FLOW, searchParams: Promise.resolve({}) });
const closed = [["/verify", verifyMount]] as const;

describe("#675 Academy auth routes, server-side signed-in guard", () => {
  it.each(closed)(
    "#675: a signed-in visitor on %s is redirected to /account before the surface renders",
    async (_path, mount) => {
      incoming.headers = SIGNED_IN;

      await expect(mount()).rejects.toThrow("NEXT_REDIRECT:/account");
      expect(redirect).toHaveBeenCalledWith("/account");
    },
  );

  it.each(closed)(
    "#675: a guest on %s is served the surface and never redirected",
    async (_path, mount) => {
      incoming.headers = GUEST;

      await mount();
      expect(redirect).not.toHaveBeenCalled();
      // Row 24 — no session cookie means guest with NO upstream read at all.
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("003 EARS-28: /reset runs the same guard and lets a SIGNED-IN visitor through (routes.allowAuthenticated)", async () => {
    // The /account «Сменить пароль» action hands off to the existing reset
    // flow, so a signed-in doctor must be able to complete it.
    incoming.headers = SIGNED_IN;

    await ResetLayout({ children: null });
    expect(redirect).not.toHaveBeenCalled();
  });
});
