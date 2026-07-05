import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";

afterEach(cleanup);

/**
 * Skeleton — a livePulse shimmer placeholder block. Decorative loading state:
 * hidden from the a11y tree, muted fill, pulsing animation (neutralised under
 * prefers-reduced-motion by the layer-1 base reset).
 */
describe("Skeleton", () => {
  it("renders a decorative, aria-hidden pulsing block", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el.className).toMatch(/animate-pulse/);
    expect(el.className).toMatch(/bg-muted/);
  });

  it("merges caller className and uses no arbitrary values in its base", () => {
    const { container } = render(<Skeleton className="h-8" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/h-8/);
    expect(el.className).not.toMatch(/\[#/);
  });
});
