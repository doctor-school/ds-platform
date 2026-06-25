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
  it("carries a resting border + hover/active feedback (not a borderless chip)", () => {
    const cls = buttonVariants({ variant: "secondary" });
    expect(cls).toMatch(/\bborder\b/);
    expect(cls).toMatch(/border-input/);
    expect(cls).toMatch(/hover:/);
    expect(cls).toMatch(/active:/);
  });

  it("matches the bordered weight of the outline variant (both bordered)", () => {
    expect(buttonVariants({ variant: "outline" })).toMatch(/\bborder\b/);
    expect(buttonVariants({ variant: "secondary" })).toMatch(/\bborder\b/);
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
