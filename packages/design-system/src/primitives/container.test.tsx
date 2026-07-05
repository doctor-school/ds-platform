import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Container, containerVariants } from "./container";

afterEach(cleanup);

/**
 * Contract harness for the Container layout primitive (#514, canvas §09). The
 * rendered gutter/width is CSS proven on the live dev-stand at both breakpoints;
 * this pins the token-wiring half jsdom can assert deterministically — the
 * variant→max-width mapping, the responsive gutter classes, margin-auto, and the
 * `asChild` slot — so a bespoke value or a dropped `desktop:` swap is a red test.
 */
describe("Container width variants", () => {
  it("defaults to the content (1104) reading column", () => {
    render(<Container>body</Container>);
    const el = screen.getByText("body");
    expect(el).toHaveAttribute("data-variant", "content");
    expect(el.className).toMatch(/max-w-\(--layout-container-content\)/);
  });

  it("caps at the calendar (1240) width on the calendar variant", () => {
    const cls = containerVariants({ variant: "calendar" });
    expect(cls).toMatch(/max-w-\(--layout-container-calendar\)/);
    expect(cls).not.toMatch(/max-w-\(--layout-container-content\)/);
  });
});

describe("Container responsive gutter + centring", () => {
  it("centres with margin-auto and fills the available width", () => {
    const cls = containerVariants({});
    expect(cls).toMatch(/\bmx-auto\b/);
    expect(cls).toMatch(/\bw-full\b/);
  });

  it("uses the fixed mobile gutter by default and swaps to the fluid gutter on desktop", () => {
    const cls = containerVariants({});
    // Mobile-first: the fixed 16px gutter is unconditional…
    expect(cls).toMatch(/px-\(--layout-gutter-mobile\)/);
    // …and the fluid clamp gutter engages at the `desktop` (901px) breakpoint.
    expect(cls).toMatch(/desktop:px-\(--layout-gutter\)/);
  });
});

describe("Container asChild", () => {
  it("renders as the single child element (no wrapper div) when asChild", () => {
    render(
      <Container asChild variant="calendar">
        <main>page</main>
      </Container>,
    );
    const el = screen.getByText("page");
    expect(el.tagName).toBe("MAIN");
    expect(el).toHaveAttribute("data-slot", "container");
    expect(el.className).toMatch(/max-w-\(--layout-container-calendar\)/);
  });
});
