import { describe, expect, it } from "vitest";
import type { MyEventItem } from "@ds/schemas";

import { buildMyEventListItems } from "./my-events-items";

// 005 EARS-6 / EARS-11 + 014 EARS-9 — the «Мои события» row→card projection,
// unit-tested independent of any browser (wave-2 entry gate §2.1 row 15, moved
// from the Academy host in PR 2.3). The API returns ONE tab already ordered
// (Предстоящие nearest-first, Записи newest-first); the projection groups without
// reordering — by calendar DAY for Предстоящие, by MONTH for Записи — in the zone
// the row is shown in: the viewer zone for an online or hybrid row, МСК for an
// offline one (004 EARS-12 as amended 2026-10-02, gate row 26).
//
// The process TZ is deliberately neither Moscow nor the viewer zone used below,
// so a regression that leaked the runtime TZ would flip these assertions.
process.env.TZ = "America/New_York";

const COPY = {
  dateLabel: ({ date, weekday }: { date: string; weekday: string }) =>
    `${date} · ${weekday}`,
  live: "В эфире",
  recordingLabel: (state: string) => `recording:${state}`,
  recordingCta: "Смотреть запись ↗",
  roomCta: "Войти в эфир",
} as const;

/** The server render and the first client render: the Moscow zone (gate row 26). */
const CTX = {
  copy: COPY,
  routes: { eventPage: "/webinars" },
  viewerZone: "Europe/Moscow",
} as const;

// An event airing now, one the next МСК day, and one two days out — supplied in
// nearest-first order (as the API returns them). Instants chosen so the Moscow
// calendar day is unambiguous and stable.
const upcoming: MyEventItem[] = [
  {
    eventId: "11111111-1111-4111-8111-111111111111",
    slug: "ortho-live",
    title: "Пластика ахиллова сухожилия",
    school: "Школа травматологии",
    // 2026-07-16 19:00 МСК = 16:00Z
    startsAt: "2026-07-16T16:00:00.000Z",
    state: "live",
    recording: null,
    participationFormat: "online",
    roomHref: "/webinars/ortho-live/room",
  },
  {
    eventId: "22222222-2222-4222-8222-222222222222",
    slug: "cardio-hsn",
    title: "ХСН: амбулаторное ведение",
    school: "Школа кардиологии",
    // 2026-07-17 18:00 МСК = 15:00Z
    startsAt: "2026-07-17T15:00:00.000Z",
    state: "published",
    recording: null,
    participationFormat: "online",
    roomHref: null,
  },
  {
    eventId: "33333333-3333-4333-8333-333333333333",
    slug: "endo-insulin",
    title: "Старт инсулинотерапии",
    school: "Школа эндокринологии",
    // 2026-07-18 18:00 МСК = 15:00Z
    startsAt: "2026-07-18T15:00:00.000Z",
    state: "published",
    recording: null,
    participationFormat: "online",
    roomHref: null,
  },
];

