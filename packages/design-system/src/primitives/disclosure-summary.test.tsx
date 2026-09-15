import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { buttonVariants } from "./button";
import { DisclosureSummary } from "./disclosure-summary";

afterEach(cleanup);

/**
 * `DisclosureSummary` (#2180) — the `≡` control of the storefront mobile nav is
 * the SAME on-header chip as the guest/profile control, at the glyph type size
 * (`design-source/ds-shell.dc.html` line 43). It is a primitive rather than a raw
 * `<summary>` hand-assembled in the shell, so the chip's surface, cast, press
 * chain and 44px box arrive from ONE definition on both storefronts.
 */
describe("DisclosureSummary (#2180, canvas ds-shell.dc.html line 43)", () => {
  it("008 EARS-11: the disclosure IS the on-header chip at the icon size, class for class", () => {
    render(
      <details>
        <DisclosureSummary aria-label="Menu">
          <span aria-hidden="true">≡</span>
        </DisclosureSummary>
      </details>,
    );
    const summary = screen.getByLabelText("Menu");
    expect(summary.tagName).toBe("SUMMARY");
    const chip = buttonVariants({ variant: "on-primary", size: "icon" })
      .split(" ")
      // The glyph is deliberately larger than the chip's body type, so the
      // primitive's own `text-xl` replaces that one class (tailwind-merge).
      .filter((cls) => !/^text-(?:xs|sm|base|lg|xl)$/.test(cls));
    for (const cls of chip) {
      expect(summary.className.split(" ")).toContain(cls);
    }
  });

  it("008 EARS-11: it carries the pointer cursor, the suppressed native marker and the glyph step", () => {
    render(
      <details>
        <DisclosureSummary aria-label="Menu">≡</DisclosureSummary>
      </details>,
    );
    const summary = screen.getByLabelText("Menu");
    expect(summary).toHaveClass(
      "cursor-pointer",
      "list-none",
      "text-xl",
      "[&::-webkit-details-marker]:hidden",
    );
  });

  it("008 EARS-11: a positional utility from the call site is kept alongside the chip", () => {
    render(
      <details>
        <DisclosureSummary aria-label="Menu" className="ml-auto">
          ≡
        </DisclosureSummary>
      </details>,
    );
    expect(screen.getByLabelText("Menu")).toHaveClass("ml-auto", "text-xl");
  });
});
