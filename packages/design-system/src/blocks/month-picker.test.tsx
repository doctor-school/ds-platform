import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MonthPicker, type MonthPickerYear } from "./month-picker";

afterEach(cleanup);

/**
 * `<MonthPicker>` (004 EARS-16/17) — the 12-month chooser. The harness covers the
 * two behaviours reworked in owner verdicts #1/#2/#4 on #1052: the trigger adopts
 * the `Button` `outline` surface (a white bordered control, not the old filled
 * blue summary that vanished into the navy hero), and the year ‹ › stepper pages
 * IN PLACE across the provided window (a `<button>`, no navigation, counters swap)
 * with an edge fallback to a real server-navigation `<a>`.
 *
 * The picker renders closed (a native `<details>` — its content stays in the DOM
 * under jsdom, and driving it `defaultOpen` schedules a jsdom toggle timer that the
 * orphan-timer guard rejects), so the harness queries the popover content directly.
 */
const YEARS: readonly MonthPickerYear[] = [
  {
    year: "2026",
    months: [
      { label: "Янв", note: "прошёл", href: "#", muted: true },
      { label: "Фев", note: "прошёл", href: "#", muted: true },
      { label: "Мар", note: "прошёл", href: "#", muted: true },
      { label: "Апр", note: "прошёл", href: "#", muted: true },
      { label: "Май", note: "прошёл", href: "#", muted: true },
      { label: "Июн", note: "прошёл", href: "#", muted: true },
      { label: "Июл", note: "y26-июл", current: true },
      { label: "Авг", note: "y26-авг", href: "#" },
      { label: "Сен", note: "y26-сен", href: "#" },
      { label: "Окт", note: "y26-окт", href: "#" },
      { label: "Ноя", note: "y26-ноя", href: "#" },
      { label: "Дек", note: "y26-дек", href: "#" },
    ],
  },
  {
    year: "2027",
    months: Array.from({ length: 12 }, (_, i) => ({
      label: `M${i + 1}`,
      note: `y27-m${i + 1}`,
      href: "#",
    })),
  },
];

function renderPicker(props?: Partial<React.ComponentProps<typeof MonthPicker>>) {
  return render(
    <MonthPicker
      triggerLabel="Июль 2026"
      pickerLabel="Выбрать месяц"
      initialYear="2026"
      years={YEARS}
      prevYearHref="/webinars?view=month&month=2025-07"
      nextYearHref="/webinars?view=month&month=2027-07"
      prevYearLabel="Предыдущий год"
      nextYearLabel="Следующий год"
      {...props}
    />,
  );
}

describe("<MonthPicker>", () => {
  it("owner verdict #1: the trigger adopts the outline surface (white bordered), not the filled blue summary", () => {
    const { container } = renderPicker();
    const trigger = container.querySelector("summary")!;
    expect(trigger.className).toContain("border-2");
    expect(trigger.className).toContain("bg-background");
    // The low-contrast filled treatment is gone.
    expect(trigger.className).not.toContain("bg-primary-action");
  });

  it("owner verdict #4: the year › step pages IN PLACE — a button that swaps counters without navigation", () => {
    const { container } = renderPicker();
    const yearLabel = () =>
      container.querySelector('[data-testid="month-picker-year"]')!.textContent;
    expect(yearLabel()).toBe("2026");

    // In-window, the next-year control is a real <button>, never an anchor.
    const next = container.querySelector('[aria-label="Следующий год"]')!;
    expect(next.tagName).toBe("BUTTON");
    // A 2026-only counter is shown; a 2027-only counter is not yet.
    expect(screen.getByText("y26-авг")).toBeInTheDocument();
    expect(screen.queryByText("y27-m8")).toBeNull();

    fireEvent.click(next);

    // The popover stayed open, the year + all counters swapped to 2027.
    expect(yearLabel()).toBe("2027");
    expect(screen.getByText("y27-m8")).toBeInTheDocument();
    expect(screen.queryByText("y26-авг")).toBeNull();
  });

  it("owner verdict #4: at the window START edge the ‹ step falls back to a server-navigation link", () => {
    const { container } = renderPicker();
    // initialYear 2026 is the first window entry → the prev-year step is an <a>.
    const prev = container.querySelector('[aria-label="Предыдущий год"]')!;
    expect(prev.tagName).toBe("A");
    expect(prev).toHaveAttribute("href", "/webinars?view=month&month=2025-07");
  });

  it("owner verdict #4: at the window END edge the › step falls back to a server-navigation link", () => {
    // Open on the last window year — the next-year step is the edge <a>.
    const { container } = renderPicker({ initialYear: "2027" });
    expect(
      container.querySelector('[data-testid="month-picker-year"]')!.textContent,
    ).toBe("2027");
    const next = container.querySelector('[aria-label="Следующий год"]')!;
    expect(next.tagName).toBe("A");
    expect(next).toHaveAttribute("href", "/webinars?view=month&month=2027-07");
  });
});
