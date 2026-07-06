import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Switch } from "./switch";

afterEach(cleanup);

/**
 * Neo-brutalist switch (#513, source §07). A real native checkbox exposed as
 * `role="switch"`: 46×26 square track, 16×16 knob; off = hairline track + card
 * knob (left), on = action fill + light knob (right). Token-only, both themes.
 */
describe("Switch — real a11y (#513)", () => {
  it("is a keyboard-operable switch reflecting on/off", async () => {
    const user = userEvent.setup();
    render(<Switch>Напоминания</Switch>);
    const sw = screen.getByRole("switch", { name: "Напоминания" });
    expect(sw).not.toBeChecked();
    await user.click(sw);
    expect(sw).toBeChecked();
    sw.focus();
    await user.keyboard(" ");
    expect(sw).not.toBeChecked();
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    render(<Switch disabled>Напоминания</Switch>);
    const sw = screen.getByRole("switch", { name: "Напоминания" });
    await user.click(sw);
    expect(sw).not.toBeChecked();
  });
});

describe("Switch — token-class contract (#513)", () => {
  it("renders a 46×26 square track and a 16px knob that slides on check", () => {
    const { container } = render(<Switch aria-label="x" />);
    const input = container.querySelector('input[role="switch"]');
    expect(input).toHaveClass("peer", "sr-only");
    const track = container.querySelector('[aria-hidden="true"]');
    expect(track).toHaveClass(
      "w-11.5",
      "h-6.5",
      "border-2",
      "border-border",
      "bg-hairline",
      "peer-checked:bg-primary-action",
      "peer-checked:border-primary-action",
      "peer-focus-visible:shadow-focus",
      "peer-checked:justify-end",
    );
    expect(track?.className).not.toMatch(/\brounded-/);
    // The knob's on-state is driven from the track (child-targeting variant).
    expect(track?.className).toContain("peer-checked:[&>span]:bg-primary-foreground");
    const knob = track?.querySelector("span");
    expect(knob).toHaveClass("size-4", "bg-card", "border-2", "border-border");
  });
});
