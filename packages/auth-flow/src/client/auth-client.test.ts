import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DoctorConfirmRequest,
  DoctorConfirmResponse,
  DoctorRegisterRequest,
  DoctorRegisterResponse,
  VerifyRequest,
  VerifyResponse,
} from "@ds/schemas";

import { AuthError, createAuthClient } from "./auth-client";
import {
  ACADEMY_FIXTURE,
  DOCTOR_FIXTURE,
} from "../test-support/host-config-fixtures";

/**
 * The ONE auth transport, exercised through BOTH host shapes (#2027).
 *
 * What these cases pin is the ORIGIN CONTRACT — the reason each storefront had
 * its own copy of this file before wave 1: every request must be RELATIVE (so
 * Next rewrites it to the api from the calling origin) and must carry
 * `credentials: "include"` (so the `__Host-ds_session` cookie stays bound to that
 * origin). An absolute URL would silently move the session onto the wrong host —
 * a defect no rendered screen would show.
 */

const academy = createAuthClient(ACADEMY_FIXTURE.api);
const doctor = createAuthClient(DOCTOR_FIXTURE.api);

const fetchMock = vi.fn();

function callArgs(index = 0): [string, RequestInit] {
  return fetchMock.mock.calls[index] as [string, RequestInit];
}

function headers(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve(json({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("017 #1933: the sign-in transport", () => {
  it("017 #1933.6: login POSTs the relative BFF path with the session cookie attached", async () => {
    await doctor.login({ identifier: "doctor@clinic.ru", password: "x" });

    const [url, init] = callArgs();
    expect(url).toBe("/v1/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: "doctor@clinic.ru",
      password: "x",
    });
  });

  it("017 #1933.7: the OTP request and verify calls hit their own relative endpoints", async () => {
    await doctor.requestOtp({
      identifier: "doctor@clinic.ru",
      channel: "email",
    });
    expect(callArgs(0)[0]).toBe("/v1/auth/login/otp/request");

    await doctor.loginWithOtp({
      identifier: "doctor@clinic.ru",
      code: "12345678",
      channel: "email",
    });
    expect(callArgs(1)[0]).toBe("/v1/auth/login/otp");
  });

  it("017 #1933.8: a non-2xx becomes an AuthError carrying the status and the api code", async () => {
    fetchMock.mockResolvedValue(
      json({ message: "captcha", code: "BOT_PROTECTION_REQUIRED" }, 403),
    );

    const error = await doctor
      .login({ identifier: "doctor@clinic.ru", password: "x" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(403);
    expect((error as AuthError).code).toBe("BOT_PROTECTION_REQUIRED");
  });

  it("017 #1933.9: a non-JSON failure body still yields an AuthError, never a parse crash", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));

    const error = await doctor
      .login({ identifier: "doctor@clinic.ru", password: "x" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(502);
    expect((error as AuthError).code).toBeUndefined();
  });

  it("EARS-17: preserves a stable challenge code without parsing exception copy", async () => {
    fetchMock.mockResolvedValue(
      json(
        {
          statusCode: 403,
          code: "BOT_PROTECTION_REQUIRED",
          message: "provider-independent copy",
        },
        403,
      ),
    );

    await expect(
      academy.login({
        identifier: "doctor@example.com",
        password: "Sup3r$ecretPw!9",
      }),
    ).rejects.toMatchObject({ status: 403, code: "BOT_PROTECTION_REQUIRED" });
  });
});

/**
 * 003 EARS-11/12 (#1989) — the password-recovery half of the same transport.
 * Sharper than sign-in: completion AUTO-LOGS-IN (#221), so the cookie the
 * response sets must land on the CALLING origin.
 */
describe("017 #1989: the password-recovery transport", () => {
  it("003 EARS-11: the initiate call POSTs the relative reset path with the cookie attached", async () => {
    await doctor.requestPasswordReset({ identifier: "doctor@clinic.ru" });

    const [url, init] = callArgs();
    expect(url).toBe("/v1/auth/password/reset");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: "doctor@clinic.ru",
    });
  });

  it("003 EARS-12: the completion call POSTs code + new password to the relative complete path", async () => {
    await doctor.completePasswordReset({
      identifier: "doctor@clinic.ru",
      code: "PVDC3R",
      newPassword: "Sup3r$ecretPw!9",
    });

    const [url, init] = callArgs();
    expect(url).toBe("/v1/auth/password/reset/complete");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({
      identifier: "doctor@clinic.ru",
      code: "PVDC3R",
      newPassword: "Sup3r$ecretPw!9",
    });
  });

  it("003 EARS-17: a guard refusal comes back as an AuthError carrying the bot-protection code", async () => {
    fetchMock.mockResolvedValue(
      json({ message: "captcha", code: "BOT_PROTECTION_REQUIRED" }, 403),
    );

    const error = await doctor
      .requestPasswordReset({ identifier: "doctor@clinic.ru" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe("BOT_PROTECTION_REQUIRED");
  });
});

const REGISTRATION: DoctorRegisterRequest = {
  email: "doctor@clinic.ru",
  password: "correct horse battery",
  medicalWorkerDeclaration: true,
  consent: [{ purpose: "partner-data-sharing", version: "2026-09" }],
};

/**
 * 021 EARS-19 (#1558) — WHERE the widget token travels. The 003 guard reads
 * `x-smartcaptcha-token` from the HEADER first and only then from a body field,
 * so a token riding the body would still pass a green browser test while
 * silently depending on the fallback. Pinned here, on the request the client
 * actually builds. Since #2027 the rule is ONE rule for both hosts (row 18).
 */
describe("021 EARS-19: the bot-protection token on the protected commands", () => {
  it("EARS-19.2: the registration command carries the minted token on the x-smartcaptcha-token header", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ status: "pending_verification" })),
    );

    await doctor.register<DoctorRegisterRequest, DoctorRegisterResponse>(
      { ...REGISTRATION },
      "token-from-the-widget",
    );

    const [url, init] = callArgs();
    expect(url, "the storefront registration route, relative to this origin").toBe(
      "/v1/storefront/doctor/register",
    );
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(headers(init)["x-smartcaptcha-token"]).toBe("token-from-the-widget");
    // The token rides the HEADER and the body stays exactly the contract
    // schema — no `captchaToken` field smuggled alongside it.
    expect(JSON.parse(String(init.body))).toEqual(REGISTRATION);
  });

  it("EARS-19.2: with no token the header is ABSENT, matching the guard's no-op when the provider is disabled", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ status: "pending_verification" })),
    );

    await doctor.register<DoctorRegisterRequest, DoctorRegisterResponse>({
      ...REGISTRATION,
    });

    expect(
      "x-smartcaptcha-token" in headers(callArgs()[1]),
      "an empty header would be a claim; absence is the honest state",
    ).toBe(false);
  });

  it("EARS-19.2: the header rule is the SAME on a host-constant route — the Academy sends no empty header either", async () => {
    await academy.login({
      identifier: "doctor@example.com",
      password: "Sup3r$ecretPw!9",
    });
    expect("x-smartcaptcha-token" in headers(callArgs()[1])).toBe(false);

    await academy.login(
      { identifier: "doctor@example.com", password: "Sup3r$ecretPw!9" },
      "academy-token",
    );
    expect(headers(callArgs(1)[1])["x-smartcaptcha-token"]).toBe("academy-token");
  });

  it("EARS-19.3: every code resend carries the token too — the resend route is @BotProtected on the api", async () => {
    fetchMock.mockResolvedValue(json({ status: "resend_requested" }));

    await doctor.resendVerification(
      { identifier: "doctor@clinic.ru" },
      "resend-token",
    );

    const [url, init] = callArgs();
    expect(url).toBe("/v1/auth/verify/resend");
    expect(headers(init)["x-smartcaptcha-token"]).toBe("resend-token");
    expect(init.credentials).toBe("include");
  });
});

