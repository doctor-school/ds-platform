import { describe, expect, it } from "vitest";
import type { MyEvents } from "@ds/schemas";

import { formatMskParts, formatMskWeekdayShort } from "./msk";
import { groupMyEventsByDay } from "./my-events";

// 005 EARS-6 / EARS-11 — the «мои события» Предстоящие day-grouping + МСК
// rendering, unit-tested independent of any browser. The API returns the caller's
// registered upcoming events already ordered nearest `startsAt` first; the surface
// groups them by Europe/Moscow calendar day WITHOUT reordering, and renders every
// instant in Europe/Moscow labeled МСК regardless of the runtime's timezone.
//
// The process TZ is deliberately NON-Moscow for this file (set below), so a
// regression that dropped the pinned `timeZone: "Europe/Moscow"` and leaked the
// runtime TZ would flip these assertions (EARS-11: no local drift).
process.env.TZ = "America/New_York";

// An event airing now, one the next МСК day, and one two days out — supplied in
// nearest-first order (as the API returns them). Instants chosen so the Moscow
// calendar day is unambiguous and stable.
const events: MyEvents = [
  {
    eventId: "11111111-1111-4111-8111-111111111111",
    slug: "ortho-live",
    title: "Пластика ахиллова сухожилия",
    school: "Школа травматологии",
    // 2026-07-16 19:00 МСК = 16:00Z
    startsAt: "2026-07-16T16:00:00.000Z",
    state: "live",
  },
  {
    eventId: "22222222-2222-4222-8222-222222222222",
    slug: "cardio-hsn",
    title: "ХСН: амбулаторное ведение",
    school: "Школа кардиологии",
    // 2026-07-17 18:00 МСК = 15:00Z
    startsAt: "2026-07-17T15:00:00.000Z",
    state: "published",
  },
  {
    eventId: "33333333-3333-4333-8333-333333333333",
    slug: "endo-insulin",
    title: "Старт инсулинотерапии",
    school: "Школа эндокринологии",
    // 2026-07-18 18:00 МСК = 15:00Z
    startsAt: "2026-07-18T15:00:00.000Z",
    state: "published",
  },
];

describe("005 EARS-6 my events day grouping (unit)", () => {
  it("EARS-6.1: groups the nearest-first events by Europe/Moscow day, preserving order across groups", () => {
    const groups = groupMyEventsByDay(events);
    // Three distinct МСК days → three groups, in the same nearest-first order.
    expect(groups.map((g) => g.key)).toEqual([
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
    expect(
      groups.flatMap((g) => g.events.map((e) => e.eventId)),
    ).toEqual(events.map((e) => e.eventId));
  });

  it("EARS-6.1: two events on the same Moscow day share one group in order", () => {
    const sameDay: MyEvents = [
      { ...events[0]!, startsAt: "2026-07-16T16:00:00.000Z" },
      {
        ...events[1]!,
        eventId: "44444444-4444-4444-8444-444444444444",
        // 2026-07-16 22:30 МСК = 19:30Z — same Moscow day, later.
        startsAt: "2026-07-16T19:30:00.000Z",
      },
    ];
    const groups = groupMyEventsByDay(sameDay);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.events.map((e) => e.eventId)).toEqual([
      sameDay[0]!.eventId,
      sameDay[1]!.eventId,
    ]);
  });

  it("EARS-11: instants render in Europe/Moscow (МСК) regardless of the runtime timezone (no local drift)", () => {
    // Runtime TZ is America/New_York (set above). The live event's 16:00Z instant
    // is 19:00 in Moscow and 12:00 in New York — the МСК formatter must yield 19:00.
    const parts = formatMskParts(events[0]!.startsAt);
    expect(parts.time).toBe("19:00");
    expect(parts.date).toBe("16 июля");
    // The card sub-label weekday is also Moscow-computed (16 July 2026 = Thursday).
    expect(formatMskWeekdayShort(events[0]!.startsAt)).toBe("чт");
  });

  it("EARS-6.3: an empty list yields no groups (the surface renders the empty-state)", () => {
    expect(groupMyEventsByDay([])).toEqual([]);
  });
});
