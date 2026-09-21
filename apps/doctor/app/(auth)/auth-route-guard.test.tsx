import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #675 / 003 EARS-28 — the doctor storefront's auth routes are guarded on the
 * SERVER, by the same rule the Academy runs.
 *
 * The DECISION («who may see an auth route») is proved once in
 * `packages/auth-flow/src/server/auth-route-guard.test.ts`. Since #2027 wave 1
 * the two shared doors — `/login` and `/register` — are MOUNTS of
 * `@ds/auth-flow`, which hands the guard `config.routes.<door>` off the host
 * config, and the package pins that wiring against `DOCTOR_FIXTURE`; the shipped
 * host config is pinned in `lib/auth-flow.host-config.test.ts`. So what this
 * tier still owns is `/reset`, the one auth surface the doctor app composes
 * itself, plus the smoke check that `/register` is a mount of the shared door
 * with THIS host's config and not a second composition.
 *
 * Nothing is stubbed between the page and the package: the real
 * `resolveServerAuth` runs against a stubbed `fetch` and the real guard runs
 * against `DOCTOR_AUTH_ROUTES`. Only the two Next request-scoped primitives
 * (`headers()`, `redirect()`) are mocked, because there is no request here.
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

import { RegisterRoute } from "@ds/auth-flow/register/route";

import { DOCTOR_AUTH_FLOW } from "@/lib/auth-flow.host-config";

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
  it("#2027 PR 1.6: /register is a MOUNT of the shared sign-up door, stated with THIS host's config", async () => {
    incoming.headers = GUEST;

    const mounted = (await DoctorRegisterPage(noParams)) as {
      type: unknown;
      props: { config: unknown };
    };

    // The door itself — its guard, landing and composition are the package's,
    // proved there against `DOCTOR_FIXTURE`. What can only break HERE is the
    // route handing it someone else's config, or composing a second door.
    expect(mounted.type).toBe(RegisterRoute);
    expect(mounted.props.config).toBe(DOCTOR_AUTH_FLOW);
    // A mount decides nothing before the door runs, so no redirect is issued
    // at this level.
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