/**
 * The confirmation submit. Each host names its own `api.confirmPath`: the
 * Academy confirms on the shipped 003 engine, the doctor storefront on its
 * command, which DELEGATES to that same engine and adds the 021 success state.
 * Neither carries a captcha token (row 20).
 */
describe("021 EARS-10: the confirmation command", () => {
  it("EARS-19.3: confirming the emailed code reuses the shipped 003 route unchanged", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ status: "verified" })));

    await academy.confirm<VerifyRequest, VerifyResponse>({
      email: "doctor@clinic.ru",
      code: "ABC123",
    });

    const [url, init] = callArgs();
    expect(url, "003's engine, not a second code path").toBe("/v1/auth/verify");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "doctor@clinic.ru",
      code: "ABC123",
    });
    expect("x-smartcaptcha-token" in headers(init)).toBe(false);
  });

  it("021 EARS-10: the confirm command carries the code AND the doctor-host return target in one request", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ status: "verified" })));

    await doctor.confirm<DoctorConfirmRequest, DoctorConfirmResponse>({
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
      // The DOCTOR-HOST projection, the only shape the server guard accepts.
      returnTo: "/events/prp-pri-gonartroze",
    });
    expect(init.credentials).toBe("include");
  });

  it("021 EARS-10: a direct arrival sends no target at all rather than an empty one", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ status: "verified" })));

    await doctor.confirm<DoctorConfirmRequest, DoctorConfirmResponse>({
      email: "doctor@clinic.ru",
      code: "ABC123",
    });

    expect(JSON.parse(String(callArgs()[1].body))).toEqual({
      email: "doctor@clinic.ru",
      code: "ABC123",
    });
  });

  it("EARS-19.4: a refused token surfaces as the machine-readable code the shared predicates read", async () => {
    fetchMock.mockResolvedValue(
      json({ message: "captcha refused", code: "bot_protection_rejected" }, 403),
    );

    const error = await doctor
      .register<DoctorRegisterRequest, DoctorRegisterResponse>(
        { ...REGISTRATION },
        "stale-token",
      )
      .catch((err: unknown) => err);

    // The screen branches on this code, never on the message.
    expect((error as AuthError).code).toBe("bot_protection_rejected");
    expect((error as AuthError).status).toBe(403);
  });

  it("EARS-19.4: a failure with no parseable body still raises, never resolves as success", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      doctor.register<DoctorRegisterRequest, DoctorRegisterResponse>({
        ...REGISTRATION,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
