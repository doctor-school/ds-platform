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
