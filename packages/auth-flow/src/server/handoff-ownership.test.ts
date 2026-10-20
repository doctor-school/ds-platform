import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveOwnHandoff } from "./handoff-ownership";

/**
 * 003 EARS-44 (#2951) — the `/login` server door's ownership read. It forwards
 * the incoming request's session surface (cookie + fingerprint headers +
 * client chain) exactly like every other SSR hop, and answers `true` ONLY on a
 * well-formed `{ own: true }`; every other outcome is `false`, so the mount
 * renders exactly as it did before the read existed.
 */

const ORIGINAL_API_TARGET = process.env.API_PROXY_TARGET;
const REF = "Ab-_0123456789abcdefghijklmnopqrstuvwxyzABC";

const SIGNED_IN = new Headers({
  cookie: "__Host-ds_session=s1; other=1",
  "user-agent": "UA/1",
  "accept-language": "ru",
  "x-forwarded-for": "203.0.113.7",
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("003 EARS-44 (#2951): the server door's hand-off ownership read", () => {
  beforeEach(() => {
    process.env.API_PROXY_TARGET = "http://api.internal:3000/";
  });

  afterEach(() => {
    if (ORIGINAL_API_TARGET === undefined) delete process.env.API_PROXY_TARGET;
    else process.env.API_PROXY_TARGET = ORIGINAL_API_TARGET;
  });

  it("003 EARS-44: asks the ownership endpoint with the reference and the forwarded session surface", async () => {
    const fetchImpl = vi.fn(async () => json({ own: true }));

    expect(await resolveOwnHandoff(REF, SIGNED_IN, fetchImpl)).toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://api.internal:3000/v1/auth/login/otp/handoff/own");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body as string)).toEqual({ ref: REF });
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      cookie: "__Host-ds_session=s1; other=1",
      "user-agent": "UA/1",
      "accept-language": "ru",
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("003 EARS-44: «not yours», a 401, a throttle, a server error, an unexpected body and a network failure are all false", async () => {
    for (const answer of [
      async () => json({ own: false }),
      async () => json({ message: "Unauthorized" }, 401),
      async () => json({ message: "throttled" }, 429),
      async () => json({}, 500),
      async () => json({ own: "yes" }),
      async () => new Response("<html>", { status: 200 }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      expect(await resolveOwnHandoff(REF, SIGNED_IN, vi.fn(answer))).toBe(
        false,
      );
    }
  });

  it("003 EARS-44: without a session cookie nothing is asked — there is no session to own the link", async () => {
    const fetchImpl = vi.fn(async () => json({ own: true }));

    expect(
      await resolveOwnHandoff(
        REF,
        new Headers({ cookie: "other=1" }),
        fetchImpl,
      ),
    ).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
