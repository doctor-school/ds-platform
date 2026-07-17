import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Label } from "./label";

afterEach(cleanup);

/**
 * Label required-marker contract (#529, source §07 «Формы и валидация»). The
 * canvas renders a required field label as `Email <span color:danger>*</span>` —
 * the asterisk is the destructive `*` marker. It is decorative (the programmatic
 * `required` semantics live on the INPUT), so it is `aria-hidden` and must not read
 * as noise to a screen reader.
 */
describe("Label required marker (#529, source §07)", () => {
  it("#529: renders no asterisk by default", () => {
    render(<Label data-testid="l">Email</Label>);
    expect(screen.getByTestId("l").textContent).toBe("Email");
  });

  it("#529: renders a destructive asterisk when required, hidden from assistive tech", () => {
    render(
      <Label data-testid="l" required>
        Email
      </Label>,
    );
    const label = screen.getByTestId("l");
    expect(label.textContent).toContain("*");
    const star = label.querySelector("[aria-hidden]");
    expect(star).not.toBeNull();
    // The canvas asterisk rides the danger colour (`text-destructive-text`).
    expect(star).toHaveClass("text-destructive-text");
    expect(star).toHaveTextContent("*");
  });

  it("#529: does not leak the `required` prop onto the DOM label element", () => {
    render(
      <Label data-testid="l" required>
        Email
      </Label>,
    );
    // The asterisk carries the visual required cue; the label element itself is not
    // a form control, so the boolean must not surface as a stray DOM attribute.
    expect(screen.getByTestId("l")).not.toHaveAttribute("required");
  });
});
