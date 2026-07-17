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

/**
 * A wide seven-year window (2023‥2029) centred on 2026 — the shape the app hands
 * in after 004 owner verdict #6 (radius 3): ≥3 consecutive in-place steps in EITHER
 * direction stay client `<button>`s before an edge `<a>` is ever reached.
 */
const WIDE_YEARS: readonly MonthPickerYear[] = Array.from({ length: 7 }, (_, i) => {
  const year = String(2023 + i);
  return {
    year,
    months: Array.from({ length: 12 }, (_, m) => ({
      label: `M${m + 1}`,
      note: `${year}-m${m + 1}`,
      href: "#",
    })),
  };
});

function pickerProps(
  props?: Partial<React.ComponentProps<typeof MonthPicker>>,
): React.ComponentProps<typeof MonthPicker> {
  return {
    triggerLabel: "Июль 2026",
    pickerLabel: "Выбрать месяц",
    initialYear: "2026",
    years: YEARS,
    prevYearHref: "/webinars?view=month&month=2025-07",
    nextYearHref: "/webinars?view=month&month=2027-07",
    prevYearLabel: "Предыдущий год",
    nextYearLabel: "Следующий год",
    ...props,
  };
}

function renderPicker(props?: Partial<React.ComponentProps<typeof MonthPicker>>) {
  return render(<MonthPicker {...pickerProps(props)} />);
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

  it("owner verdict #6: ≥3 consecutive in-place year steps EACH direction stay client buttons across the former ±1 edge", () => {
    const { container } = renderPicker({
      years: WIDE_YEARS,
      initialYear: "2026",
    });
    const yearLabel = () =>
      container.querySelector('[data-testid="month-picker-year"]')!.textContent;
    const nextCtl = () => container.querySelector('[aria-label="Следующий год"]')!;
    const prevCtl = () => container.querySelector('[aria-label="Предыдущий год"]')!;
    expect(yearLabel()).toBe("2026");

    // Three steps forward — each is an in-place <button> (no navigation), and
    // the year advances. The former ±1 window edge (2027) is crossed in place.
    for (let i = 1; i <= 3; i++) {
      expect(nextCtl().tagName).toBe("BUTTON");
      fireEvent.click(nextCtl());
      expect(yearLabel()).toBe(String(2026 + i));
    }
    // Only now, at the wide-window edge (2029), does › become the server-nav <a>.
    expect(nextCtl().tagName).toBe("A");

    // …and three steps back, all in-place buttons, land on the start year again.
    for (let i = 2; i >= 0; i--) {
      expect(prevCtl().tagName).toBe("BUTTON");
      fireEvent.click(prevCtl());
      expect(yearLabel()).toBe(String(2026 + i));
    }
    expect(yearLabel()).toBe("2026");
  });

  it("owner verdict #6: resyncs the displayed year when initialYear changes (sibling soft-nav), never left stale", () => {
    const { container, rerender } = renderPicker();
    const yearLabel = () =>
      container.querySelector('[data-testid="month-picker-year"]')!.textContent;
    expect(yearLabel()).toBe("2026");

    // A sibling soft-navigation re-renders the picker with a new displayed year
    // while the popover may still be open — the mount-seeded state must follow,
    // not show the stale mount year (Mode-a #1101 [SUGGESTION]).
    rerender(
      <MonthPicker
        {...pickerProps({
          triggerLabel: "Июль 2027",
          initialYear: "2027",
          prevYearHref: "/webinars?view=month&month=2026-07",
          nextYearHref: "/webinars?view=month&month=2028-07",
        })}
      />,
    );
    expect(yearLabel()).toBe("2027");
  });
});
