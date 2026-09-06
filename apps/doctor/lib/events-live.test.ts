import { describe, expect, it, vi } from "vitest";

import { DOCTOR_EVENTS_LIVE_PATH, fetchDoctorEventsLive } from "./events-live";
import { doctorLiveStripProps } from "./events-feed-cards";

/**
 * 019 EARS-6 (#1521) — the doctor host's live read and its copy projection.
 *
 * The read is the one on this screen that is viewer-DEPENDENT, so the specs
 * pin the cookie forwarding: the session must travel, or every signed-in doctor
 * silently gets the guest entry target.
 */
const strip = {
  eventId: "11111111-1111-4111-8111-111111111111",
  slug: "prp-questions",
  title: "Эфир «Вопросы по PRP»",
  school: "Школа ортобиологии",
  href: "/events/prp-questions/room",
  // 17:30Z is 20:30 in Europe/Moscow — the label must not drift to the runtime tz.
  endsAt: "2026-09-06T17:30:00.000Z",
  presenceCount: 412,
  viewerIsRegistered: true,
};

function headersWith(cookie: string): Headers {
  return new Headers({ cookie, "user-agent": "vitest", "accept-language": "ru" });
}

describe("019 EARS-6 · fetchDoctorEventsLive", () => {
  it("EARS-6.1: forwards the whole cookie header — specialty AND session — because WHO is asking picks the entry", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(strip), { status: 200 }),
    );

    const result = await fetchDoctorEventsLive(
      headersWith("__Host-ds_specialty=ortho; __Host-ds_session=abc"),
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toEqual(strip);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith(DOCTOR_EVENTS_LIVE_PATH)).toBe(true);
    const sent = (init.headers as Record<string, string>).cookie;
    expect(sent).toContain("__Host-ds_specialty=ortho");
    expect(sent).toContain("__Host-ds_session=abc");
    expect(init.cache).toBe("no-store");
  });

  it("EARS-6.2: a guest issues the same read with no cookie header at all", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("null", { status: 200 }),
    );

    const result = await fetchDoctorEventsLive(
      new Headers(),
      fetchImpl as unknown as typeof fetch,
    );

    expect(result).toBeNull();
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).cookie).toBeUndefined();
  });

  it("EARS-6.3: a body that broke the contract renders no strip rather than a half-drawn one", async () => {
    const fetchImpl = vi.fn(
      async () =>
        // `startsAt` is deliberately absent from the contract — a server that
        // started sending it is rejected at the boundary, not forwarded.
        new Response(JSON.stringify({ ...strip, startsAt: "2026-09-06T16:00:00.000Z" }), {
          status: 200,
        }),
    );

    await expect(
      fetchDoctorEventsLive(
        headersWith("__Host-ds_session=abc"),
        fetchImpl as unknown as typeof fetch,
      ),
    ).resolves.toBeNull();
  });

  it("EARS-6.4: a failed read degrades to no block — the live strip never takes the feed down", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const notOk = vi.fn(async () => new Response("", { status: 503 }));

    await expect(
      fetchDoctorEventsLive(new Headers(), failing as unknown as typeof fetch),
    ).resolves.toBeNull();
    await expect(
      fetchDoctorEventsLive(new Headers(), notOk as unknown as typeof fetch),
    ).resolves.toBeNull();
  });
});

describe("019 EARS-6 · doctorLiveStripProps", () => {
  it("EARS-6.5: renders the МСК meta line and takes the action href from the server, unchanged", () => {
    const props = doctorLiveStripProps(strip);

    expect(props.liveLabel).toBe("Идёт сейчас");
    expect(props.title).toBe("Эфир «Вопросы по PRP»");
    expect(props.titleHref).toBe("/events/prp-questions");
    expect(props.meta).toBe("412 в комнате · Школа ортобиологии · до 20:30 МСК");
    expect(props.actionLabel).toBe("Войти в комнату эфира");
    expect(props.actionHref).toBe("/events/prp-questions/room");
  });

  it("EARS-6.6: an unregistered viewer gets the event-page label for the event-page href the server chose", () => {
    const props = doctorLiveStripProps({
      ...strip,
      href: "/events/prp-questions",
      viewerIsRegistered: false,
      presenceCount: 1,
    });

    expect(props.actionLabel).toBe("Открыть страницу события");
    expect(props.actionHref).toBe("/events/prp-questions");
    // «в комнате» is numeral-neutral by design — one form, no plural to get wrong.
    expect(props.meta.startsWith("1 в комнате · ")).toBe(true);
  });

  it("EARS-6.7: an event with no school drops the segment instead of painting an empty one", () => {
    expect(doctorLiveStripProps({ ...strip, school: "" }).meta).toBe(
      "412 в комнате · до 20:30 МСК",
    );
  });
});
