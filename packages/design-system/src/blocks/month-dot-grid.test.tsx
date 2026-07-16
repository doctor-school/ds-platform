import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MonthDotGrid, type DotGridCell } from "./month-dot-grid";

afterEach(cleanup);

/**
 * `<MonthDotGrid>` (004 EARS-19) — the controlled mobile calendar. Presentation +
 * a selection callback; the harness asserts the accessible day labels (the live
 * signal is carried in text, never colour-only), that a neighbour-month cell is
 * non-interactive, and that tapping an in-month day reports the selection.
 */
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

function fullWeek(cells: DotGridCell[]): DotGridCell[] {
  const pad = Array.from({ length: 7 - cells.length }, (_, i) => ({
    day: 90 + i,
    inMonth: false,
    dots: [],
    ariaLabel: String(90 + i),
  }));
  return [...cells, ...pad];
}

describe("<MonthDotGrid>", () => {
  const weeks = [
    fullWeek([
      { day: 30, inMonth: false, dots: [], ariaLabel: "30" },
      {
        day: 7,
        inMonth: true,
        today: true,
        dots: ["live", "event"],
        ariaLabel: "7 июля, вторник, 2 эфира, идёт эфир",
      },
    ]),
  ];

  it("exposes each day's accessible summary (live signal in text, not colour)", () => {
    render(
      <MonthDotGrid
        weekdays={WEEKDAYS}
        weeks={weeks}
        selectedDay={7}
        onSelectDay={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /2 эфира, идёт эфир/ }),
    ).toBeInTheDocument();
  });

  it("marks the selected in-month day pressed and reports a tap", () => {
    const onSelect = vi.fn();
    render(
      <MonthDotGrid
        weekdays={WEEKDAYS}
        weeks={weeks}
        selectedDay={7}
        onSelectDay={onSelect}
      />,
    );
    const today = screen.getByRole("button", { name: /7 июля/ });
    expect(today).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(today);
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("disables a neighbour-month cell", () => {
    render(
      <MonthDotGrid
        weekdays={WEEKDAYS}
        weeks={weeks}
        selectedDay={7}
        onSelectDay={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "30" })).toBeDisabled();
  });
});
