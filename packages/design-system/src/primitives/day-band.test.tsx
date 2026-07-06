import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DayBand } from "./day-band";

afterEach(cleanup);

/**
 * Neo-brutalist day-band (#513, source §05/§09): a full-bleed section plate on the
 * faint `section` surface carrying an uppercase micro-label. Token-only, both themes.
 */
describe("DayBand (#513)", () => {
  it("bands the section surface with extrabold uppercase micro-label ink", () => {
    render(<DayBand>Сегодня — 16 июля</DayBand>);
    const band = screen.getByText("Сегодня — 16 июля");
    expect(band).toHaveClass(
      "bg-section",
      "text-caption",
      "font-extrabold",
      "uppercase",
      "tracking-micro",
      "text-foreground",
    );
    expect(band.className).not.toMatch(/\brounded-/);
  });
});
