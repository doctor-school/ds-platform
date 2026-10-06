import { describe, expect, it } from "vitest";
import { MOSCOW_TIME_ZONE, formatEventTime } from "./event-time.js";

/**
 * 004 EARS-12 as amended 2026-10-02 — the one event-time formatter. Every
 * expectation names the zone explicitly, so the table holds on any host zone
 * (the suite is also run under `TZ=America/New_York`).
 */

// 2026-07-16 19:00 МСК (16:00Z) — a Thursday.
const EVENING = "2026-07-16T16:00:00.000Z";
// 2026-07-17 01:00 МСК (2026-07-16 22:00Z) — the previous day in London.
const ONE_AM_MSK = "2026-07-16T22:00:00.000Z";

describe("formatEventTime (004 EARS-12)", () => {
  it("004 EARS-12: a Moscow viewer of an online event reads the time labelled «МСК»", () => {
    const shown = formatEventTime({
      startsAt: EVENING,
      participationFormat: "online",
      viewerZone: MOSCOW_TIME_ZONE,
    });
    expect(shown).toMatchObject({
      date: "16 июля",
      time: "19:00",
      zoneLabel: "МСК",
      groupDay: "2026-07-16",
      groupMonth: "2026-07",
    });
  });

  it("004 EARS-12: a Yekaterinburg viewer of an online event reads it in GMT+5", () => {
    const shown = formatEventTime({
      startsAt: EVENING,
      participationFormat: "online",
      viewerZone: "Asia/Yekaterinburg",
    });
    expect(shown).toMatchObject({ time: "21:00", zoneLabel: "GMT+5" });
  });

  it("004 EARS-12: a Kolkata viewer of a hybrid event reads a non-whole offset as GMT+5:30", () => {
    const shown = formatEventTime({
      startsAt: EVENING,
      participationFormat: "hybrid",
      viewerZone: "Asia/Kolkata",
    });
    expect(shown).toMatchObject({ time: "21:30", zoneLabel: "GMT+5:30" });
  });

  it.each([
    "Europe/Moscow",
    "Asia/Yekaterinburg",
    "Asia/Kolkata",
    "Europe/London",
    "America/New_York",
    "UTC",
  ])(
    "004 EARS-12: an offline event reads «МСК» for a viewer in %s",
    (viewerZone) => {
      const shown = formatEventTime({
        startsAt: EVENING,
        participationFormat: "offline",
        viewerZone,
      });
      expect(shown).toMatchObject({
        date: "16 июля",
        time: "19:00",
        zoneLabel: "МСК",
        groupDay: "2026-07-16",
      });
    },
  );

  it("004 EARS-12: a 01:00 МСК online event groups on the previous day for a London viewer", () => {
    const moscow = formatEventTime({
      startsAt: ONE_AM_MSK,
      participationFormat: "online",
      viewerZone: MOSCOW_TIME_ZONE,
    });
    const london = formatEventTime({
      startsAt: ONE_AM_MSK,
      participationFormat: "online",
      viewerZone: "Europe/London",
    });
    expect(moscow.groupDay).toBe("2026-07-17");
    expect(london).toMatchObject({
      date: "16 июля",
      time: "23:00",
      zoneLabel: "GMT+1",
      groupDay: "2026-07-16",
      groupMonth: "2026-07",
    });
  });

  it("004 EARS-12: a zero offset reads GMT+0 and a negative one keeps its sign", () => {
    // 2026-01-15 — London on winter time (UTC+0), New York on EST (UTC-5).
    const winter = "2026-01-15T12:00:00.000Z";
    expect(
      formatEventTime({
        startsAt: winter,
        participationFormat: "online",
        viewerZone: "Europe/London",
      }).zoneLabel,
    ).toBe("GMT+0");
    expect(
      formatEventTime({
        startsAt: winter,
        participationFormat: "online",
        viewerZone: "America/St_Johns",
      }).zoneLabel,
    ).toBe("GMT-3:30");
    expect(
      formatEventTime({
        startsAt: winter,
        participationFormat: "online",
        viewerZone: "Australia/Adelaide",
      }).zoneLabel,
    ).toBe("GMT+10:30");
  });

  it("004 EARS-12: the Moscow-pinned callers (admin, mail) get the long date, weekdays and month header of the same instant", () => {
    const shown = formatEventTime({
      startsAt: new Date(EVENING),
      viewerZone: MOSCOW_TIME_ZONE,
    });
    expect(shown).toMatchObject({
      dateWithYear: "16 июля 2026 г.",
      weekday: "четверг",
      weekdayShort: "чт",
      monthLabel: "Июль 2026",
      zoneLabel: "МСК",
    });
  });
});
