import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge } from "./badge";

afterEach(cleanup);

/**
 * Neo-brutalist badge (#513, source §05). `live` = flat danger-red fill with a
 * pulsing white dot; `label`/`speaker` = the pale tint tag. Token-only, both
 * themes; jsdom pins the class contract and the decorative-dot a11y.
 */
describe("Badge — live variant (#513)", () => {
  it("fills the invariant live red with white micro-label copy", () => {
    render(<Badge variant="live">В эфире</Badge>);
    const badge = screen.getByText("В эфире");
    expect(badge).toHaveClass(
      "bg-live",
      "text-live-foreground",
      "text-2xs",
      "font-extrabold",
      "uppercase",
      "tracking-micro",
    );
    // Square tag — only the dot is round.
    expect(badge.className).not.toMatch(/\brounded-/);
  });

  it("renders a decorative, pulsing round dot hidden from the a11y tree", () => {
    const { container } = render(<Badge variant="live">В эфире</Badge>);
    const dot = container.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass("animate-live-pulse", "rounded-full", "bg-live-foreground");
  });
});

describe("Badge — label / speaker variant (#513)", () => {
  it("uses the pale tint surface with tint-foreground copy and no dot", () => {
    const { container } = render(<Badge variant="speaker">Спикер</Badge>);
    const badge = screen.getByText("Спикер");
    expect(badge).toHaveClass("bg-tint", "text-tint-foreground", "text-2xs", "uppercase");
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("label and speaker share one visual (tint tag)", () => {
    const { container: a } = render(<Badge variant="label">Метка</Badge>);
    const { container: b } = render(<Badge variant="speaker">Спикер</Badge>);
    const clsA = a.firstElementChild?.className ?? "";
    const clsB = b.firstElementChild?.className ?? "";
    expect(clsA).toContain("bg-tint");
    expect(clsB).toContain("bg-tint");
  });
});
