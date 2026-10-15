import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authProvider } from "./auth-provider";

/**
 * 011 EARS-3 + #1217 — the provider is where a refused primary authentication
 * turns into something a screen can render, and it used to flatten three
 * different answers into two.
 *
 * `POST /v1/admin/auth/login` answers 503 when the IdP is unreachable (#1212):
 * the password was never checked and no attempt budget was spent. Reporting that
 * as «Не удалось войти. Проверьте данные» is a false verdict on credentials that
 * are probably correct — the #1217 defect. 401 and 429 are unchanged: the uniform
 * refusal (ADR-0001 §7 enumeration safety) and the caller's own rate limit.
 *
 * Node tier: `fetch` is stubbed, so these pin the status → surfaced-message map.
 */
const originalFetch = globalThis.fetch;

function respondWith(status: number, body: unknown = {}): void {
  globalThis.fetch = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
      : new Response(null, { status }),
  ) as unknown as typeof fetch;
}

const credentials = { email: "admin@doctor.school", password: "correct-horse" };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("authProvider.login — refusal mapping", () => {
  it("EARS-3: a 503 surfaces the outage copy, not a credentials verdict", async () => {
    respondWith(503);
    expect(await authProvider.login!(credentials)).toMatchObject({
      success: false,
      error: { message: "login.errorOutage" },
    });
  });

  it("EARS-3: a 401 stays the uniform credentials message", async () => {
    respondWith(401);
    expect(await authProvider.login!(credentials)).toMatchObject({
      success: false,
      error: { message: "login.errorGeneric" },
    });
  });

  it("EARS-3: a 429 stays the throttling message", async () => {
    respondWith(429);
    expect(await authProvider.login!(credentials)).toMatchObject({
      success: false,
      error: { message: "login.errorThrottled" },
    });
  });

  it("EARS-3: a success still routes to the second factor it owes", async () => {
    respondWith(200, { state: "mfa_pending_challenge" });
    expect(await authProvider.login!(credentials)).toEqual({
      success: true,
      redirectTo: "/mfa/challenge",
    });
  });
});

describe("authProvider.onError — which refusal ends the session", () => {
  it("044 EARS-38: a 401 (session gone) signs the operator out and routes to /login", async () => {
    const error = { statusCode: 401, message: "x" };
    await expect(authProvider.onError(error)).resolves.toEqual({
      logout: true,
      redirectTo: "/login",
      error,
    });
  });

  it("044 EARS-38: a 403 (a live session refused this action) keeps the session and surfaces the error to the screen", async () => {
    const error = {
      statusCode: 403,
      errorCode: "EVENT_BINDING_REQUIRED",
      message: "x",
    };
    const verdict = await authProvider.onError(error);
    expect(verdict).toEqual({ error });
    expect(verdict).not.toHaveProperty("logout");
    expect(verdict).not.toHaveProperty("redirectTo");
  });

  it("047 EARS-8: a 401 STEP_UP_REQUIRED is not a lost session — no sign-out, the screen owns the code step", async () => {
    const error = {
      statusCode: 401,
      errorCode: "STEP_UP_REQUIRED",
      stepUpUrl: "/mfa/challenge?mode=reverify",
      message: "x",
    };
    const verdict = await authProvider.onError(error);
    expect(verdict).toEqual({ error });
    expect(verdict).not.toHaveProperty("logout");
    expect(verdict).not.toHaveProperty("redirectTo");
  });

  it("044 EARS-38: any other failure is left to the screen", async () => {
    await expect(
      authProvider.onError({ statusCode: 503, message: "x" }),
    ).resolves.toEqual({});
  });
});

describe("authProvider.logout — 047 EARS-8 step-up replay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it("047 EARS-8: sign-out (and the 401 path, which signs out through it) clears a saved step-up request and its confirmation", async () => {
    const data = new Map<string, string>([
      ["ds-admin:step-up-request", "{}"],
      ["ds-admin:step-up-confirmed", "{}"],
      ["unrelated", "kept"],
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
    });
    respondWith(200, {});
    expect(await authProvider.logout!({})).toMatchObject({ success: true });
    expect([...data.keys()]).toEqual(["unrelated"]);
  });
});

/**
 * #2782 — the sign-in returns the admin to the page they were on. A 401 mid-work
 * (most often `fingerprint_mismatch` after a network change) sends the operator
 * to `/login` carrying where they were, and a successful password step carries
 * that target on to the second-factor screen it routes to.
 */
function onPage(href: string): void {
  const url = new URL(href, "https://admin.example");
  vi.stubGlobal("window", {
    location: { pathname: url.pathname, search: url.search, hash: url.hash },
  });
}

describe("authProvider — #2782 return target", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("#2782: a 401 on an admin page routes to /login carrying that page and its query", async () => {
    onPage("/events/123?tab=x");
    const error = { statusCode: 401, message: "x" };
    await expect(authProvider.onError(error)).resolves.toEqual({
      logout: true,
      redirectTo: "/login?to=%2Fevents%2F123%3Ftab%3Dx",
      error,
    });
  });

  it("#2782: a 401 while already on a sign-in screen carries nothing (no /login loop)", async () => {
    onPage("/login?to=%2Fevents");
    await expect(
      authProvider.onError({ statusCode: 401, message: "x" }),
    ).resolves.toMatchObject({ redirectTo: "/login" });
  });

  it("#2782: the password step carries a valid target to the challenge", async () => {
    respondWith(200, { state: "mfa_pending_challenge" });
    expect(
      await authProvider.login!({ ...credentials, to: "/events/123?tab=x" }),
    ).toEqual({
      success: true,
      redirectTo: "/mfa/challenge?to=%2Fevents%2F123%3Ftab%3Dx",
    });
  });

  it("#2782: the password step carries a valid target to enrollment", async () => {
    respondWith(200, { state: "mfa_pending_enrollment" });
    expect(
      await authProvider.login!({ ...credentials, to: "/projects/7" }),
    ).toEqual({ success: true, redirectTo: "/mfa/enroll?to=%2Fprojects%2F7" });
  });

  it("#2782: the password step drops a hostile target", async () => {
    respondWith(200, { state: "mfa_pending_challenge" });
    expect(
      await authProvider.login!({ ...credentials, to: "//evil.example" }),
    ).toEqual({ success: true, redirectTo: "/mfa/challenge" });
  });
});
