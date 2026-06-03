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
      enabled: false,
      fetchImpl,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("fails closed when enabled with no server key", async () => {
    const provider = new SmartCaptchaProvider({
      enabled: true,
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
      enabled: true,
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
      enabled: true,
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
      enabled: true,
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
      enabled: true,
      fetchImpl,
    });
    const result = await provider.verify("tok", "register", "203.0.113.1");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ECONNRESET");
  });
});
