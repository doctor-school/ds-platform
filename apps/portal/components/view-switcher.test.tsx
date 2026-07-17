// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ViewSwitcher } from "./view-switcher";

afterEach(cleanup);

/**
 * 004 EARS-18 — the «Неделя / Месяц» switcher. The component contract: the active
 * side is a non-interactive `aria-current` label, the other side is a REAL link
 * (never a dead CTA) that adopts the `Button` `ghost` state machinery — a
 * hover tint-fill + focus ring, NOT the old `Link`-primitive hover-underline
 * (004 owner verdict #2 on #1052 — segment states from a primitive, not
 * hand-assembled).
 */
describe("<ViewSwitcher>", () => {
  it("EARS-18: the inactive segment is a real link to the other pane", () => {
    render(
      <ViewSwitcher
        active="month"
        weekHref="/webinars?month=2026-07"
        monthHref="/webinars?view=month&month=2026-07"
        weekLabel="Неделя"
        monthLabel="Месяц"
      />,
    );
    const weekLink = screen.getByRole("link", { name: "Неделя" });
    expect(weekLink).toHaveAttribute("href", "/webinars?month=2026-07");
    // The active side is the non-interactive current-page label.
    expect(screen.getByText("Месяц")).toHaveAttribute("aria-current", "page");
  });

  it("owner verdict #2: the inactive segment adopts the Button ghost states, not a link underline", () => {
    render(
      <ViewSwitcher
        active="week"
        weekHref="/webinars"
        monthHref="/webinars?view=month"
        weekLabel="Неделя"
        monthLabel="Месяц"
      />,
    );
    const monthLink = screen.getByRole("link", { name: "Месяц" });
    // Button `ghost`: hover tint-fill + focus ring (the segment affordance).
    expect(monthLink.className).toContain("hover:bg-tint");
    expect(monthLink.className).toContain("focus-visible:shadow-focus");
    // NOT the Link primitive's hover-underline (wrong for a segmented toggle).
    expect(monthLink.className).not.toContain("hover:underline");
  });
});
