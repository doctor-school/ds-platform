import { describe, expect, it } from "vitest";
import {
  SMARTCAPTCHA_VALIDATE_URL,
  SmartCaptchaProvider,
  type FetchLike,
} from "./smart-captcha.provider.js";

/** A fetch double that records its call and returns a scripted response. */
function fakeFetch(
  response: { ok: boolean; status: number; body: unknown } | { throws: Error },
): { fetchImpl: FetchLike; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, body: init.body });
      if ("throws" in response) return Promise.reject(response.throws);
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        json: () => Promise.resolve(response.body),
      });
    },
  };
}

const base = {
  serverKey: "server-secret",
  validateUrl: SMARTCAPTCHA_VALIDATE_URL,
};

describe("SmartCaptchaProvider", () => {
  it("short-circuits to ok when disabled (no provider call)", async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true, status: 200, body: {} });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => false,
      fetchImpl,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("#185: reads the enabled switch LIVE per verify (a toggle takes effect with no rebuild)", async () => {
    // The switch is a callback (the live Unleash `bot-protection` read), so the
    // same provider instance honours a flip between calls — the runtime-toggle
    // contract the migration delivers.
    const { fetchImpl } = fakeFetch({
      ok: true,
      status: 200,
      body: { status: "ok" },
    });
    let live = false;
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => live,
      fetchImpl,
    });
    // Disabled → short-circuits ok with no server call.
    expect((await provider.verify("t", "register", "1.1.1.1")).reason).toBe(
      "bot-protection-disabled",
    );
    // Operator flips the flag ON; the very next verify now validates.
    live = true;
    expect((await provider.verify("t", "register", "1.1.1.1")).ok).toBe(true);
  });

  it("fails closed when enabled with no server key", async () => {
    const provider = new SmartCaptchaProvider({
      isEnabled: () => true,
      validateUrl: SMARTCAPTCHA_VALIDATE_URL,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-server-key");
  });

  it("posts secret, token, and ip form-encoded to the validate endpoint", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ok: true,
      status: 200,
      body: { status: "ok", host: "doctor.school" },
    });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      fetchImpl,
    });
    const result = await provider.verify(
      "widget-tok",
      "login-challenge",
      "203.0.113.5",
    );
    expect(result.ok).toBe(true);
    expect(result.host).toBe("doctor.school");
    expect(calls[0]?.url).toBe(SMARTCAPTCHA_VALIDATE_URL);
    const params = new URLSearchParams(calls[0]?.body);
    expect(params.get("secret")).toBe("server-secret");
    expect(params.get("token")).toBe("widget-tok");
    expect(params.get("ip")).toBe("203.0.113.5");
  });

  it("rejects when the service reports a non-ok status", async () => {
    const { fetchImpl } = fakeFetch({
      ok: true,
      status: 200,
      body: { status: "failed", message: "robot" },
    });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      fetchImpl,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("robot");
  });

  it("fails closed on a non-2xx response", async () => {
    const { fetchImpl } = fakeFetch({ ok: false, status: 503, body: {} });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      fetchImpl,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("validate-http-503");
  });

  it("fails closed on a transport error", async () => {
    const { fetchImpl } = fakeFetch({ throws: new Error("ECONNRESET") });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      fetchImpl,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ECONNRESET");
  });
});

describe("SmartCaptchaProvider — non-production test token (#2605)", () => {
  const testToken = "t".repeat(64);

  it("accepts the configured test token without calling Yandex, with a distinct audit reason", async () => {
    const { fetchImpl, calls } = fakeFetch({ ok: true, status: 200, body: {} });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      testToken,
      fetchImpl,
    });
    const result = await provider.verify(testToken, "register", "203.0.113.1");
    expect(result).toEqual({ ok: true, reason: "test-token" });
    expect(calls).toHaveLength(0);
  });

  it("accepts the test token even when no server key is configured (validation is substituted)", async () => {
    const provider = new SmartCaptchaProvider({
      isEnabled: () => true,
      validateUrl: SMARTCAPTCHA_VALIDATE_URL,
      testToken,
    });
    const result = await provider.verify(testToken, "login-challenge", "203.0.113.1");
    expect(result).toEqual({ ok: true, reason: "test-token" });
  });

  it("validates any other token with Yandex as before (a near-miss is not the test token)", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ok: true,
      status: 200,
      body: { status: "failed", message: "token-invalid" },
    });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      testToken,
      fetchImpl,
    });
    const nearMiss = `${testToken.slice(0, -1)}x`;
    const result = await provider.verify(nearMiss, "register", "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token-invalid");
    expect(calls).toHaveLength(1);
  });

  it("keeps the fail-closed paths when a test token is configured", async () => {
    const provider = new SmartCaptchaProvider({
      isEnabled: () => true,
      validateUrl: SMARTCAPTCHA_VALIDATE_URL,
      testToken,
    });
    expect((await provider.verify("other", "register", "1.1.1.1")).reason).toBe(
      "missing-server-key",
    );
    const withKey = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      testToken,
    });
    expect((await withKey.verify("", "register", "1.1.1.1")).reason).toBe(
      "missing-token",
    );
  });

  it("with no test token configured, a request token is never accepted unvalidated", async () => {
    const { fetchImpl, calls } = fakeFetch({
      ok: true,
      status: 200,
      body: { status: "failed", message: "token-invalid" },
    });
    const provider = new SmartCaptchaProvider({
      ...base,
      isEnabled: () => true,
      fetchImpl,
    });
    const result = await provider.verify(testToken, "register", "1.1.1.1");
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
