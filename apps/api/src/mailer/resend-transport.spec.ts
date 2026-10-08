import { afterEach, describe, expect, it, vi } from "vitest";
import { RESEND_DOMAINS_URL, ResendChannel } from "./resend-transport.js";
const mail = {
  to: "doctor@example.com",
  subject: "code",
  text: "code",
  html: "code",
};
afterEach(() => vi.useRealTimers());

function respond(status: number, body = "{}"): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as typeof fetch;
}
function networkError(code: string): typeof fetch {
  return vi.fn(async () => {
    throw Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(code), { code }),
    });
  }) as typeof fetch;
}

describe("Resend cancellation", () => {
  it("EARS-45: a request that stalls before headers is aborted at the deadline and is ambiguous", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init.signal;
          signal!.addEventListener("abort", () => reject(signal!.reason));
        }),
    ) as typeof fetch;
    const send = new ResendChannel({ apiKey: "key", fetchFn }).send(mail);
    const result = expect(send).rejects.toMatchObject({
      code: "timeout",
      outcome: "ambiguous",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("EARS-31: the effective deadline is the lesser of 10 s and the remaining budget", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(init.signal.reason),
          );
        }),
    ) as typeof fetch;
    const send = new ResendChannel({ apiKey: "key", fetchFn }).send(mail, {
      deadlineMs: 3_000,
    });
    const result = expect(send).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(3_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("EARS-45: aborts body consumption and keeps an explicit 429 as provider-failure", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async (_url, init) => ({
      status: 429,
      text: () =>
        new Promise((_r, reject) =>
          init.signal.addEventListener("abort", () =>
            reject(init.signal.reason),
          ),
        ),
    })) as unknown as typeof fetch;
    const result = expect(
      new ResendChannel({ apiKey: "key", fetchFn }).send(mail),
    ).rejects.toMatchObject({ code: "429", outcome: "provider-failure" });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("003 EARS-45 Resend outcome classes", () => {
  it("EARS-45: a pre-send network failure (DNS, refused, TLS) is provider-failure; a failure after the request may have been sent is ambiguous", async () => {
    for (const code of ["ENOTFOUND", "ECONNREFUSED", "CERT_HAS_EXPIRED"]) {
      await expect(
        new ResendChannel({ apiKey: "k", fetchFn: networkError(code) }).send(
          mail,
        ),
      ).rejects.toMatchObject({ outcome: "provider-failure" });
    }
    await expect(
      new ResendChannel({
        apiKey: "k",
        fetchFn: networkError("ECONNRESET"),
      }).send(mail),
    ).rejects.toMatchObject({ outcome: "ambiguous" });
  });
  it("EARS-45: 2xx accepts, 5xx is ambiguous, 4xx/429 are provider-failure and a recipient validation error is recipient-permanent", async () => {
    await expect(
      new ResendChannel({ apiKey: "k", fetchFn: respond(200) }).send(mail),
    ).resolves.toBeUndefined();
    for (const [status, body, outcome] of [
      [503, "{}", "ambiguous"],
      [429, "{}", "provider-failure"],
      [401, '{"name":"invalid_api_key"}', "provider-failure"],
      [
        422,
        '{"name":"validation_error","message":"Invalid `from` field."}',
        "provider-failure",
      ],
      [
        422,
        '{"name":"validation_error","message":"Invalid `to` field. doctor@example.com"}',
        "recipient-permanent",
      ],
    ] as const) {
      const err = await new ResendChannel({
        apiKey: "k",
        fetchFn: respond(status, body),
      })
        .send(mail)
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: String(status), outcome });
      expect(JSON.stringify(err)).not.toContain("doctor@example.com");
    }
  });
});

describe("003 EARS-46 Resend readiness probe", () => {
  it("EARS-46: a read-only key check — 2xx and a sending-only key's restricted_api_key 401 are verified; an invalid key is probe-failed", async () => {
    for (const [status, body, result] of [
      [200, '{"data":[]}', "verified"],
      [
        401,
        '{"name":"restricted_api_key","message":"This API key is restricted to only send emails"}',
        "verified",
      ],
      [
        400,
        '{"name":"validation_error","message":"API key is invalid"}',
        "probe-failed",
      ],
      [403, '{"name":"invalid_api_key"}', "probe-failed"],
      [401, '{"name":"missing_api_key"}', "probe-failed"],
      [500, "{}", "probe-failed"],
    ] as const) {
      const fetchFn = respond(status, body);
      expect(await new ResendChannel({ apiKey: "k", fetchFn }).probe()).toBe(
        result,
      );
      const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      expect(url).toBe(RESEND_DOMAINS_URL);
      expect(init.method).toBe("GET");
      expect(init.body).toBeUndefined();
    }
  });
  it("EARS-46: a network failure is probe-failed", async () => {
    expect(
      await new ResendChannel({
        apiKey: "k",
        fetchFn: networkError("ENOTFOUND"),
      }).probe(),
    ).toBe("probe-failed");
  });
});
