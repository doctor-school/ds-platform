import { describe, expect, it } from "vitest";
import type { MonthBroadcastEntry } from "@ds/schemas";

import { buildMonthGrid } from "./month-grid";
import {
  agendaDaysOf,
  defaultAgendaDay,
  dotWeeksOf,
  gridWeeksOf,
  pickerYearsOf,
} from "./month-view";

const EFIR = { one: "эфир", few: "эфира", many: "эфиров" };
const EVENT = { one: "событие", few: "события", many: "событий" };
const now = new Date("2026-10-08T09:00:00.000Z");
const links = {
  event: (slug: string) => `/events/${slug}`,
  day: (iso: string) => `/events?day=${iso}`,
};
const entry = (
  i: number,
  startsAt: string,
  state: MonthBroadcastEntry["state"] = "published",
  participationFormat: MonthBroadcastEntry["participationFormat"] = "online",
): MonthBroadcastEntry => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  slug: `e${i}`,
  title: `Событие ${i}`,
  school: "Школа",
  startsAt,
  state,
  participationFormat,
});
const MSK = "Europe/Moscow";

const busyDay = [
  entry(1, "2026-10-20T09:00:00.000Z"),
  entry(2, "2026-10-20T10:00:00.000Z"),
  entry(3, "2026-10-20T11:00:00.000Z"),
  entry(4, "2026-10-20T12:00:00.000Z", "live"),
  entry(5, "2026-10-20T13:00:00.000Z"),
];

describe("the month view (rows 53–55)", () => {
  it("NEW: ≥1024 — ≤3 pills «time zone · title» live first, «+N ещё» into that day of the feed, today outlined, past muted (row 53)", () => {
    const grid = buildMonthGrid({
      month: "2026-10",
      entries: [...busyDay, entry(6, "2026-10-01T09:00:00.000Z", "ended")],
      now,
    });
    const cells = gridWeeksOf(grid, links, MSK).flat();
    const day20 = cells.find((cell) => cell.dateLabel === "20")!;
    expect(day20.pills).toHaveLength(3);
    expect(day20.pills![0]).toMatchObject({ live: true, time: "15:00 МСК", title: "Событие 4", href: "/events/e4" });
    expect(day20.more).toEqual({ href: "/events?day=2026-10-20", label: "+2 ещё" });
    const today = cells.find((cell) => cell.today)!;
    expect(today.dateLabel).toBe("8 · сегодня");
    const first = cells.find((cell) => cell.dateLabel === "1" && cell.pills)!;
    expect(first.mutedDate).toBe(true);
    expect(first.pills![0]!.past).toBe(true);
  });

  it("NEW: month pills and agenda rows state the time in the viewer's zone", () => {
    const grid = buildMonthGrid({
      month: "2026-10",
      entries: [
        entry(1, "2026-10-20T09:00:00.000Z"),
        entry(2, "2026-10-20T10:00:00.000Z", "published", "offline"),
      ],
      now,
    });
    const zone = "Asia/Yekaterinburg";
    const day20 = gridWeeksOf(grid, links, zone).flat().find((cell) => cell.dateLabel === "20")!;
    // Online follows the viewer; offline keeps МСК — the feed card rule (004).
    expect(day20.pills!.map((pill) => pill.time)).toEqual(["14:00 GMT+5", "13:00 МСК"]);
    const rows = agendaDaysOf(grid, links, EVENT, zone)[20]!.rows;
    expect(rows.map((row) => row.time)).toEqual(["14:00 GMT+5", "13:00 МСК"]);
  });

  it("NEW: below 1024 — dots per day and the agenda of the tapped day, its aria label in the host noun (row 55)", () => {
    const grid = buildMonthGrid({ month: "2026-10", entries: busyDay, now });
    const day20 = dotWeeksOf(grid, EFIR).flat().find((cell) => cell.inMonth && cell.day === 20)!;
    expect(day20.dots).toEqual(["live", "event", "event"]);
    expect(day20.ariaLabel).toMatch(/, 5 эфиров$/);
    const agenda = agendaDaysOf(grid, links, EVENT, MSK);
    expect(agenda[20]!.rows).toHaveLength(5);
    expect(agenda[20]!.rows.find((row) => row.live)?.liveLabel).toBe("В эфире");
    expect(agenda[21]!.emptyText).toBe("В этот день событий нет");
    expect(defaultAgendaDay(grid)).toBe(8);
    expect(defaultAgendaDay(buildMonthGrid({ month: "2026-12", entries: [entry(7, "2026-12-03T09:00:00.000Z")], now }))).toBe(3);
  });

  it("NEW: the picker states each month's count, «архив» for an empty past month, and links every other month (row 54)", () => {
    const years = pickerYearsOf(
      [["2026", [{ month: 10, count: 2 }, { month: 11, count: 0 }]]],
      "2026-10",
      EFIR,
      (month) => `/webinars?view=month&month=${month}`,
    );
    const months = years[0]!.months;
    expect(months[9]).toMatchObject({ note: "2 эфира", current: true, muted: false });
    expect(months[9]!.href).toBeUndefined();
    expect(months[10]).toMatchObject({ note: "нет эфиров", muted: true, href: "/webinars?view=month&month=2026-11" });
    expect(months[0]!.note).toBe("архив");
  });
});