describe("014 EARS-9 my events tab projection (unit)", () => {
  it("014 EARS-9.1: Предстоящие groups the nearest-first rows by Europe/Moscow day, preserving order across groups", () => {
    const items = buildMyEventListItems(upcoming, "upcoming", CTX);
    expect(items.map((i) => i.groupKey)).toEqual([
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
    expect(items.map((i) => i.id)).toEqual(upcoming.map((e) => e.eventId));
    expect(items.every((i) => i.variant === "upcoming")).toBe(true);
  });

  it("014 EARS-9.2: two events on the same Moscow day share one group key, in order", () => {
    const sameDay: MyEventItem[] = [
      { ...upcoming[0]!, startsAt: "2026-07-16T16:00:00.000Z" },
      {
        ...upcoming[1]!,
        eventId: "44444444-4444-4444-8444-444444444444",
        // 2026-07-16 22:30 МСК = 19:30Z — same Moscow day, later.
        startsAt: "2026-07-16T19:30:00.000Z",
      },
    ];
    const items = buildMyEventListItems(sameDay, "upcoming", CTX);
    expect(new Set(items.map((i) => i.groupKey))).toEqual(
      new Set(["2026-07-16"]),
    );
    expect(items.map((i) => i.id)).toEqual(sameDay.map((e) => e.eventId));
  });

  it("014 EARS-9.3: a live row on Предстоящие carries the room-entry CTA; a non-live row carries none", () => {
    const [live, published] = buildMyEventListItems(upcoming, "upcoming", CTX);
    expect(live!.live).toBe(true);
    expect(live!.ctaHref).toBe("/webinars/ortho-live/room");
    expect(live!.ctaLabel).toBe("Войти в эфир");
    expect(published!.ctaHref).toBeUndefined();
    expect(published!.ctaLabel).toBeUndefined();
  });

  it("014 EARS-9.4: Записи groups the newest-first ended rows by Moscow month and badges every row with its recording state", () => {
    const ended: MyEventItem[] = [
      {
        ...upcoming[0]!,
        state: "ended",
        // 2026-08-02 03:00 МСК = 2026-08-01T00:00Z
        startsAt: "2026-08-01T00:00:00.000Z",
        recording: { state: "montage" } as MyEventItem["recording"],
      },
      {
        ...upcoming[1]!,
        state: "ended",
        startsAt: "2026-07-17T15:00:00.000Z",
        // An ended event with nothing published yet is still LISTED, badged
        // «готовится» — never dropped from the tab (014 EARS-9).
        recording: { state: "preparing" } as MyEventItem["recording"],
      },
    ];
    const items = buildMyEventListItems(ended, "recordings", CTX);
    expect(items.map((i) => i.groupKey)).toEqual(["2026-08", "2026-07"]);
    expect(items.map((i) => i.groupLabel)).toEqual([
      "Август 2026",
      "Июль 2026",
    ]);
    expect(items.map((i) => i.recordingLabel)).toEqual([
      "recording:montage",
      "recording:preparing",
    ]);
    // Every Записи row links back to its event page — no dead CTA.
    expect(items.map((i) => i.ctaHref)).toEqual([
      "/webinars/ortho-live",
      "/webinars/cardio-hsn",
    ]);
    expect(items.every((i) => i.variant === "past")).toBe(true);
    expect(items.every((i) => i.live === false)).toBe(true);
  });

  it("014 EARS-9.8: a Записи row offers «Смотреть запись» only when a cut is published — a preparing row carries the badge and NO CTA label", () => {
    const ended: MyEventItem[] = [
      {
        ...upcoming[0]!,
        state: "ended",
        startsAt: "2026-08-01T00:00:00.000Z",
        recording: { state: "montage" } as MyEventItem["recording"],
      },
      {
        ...upcoming[1]!,
        state: "ended",
        startsAt: "2026-07-17T15:00:00.000Z",
        recording: { state: "preparing" } as MyEventItem["recording"],
      },
      {
        ...upcoming[2]!,
        state: "ended",
        startsAt: "2026-06-10T15:00:00.000Z",
        // An ended row the projection could not resolve at all — no recording
        // object. Nothing is playable, so it must not advertise a cut either.
        recording: null,
      },
    ];
    const items = buildMyEventListItems(ended, "recordings", CTX);
    // The card renders its CTA only on `ctaHref && ctaLabel`, so suppressing the
    // label is what removes the button — the href stays, the card is still a link.
    expect(items.map((i) => i.ctaLabel)).toEqual([
      "Смотреть запись ↗",
      undefined,
      undefined,
    ]);
    // The preparing row keeps its badge — it is listed, just not playable.
    expect(items[1]!.recordingLabel).toBe("recording:preparing");
    expect(items.every((i) => i.ctaHref !== undefined)).toBe(true);
  });

  it("004 EARS-12: an online row shows the viewer zone with its label; an offline row stays МСК (gate row 26)", () => {
    // 16:00Z is 23:00 in Novosibirsk (UTC+7), 19:00 in Moscow, 12:00 in New York.
    const rows: MyEventItem[] = [
      { ...upcoming[0]!, participationFormat: "online" },
      {
        ...upcoming[0]!,
        eventId: "55555555-5555-4555-8555-555555555555",
        participationFormat: "hybrid",
      },
      {
        ...upcoming[0]!,
        eventId: "66666666-6666-4666-8666-666666666666",
        participationFormat: "offline",
      },
    ];
    const [online, hybrid, offline] = buildMyEventListItems(rows, "upcoming", {
      ...CTX,
      viewerZone: "Asia/Novosibirsk",
    });
    expect([online!.time, online!.tzLabel, online!.dateLabel]).toEqual([
      "23:00",
      "GMT+7",
      "16 июля · чт",
    ]);
    expect([hybrid!.time, hybrid!.tzLabel]).toEqual(["23:00", "GMT+7"]);
    expect([offline!.time, offline!.tzLabel, offline!.dateLabel]).toEqual([
      "19:00",
      "МСК",
      "16 июля · чт",
    ]);
  });

  it("004 EARS-12: in the Moscow zone every row renders МСК, never the runtime timezone (the server render)", () => {
    const [live] = buildMyEventListItems(upcoming, "upcoming", CTX);
    expect(live!.time).toBe("19:00");
    expect(live!.tzLabel).toBe("МСК");
    expect(live!.dateLabel).toBe("16 июля · чт");
  });

  it("004 EARS-12: an online row groups by the viewer-zone day; an offline row by the МСК day", () => {
    // 22:30Z on 16 July is 17 July in Novosibirsk and still 17 July 01:30 in Moscow;
    // 19:30Z is 17 July 02:30 in Novosibirsk but 16 July 22:30 in Moscow.
    const rows: MyEventItem[] = [
      {
        ...upcoming[0]!,
        startsAt: "2026-07-16T19:30:00.000Z",
        participationFormat: "online",
      },
      {
        ...upcoming[1]!,
        startsAt: "2026-07-16T19:30:00.000Z",
        participationFormat: "offline",
      },
    ];
    const [online, offline] = buildMyEventListItems(rows, "upcoming", {
      ...CTX,
      viewerZone: "Asia/Novosibirsk",
    });
    expect(online!.groupKey).toBe("2026-07-17");
    expect(offline!.groupKey).toBe("2026-07-16");
  });

  it("014 EARS-9.7: every row links to its event page on the host's event-page route", () => {
    const items = buildMyEventListItems(upcoming, "upcoming", {
      ...CTX,
      routes: { eventPage: "/events" },
    });
    expect(items.map((i) => i.href)).toEqual([
      "/events/ortho-live",
      "/events/cardio-hsn",
      "/events/endo-insulin",
    ]);
  });

  it("014 EARS-9.6: an empty tab yields no items (the surface renders that tab's empty-state)", () => {
    expect(buildMyEventListItems([], "upcoming", CTX)).toEqual([]);
    expect(buildMyEventListItems([], "recordings", CTX)).toEqual([]);
  });
});
