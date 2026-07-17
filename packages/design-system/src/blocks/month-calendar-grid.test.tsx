import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MonthCalendarGrid, type MonthGridCell } from "./month-calendar-grid";

afterEach(cleanup);

/**
 * `<MonthCalendarGrid>` (004 EARS-19) — the display-only desktop month grid. The
 * block is presentation-only (all data/copy/hrefs are app-supplied), so the
 * harness asserts on the STRUCTURE the month view depends on: event pills link to
 * their event page, a live pill carries a screen-reader live label (never
 * colour-only), a past day renders its aggregate note, today gets an outline, and
 * the legend renders.
 */
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const LEGEND = { live: "В эфире", planned: "Запланирован", past: "Прошёл / пусто" };

function week(cells: MonthGridCell[]): MonthGridCell[] {
  const pad = Array.from({ length: 7 - cells.length }, () => ({ dateLabel: "" }));
  return [...cells, ...pad];
}

describe("<MonthCalendarGrid>", () => {
  it("renders event pills that link to the event page", () => {
    render(
      <MonthCalendarGrid
        weekdays={WEEKDAYS}
        liveLabel="В эфире"
        legend={LEGEND}
        weeks={[
          week([
            {
              dateLabel: "8",
              pills: [{ href: "/webinars/x", time: "18:00", title: "Кардиология" }],
            },
          ]),
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /18:00 · Кардиология/ });
    expect(link).toHaveAttribute("href", "/webinars/x");
  });

  it("carries a screen-reader live label on a live pill (not colour-only)", () => {
    render(
      <MonthCalendarGrid
        weekdays={WEEKDAYS}
        liveLabel="В эфире"
        legend={LEGEND}
        weeks={[
          week([
            {
              dateLabel: "7 · сегодня",
              today: true,
              pills: [{ href: "/webinars/l", time: "19:00", title: "Эфир", live: true }],
            },
          ]),
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /В эфире/ });
    expect(within(link).getByText("В эфире")).toHaveClass("sr-only");
  });

  it("renders a past day's aggregate note and the state legend", () => {
    render(
      <MonthCalendarGrid
        weekdays={WEEKDAYS}
        liveLabel="В эфире"
        legend={LEGEND}
        weeks={[week([{ dateLabel: "1", note: "2 эфира · прошли", mutedDate: true }])]}
      />,
    );
    expect(screen.getByText("2 эфира · прошли")).toBeInTheDocument();
    expect(screen.getByText("Запланирован")).toBeInTheDocument();
    expect(screen.getByText("Прошёл / пусто")).toBeInTheDocument();
  });

  it("EARS-19: clamps every pill's text run to two lines via an inner clamp span (planned and live)", () => {
    render(
      <MonthCalendarGrid
        weekdays={WEEKDAYS}
        liveLabel="В эфире"
        legend={LEGEND}
        weeks={[
          week([
            {
              dateLabel: "8",
              pills: [
                { href: "/webinars/x", time: "18:00", title: "Кардиология" },
                { href: "/webinars/l", time: "19:00", title: "Эфир", live: true },
              ],
            },
          ]),
        ]}
      />,
    );
    const planned = screen.getByRole("link", { name: /18:00 · Кардиология/ });
    const plannedSpan = planned.querySelector("span.line-clamp-2");
    expect(plannedSpan).not.toBeNull();
    expect(plannedSpan).toHaveTextContent("18:00 · Кардиология");

    // The live pill's clamp span carries the WHOLE inline run — dot + sr-only
    // label + text — so multi-line text still wraps around the live glyph.
    const live = screen.getByRole("link", { name: /В эфире/ });
    const liveSpan = live.querySelector("span.line-clamp-2");
    expect(liveSpan).not.toBeNull();
    expect(liveSpan).toHaveTextContent("19:00 · Эфир");
    expect(within(live).getByText("В эфире")).toHaveClass("sr-only");
    expect(liveSpan!.contains(within(live).getByText("В эфире"))).toBe(true);
  });

  it("EARS-19: does not clamp the «+N ещё» overflow link or a past-day note", () => {
    render(
      <MonthCalendarGrid
        weekdays={WEEKDAYS}
        liveLabel="В эфире"
        legend={LEGEND}
        weeks={[
          week([
            {
              dateLabel: "8",
              pills: [{ href: "/webinars/x", time: "18:00", title: "Кардиология" }],
              more: { href: "/webinars?month=2026-07#day-2026-07-08", label: "+2 ещё" },
            },
            { dateLabel: "1", note: "2 эфира · прошли", mutedDate: true },
          ]),
        ]}
      />,
    );
    const more = screen.getByRole("link", { name: "+2 ещё" });
    expect(more).not.toHaveClass("line-clamp-2");
    expect(more.querySelector(".line-clamp-2")).toBeNull();
    const note = screen.getByText("2 эфира · прошли");
    expect(note).not.toHaveClass("line-clamp-2");
  });

  it("EARS-19: renders the always-on next-month link", () => {
    render(
      <MonthCalendarGrid
        weekdays={WEEKDAYS}
        liveLabel="В эфире"
        legend={LEGEND}
        weeks={[week([{ dateLabel: "1" }])]}
        nextMonthLink={{
          href: "/webinars?view=month&month=2026-08",
          label: "Август 2026 →",
        }}
      />,
    );
    const link = screen.getByTestId("next-month-link");
    expect(link).toHaveAttribute("href", "/webinars?view=month&month=2026-08");
    expect(link).toHaveTextContent("Август 2026 →");
  });
});
