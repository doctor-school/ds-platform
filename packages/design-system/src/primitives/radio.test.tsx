import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Radio } from "./radio";

afterEach(cleanup);

/**
 * Neo-brutalist radio (#513, source §07). A real native radio; the ONLY rounded
 * element in the language (`rounded-full`). 22×22, 2px border, inner 10px dot on
 * check. Token-only, both themes.
 */
describe("Radio — real a11y + single-select (#513)", () => {
  it("selects within a native radio group by click and arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Radio name="dir" value="a">
          Кардиология
        </Radio>
        <Radio name="dir" value="b">
          Пульмонология
        </Radio>
      </>,
    );
    const a = screen.getByRole("radio", { name: "Кардиология" });
    const b = screen.getByRole("radio", { name: "Пульмонология" });
    await user.click(a);
    expect(a).toBeChecked();
    expect(b).not.toBeChecked();
    await user.keyboard("{ArrowDown}");
    expect(b).toBeChecked();
    expect(a).not.toBeChecked();
  });
});

describe("Radio — token-class contract (#513)", () => {
  it("is a round 22px box with a round inner dot, 2px border, focus ring", () => {
    const { container } = render(<Radio name="d" value="x" aria-label="x" />);
    const visual = container.querySelector('[aria-hidden="true"]');
    expect(visual).toHaveClass(
      "size-5.5",
      "rounded-full",
      "border-2",
      "border-border",
      "bg-card",
      "peer-checked:border-primary-action",
      "peer-focus-visible:shadow-focus",
    );
    // The inner dot is revealed on check via the visual's child-targeting variant.
    expect(visual?.className).toContain("peer-checked:[&>span]:opacity-100");
    const dot = visual?.querySelector("span");
    expect(dot).toHaveClass("size-2.5", "rounded-full", "bg-primary-action");
    const input = container.querySelector('input[type="radio"]');
    expect(input).toHaveClass("peer", "sr-only");
  });
});
