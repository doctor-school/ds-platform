import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Link, linkVariants } from "./link";

afterEach(cleanup);

/**
 * `Link` primitive contract (ADR-0013 §7 `link` row, #324). The visual states
 * (hover-underline, focus ring, active tint) are CSS proven on the live stand;
 * this pins the class contract + the routing/`asChild` behaviour jsdom can assert
 * deterministically: a standalone nav link has NO resting underline but carries
 * the hover-underline, focus ring, and disabled dim, and `asChild` lets it carry
 * an `href` (route) through a wrapped anchor.
 */
describe("Link variant classes", () => {
  it("standalone (default): brand colour, hover-underline + focus ring, no resting underline", () => {
    const cls = linkVariants();
    expect(cls).toMatch(/text-primary/);
    expect(cls).toMatch(/hover:underline/);
    expect(cls).toMatch(/underline-offset-4/);
    expect(cls).toMatch(/focus-visible:ring-2/);
    expect(cls).toMatch(/active:text-primary\/80/);
    // disabled dim via aria-disabled (anchors have no native :disabled).
    expect(cls).toMatch(/aria-disabled:opacity-50/);
    // No RESTING underline class on the standalone variant.
    expect(cls).not.toMatch(/(?:^|\s)underline(?:\s|$)/);
  });

  it("inline: keeps a resting underline for in-body links", () => {
    const cls = linkVariants({ variant: "inline" });
    expect(cls).toMatch(/(?:^|\s)underline(?:\s|$)/);
  });
});

describe("Link rendering + routing", () => {
  it("renders a styled anchor carrying its href and hover/focus classes", () => {
    render(<Link href="/login">Sign in</Link>);
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveClass("text-primary", "hover:underline");
    expect(link).toHaveClass("focus-visible:ring-2");
  });

  it("asChild composes onto a wrapped anchor (next/link route carrier) without adding a second element", () => {
    render(
      <Link asChild>
        {/* Stand-in for next/link — a plain routing anchor. */}
        <a href="/register" data-testid="next-link">
          Create account
        </a>
      </Link>,
    );
    const link = screen.getByTestId("next-link");
    // The wrapped anchor IS the rendered element (Slot merges, no extra <a>).
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/register");
    // Interaction states come from the primitive, applied onto the wrapped anchor.
    expect(link).toHaveClass("text-primary", "hover:underline");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("forwards a custom className while keeping the variant classes", () => {
    render(
      <Link href="/x" className="w-full">
        X
      </Link>,
    );
    const link = screen.getByRole("link", { name: "X" });
    expect(link).toHaveClass("w-full", "text-primary");
  });
});
