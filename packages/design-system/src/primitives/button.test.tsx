import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";

afterEach(cleanup);

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
