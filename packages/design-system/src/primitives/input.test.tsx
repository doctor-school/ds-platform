import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Input } from "./input";

afterEach(cleanup);

/**
 * Neo-brutalist input contract (#512, canvas 8cc2f39a). The field is a hard
 * 2px-bordered slab with a square corner (`--input-radius` is 0), a token focus
 * treatment (a blue.300 `border-ring` + the shared `interactiveBase` ring), and
 * the invalid state carried by a destructive border + a faint danger tint. The
 * success affordance is a token-driven `data-[success]` hook so a valid field can
 * read green. These pin the class contract jsdom can assert; the rendered look is
 * proven on the live stand.
 */
describe("Input neo-brutalist contract", () => {
  it("is a square 2px-bordered slab with a token focus border + ring", () => {
    render(<Input aria-label="sample" data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    expect(inp).toHaveClass("rounded-none", "border-2", "border-input");
    // Focus paints a blue.300 border (the #6BB1F7 ring token) on top of the
    // shared interactiveBase focus ring.
    expect(inp).toHaveClass("focus-visible:border-ring");
  });

  it("error: destructive border + faint danger tint + destructive focus ring", () => {
    render(<Input aria-invalid aria-label="err" data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    expect(inp).toHaveClass(
      "aria-invalid:border-destructive",
      "aria-invalid:bg-destructive/10",
      "aria-invalid:focus-visible:ring-destructive",
    );
  });

  it("success: a token-driven data-[success] hook reads green", () => {
    render(<Input data-success aria-label="ok" data-testid="inp" />);
    const inp = screen.getByTestId("inp");
    expect(inp).toHaveClass("data-[success]:border-success");
  });
});
