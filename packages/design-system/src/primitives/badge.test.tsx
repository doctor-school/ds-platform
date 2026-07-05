import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge, badgeVariants } from "./badge";

afterEach(cleanup);

/**
 * Badge — a non-interactive status/label token. Two variants matter for the
 * webinars surfaces: `live` (destructive red, UPPERCASE, a pulsing dot) and the
 * tonal `label` / `speaker` tint. Tests pin the variant classes + the live dot's
 * a11y (decorative, hidden) and the token-only styling.
 */
describe("Badge", () => {
  it("renders its children as text content", () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("live variant is destructive-toned, uppercase, and carries a decorative pulsing dot", () => {
    const { container } = render(<Badge variant="live">Live</Badge>);
    const badge = container.firstChild as HTMLElement;
    expect(badge.className).toMatch(/uppercase/);
    expect(badge.className).toMatch(/border-destructive/);
    // the pulsing dot is decorative — hidden from the a11y tree, animated
    const dot = badge.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/animate-pulse/);
    expect(dot?.className).toMatch(/bg-destructive/);
  });

  it("label/speaker variants use the tint surface", () => {
    expect(badgeVariants({ variant: "label" })).toMatch(/bg-tint/);
    expect(badgeVariants({ variant: "speaker" })).toMatch(/bg-tint/);
  });

  it("uses no arbitrary Tailwind values (tokens-only)", () => {
    for (const variant of ["live", "label", "speaker"] as const) {
      expect(badgeVariants({ variant })).not.toMatch(/\[#/);
    }
  });
});
