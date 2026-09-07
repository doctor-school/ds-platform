import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegistrationError, registerForEvent } from "./registration-client";

/**
 * 005 EARS-1/EARS-3 — the browser arm of the `RegisterForEvent` command, shared
 * by both storefronts. What belongs to THIS module is the transport contract: a
 * RELATIVE same-origin path (so each host's own `__Host-` cookie rides it), the
 * explicit `credentials: "include"`, and a typed non-2xx failure the callers
 * branch on rather than a bare `Error`.
 */
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("005 @ds/events-storefront registration client", () => {
  it("005 EARS-1: the command POSTs the escaped same-origin registration path with the session cookie attached", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ registered: true }),
    });

    await expect(registerForEvent("ahilles 042")).resolves.toEqual({
      registered: true,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Relative — never an absolute host: the request must ride the origin the
    // document was served from, whichever storefront that is.
    expect(url).toBe("/v1/events/ahilles%20042/registration");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("005 EARS-3: a non-2xx answer throws RegistrationError carrying the status, so a retry stays the caller's decision", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });

    await expect(registerForEvent("ahilles-042")).rejects.toBeInstanceOf(
      RegistrationError,
    );
    await expect(registerForEvent("ahilles-042")).rejects.toMatchObject({
      status: 409,
    });
  });
});
