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

/**
 * The storefront-chrome axes (#2180). Every one of these looks used to be a
 * `className` on the shared shell's call site, which forked the primitive for
 * that surface only and left `local/no-primitive-style-override` blind to the
 * package that introduced it. Values are unchanged — they MOVED — and each is
 * backed by `design-source/ds-shell.dc.html`.
 */
describe("Link storefront-chrome axes (#2180, canvas ds-shell.dc.html)", () => {
  it("008 EARS-2: the desktop nav tone is the canvas on-navy tier with the opacity press step, not the brand ink", () => {
    const cls = linkVariants({ tone: "header-nav" });
    expect(cls).toMatch(/(?:^|\s)text-header-foreground(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)no-underline(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)opacity-80(?:\s|$)/);
    expect(cls).toMatch(/active:text-header-foreground/);
    expect(cls).toMatch(/active:opacity-60/);
    expect(cls).toMatch(/(?:^|\s)font-bold(?:\s|$)/);
    // The DS press tint IS the band colour — it would paint the label invisible.
    expect(cls).not.toMatch(/text-primary-action/);
  });

  it("008 EARS-2: the wrapper variant suppresses the hover underline for a link around the wordmark", () => {
    const cls = linkVariants({ variant: "wrapper" });
    expect(cls).toMatch(/hover:no-underline/);
    expect(cls).not.toMatch(/(?:^|\s)underline(?:\s|$)/);
  });

  it("008 EARS-11: the mobile nav row is a full-bleed target in page ink with a surface tint on hover", () => {
    const cls = linkVariants({
      tone: "neutral",
      variant: "mobile-nav-row",
      size: "sm",
    });
    expect(cls).toMatch(/(?:^|\s)px-4(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)py-3(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)text-sm(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)font-bold(?:\s|$)/);
    expect(cls).toMatch(/(?:^|\s)text-foreground(?:\s|$)/);
    expect(cls).toMatch(/hover:bg-muted/);
    expect(cls).toMatch(/hover:no-underline/);
  });

  it("008 EARS-14 · 017 EARS-12: the footer link is the sm step, and the cross link adds the canvas 800 weight", () => {
    const footer = linkVariants({ size: "sm" });
    expect(footer).toMatch(/(?:^|\s)text-sm(?:\s|$)/);
    expect(footer).toMatch(/(?:^|\s)font-bold(?:\s|$)/);
    expect(footer).not.toMatch(/font-extrabold/);

    const cross = linkVariants({ variant: "inline", size: "sm", weight: "strong" });
    expect(cross).toMatch(/(?:^|\s)underline(?:\s|$)/);
    expect(cross).toMatch(/(?:^|\s)text-sm(?:\s|$)/);
    expect(cross).toMatch(/(?:^|\s)font-extrabold(?:\s|$)/);
    expect(cross).not.toMatch(/(?:^|\s)font-bold(?:\s|$)/);
  });

  it("008 EARS-2: the chrome axes never leak onto the anchor as DOM attributes", () => {
    render(
      <Link href="/events" tone="header-nav" size="sm" weight="strong">
        Events
      </Link>,
    );
    const link = screen.getByRole("link", { name: "Events" });
    expect(link).toHaveClass("text-header-foreground", "text-sm", "font-extrabold");
    for (const attr of ["tone", "size", "weight", "variant"]) {
      expect(link).not.toHaveAttribute(attr);
    }
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
