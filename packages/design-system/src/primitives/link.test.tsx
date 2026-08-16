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
    // Accessible brand link colour: primary-action (blue.700, 8.14:1 on white) —
    // NOT primary/blue.500 (~3.3:1, fails the axe scan).
    expect(cls).toMatch(/text-primary-action/);
    expect(cls).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(cls).toMatch(/hover:underline/);
    expect(cls).toMatch(/underline-offset-4/);
    expect(cls).toMatch(/focus-visible:shadow-focus/);
    expect(cls).toMatch(/active:text-primary-action\/80/);
    // disabled dim via aria-disabled (anchors have no native :disabled).
    expect(cls).toMatch(/aria-disabled:opacity-50/);
    // No RESTING underline class on the standalone variant.
    expect(cls).not.toMatch(/(?:^|\s)underline(?:\s|$)/);
  });

  it("inline: keeps a resting underline for in-body links", () => {
    const cls = linkVariants({ variant: "inline" });
    expect(cls).toMatch(/(?:^|\s)underline(?:\s|$)/);
  });

  it("EARS-4: when an inline link sits on a primary surface, the system shall keep every interaction state readable", () => {
    const cls = linkVariants({ variant: "inline", tone: "on-primary" });

    expect(cls).toMatch(/(?:^|\s)text-primary-surface-foreground(?:\s|$)/);
    expect(cls).toMatch(/hover:underline/);
    expect(cls).toMatch(/active:text-primary-surface-muted/);
    expect(cls).toMatch(/focus-visible:shadow-focus/);
    expect(cls).not.toMatch(/(?:^|\s)text-primary-action(?:\s|$)/);
  });
});

describe("Link rendering + routing", () => {
  it("renders a styled anchor carrying its href and hover/focus classes", () => {
    render(<Link href="/login">Sign in</Link>);
    const link = screen.getByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveClass("text-primary-action", "hover:underline");
    expect(link).toHaveClass("focus-visible:shadow-focus");
  });

  it("EARS-4: applies the on-primary tone to the anchor without leaking the variant prop", () => {
    render(
      <Link href="/privacy" variant="inline" tone="on-primary">
        Privacy policy
      </Link>,
    );

    const link = screen.getByRole("link", { name: "Privacy policy" });
    expect(link).toHaveClass(
      "text-primary-surface-foreground",
      "active:text-primary-surface-muted",
      "hover:underline",
      "focus-visible:shadow-focus",
    );
    expect(link).not.toHaveAttribute("tone");
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
    expect(link).toHaveClass("text-primary-action", "hover:underline");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("forwards a custom className while keeping the variant classes", () => {
    render(
      <Link href="/x" className="w-full">
        X
      </Link>,
    );
    const link = screen.getByRole("link", { name: "X" });
    expect(link).toHaveClass("w-full", "text-primary-action");
  });
});
