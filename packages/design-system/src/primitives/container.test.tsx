import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Container } from "./container";

afterEach(cleanup);

/**
 * §09 «Раскладка и ритм» layout container (source `design-system.dc.html`
 * §09 «Контейнер»/«Брейкпоинты»). Token-only; the rendered responsive behaviour
 * (edge-to-edge ≤900px, capped + centred ≥901px) is proven live on the dev stand.
 * This pins the token-class contract jsdom can assert: centred column, fixed 16px
 * mobile gutter, the clamp gutter + max-width cap gated behind the `layout:`
 * breakpoint variant, and square (radius-0) throughout.
 */
describe("Container (#514) — §09 content column", () => {
  it("centres, uses a fixed 16px mobile gutter and caps to `content` width above the layout breakpoint", () => {
    render(<Container data-testid="c">body</Container>);
    const el = screen.getByTestId("c");
    // Centred full-width column with the fixed 16px mobile gutter.
    expect(el).toHaveClass("mx-auto", "w-full", "px-4");
    // Cap + clamp gutter apply ONLY at/above the `layout` breakpoint (≥901px);
    // below it the column is edge-to-edge (no unconditional max-width).
    expect(el).toHaveClass("layout:max-w-content", "layout:px-gutter");
    expect(el.className).not.toMatch(/(?:^|\s)max-w-/); // no un-gated cap
    // Square — neo-brutalist radius-0.
    expect(el.className).not.toMatch(/\brounded-/);
  });

  it("caps to the wider `calendar` width for calendar surfaces", () => {
    render(
      <Container variant="calendar" data-testid="c">
        cal
      </Container>,
    );
    const el = screen.getByTestId("c");
    expect(el).toHaveClass("layout:max-w-calendar", "layout:px-gutter", "mx-auto");
    expect(el.className).not.toMatch(/layout:max-w-content/);
  });

  it("defaults to the `content` variant and forwards className + props", () => {
    render(
      <Container className="custom-x" id="main-col" data-testid="c">
        x
      </Container>,
    );
    const el = screen.getByTestId("c");
    expect(el).toHaveClass("layout:max-w-content", "custom-x");
    expect(el).toHaveAttribute("id", "main-col");
  });
});
