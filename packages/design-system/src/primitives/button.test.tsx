import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, buttonVariants } from "./button";

afterEach(cleanup);

/**
 * The `secondary` variant must read as an enabled, clickable secondary action,
 * not a disabled chip (#227/#267 owner finding). The borderless light fill looked
 * disabled; the fix gives it a resting border (like `outline`) plus a clear
 * hover/active. This pins the regression: `secondary` carries a border and the
 * hover/active feedback, so it can never silently revert to the borderless look.
 */
describe("Button secondary variant reads as enabled", () => {
  it("carries a resting 2px border + hover/active feedback (not a borderless chip)", () => {
    const cls = buttonVariants({ variant: "secondary" });
    expect(cls).toMatch(/border-2/);
    expect(cls).toMatch(/border-border/);
    expect(cls).toMatch(/hover:/);
    expect(cls).toMatch(/active:/);
  });

  it("matches the bordered weight of the outline variant (both hard 2px bordered)", () => {
    expect(buttonVariants({ variant: "outline" })).toMatch(/border-2/);
    expect(buttonVariants({ variant: "secondary" })).toMatch(/border-2/);
  });
});

/**
 * Neo-brutalist re-skin contract (#512, source `design-source/design-system.dc.html`).
 * The look is CSS proven live on the dev stand; this pins the token-class contract
 * jsdom can assert — square radius-0, a hard 2px border, and the PER-VARIANT offset
 * shadow colour (the brief's fidelity trap): a filled action casts in the INK
 * `shadow-btn`, a bordered surface casts in the SOFT `shadow-ghost`. They differ.
 */
describe("Button neo-brutalist offset-shadow contract (#512)", () => {
  it("primary (default) casts the INK offset shadow and fills the accessible action colour", () => {
    const cls = buttonVariants({ variant: "default" });
    expect(cls).toMatch(/\bshadow-btn\b/);
    expect(cls).toMatch(/hover:shadow-btn-hover/);
    expect(cls).toMatch(/focus-visible:shadow-btn-focus/);
    expect(cls).toMatch(/bg-primary-action/);
    expect(cls).toMatch(/font-extrabold/);
    // Not the generic blue `md` shadow (wrong colour for a filled action).
    expect(cls).not.toMatch(/\bshadow-md\b/);
  });

  it("destructive also casts the INK offset shadow", () => {
    const cls = buttonVariants({ variant: "destructive" });
    expect(cls).toMatch(/\bshadow-btn\b/);
    expect(cls).toMatch(/bg-destructive/);
  });

  it("outline + secondary (bordered surfaces) cast the SOFT offset shadow, not the ink one", () => {
    for (const variant of ["outline", "secondary"] as const) {
      const cls = buttonVariants({ variant });
      expect(cls).toMatch(/\bshadow-ghost\b/);
      expect(cls).toMatch(/focus-visible:shadow-ghost-focus/);
      expect(cls).not.toMatch(/\bshadow-btn\b/);
    }
  });

  it("presses translate INTO the cast and collapse the shadow (hover 2px → press flat)", () => {
    const cls = buttonVariants({ variant: "default" });
    expect(cls).toMatch(/hover:translate-x-0\.5/);
    expect(cls).toMatch(/active:translate-x-1\b/);
    expect(cls).toMatch(/active:shadow-none/);
    // Disabled removes the lift entirely (opacity .4, no shadow) — source §06.
    expect(cls).toMatch(/disabled:opacity-40/);
    expect(cls).toMatch(/disabled:shadow-none/);
  });

  it("every variant is square (radius 0 — no rounded-* utility in the class set)", () => {
    for (const variant of [
      "default",
      "destructive",
      "outline",
      "secondary",
      "ghost",
      "link",
    ] as const) {
      expect(buttonVariants({ variant })).not.toMatch(/\brounded-/);
    }
  });
});

/**
 * Contract harness for the Button `loading` state (ADR-0013 §7 layer 2, #273).
 * The visual states (hover/active/focus-visible ring) are CSS and are proven on
 * the live dev-stand; this pins the BEHAVIOURAL half of the contract that the
 * loading prop adds — `aria-busy`, the click block, and the spinner presence —
 * which jsdom can assert deterministically.
 */
describe("Button loading state", () => {
  it("sets aria-busy and disables the button while loading", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
  });

  it("renders a spinner that is hidden from the a11y tree", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    const spinner = btn.querySelector("svg");
    expect(spinner).not.toBeNull();
    expect(spinner).toHaveClass("animate-spin");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  it("blocks clicks while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is interactive and announces nothing busy when not loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).not.toHaveAttribute("aria-busy");
    expect(btn.querySelector("svg")).toBeNull();
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("leaves the busy presentation to the call site for asChild (single-child Slot) but still forwards aria-busy", () => {
    render(
      <Button asChild loading>
        <a href="/next">Go</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link).toHaveAttribute("aria-busy", "true");
    // Slot must keep the single child intact — no injected spinner.
    expect(link.querySelector("svg")).toBeNull();
  });
});
