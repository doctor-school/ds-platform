import * as React from "react";
import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Form, FormField } from "../form";

import { PasswordField } from "./password-field";

afterEach(cleanup);

/**
 * Regression harness: drives `<PasswordField>` exactly as the register / reset
 * surfaces (`purpose="new"` + `policyHint`) and login (`purpose="current"`) do,
 * and pins the **inline** message contract (ADR-0013 §7, #333 redo).
 *
 * The field renders ONE message element via `FormMessage` children: the policy
 * hint (muted) by default, swapped in place by the destructive error. A field
 * with no helper (`purpose="current"`) renders **nothing** until an error — the
 * slice-B always-reserved `min-h-5` line (the K-1 over-spacing defect) is gone.
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

describe("PasswordField composition (inline message)", () => {
  it("renders the policy hint as the ONE message element — no duplicate description element", () => {
    const { container } = render(
      <PwHarness purpose="new" policyHint={POLICY} />,
    );
    // Exactly one element owns the description id (no separate FormDescription +
    // empty FormMessage pair), and it is small + muted.
    const descs = container.querySelectorAll('[id$="-form-item-description"]');
    expect(descs).toHaveLength(1);
    const desc = descs[0]!;
    expect(desc).toHaveTextContent(POLICY);
    expect(desc).toHaveClass("text-xs", "text-muted-foreground");
    // Exactly one message paragraph under the field — no extra blank line.
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("swaps the error into the hint's place (message id, small weight-700 danger + ⚠, alert)", () => {
    const { container } = render(
      <PwHarness
        purpose="new"
        policyHint={POLICY}
        error="Не менее 8 символов."
      />,
    );
    const paras = container.querySelectorAll("p");
    // Still ONE element — the error replaced the helper, not a new line.
    expect(paras).toHaveLength(1);
    const slot = paras[0]!;
    expect(slot).toHaveTextContent("Не менее 8 символов.");
    expect(slot.textContent ?? "").not.toContain(POLICY);
    expect(slot).toHaveClass("text-xs", "font-bold", "text-destructive-text");
    expect(slot.textContent ?? "").toContain("⚠");
    expect(slot).toHaveAttribute("role", "alert");
    expect(slot.id).toMatch(/-form-item-message$/);
    // While erroring the element owns the message id, not the description id.
    expect(
      container.querySelectorAll('[id$="-form-item-description"]'),
    ).toHaveLength(0);
  });

  it("purpose=current (login) renders NO message line at rest, then shows the error inline", () => {
    const { container, rerender } = render(<PwHarness purpose="current" />);
    // K-1: no helper → no reserved line at all (the old min-h-5 slot is gone).
    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(screen.getByTestId("pw")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );

    // The error appears inline on failure.
    rerender(<PwHarness purpose="current" error="Не менее 8 символов." />);
    const paras = container.querySelectorAll("p");
    expect(paras).toHaveLength(1);
    const errored = paras[0]!;
    expect(errored).toHaveTextContent("Не менее 8 символов.");
    expect(errored).toHaveAttribute("role", "alert");
  });
});
