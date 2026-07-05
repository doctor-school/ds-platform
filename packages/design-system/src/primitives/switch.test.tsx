import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

afterEach(cleanup);

/**
 * Switch (Radix) — off / on. role=switch with aria-checked. Neo-brutalist hard
 * track + square thumb; the on-state track fill is the primary-action token.
 */
describe("Switch", () => {
  it("exposes role=switch, off by default", () => {
    render(<Switch aria-label="Notifications" />);
    const sw = screen.getByRole("switch", { name: "Notifications" });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("reflects the checked state", () => {
    render(
      <Switch aria-label="Notifications" checked onCheckedChange={() => {}} />,
    );
    expect(screen.getByRole("switch", { name: "Notifications" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggles on click and fires onCheckedChange", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Toggle" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole("switch", { name: "Toggle" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("is disabled and non-interactive when `disabled`", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <Switch aria-label="Off" disabled onCheckedChange={onCheckedChange} />,
    );
    const sw = screen.getByRole("switch", { name: "Off" });
    expect(sw).toBeDisabled();
    await user.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("on-state track is primary-action, focus ring present, no arbitrary values", () => {
    const { container } = render(<Switch aria-label="x" />);
    const cls = (container.querySelector('[role="switch"]') as HTMLElement)
      .className;
    expect(cls).toMatch(/data-\[state=checked\]:bg-primary-action/);
    expect(cls).toMatch(/focus-visible:ring/);
    expect(cls).not.toMatch(/\[#/);
  });
});
