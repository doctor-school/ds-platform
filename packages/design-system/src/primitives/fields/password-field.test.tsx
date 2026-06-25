import * as React from "react";
import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Form, FormField } from "../form";

import { PasswordField } from "./password-field";

afterEach(cleanup);

/**
 * Regression harness (#324 Mode-a review): drives `<PasswordField>` exactly as the
 * register / reset surfaces (`purpose="new"` + `policyHint`) and login
 * (`purpose="current"`) do, and pins the SINGLE no-reflow slot the form contract
 * (ADR-0013 §7) requires.
 *
 * The defect this guards: the field used to render a separate `<FormDescription>`
 * PLUS an empty `<FormMessage>`, producing TWO elements sharing `formDescriptionId`
 * (invalid duplicate id, ambiguous `aria-describedby`) and an extra always-blank
 * reserved line (defect #1). The earlier `form.test.tsx` only exercised the
 * helper-as-`FormMessage`-children path, so it stayed green while the real field
 * shipped the regression. These tests render the AS-SHIPPED composition.
 *
 * jsdom has no layout engine, so the no-GROWTH proof is the lead's live-verify;
 * these pin the DOM / id / swap contract the duplicate-id regression broke.
 */
function PwHarness({
  purpose,
  policyHint,
  error,
}: {
  purpose: "new" | "current";
  policyHint?: string;
  error?: string;
}) {
  const form = useForm<{ password: string }>({
    defaultValues: { password: "" },
  });
  // Inject the error once after mount (a resolver-free way to reach the error
  // state; setting it during render would loop).
  React.useEffect(() => {
    if (error) form.setError("password", { message: error });
  }, [error, form]);
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="password"
        render={({ field }) => (
          <PasswordField
            field={field as ControllerRenderProps<{ password: string }>}
            purpose={purpose}
            label="Пароль"
            testId="pw"
            {...(policyHint !== undefined ? { policyHint } : {})}
          />
        )}
      />
    </Form>
  );
}

const POLICY = "Не менее 8 символов: заглавная, строчная, цифра, спецсимвол.";

describe("PasswordField composition (single no-reflow slot)", () => {
  it("renders the policy hint as the ONE message slot — no duplicate description element", () => {
    const { container } = render(
      <PwHarness purpose="new" policyHint={POLICY} />,
    );
    // Before the fix there were TWO elements owning the description id (the
    // separate FormDescription AND the empty FormMessage). Now: exactly one.
    const descs = container.querySelectorAll('[id$="-form-item-description"]');
    expect(descs).toHaveLength(1);
    const desc = descs[0]!;
    expect(desc).toHaveTextContent(POLICY);
    expect(desc).toHaveClass("text-muted-foreground");
    // And exactly one message paragraph under the field — no extra blank line.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("swaps the error into the same slot in place (message id, destructive, alert)", () => {
    const { container } = render(
      <PwHarness
        purpose="new"
        policyHint={POLICY}
        error="Не менее 8 символов."
      />,
    );
    const paras = container.querySelectorAll("p");
    // Still ONE element — the error replaced the helper in place, not a new line.
    expect(paras).toHaveLength(1);
    const slot = paras[0]!;
    expect(slot).toHaveTextContent("Не менее 8 символов.");
    expect(slot.textContent ?? "").not.toContain(POLICY);
    expect(slot).toHaveClass("font-medium", "text-destructive");
    expect(slot).toHaveAttribute("role", "alert");
    expect(slot.id).toMatch(/-form-item-message$/);
    // While erroring the slot owns the message id, not the description id — so no
    // duplicate id and no orphaned helper element.
    expect(
      container.querySelectorAll('[id$="-form-item-description"]'),
    ).toHaveLength(0);
  });

  it("purpose=current (login) reserves one empty silent slot and shows the error", () => {
    const { container, rerender } = render(<PwHarness purpose="current" />);
    // No helper: a single reserved min-h-5 line, hidden from a11y until filled.
    let paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(1);
    const resting = paras[0]!;
    expect(resting).toHaveClass("min-h-5");
    expect(resting).toHaveAttribute("aria-hidden", "true");
    expect(resting).toBeEmptyDOMElement();
    expect(screen.getByTestId("pw")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );

    // The same single slot carries the error on failure (no second line).
    rerender(<PwHarness purpose="current" error="Не менее 8 символов." />);
    paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(1);
    const errored = paras[0]!;
    expect(errored).toHaveTextContent("Не менее 8 символов.");
    expect(errored).toHaveAttribute("role", "alert");
  });
});
