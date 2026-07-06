import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilterChip, filterChipVariants } from "./filter-chip";

afterEach(cleanup);

/**
 * Neo-brutalist filter chip (#513, fidelity SoT
 * `design-source/design-system.dc.html` §05/§06). The rendered look is proven on
 * the live stand; jsdom pins the token-class contract and the interactive
 * (aria-pressed) semantics — square, hard 2px border, per-state token fills.
 */
describe("FilterChip — token-class contract (#513)", () => {
  it("rests transparent on the pale chip-border with tint-foreground copy (weight 700)", () => {
    const cls = filterChipVariants({ selected: false });
    expect(cls).toMatch(/border-2/);
    expect(cls).toMatch(/border-chip-border/);
    expect(cls).toMatch(/bg-transparent/);
    expect(cls).toMatch(/text-tint-foreground/);
    expect(cls).toMatch(/font-bold/);
    // Hover fills with tint and switches the border to the foreground tone.
    expect(cls).toMatch(/hover:bg-tint/);
    expect(cls).toMatch(/hover:border-tint-foreground/);
  });

  it("selected fills the accessible action colour with weight 800", () => {
    const cls = filterChipVariants({ selected: true });
    expect(cls).toMatch(/bg-primary-action/);
    expect(cls).toMatch(/text-primary-foreground/);
    expect(cls).toMatch(/border-primary-action/);
    expect(cls).toMatch(/font-extrabold/);
  });

  it("is square, carries the flush 3px focus ring, and dims disabled to hairline", () => {
    const base = filterChipVariants({ selected: false });
    expect(base).not.toMatch(/\brounded-/);
    expect(base).toMatch(/focus-visible:shadow-focus/);
    expect(base).toMatch(/disabled:border-hairline/);
    expect(base).toMatch(/disabled:text-muted-2/);
  });
});

describe("FilterChip — interactive (aria-pressed) semantics (#513)", () => {
  it("renders a real button reflecting selection via aria-pressed", () => {
    render(<FilterChip selected>Кардиология</FilterChip>);
    const chip = screen.getByRole("button", { name: "Кардиология", pressed: true });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveAttribute("type", "button");
  });

  it("unselected chip reports aria-pressed=false", () => {
    render(<FilterChip>Кардиология</FilterChip>);
    expect(
      screen.getByRole("button", { name: "Кардиология", pressed: false }),
    ).toBeInTheDocument();
  });

  it("is keyboard-clickable and blocks clicks when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<FilterChip onClick={onClick}>Пульмонология</FilterChip>);
    await user.click(screen.getByRole("button", { name: "Пульмонология" }));
    expect(onClick).toHaveBeenCalledTimes(1);

    rerender(
      <FilterChip onClick={onClick} disabled>
        Пульмонология
      </FilterChip>,
    );
    await user.click(screen.getByRole("button", { name: "Пульмонология" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
