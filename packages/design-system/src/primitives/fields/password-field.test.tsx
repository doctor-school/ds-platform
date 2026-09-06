import * as React from "react";
import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

/**
 * 003 EARS-38 harness: a bare creation field with a stable test id per instance,
 * so a second instance can be mounted alongside the first and proven independent.
 */
function RevealHarness({
  testId = "pw",
  placeholder,
}: {
  testId?: string;
  placeholder?: string;
}) {
  const form = useForm<{ password: string }>({
    defaultValues: { password: "" },
  });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="password"
        render={({ field }) => (
          <PasswordField
            field={field as ControllerRenderProps<{ password: string }>}
            purpose="new"
            label="Пароль"
            testId={testId}
            {...(placeholder !== undefined ? { placeholder } : {})}
          />
        )}
      />
    </Form>
  );
}

describe("PasswordField reveal toggle (003 EARS-38)", () => {
  it("003 EARS-38.1: masked by default — type=password, toggle present, aria-pressed=false, «Показать»", () => {
    render(<RevealHarness />);
    const input = screen.getByTestId("pw");
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByTestId("pw-reveal");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("Показать");
    expect(toggle).toHaveAttribute("aria-label", "Показать пароль");
    // The control the toggle governs is the password input itself.
    expect(toggle.getAttribute("aria-controls")).toBe(input.getAttribute("id"));
  });

  it("003 EARS-38.2: toggling reveals — type=text, aria-pressed=true, «Скрыть», and back to masked", () => {
    render(<RevealHarness />);
    const input = screen.getByTestId("pw");
    const toggle = screen.getByTestId("pw-reveal");

    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent("Скрыть");
    expect(toggle).toHaveAttribute("aria-label", "Скрыть пароль");

    fireEvent.click(toggle);
    expect(input).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("Показать");
  });

  it("003 EARS-38.3: the entered value and the caret survive a toggle, focus stays on the field", async () => {
    render(<RevealHarness />);
    const input = screen.getByTestId("pw") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "secret1234" } });
    await waitFor(() => expect(input).toHaveValue("secret1234"));
    input.focus();
    input.setSelectionRange(4, 4);

    fireEvent.click(screen.getByTestId("pw-reveal"));

    expect(input).toHaveValue("secret1234");
    expect(input).toHaveAttribute("type", "text");
    expect(input.selectionStart).toBe(4);
    expect(input.selectionEnd).toBe(4);
    expect(document.activeElement).toBe(input);

    // Flush the select events jsdom queues on `focus` / `setSelectionRange` so no
    // timer outlives the test (#441 orphan-timer guard).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("003 EARS-38.4: revealing one field does not reveal another instance", () => {
    render(
      <>
        <RevealHarness testId="pw-a" />
        <RevealHarness testId="pw-b" />
      </>,
    );
    fireEvent.click(screen.getByTestId("pw-a-reveal"));
    expect(screen.getByTestId("pw-a")).toHaveAttribute("type", "text");
    expect(screen.getByTestId("pw-b")).toHaveAttribute("type", "password");
    expect(screen.getByTestId("pw-b-reveal")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("003 EARS-38.5: the optional placeholder reaches the input", () => {
    render(<RevealHarness placeholder="••••••••" />);
    expect(screen.getByTestId("pw")).toHaveAttribute(
      "placeholder",
      "••••••••",
    );
  });
});
