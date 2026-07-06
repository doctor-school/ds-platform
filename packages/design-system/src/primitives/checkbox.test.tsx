import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

afterEach(cleanup);

/**
 * Neo-brutalist checkbox (#513, source §07). A real native checkbox (keyboard +
 * focus native) with a styled 22×22 box: 2px border, ink fill + ✓ on check,
 * hairline/muted when disabled. The 3px focus ring rides the box via
 * `peer-focus-visible`. Token-only, both themes.
 */
describe("Checkbox — real a11y (#513)", () => {
  it("exposes a real checkbox that toggles by click and keyboard", async () => {
    const user = userEvent.setup();
    render(<Checkbox>Согласен</Checkbox>);
    const box = screen.getByRole("checkbox", { name: "Согласен" });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    render(<Checkbox disabled>Согласен</Checkbox>);
    const box = screen.getByRole("checkbox", { name: "Согласен" });
    await user.click(box);
    expect(box).not.toBeChecked();
  });
});

describe("Checkbox — token-class contract (#513)", () => {
  it("renders a square 22px box, 2px border, ink fill on check, focus ring", () => {
    const { container } = render(<Checkbox aria-label="x" />);
    const visual = container.querySelector('[aria-hidden="true"]');
    expect(visual).not.toBeNull();
    expect(visual).toHaveClass(
      "size-5.5",
      "border-2",
      "border-border",
      "bg-card",
      "peer-checked:bg-primary-action",
      "peer-checked:border-primary-action",
      "peer-focus-visible:shadow-focus",
      "peer-disabled:border-hairline",
      "peer-disabled:bg-muted",
    );
    expect(visual?.className).not.toMatch(/\brounded-/);
    // The native control is the real focus/keyboard target (visually hidden).
    const input = container.querySelector('input[type="checkbox"]');
    expect(input).toHaveClass("peer", "sr-only");
  });
});
