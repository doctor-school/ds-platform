import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Card } from "./card";

afterEach(cleanup);

/**
 * Neo-brutalist card contract (#512): a hard 2px-bordered, square panel that
 * casts the token offset shadow (`shadow-md` = `4px 4px 0`), replacing the
 * pre-511 soft `rounded-xl` + blurred `shadow`.
 */
describe("Card neo-brutalist contract", () => {
  it("is a square 2px-bordered panel with the token offset shadow", () => {
    render(<Card data-testid="card">body</Card>);
    const card = screen.getByTestId("card");
    expect(card).toHaveClass("rounded-none", "border-2", "border-border", "shadow-md");
    expect(card).not.toHaveClass("rounded-xl");
  });
});
