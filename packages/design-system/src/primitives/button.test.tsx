import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, buttonVariants } from "./button";

afterEach(cleanup);

/**
 * Neo-brutalist language contract (#512, canvas 8cc2f39a). Every button is a hard
 * bordered slab with a token-driven offset shadow (`shadow-md` = `4px 4px 0`), a
 * square corner (`rounded-none` — `--button-radius` is 0), and bold text; it
 * "presses into the page" on interaction — hover nudges it toward the shadow by
 * 2px and shrinks the shadow, pressed nudges 4px and drops the shadow to 0;
 * disabled loses the shadow and dims. These pin the visual contract so a
 * regression to the pre-511 soft look can't merge silently.
 */
describe("Button neo-brutalist offset-shadow contract", () => {
  it("default (primary): square, offset shadow, bold, press-motion + focus/disabled", () => {
    const cls = buttonVariants({ variant: "default" });
    expect(cls).toMatch(/rounded-none/);
    expect(cls).toMatch(/border-2/);
    expect(cls).toMatch(/font-bold/);
    // resting offset shadow (4px) → hover shrinks to 2px → pressed drops to 0.
    expect(cls).toMatch(/shadow-md/);
    expect(cls).toMatch(/hover:translate-x-0\.5/);
    expect(cls).toMatch(/hover:shadow-base/);
    expect(cls).toMatch(/active:translate-x-1/);
    expect(cls).toMatch(/active:shadow-none/);
    // disabled: no shadow + the .4 dim, and a visible keyboard focus (interactiveBase).
    expect(cls).toMatch(/disabled:shadow-none/);
    expect(cls).toMatch(/disabled:opacity-40/);
    expect(cls).toMatch(/focus-visible:/);
  });

  it("ghost carries the same offset-shadow treatment (issue: primary / ghost)", () => {
    const cls = buttonVariants({ variant: "ghost" });
    expect(cls).toMatch(/shadow-md/);
    expect(cls).toMatch(/active:shadow-none/);
    expect(cls).toMatch(/hover:/);
  });

  /**
   * `secondary` stays an enabled, clickable action (the #227/#267 owner finding):
   * in the neo-brutalist language every button is bordered, so the old
   * "borderless chip reads as disabled" defect cannot recur — assert the hard
   * border + press feedback.
   */
  it("secondary + outline are hard-bordered slabs with press feedback", () => {
    for (const variant of ["secondary", "outline"] as const) {
      const cls = buttonVariants({ variant });
      expect(cls).toMatch(/border-2/);
      expect(cls).toMatch(/shadow-md/);
      expect(cls).toMatch(/hover:/);
      expect(cls).toMatch(/active:/);
    }
  });

  it("link variant is a bare text link — no border frame, no offset shadow", () => {
    const cls = buttonVariants({ variant: "link" });
    expect(cls).toMatch(/border-transparent/);
    expect(cls).toMatch(/shadow-none/);
    expect(cls).toMatch(/text-primary-action/);
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
