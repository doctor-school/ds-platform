import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";

afterEach(cleanup);

/**
 * Neo-brutalist loading skeleton (#513, source §08): a hairline-filled block that
 * pulses (`animate-skeleton-pulse`, 1.4s). Compose size freely. Decorative →
 * hidden from the a11y tree. Token-only, both themes.
 */
describe("Skeleton (#513)", () => {
  it("is a hairline pulsing block, hidden from the a11y tree, composable via className", () => {
    const { container } = render(<Skeleton className="size-14" data-testid="s" />);
    const el = container.querySelector('[data-testid="s"]');
    expect(el).toHaveClass("bg-hairline", "animate-skeleton-pulse", "size-14");
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el?.className).not.toMatch(/\brounded-/);
  });
});
