import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  startMfaEnrollment,
  verifyMfaChallenge,
  verifyMfaEnrollment,
} from "./admin-auth";

/**
 * 011 EARS-7 — what the admin client is allowed to learn from a refused MFA call.
 *
 * The API answers every refusal with one uniform 401 on purpose, and this module
 * must not invent a taxonomy on top of it. There are exactly two answers that are
 * NOT a refusal of the submitted code and therefore must survive to the screen:
 *
 * - **429** — the ADR-0001 §7 rate limit, a fact about the CALLER's attempt rate.
 * - **503** — `IdpUnavailableError`: the verification service itself is down (#1212).
 *   It consumes no attempt budget and says nothing about the code, the factor, or
 *   the account, so it discloses nothing a 401 would have hidden — while folding it
 *   into `errorGeneric` tells an operator holding a CORRECT code that their code is
 *   wrong, and sends them to re-check a phone clock that is fine (#1213).
 *
 * Node tier: `fetch` is stubbed, so these pin the status→result mapping itself.
 */
type FetchStub = ReturnType<typeof vi.fn>;

const originalFetch = globalThis.fetch;

function respondWith(status: number, body: unknown = {}): FetchStub {
  const stub = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
      : new Response(null, { status }),
  );
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MFA verify — refusal mapping", () => {
  const submit: Record<string, (code: string) => Promise<unknown>> = {
    "mfa/enroll/verify": verifyMfaEnrollment,
    "mfa/verify": verifyMfaChallenge,
  };

  for (const [route, call] of Object.entries(submit)) {
    it(`EARS-7: ${route} — a 401 stays the uniform refusal, carrying no reason`, async () => {
      respondWith(401);
      expect(await call("123456")).toEqual({ ok: false, refused: true });
    });

    it(`EARS-7: ${route} — a 429 is reported as throttled, not as a wrong code`, async () => {
      respondWith(429);
      expect(await call("123456")).toEqual({
        ok: false,
        refused: true,
        throttled: true,
      });
    });

    it(`EARS-7: ${route} — a 503 is reported as an outage, not as a wrong code`, async () => {
      respondWith(503);
      expect(await call("123456")).toEqual({
        ok: false,
        refused: true,
        outage: true,
      });
    });
  }

  it("EARS-6: a 200 verify resolves ok — the session rode the response (LD-1)", async () => {
    respondWith(200);
    expect(await verifyMfaChallenge("123456")).toEqual({
      ok: true,
      value: undefined,
    });
  });
});

describe("MFA enrollment start — refusal mapping", () => {
  it("EARS-5: a 401 stays the uniform refusal — not a pending-enrollment principal", async () => {
    respondWith(401);
    expect(await startMfaEnrollment()).toEqual({ ok: false, refused: true });
  });

  it("EARS-5: a 503 is reported as an outage — the offer could not be issued", async () => {
    respondWith(503);
    expect(await startMfaEnrollment()).toEqual({
      ok: false,
      refused: true,
      outage: true,
    });
  });

  it("EARS-5: a 200 resolves the one-time offer", async () => {
    respondWith(200, {
      secret: "JBSWY3DPEHPK3PXP",
      provisioningUri: "otpauth://totp/Doctor.School:admin",
      issuer: "Doctor.School",
    });
    const result = await startMfaEnrollment();
    expect(result).toMatchObject({ ok: true });
  });
});
