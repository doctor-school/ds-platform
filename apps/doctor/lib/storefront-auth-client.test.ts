import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DoctorRegisterRequest } from "@ds/schemas";

import {
  StorefrontAuthError,
  confirmDoctorEmail,
  registerDoctor,
  resendVerification,
  verifyEmail,
} from "./storefront-auth-client";

/**
 * 021 EARS-19 (#1558) — the wire contract of the two bot-protected commands.
 *
 * The clause is about WHERE the widget token travels: the 003 guard
 * (`apps/api/src/bot-protection/bot-protection.guard.ts`) reads
 * `x-smartcaptcha-token` from the HEADER first and only then from a body field,
 * so a token that rode the body would still pass a green browser test while
 * silently depending on the fallback. That is exactly what a rendering test
 * cannot see, so it is pinned here, on the request the client actually builds —
 * `globalThis.fetch` mocked, the request init inspected.
 *
 * The browser tier of EARS-19 (the field mounted, the enabled submit, the
 * form-level failure statement, the post-submit state) lives in
 * `apps/doctor/e2e/register-bot-protection.spec.ts`; the server half — a
 * submission the guard refuses — in
 * `apps/api/test/storefront/doctor-register-bot-protection.e2e-spec.ts`.
 */

const fetchMock = vi.fn();

/** The single `fetch` call the assertion under test reads. */
function callArgs(): [string, RequestInit] {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return fetchMock.mock.calls[0] as [string, RequestInit];
}

function headers(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function refused(code: string) {
  return {
    ok: false,
    status: 403,
    json: async () => ({ message: "captcha refused", code }),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REGISTRATION: DoctorRegisterRequest = {
  email: "doctor@clinic.ru",
  password: "correct horse battery",
  medicalWorkerDeclaration: true,
  consent: [{ purpose: "partner-data-sharing", version: "2026-09" }],
};

describe("021 EARS-19: the bot-protection token on the storefront commands", () => {
  it("EARS-19.2: the registration command carries the minted token on the x-smartcaptcha-token header", async () => {
    fetchMock.mockResolvedValue(ok({ status: "pending_verification" }));

    await registerDoctor({ ...REGISTRATION }, "token-from-the-widget");

    const [url, init] = callArgs();
    expect(
      url,
      "the storefront registration route, relative to this origin",
    ).toBe("/v1/storefront/doctor/register");
    expect(init.method).toBe("POST");
    // Same-origin proxy: the `__Host-` session cookie is locked to this host,
    // so the request must ride it rather than a cross-origin api base.
    expect(init.credentials).toBe("include");
    expect(headers(init)["x-smartcaptcha-token"]).toBe("token-from-the-widget");
    // The token rides the HEADER and the body stays exactly the contract
    // schema — no `captchaToken` field smuggled alongside it.
    expect(JSON.parse(String(init.body))).toEqual(REGISTRATION);
  });

  it("EARS-19.2: with no token the header is ABSENT, matching the guard's no-op when the provider is disabled", async () => {
    fetchMock.mockResolvedValue(ok({ status: "pending_verification" }));

    await registerDoctor({ ...REGISTRATION });

    const [, init] = callArgs();
    expect(
      "x-smartcaptcha-token" in headers(init),
      "an empty header would be a claim; absence is the honest state",
    ).toBe(false);
  });

  it("EARS-19.3: every code resend carries the token too — the resend route is @BotProtected on the api", async () => {
    fetchMock.mockResolvedValue(ok({ status: "resend_requested" }));

    await resendVerification(
      { identifier: "doctor@clinic.ru" },
      "resend-token",
    );

    const [url, init] = callArgs();
    expect(url).toBe("/v1/auth/verify/resend");
    expect(headers(init)["x-smartcaptcha-token"]).toBe("resend-token");
    expect(init.credentials).toBe("include");
  });

  it("EARS-19.3: confirming the emailed code reuses the shipped 003 route unchanged", async () => {
    fetchMock.mockResolvedValue(ok({ status: "verified" }));

    await verifyEmail({ email: "doctor@clinic.ru", code: "ABC123" });

    const [url, init] = callArgs();
    expect(url, "003's engine, not a second code path").toBe("/v1/auth/verify");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "doctor@clinic.ru",
      code: "ABC123",
    });
  });

  it("021 EARS-10: the confirm command carries the code AND the doctor-host return target in one request", async () => {
    fetchMock.mockResolvedValue(
      ok({
        status: "verified",
        credited: null,
        profileCompletion: null,
        primaryAction: { kind: "return", href: "/events/prp-pri-gonartroze" },
        secondaryAction: { kind: "cabinet", href: "/account" },
      }),
    );

    await confirmDoctorEmail({
      email: "doctor@clinic.ru",
      code: "ABC123",
      returnTo: "/events/prp-pri-gonartroze",
    });

    const [url, init] = callArgs();
    expect(url, "one command, not a verify hop plus a landing hop").toBe(
      "/v1/storefront/doctor/confirm",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      email: "doctor@clinic.ru",
      code: "ABC123",
      // The DOCTOR-HOST projection, which is the only shape the server guard
      // accepts — never the canonical academy `/webinars/<slug>` the gate emits.
      returnTo: "/events/prp-pri-gonartroze",
    });
    expect(init.credentials).toBe("include");
  });

  it("021 EARS-10: a direct arrival sends no target at all rather than an empty one", async () => {
    fetchMock.mockResolvedValue(
      ok({
        status: "verified",
        credited: null,
        profileCompletion: null,
        primaryAction: { kind: "landing", href: "/events" },
        secondaryAction: { kind: "cabinet", href: "/account" },
      }),
    );

    await confirmDoctorEmail({ email: "doctor@clinic.ru", code: "ABC123" });

    expect(JSON.parse(String(callArgs()[1].body))).toEqual({
      email: "doctor@clinic.ru",
      code: "ABC123",
    });
  });

  it("EARS-19.4: a refused token surfaces as the machine-readable code the shared predicates read", async () => {
    fetchMock.mockResolvedValue(refused("bot_protection_rejected"));

    const error = await registerDoctor({ ...REGISTRATION }, "stale-token").catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(StorefrontAuthError);
    // The screen branches on this code, never on the message: it is what
    // `isBotProtectionRejected` reads off the thrown value.
    expect((error as StorefrontAuthError).code).toBe("bot_protection_rejected");
    expect((error as StorefrontAuthError).status).toBe(403);
  });

  it("EARS-19.4: a failure with no parseable body still raises, never resolves as success", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);

    await expect(registerDoctor({ ...REGISTRATION })).rejects.toMatchObject({
      status: 500,
    });
  });
});
