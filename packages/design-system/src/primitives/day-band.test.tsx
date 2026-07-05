import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DayBand } from "./day-band";

afterEach(cleanup);

/**
 * DayBand — a full-bleed section label plate used to head a day in the webinars
 * schedule. Renders as a heading by default (semantic section label) with an
 * UPPERCASE micro-label plate on the primary surface.
 */
describe("DayBand", () => {
  it("renders its label as a level-2 heading by default", () => {
    render(<DayBand>Day 1 · 17 July</DayBand>);
    const heading = screen.getByRole("heading", { level: 2, name: /Day 1/ });
    expect(heading).toBeInTheDocument();
  });

  it("honours a custom heading level via `as`", () => {
    render(<DayBand as="h3">Day 2</DayBand>);
    expect(
      screen.getByRole("heading", { level: 3, name: "Day 2" }),
    ).toBeInTheDocument();
  });

  it("is an uppercase plate on the primary surface, no arbitrary values", () => {
    const { container } = render(<DayBand>Day 1</DayBand>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toMatch(/uppercase/);
    expect(cls).toMatch(/bg-primary-surface/);
    expect(cls).not.toMatch(/\[#/);
  });
});
