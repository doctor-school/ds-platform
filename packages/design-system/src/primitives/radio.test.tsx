import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RadioGroup, RadioGroupItem } from "./radio";

afterEach(cleanup);

/**
 * RadioGroup / RadioGroupItem (Radix) — off / on. Radix supplies the radiogroup
 * roving-focus + arrow-key selection; these tests pin the role wiring, the
 * selection contract, and the token-only on-state fill.
 */
function Group() {
  return (
    <RadioGroup aria-label="Plan" defaultValue="a">
      <RadioGroupItem value="a" aria-label="Plan A" />
      <RadioGroupItem value="b" aria-label="Plan B" />
    </RadioGroup>
  );
}

describe("RadioGroup", () => {
  it("renders a radiogroup of radios with one checked", () => {
    render(<Group />);
    expect(screen.getByRole("radiogroup", { name: "Plan" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[1]).toHaveAttribute("aria-checked", "false");
  });

  it("selects a radio on click and fires onValueChange", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Plan" onValueChange={onValueChange}>
        <RadioGroupItem value="a" aria-label="Plan A" />
        <RadioGroupItem value="b" aria-label="Plan B" />
      </RadioGroup>,
    );
    await user.click(screen.getByRole("radio", { name: "Plan B" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
  });

  it("the selected dot is shown only on the checked item, focus ring present, no arbitrary values", () => {
    render(<Group />);
    const radios = screen.getAllByRole("radio");
    const checked = radios[0]!;
    const unchecked = radios[1]!;
    expect(checked.querySelector("span")).not.toBeNull();
    expect(unchecked.querySelector("span")).toBeNull();
    expect(checked.className).toMatch(/focus-visible:ring/);
    expect(checked.className).not.toMatch(/\[#/);
  });
});
