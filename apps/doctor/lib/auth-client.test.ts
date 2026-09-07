import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthError, authClient } from "./auth-client";

/**
 * #1933 — the doctor host sign-in transport.
 *
 * What these cases pin is the ORIGIN CONTRACT, which is the whole reason the
 * doctor storefront gets its own client instead of calling the academy: every
 * request must be RELATIVE (so Next rewrites it to the api from this origin) and
 * must carry `credentials: "include"` (so the `__Host-ds_session` cookie the BFF
 * sets is bound to `doctor.school`). An absolute URL here would silently move
 * the session onto the wrong origin — a defect no rendered screen would show.
 */
type FetchCall = [input: string, init: RequestInit];

function stubFetch(response: Response) {
  const spy = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("017 #1933: the doctor sign-in transport", () => {
  it("017 #1933.6: login POSTs the relative BFF path with the session cookie attached", async () => {
    const spy = stubFetch(json({ ok: true }));

    await authClient.login({ identifier: "doctor@clinic.ru", password: "x" });

    const [url, init] = spy.mock.calls[0] as unknown as FetchCall;
    expect(url).toBe("/v1/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      identifier: "doctor@clinic.ru",
      password: "x",
    });
  });

  it("017 #1933.7: the OTP request and verify calls hit their own relative endpoints", async () => {
    const requestSpy = stubFetch(json({ ok: true }));
    await authClient.requestOtp({
      identifier: "doctor@clinic.ru",
      channel: "email",
    });
    expect((requestSpy.mock.calls[0] as unknown as FetchCall)[0]).toBe(
      "/v1/auth/login/otp/request",
    );

    const verifySpy = stubFetch(json({ ok: true }));
    await authClient.loginWithOtp({
      identifier: "doctor@clinic.ru",
      code: "12345678",
      channel: "email",
    });
    expect((verifySpy.mock.calls[0] as unknown as FetchCall)[0]).toBe(
      "/v1/auth/login/otp",
    );
  });

  it("017 #1933.8: a non-2xx becomes an AuthError carrying the status and the api code", async () => {
    stubFetch(json({ message: "captcha", code: "BOT_PROTECTION_REQUIRED" }, 403));

    const error = await authClient
      .login({ identifier: "doctor@clinic.ru", password: "x" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(403);
    expect((error as AuthError).code).toBe("BOT_PROTECTION_REQUIRED");
  });

  it("017 #1933.9: a non-JSON failure body still yields an AuthError, never a parse crash", async () => {
    stubFetch(new Response("<html>502</html>", { status: 502 }));

    const error = await authClient
      .login({ identifier: "doctor@clinic.ru", password: "x" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(502);
    expect((error as AuthError).code).toBeUndefined();
  });
});

/**
 * 003 EARS-11/12 (#1989) — the password-recovery half of the same transport.
 *
 * The origin contract is the point again, and it is sharper here than for login:
 * completion AUTO-LOGS-IN (#221), so the `__Host-ds_session` cookie the response
 * sets must land on THIS origin. An absolute URL would mint the session on the
 * Academy's — the exact defect the doctor-host projection exists to end.
 */
describe("017 #1989: the doctor password-recovery transport", () => {
  it("003 EARS-11: the initiate call POSTs the relative reset path with the cookie attached", async () => {
    const spy = stubFetch(json({ ok: true }));

    await authClient.requestPasswordReset({ identifier: "doctor@clinic.ru" });

    const [url, init] = spy.mock.calls[0] as unknown as FetchCall;
    expect(url).toBe("/v1/auth/password/reset");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      identifier: "doctor@clinic.ru",
    });
  });

  it("003 EARS-12: the completion call POSTs code + new password to the relative complete path", async () => {
    const spy = stubFetch(json({ ok: true }));

    await authClient.completePasswordReset({
      identifier: "doctor@clinic.ru",
      code: "PVDC3R",
      newPassword: "Sup3r$ecretPw!9",
    });

    const [url, init] = spy.mock.calls[0] as unknown as FetchCall;
    expect(url).toBe("/v1/auth/password/reset/complete");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({
      identifier: "doctor@clinic.ru",
      code: "PVDC3R",
      newPassword: "Sup3r$ecretPw!9",
    });
  });

  it("003 EARS-17: a guard refusal comes back as an AuthError carrying the bot-protection code", async () => {
    stubFetch(
      json({ message: "captcha", code: "BOT_PROTECTION_REQUIRED" }, 403),
    );

    const error = await authClient
      .requestPasswordReset({ identifier: "doctor@clinic.ru" })
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).code).toBe("BOT_PROTECTION_REQUIRED");
  });
});
