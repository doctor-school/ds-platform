import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterChip } from "./filter-chip";

afterEach(cleanup);

/**
 * FilterChip is a toggleable selection chip (Radix Toggle → `aria-pressed`). The
 * neo-brutalist language (#511) gives it a hard 2px border, a tint hover, and the
 * primary-action fill when selected. These tests pin the a11y contract (pressed
 * state, disabled) and the token-only state classes; the rendered look is proven
 * live on the stand.
 */
describe("FilterChip", () => {
  it("exposes a pressed toggle-button role and reflects `pressed`", () => {
    render(<FilterChip pressed>Cardiology</FilterChip>);
    const chip = screen.getByRole("button", { name: "Cardiology" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAttribute("data-state", "on");
  });

  it("is unpressed by default", () => {
    render(<FilterChip>Neurology</FilterChip>);
    const chip = screen.getByRole("button", { name: "Neurology" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip).toHaveAttribute("data-state", "off");
  });

  it("fires onPressedChange when toggled", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(<FilterChip onPressedChange={onPressedChange}>Oncology</FilterChip>);
    await user.click(screen.getByRole("button", { name: "Oncology" }));
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it("is disabled and non-interactive when `disabled`", async () => {
    const user = userEvent.setup();
    const onPressedChange = vi.fn();
    render(
      <FilterChip disabled onPressedChange={onPressedChange}>
        Disabled
      </FilterChip>,
    );
    const chip = screen.getByRole("button", { name: "Disabled" });
    expect(chip).toBeDisabled();
    await user.click(chip);
    expect(onPressedChange).not.toHaveBeenCalled();
  });

  it("carries a hover affordance, a selected fill and a focus ring (token-only)", () => {
    const { container } = render(<FilterChip>Chip</FilterChip>);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toMatch(/hover:/);
    expect(cls).toMatch(/data-\[state=on\]:bg-primary-action/);
    // focus-visible ring via the shared interactiveBase fragment
    expect(cls).toMatch(/focus-visible:ring/);
    // no arbitrary Tailwind values (tokens-only contract)
    expect(cls).not.toMatch(/\[#/);
  });
});
