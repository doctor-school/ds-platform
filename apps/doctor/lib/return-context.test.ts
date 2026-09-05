import { describe, expect, it } from "vitest";

import {
  RETURN_CONTEXT_PARAM,
  formatMskDateLabel,
  formatMskTime,
  resolveReturnContext,
} from "@/lib/return-context";

/**
 * 021 EARS-2 (#1538) — the RESOLUTION half of the return context: the canonical
 * `returnTo` target → the public event read → the card projection.
 *
 * The clause's browser tier (`e2e/register-return-context.spec.ts`) proves what
 * RENDERS; this tier pins the contract the render depends on — that the surface
 * speaks the ONE return-target vocabulary (005 EARS-2 / 021 LD-3) through the
 * shared `parseReturnTarget` guard, and that every unsafe or unresolvable value
 * degrades to absence without ever reaching the api.
 */
const EVENT = {
  id: "00000000-0000-4000-8000-0000000005f7",
  slug: "prp-pri-gonartroze",
  title: "PRP при гонартрозе: показания, протоколы, ошибки",
  school: "Школа ортобиологии",
  startsAt: "2026-08-27T16:00:00.000Z",
  durationMin: 90,
  description: "Разбор показаний, протоколов и типичных ошибок PRP-терапии.",
  speakers: [
    { source: "legacy", name: "Анна Соколова", credentials: "к.м.н." },
  ],
  specialties: ["Травматология"],
  partners: [],
  // 020 EARS-2 (#1765): `links` is a REQUIRED member of the public event read.
  // The doctor host publishes no expert/school/community page yet, so every
  // key resolves absent — but the object itself is always on the body.
  links: { speakerPages: [] },
  state: "published",
  format: "online",
  seatsLeft: null,
  recording: {
    state: "preparing",
    primaryKind: null,
    secondaryKind: null,
    posterUrl: null,
    expectedBy: null,
  },
};

function stubFetch(
  body: unknown,
  init: { status?: number } = {},
): { impl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

describe("021 EARS-2: resolveReturnContext", () => {
  it("021 EARS-2: reads the canonical `returnTo` param, never a surface-local one", () => {
    expect(RETURN_CONTEXT_PARAM).toBe("returnTo");
  });

  it("021 EARS-2: resolves the canonical target to the card projection", async () => {
    const { impl, calls } = stubFetch(EVENT);
    const resolved = await resolveReturnContext(
      "/webinars/prp-pri-gonartroze",
      impl,
    );

    // The slug comes out of the shared guard, so the read is addressed by the
    // event slug the target names — not by the raw param value.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/v1/public/events/prp-pri-gonartroze");
    expect(resolved).not.toBeNull();
    expect(resolved!.title).toBe(EVENT.title);
    expect(resolved!.school).toBe("Школа ортобиологии");
    expect(resolved!.time).toBe("19:00");
    expect(resolved!.dateLabel).toBe("27 августа · чт");
    // The projection narrows the speaker rows to name-only — no credentials.
    expect(resolved!.speakers).toEqual([{ name: "Анна Соколова" }]);
  });

  it.each([
    ["absent", undefined],
    ["a bare slug — the retired second vocabulary", "prp-pri-gonartroze"],
    ["cross-origin", "https://evil.example/webinars/prp-pri-gonartroze"],
    ["protocol-relative", "//evil.example/webinars/x"],
    ["a backslash bypass", String.raw`/webinars/\evil`],
    ["traversal", "/webinars/../account"],
    ["not anchored under /webinars/", "/account"],
  ])(
    "021 EARS-2: %s never reaches the read and resolves to absence",
    async (_label, value) => {
      const { impl, calls } = stubFetch(EVENT);
      await expect(resolveReturnContext(value, impl)).resolves.toBeNull();
      expect(calls).toHaveLength(0);
    },
  );

  it("019 EARS-12: a feed-shaped returnTo resolves the resumed card through the same one read", async () => {
    const { impl, calls } = stubFetch(EVENT);
    // The value the feed's guest CTA mints — the whole feed query rides along,
    // and the resumed event is named by `resume=`.
    const resolved = await resolveReturnContext(
      "/events?day=2026-08-27&tense=upcoming&specialty=mine-and-adjacent" +
        "&resume=prp-pri-gonartroze",
      impl,
    );

    // 021 EARS-2 needed NO change for the 019 shape: the guard hands back the
    // same `{ eventSlug, returnTo }`, so the resolution reads by slug exactly as
    // it does for the academy shape.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/v1/public/events/prp-pri-gonartroze");
    expect(resolved!.title).toBe(EVENT.title);
  });

  it("019 EARS-12: a feed-shaped target the guard refuses never reaches the read", async () => {
    for (const hostile of [
      "/events?tense=upcoming",
      "/events?resume=a/b",
      "/events/x?resume=prp-pri-gonartroze",
      "https://evil.example/events?resume=prp-pri-gonartroze",
    ]) {
      const { impl, calls } = stubFetch(EVENT);
      await expect(resolveReturnContext(hostile, impl)).resolves.toBeNull();
      expect(calls, `must not read for: ${hostile}`).toHaveLength(0);
    }
  });

  it("021 EARS-2: a safe target naming an unknown event is absence, not a throw", async () => {
    const { impl } = stubFetch(
      { status: 404, message: "event not found" },
      { status: 404 },
    );
    await expect(
      resolveReturnContext("/webinars/net-takogo-sobytiya", impl),
    ).resolves.toBeNull();
  });

  it("021 EARS-2: a body that fails the contract is absence", async () => {
    const { impl } = stubFetch({ slug: "prp-pri-gonartroze" });
    await expect(
      resolveReturnContext("/webinars/prp-pri-gonartroze", impl),
    ).resolves.toBeNull();
  });

  it("021 EARS-2: an api that is down never takes the door down", async () => {
    const impl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(
      resolveReturnContext("/webinars/prp-pri-gonartroze", impl),
    ).resolves.toBeNull();
  });

  it("021 EARS-12: both formatters render the event's own МСК clock", () => {
    // 16:00Z is 19:00 in Europe/Moscow; the label must not drift to the runtime
    // zone, and the short weekday carries no trailing period on any ICU build.
    expect(formatMskTime("2026-08-27T16:00:00.000Z")).toBe("19:00");
    expect(formatMskDateLabel("2026-08-27T16:00:00.000Z")).toBe(
      "27 августа · чт",
    );
  });
});
