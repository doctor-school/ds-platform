import { describe, expect, it } from "vitest";
import type { MyEventItem } from "@ds/schemas";

import { formatMskParts, formatMskWeekdayShort } from "./msk";
import { buildMyEventListItems } from "./my-events";

// 005 EARS-6 / EARS-11 + 014 EARS-9 — the «Мои события» row→card projection,
// unit-tested independent of any browser. The API returns ONE tab already ordered
// (Предстоящие nearest-first, Записи newest-first); the projection groups without
// reordering — by Europe/Moscow calendar DAY for Предстоящие, by МСК MONTH for
// Записи — and renders every instant in Europe/Moscow labeled МСК regardless of
// the runtime's timezone.
//
// The process TZ is deliberately NON-Moscow for this file (set below), so a
// regression that dropped the pinned `timeZone: "Europe/Moscow"` and leaked the
// runtime TZ would flip these assertions (EARS-11: no local drift).
process.env.TZ = "America/New_York";

const COPY = {
  cardTz: "МСК",
  dateLabel: ({ date, weekday }: { date: string; weekday: string }) =>
    `${date} · ${weekday}`,
  live: "В эфире",
  recordingLabel: (state: string) => `recording:${state}`,
  recordingCta: "Смотреть запись ↗",
  roomCta: "Войти в эфир",
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
  },
];

describe("014 EARS-9 my events tab projection (unit)", () => {
  it("014 EARS-9.1: Предстоящие groups the nearest-first rows by Europe/Moscow day, preserving order across groups", () => {
    const items = buildMyEventListItems(upcoming, "upcoming", COPY);
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
    const items = buildMyEventListItems(sameDay, "upcoming", COPY);
    expect(new Set(items.map((i) => i.groupKey))).toEqual(
      new Set(["2026-07-16"]),
    );
    expect(items.map((i) => i.id)).toEqual(sameDay.map((e) => e.eventId));
  });

  it("014 EARS-9.3: a live row on Предстоящие carries the room-entry CTA; a non-live row carries none", () => {
    const [live, published] = buildMyEventListItems(upcoming, "upcoming", COPY);
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
    const items = buildMyEventListItems(ended, "recordings", COPY);
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

  it("014 EARS-9.5: instants render in Europe/Moscow (МСК) regardless of the runtime timezone (no local drift)", () => {
    // Runtime TZ is America/New_York (set above). The live event's 16:00Z instant
    // is 19:00 in Moscow and 12:00 in New York — the МСК formatter must yield 19:00.
    const parts = formatMskParts(upcoming[0]!.startsAt);
    expect(parts.time).toBe("19:00");
    expect(parts.date).toBe("16 июля");
    // The card sub-label weekday is also Moscow-computed (16 July 2026 = Thursday).
    expect(formatMskWeekdayShort(upcoming[0]!.startsAt)).toBe("чт");
    const [live] = buildMyEventListItems(upcoming, "upcoming", COPY);
    expect(live!.time).toBe("19:00");
    expect(live!.tzLabel).toBe("МСК");
    expect(live!.dateLabel).toBe("16 июля · чт");
  });

  it("014 EARS-9.6: an empty tab yields no items (the surface renders that tab's empty-state)", () => {
    expect(buildMyEventListItems([], "upcoming", COPY)).toEqual([]);
    expect(buildMyEventListItems([], "recordings", COPY)).toEqual([]);
  });
});
