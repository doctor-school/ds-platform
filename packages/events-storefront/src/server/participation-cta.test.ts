import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchParticipationCta } from "./participation-cta";

// 020 EARS-1 / LD-2 — the participation CTA is read once per event, the same read
// for a guest and a signed-in viewer (wave-2 entry gate §2.1 row 11).
function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const GUEST = { cookie: "", userAgent: "UA", acceptLanguage: "ru", forwardedFor: "" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("020 EARS-1 fetchParticipationCta — one read for guest and doctor", () => {
  it("EARS-1: a guest sends no session headers and the read is no-store", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ kind: "register" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchParticipationCta("cardio-2026", GUEST)).resolves.toEqual({
      kind: "register",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/v1\/public\/events\/cardio-2026\/participation$/);
    expect(init?.headers).toEqual({ accept: "application/json" });
    expect(init?.cache).toBe("no-store");
  });

  it("EARS-1: a signed-in viewer's read forwards the session surface", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ kind: "registered" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchParticipationCta("cardio-2026", { ...GUEST, cookie: "__Host-ds_session=s" });
    expect(fetchMock.mock.calls[0]![1]?.headers).toMatchObject({
      cookie: "__Host-ds_session=s",
      "user-agent": "UA",
    });
  });

  it("EARS-1: a 404 yields null; any other failure throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    await expect(fetchParticipationCta("draft", GUEST)).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
    await expect(fetchParticipationCta("x", GUEST)).rejects.toThrow(
      /participation cta fetch failed \(503\)/,
    );
  });
});
