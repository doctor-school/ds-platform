import * as React from "react";
import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Form, FormField } from "../primitives/form";

import { OtpFocusScreen } from "./otp-focus-screen";

afterEach(cleanup);

/**
 * Behavioral harness for `<OtpFocusScreen>` (#227, absorbed into #235). It drives the
 * block the way an auth surface (#237) will: a real RHF `<FormField>` Controller feeds
 * the `field`, and the surface owns `onSubmit`/`onResend`/`onChangeMethod`/`onComplete`
 * + the `cooldownSeconds`. The block must, by construction, render ONLY the focus-screen
 * affordances (masked destination + code input + submit + resend-with-cooldown +
 * change-method/back) and re-use the moved `<OtpField>` for the code box.
 *
 * Copy is passed in (i18n stays in the app), so the assertions use the test-supplied
 * strings; there are NO ru/en literals inside the package under test.
 */
function Harness({
  length = 6,
  cooldownSeconds = 0,
  isSubmitting = false,
  onSubmit = (e: React.FormEvent) => e.preventDefault(),
  onResend = () => {},
  onChangeMethod = () => {},
  onComplete,
}: {
  length?: number;
  cooldownSeconds?: number;
  isSubmitting?: boolean;
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  onResend?: () => void;
  onChangeMethod?: () => void;
  onComplete?: () => void;
}) {
  const form = useForm<{ code: string }>({ defaultValues: { code: "" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="code"
        render={({ field }) => (
          <OtpFocusScreen
            field={field as ControllerRenderProps<{ code: string }>}
            length={length}
            variant="slotted"
            title="Enter code"
            sentToLabel="Code sent to a•••@p•••.com"
            codeLabel="Code"
            submitLabel="Verify"
            resendLabel="Resend"
            resendCountdownLabel={(s) => `Resend in ${s}s`}
            changeMethodLabel="Change method"
            cooldownSeconds={cooldownSeconds}
            isSubmitting={isSubmitting}
            onComplete={onComplete}
            onSubmit={onSubmit}
            onResend={onResend}
            onChangeMethod={onChangeMethod}
            submitTestId="otp-submit"
            resendTestId="otp-resend"
            changeMethodTestId="otp-change-method"
          />
        )}
      />
    </Form>
  );
}

describe("OtpFocusScreen", () => {
  it("renders the masked destination passed by the app (past-tense, no raw value)", () => {
    render(<Harness />);
    expect(screen.getByTestId("otp-sent-to")).toHaveTextContent(
      "Code sent to a•••@p•••.com",
    );
  });

  it("renders ONLY the focus-screen affordances — no channel switcher / secondary links", () => {
    render(<Harness />);
    // The block omits any channel selector or create/forgot links by construction.
    expect(screen.getByRole("textbox")).toBeInTheDocument(); // code input
    expect(screen.getByTestId("otp-submit")).toBeInTheDocument();
    expect(screen.getByTestId("otp-resend")).toBeInTheDocument();
    expect(screen.getByTestId("otp-change-method")).toBeInTheDocument();
    // No extra links/tabs leaked in.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("disables resend during cooldown then re-enables when the countdown elapses", () => {
    vi.useFakeTimers();
    try {
      render(<Harness cooldownSeconds={3} />);
      const resend = screen.getByTestId("otp-resend");
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent("Resend in 3s");

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(resend).not.toBeDisabled();
      expect(resend).toHaveTextContent("Resend");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires onResend when the (enabled) resend control is clicked", async () => {
    const onResend = vi.fn();
    const user = userEvent.setup();
    render(<Harness cooldownSeconds={0} onResend={onResend} />);
    await user.click(screen.getByTestId("otp-resend"));
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("fires onChangeMethod / back when the change-method control is clicked", async () => {
    const onChangeMethod = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChangeMethod={onChangeMethod} />);
    await user.click(screen.getByTestId("otp-change-method"));
    expect(onChangeMethod).toHaveBeenCalledTimes(1);
  });

  it("auto-submits (fires onComplete) once the fixed-length code lands", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Harness length={6} onComplete={onComplete} />);
    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("12345");
    expect(onComplete).not.toHaveBeenCalled();
    await user.keyboard("6");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("guards the in-flight state by disabling submit while isSubmitting", () => {
    render(<Harness isSubmitting />);
    expect(screen.getByTestId("otp-submit")).toBeDisabled();
  });
});
