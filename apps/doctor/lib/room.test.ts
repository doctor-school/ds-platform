import { describe, expect, it, vi } from "vitest";

import { fetchDoctorDisplayName, fetchDoctorRoomConfig } from "@/lib/room";
import type { ForwardedSession } from "@/lib/session";

/**
 * 006 EARS-1 / EARS-6 (#1722, slice 3) — the doctor host's binding of the shared
 * room reads.
 *
 * The refusal→branch mapping itself belongs to `@ds/room/server` and is tested
 * there. What is asserted HERE is the part this host owns and could get wrong on
 * its own: that the doctor's upstream base is addressed, that the
 * fingerprint-bound surface (ADR-0001 §6) actually rides along — without it the
 * api re-derives a different fingerprint and 401s a valid session, turning a
 * registered doctor into a redirect to the event page — and that a session-less
 * request never reaches the api at all.
 */

const session: ForwardedSession = {
  cookie: "__Host-ds_session=abc",
  userAgent: "Mozilla/5.0 (doctor)",
  acceptLanguage: "ru-RU,ru;q=0.9",
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("006 doctor room reads", () => {
  it("006 EARS-1: the doctor room read forwards the session cookie and the fingerprint headers", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        eventId: "e1",
        slug: "cardio-live",
        title: "Кардио",
        liveAt: "2026-09-05T10:00:00.000Z",
        presenceCount: 3,
        heartbeatIntervalSeconds: 30,
      }),
    );

    await fetchDoctorRoomConfig("cardio-live", session, fetchImpl as never);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toMatch(/\/v1\/events\/cardio-live\/room$/);
    expect(init.headers.cookie).toBe(session.cookie);
    expect(init.headers["user-agent"]).toBe(session.userAgent);
    expect(init.headers["accept-language"]).toBe(session.acceptLanguage);
    expect(init.cache).toBe("no-store");
  });

  it("006 EARS-6: an api 403 surfaces as the register branch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "forbidden" }, 403));

    const access = await fetchDoctorRoomConfig(
      "cardio-live",
      session,
      fetchImpl as never,
    );

    expect(access).toEqual({ kind: "register" });
  });

  it("006 EARS-6: a request with no session cookie never reaches the api and resolves to the auth branch", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 200));

    const access = await fetchDoctorRoomConfig(
      "cardio-live",
      { ...session, cookie: "" },
      fetchImpl as never,
    );

    expect(access).toEqual({ kind: "auth" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("006 EARS-14: the display-name read is self-only and forwards the same bound surface", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ displayName: "Иван Петров" }));

    await expect(
      fetchDoctorDisplayName(session, fetchImpl as never),
    ).resolves.toBe("Иван Петров");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toMatch(/\/v1\/me\/display-name$/);
    expect(init.headers.cookie).toBe(session.cookie);
    expect(init.headers["user-agent"]).toBe(session.userAgent);
  });
});
