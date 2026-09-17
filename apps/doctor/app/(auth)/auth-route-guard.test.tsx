import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #675 / 003 EARS-28 — the doctor storefront's auth routes are guarded on the
 * SERVER, by the same rule the Academy runs.
 *
 * The DECISION («who may see an auth route») is proved once in
 * `packages/auth-flow/src/server/auth-route-guard.test.ts`, and `/login`'s own
 * landing vocabulary is proved in `login/page.test.tsx`. What only this tier can
 * prove is the WIRING of the two remaining doors, and the wiring is where the
 * realistic defect lives: each page hands the guard ITS OWN pathname against the
 * ONE host route table, and a copy-pasted `pathname` would silently make
 * `/register` inherit `/reset`'s exemption.
 *
 * So nothing is stubbed between the page and the package: the real
 * `resolveServerAuth` runs against a stubbed `fetch` and the real guard runs
 * against `DOCTOR_AUTH_ROUTES`. Only the two Next request-scoped primitives
 * (`headers()`, `redirect()`) are mocked, because there is no request here.
 *
 * WHAT CHANGES FOR `/register`. It shipped with no signed-in guard at all, which
 * meant a doctor who already held a session could re-walk the registration form.
 * #2027 PR 1.4 puts both storefronts behind the one rule, so the doctor host
 * gains the guard the Academy already had.
 */
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  // The nested client screens read the router; only the route's own redirect is
  // under test here.
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const incoming = { headers: new Headers() };
vi.mock("next/headers", () => ({
  headers: async () => incoming.headers,
}));

import DoctorRegisterPage from "./register/page";
import DoctorResetPage from "./reset/page";

const SIGNED_IN = new Headers({ cookie: "__Host-ds_session=abc" });
const GUEST = new Headers();

const fetchMock = vi.fn();

beforeEach(() => {
  redirect.mockClear();
  fetchMock.mockReset();
  // A session read that succeeds; every other upstream read this route makes is
  // free to find the same body unrecognisable and degrade, which is what the
  // LD-4 fallback below depends on.
  fetchMock.mockResolvedValue({
    status: 200,
    ok: true,
    json: async () => ({ sub: "u1", roles: ["doctor"], mfa: false }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const noParams = { searchParams: Promise.resolve({}) };

describe("#675 doctor auth routes, server-side signed-in guard", () => {
  it("#675: a signed-in doctor on /register is redirected to the LD-4 landing before the form renders", async () => {
    incoming.headers = SIGNED_IN;

    await expect(DoctorRegisterPage(noParams)).rejects.toThrow(
      "NEXT_REDIRECT:/",
    );
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("#675: a guest on /register is served the form and never redirected", async () => {
    incoming.headers = GUEST;

    await DoctorRegisterPage(noParams);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("003 EARS-28: /reset runs the same guard and lets a SIGNED-IN doctor through (routes.allowAuthenticated)", async () => {
    // The `/account` «Сменить пароль» action hands off to the existing reset
    // flow, so a signed-in doctor must be able to complete it.
    incoming.headers = SIGNED_IN;

    await DoctorResetPage({ searchParams: Promise.resolve({}) });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("003 EARS-28: a guest on /reset is served the surface with NO upstream read at all", async () => {
    incoming.headers = GUEST;

    await DoctorResetPage({ searchParams: Promise.resolve({}) });
    expect(redirect).not.toHaveBeenCalled();
    // Row 24 — no session cookie means guest without an upstream session read.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
