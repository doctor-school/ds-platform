import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

afterEach(cleanup);

/**
 * Checkbox (Radix) — off / on (btn-bg + ✓) / disabled. Register consent (#517)
 * depends on it, so the a11y contract (role=checkbox, aria-checked, keyboard
 * toggle, disabled) is pinned here; the neo-brutalist look is proven live.
 */
describe("Checkbox", () => {
  it("exposes role=checkbox, unchecked by default", () => {
    render(<Checkbox aria-label="I agree" />);
    const box = screen.getByRole("checkbox", { name: "I agree" });
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("reflects the checked state and shows the ✓ indicator only when checked", () => {
    const { rerender } = render(<Checkbox aria-label="Consent" checked={false} />);
    let box = screen.getByRole("checkbox", { name: "Consent" });
    expect(box.querySelector("svg")).toBeNull();
    rerender(<Checkbox aria-label="Consent" checked onCheckedChange={() => {}} />);
    box = screen.getByRole("checkbox", { name: "Consent" });
    expect(box).toHaveAttribute("aria-checked", "true");
    const check = box.querySelector("svg");
    expect(check).not.toBeNull();
    expect(check).toHaveAttribute("aria-hidden", "true");
  });

  it("toggles on click and fires onCheckedChange", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Toggle" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Toggle" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("is disabled and non-interactive when `disabled`", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Checkbox aria-label="Off" disabled onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByRole("checkbox", { name: "Off" });
    expect(box).toBeDisabled();
    await user.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("checked fill is the primary-action token, focus ring present, no arbitrary values", () => {
    const { container } = render(<Checkbox aria-label="x" />);
    const cls = (container.querySelector('[role="checkbox"]') as HTMLElement)
      .className;
    expect(cls).toMatch(/data-\[state=checked\]:bg-primary-action/);
    expect(cls).toMatch(/focus-visible:ring/);
    expect(cls).not.toMatch(/\[#/);
  });
});
