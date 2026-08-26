import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/lib/session";
import { resolveShellAuth } from "@/lib/shell-auth";

/**
 * 017 EARS-1 — the server-resolved sign-in branch feeding the shell's action
 * cluster. Every path must land on exactly ONE of `guest` / `doctor`: the
 * "never neither, never transitional" half of the invariant is a property of
 * this resolver's total return type, and these cases pin every branch that
 * reaches it.
 */
const withCookie = () =>
  new Headers({
    cookie: `${SESSION_COOKIE_NAME}=abc`,
    "user-agent": "test-agent",
    "accept-language": "ru-RU",
  });

const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("017 EARS-1: server-resolved shell sign-in status", () => {
  it("017 EARS-1.1: resolves guest with no session cookie and issues no upstream read", async () => {
    const fetchSpy = vi.fn();
    const auth = await resolveShellAuth(
      new Headers(),
      fetchSpy as unknown as typeof fetch,
    );

    expect(auth).toEqual({ status: "guest" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("017 EARS-1.2: resolves doctor when the session read returns claims", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, { sub: "user-1", roles: ["doctor"], mfa: false }),
    );

    const auth = await resolveShellAuth(
      withCookie(),
      fetchImpl as unknown as typeof fetch,
    );

    expect(auth).toEqual({ status: "doctor" });
  });

  it("017 EARS-1.3: resolves guest on a 401 (expired or invalid session)", async () => {
    const fetchImpl = vi.fn(async () => json(401, {}));

    const auth = await resolveShellAuth(
      withCookie(),
      fetchImpl as unknown as typeof fetch,
    );

    expect(auth).toEqual({ status: "guest" });
  });

  it("017 EARS-1.4: degrades to guest on an upstream failure instead of taking the shell down", async () => {
    const auth = await resolveShellAuth(withCookie(), (async () => {
      throw new Error("upstream unreachable");
    }) as unknown as typeof fetch);

    expect(auth).toEqual({ status: "guest" });
  });

  it("017 EARS-1.5: forwards the fingerprint surface the session is bound to", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, { sub: "user-1", roles: [], mfa: false }),
    );

    await resolveShellAuth(
      withCookie(),
      fetchImpl as unknown as typeof fetch,
    );

    const init = fetchImpl.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["user-agent"]).toBe("test-agent");
    expect(headers["accept-language"]).toBe("ru-RU");
    expect(headers.cookie).toContain(SESSION_COOKIE_NAME);
  });
});
