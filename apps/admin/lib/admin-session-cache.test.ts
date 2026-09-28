import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSessionResponse } from "@ds/schemas";
import { authProvider } from "@/providers/auth-provider";
import { accessControlProvider } from "@/providers/access-control-provider";
import { clearAdminSession, fetchAdminSession } from "./admin-session-cache";

/**
 * 044 EARS-20 — the chrome and the Refine `can` answer read ONE cached session,
 * and that cache belongs to one principal: a sign-out (or a new sign-in) in the
 * same tab drops it, so the next principal never sees the previous one's nav.
 *
 * Node tier: `fetch` is stubbed and answers `/session` with whoever is "signed in".
 */
const EVENT_A = "0b5f7c1e-4c1a-4e7e-9a55-0a4f2d9b1a0a";
const registrar: AdminSessionResponse = {
  roles: ["event-registrar"],
  eventGrants: [
    { role: "event-registrar", eventId: EVENT_A, eventSlug: "congress-a" },
  ],
};
const platformAdmin: AdminSessionResponse = {
  roles: ["platform_admin"],
  eventGrants: [],
};

const originalFetch = globalThis.fetch;
let signedIn: AdminSessionResponse;
let sessionReads = 0;

beforeEach(() => {
  clearAdminSession();
  sessionReads = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/v1/admin/auth/session")) {
      sessionReads += 1;
      return new Response(JSON.stringify(signedIn), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // `/login` answers the step owed; `/logout` needs no body.
    return new Response(JSON.stringify({ state: "mfa_pending_challenge" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("044 EARS-20 session cache — one source, one principal", () => {
  it("044 EARS-20.7: sign-out drops the cached principal; the next sign-in reads its own", async () => {
    signedIn = registrar;
    expect(await fetchAdminSession()).toEqual(registrar);
    // `can` reads the SAME cached answer — no second request.
    expect(
      await accessControlProvider.can({ resource: "events", action: "list" }),
    ).toMatchObject({ can: false });
    expect(sessionReads).toBe(1);

    // Another principal signs in in the same tab.
    await authProvider.logout!({});
    signedIn = platformAdmin;

    expect(await fetchAdminSession()).toEqual(platformAdmin);
    expect(
      await accessControlProvider.can({ resource: "events", action: "list" }),
    ).toMatchObject({ can: true });
    expect(sessionReads).toBe(2);
  });

  it("044 EARS-20.7: a new sign-in drops a principal left cached without a sign-out", async () => {
    signedIn = registrar;
    expect(await fetchAdminSession()).toEqual(registrar);

    signedIn = platformAdmin;
    await authProvider.login!({ email: "a@b.c", password: "x" });

    expect(await fetchAdminSession()).toEqual(platformAdmin);
  });
});
