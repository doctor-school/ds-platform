import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Textarea } from "./textarea";

afterEach(cleanup);

/**
 * 012 EARS-1 (#1283) — the Textarea counter contract.
 *
 * The load-bearing assertion is the TOKEN the over-limit counter uses. Small red
 * text must be `destructive-text` (the AA-safe red TEXT token — `#c81e1e` light,
 * `#e15555` dark), never `destructive` (the FILL token, which is the same dark red
 * in both themes and fails WCAG AA contrast on the dark surface). The showcase
 * `playwright-axe` BLOCK gate caught exactly that: axe `color-contrast`, impact
 * `serious`, on this counter in the dark pane. `FormMessage`/`FormError` already
 * settled the same rule for inline errors, so this keeps one token story for all
 * small destructive text.
 */
describe("012 EARS-1 Textarea — character counter", () => {
  it("012 EARS-1: when the value is within the limit, the counter shall report the remaining budget in the muted token", () => {
    render(
      <Textarea
        aria-label="Описание"
        showCounter
        maxLength={100}
        defaultValue={"x".repeat(40)}
        formatCounter={(remaining) => `осталось ${remaining}`}
      />,
    );
    const counter = screen.getByText("осталось 60");
    expect(counter).toHaveClass("text-muted-foreground");
    expect(counter).toHaveAttribute("aria-live", "polite");
  });

  it("012 EARS-1: when the value exceeds the limit, the counter shall use the AA-safe destructive TEXT token, not the fill token", () => {
    render(
      <Textarea
        aria-label="Описание"
        showCounter
        maxLength={10}
        defaultValue={"x".repeat(13)}
        formatCounter={(remaining) =>
          remaining < 0 ? `превышено на ${Math.abs(remaining)}` : `осталось ${remaining}`
        }
      />,
    );
    const counter = screen.getByText("превышено на 3");
    // `destructive-text` — AA-safe on both themes (the FormMessage/FormError rule).
    expect(counter).toHaveClass("text-destructive-text");
    // The fill token would be the dark-theme contrast failure the axe gate
    // caught. `(?![\w-])` so `text-destructive-text` itself does not match — a
    // plain `\b` boundary sits before the hyphen and would.
    expect(counter.className).not.toMatch(/text-destructive(?![\w-])/);
  });

  it("012 EARS-1: over the limit the control shall read invalid and still keep the full value — never truncate it", () => {
    render(
      <Textarea
        aria-label="Описание"
        showCounter
        maxLength={5}
        defaultValue="0123456789"
      />,
    );
    const control = screen.getByLabelText("Описание");
    expect(control).toHaveAttribute("aria-invalid", "true");
    // No native maxLength: the operator's text is never silently cut.
    expect(control).not.toHaveAttribute("maxlength");
    expect(control).toHaveValue("0123456789");
  });

  it("012 EARS-1: with no counter requested the control shall render no counter element and reserve no space", () => {
    const { container } = render(<Textarea aria-label="Описание" />);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
  });
});
