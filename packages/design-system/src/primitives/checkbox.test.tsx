import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { Checkbox } from "./checkbox";

afterEach(cleanup);

/**
 * Neo-brutalist checkbox (#513, source §07). A real native checkbox (keyboard +
 * focus native) with a styled 22×22 box: 2px border, ink fill + ✓ on check,
 * hairline/muted when disabled. The 3px focus ring rides the box via
 * `peer-focus-visible`. Token-only, both themes.
 */
describe("Checkbox — real a11y (#513)", () => {
  it("exposes a real checkbox that toggles by click and keyboard", async () => {
    const user = userEvent.setup();
    render(<Checkbox>Согласен</Checkbox>);
    const box = screen.getByRole("checkbox", { name: "Согласен" });
    expect(box).not.toBeChecked();
    await user.click(box);
    expect(box).toBeChecked();
    box.focus();
    await user.keyboard(" ");
    expect(box).not.toBeChecked();
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    render(<Checkbox disabled>Согласен</Checkbox>);
    const box = screen.getByRole("checkbox", { name: "Согласен" });
    await user.click(box);
    expect(box).not.toBeChecked();
  });
});

describe("Checkbox — token-class contract (#513)", () => {
  it("renders a square 22px box, 2px border, ink fill on check, focus ring", () => {
    const { container } = render(<Checkbox aria-label="x" />);
    const visual = container.querySelector('[aria-hidden="true"]');
    expect(visual).not.toBeNull();
    expect(visual).toHaveClass(
      "size-5.5",
      "border-2",
      "border-border",
      "bg-card",
      "peer-checked:bg-primary-action",
      "peer-checked:border-primary-action",
      "peer-focus-visible:shadow-focus",
      "peer-disabled:border-hairline",
      "peer-disabled:bg-muted",
    );
    expect(visual?.className).not.toMatch(/\brounded-/);
    // The native control is the real focus/keyboard target (visually hidden).
    const input = container.querySelector('input[type="checkbox"]');
    expect(input).toHaveClass("peer", "sr-only");
  });

  it("EARS-5: when the label sits on a primary surface, the system shall use the readable on-primary tone", () => {
    render(<Checkbox tone="on-primary">Согласен</Checkbox>);

    const label = screen.getByText("Согласен");
    expect(label).toHaveClass(
      "text-primary-surface-foreground",
      "peer-disabled:text-primary-surface-foreground",
    );
    expect(label).not.toHaveClass(
      "text-foreground",
      "peer-disabled:text-muted-2",
    );
  });

  it("keeps the box square when the label wraps onto several lines", () => {
    // #2027: the box is a flex CHILD of the label. Without `shrink-0` a long,
    // wrapping consent statement steals width from it and the 22x22 square
    // renders as a rectangle — the registration door's consent rows wrap by
    // design, so the box has to refuse to shrink.
    const { container } = render(
      <Checkbox className="items-start">
        <span>
          Согласие на передачу данных партнёрам платформы. Это условие
          бесплатного для врача обучения: без согласия часть материалов
          недоступна и регистрация невозможна.
        </span>
      </Checkbox>,
    );

    const visual = container.querySelector('span[aria-hidden="true"]');
    expect(visual).toHaveClass("size-5.5", "shrink-0");
  });

  it("keeps the default label tone unchanged", () => {
    render(<Checkbox>Согласен</Checkbox>);

    expect(screen.getByText("Согласен")).toHaveClass(
      "text-foreground",
      "peer-disabled:text-muted-2",
    );
  });

  it("#2027: the statement reads at the canvas weight, 12px clear of the box", () => {
    // Owner Stage-B 2026-09-22: parity is the RENDERING. The canvas
    // (`design-source/auth.dc.html:191/199/221`) sets every checkbox statement
    // at 13.5px/700 on a 1.4 line, 12px clear of the box.
    const { container } = render(<Checkbox>Согласен</Checkbox>);

    expect(screen.getByText("Согласен")).toHaveClass(
      "text-sm",
      "font-bold",
      "leading-snug",
    );
    expect(container.querySelector("label")).toHaveClass("gap-3");
  });

  it("#2027: an invalid control carries the reported-unmet border on the box itself", () => {
    // Canvas 497 — while the unmet statement is being reported the BOX turns
    // danger, and it stays danger over the checked fill border.
    const { container } = render(<Checkbox aria-invalid aria-label="x" />);

    const visual = container.querySelector('span[aria-hidden="true"]');
    expect(visual).toHaveClass("border-destructive-text");
    expect(visual).not.toHaveClass("border-border");
    expect(visual?.className).not.toMatch(/peer-checked:border-/);
  });

  it("#2027: a valid control keeps the resting and checked borders", () => {
    const { container } = render(<Checkbox aria-label="x" />);

    const visual = container.querySelector('span[aria-hidden="true"]');
    expect(visual).toHaveClass("border-border", "peer-checked:border-primary-action");
    expect(visual).not.toHaveClass("border-destructive-text");
  });
});
