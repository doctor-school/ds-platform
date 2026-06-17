import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Form, FormField } from "../form";

import { OtpField } from "./otp-field";

afterEach(cleanup);

/**
 * Regression harness for #212 / #211. Drives `<OtpField variant="slotted">` exactly
 * as `/login`, `/verify`, and `/reset` do — a real RHF `<FormField>` Controller
 * feeding the `field` — and asserts the controlled-value contract the #212 fix
 * restored: typed input must land in the RHF value, the field must wire RHF's `ref`
 * to the underlying input (the missing wiring that left the slotted field
 * half-bound), the code may be ALPHANUMERIC, and a full-length code fires
 * `onComplete` (the auto-submit path #211 must preserve for the now-slotted login).
 *
 * NOTE: jsdom has no layout engine, so it cannot reproduce the *browser-only*
 * rendering desync this bug surfaced as; these tests pin the JS contract (value
 * ingestion, ref wiring, alphanumeric, onComplete) that the fix makes robust. The
 * live-browser proof on the dev-stand is the lead agent's verification step.
 */
function SlottedHarness({
  length,
  onValue,
  onComplete,
}: {
  length: number;
  onValue?: (v: string) => void;
  onComplete?: () => void;
}) {
  const form = useForm<{ code: string }>({ defaultValues: { code: "" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="code"
        render={({ field }) => {
          onValue?.(field.value ?? "");
          return (
            <OtpField
              field={field as ControllerRenderProps<{ code: string }>}
              length={length}
              variant="slotted"
              label="Code"
              onComplete={onComplete}
            />
          );
        }}
      />
    </Form>
  );
}

describe("OtpField variant=slotted", () => {
  it("ingests typed digits into the RHF-controlled value", async () => {
    const user = userEvent.setup();
    let latest = "";
    render(<SlottedHarness length={6} onValue={(v) => (latest = v)} />);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("123456");

    expect(latest).toBe("123456");
  });

  it("accepts the ALPHANUMERIC Zitadel reset / email-verify code", async () => {
    const user = userEvent.setup();
    let latest = "";
    render(<SlottedHarness length={6} onValue={(v) => (latest = v)} />);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("PVDC3R");

    expect(latest).toBe("PVDC3R");
  });

  it("binds the RHF field ref to the underlying input (the #212 gap)", async () => {
    // The fix: the slotted variant spreads `{...field}`, so RHF's ref callback
    // receives the real input element (the design-system `InputOTP` forwards its ref
    // straight to input-otp's hidden input). RHF 7.79 then stores a control wrapper
    // (`focus`/`select`/`setCustomValidity`/`reportValidity`) keyed on that element.
    // WITHOUT the spread, `field.ref` is never invoked, so `_f.ref` is the bare
    // `{ name }` placeholder — the half-bound state that dropped keystrokes in the
    // browser. Assert the bound wrapper, which the broken wiring cannot produce.
    let boundRef: { focus?: unknown; setCustomValidity?: unknown } | undefined;
    function RefHarness() {
      const form = useForm<{ code: string }>({ defaultValues: { code: "" } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="code"
            render={({ field }) => {
              boundRef = (
                form.control as unknown as {
                  _fields: { code?: { _f?: { ref?: typeof boundRef } } };
                }
              )._fields.code?._f?.ref;
              return (
                <OtpField
                  field={field as ControllerRenderProps<{ code: string }>}
                  length={6}
                  variant="slotted"
                  label="Code"
                />
              );
            }}
          />
        </Form>
      );
    }
    render(<RefHarness />);
    expect(typeof boundRef?.focus).toBe("function");
    expect(typeof boundRef?.setCustomValidity).toBe("function");
  });

  it("fires onComplete once the full-length (8) login code lands", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<SlottedHarness length={8} onComplete={onComplete} />);

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("1234567");
    expect(onComplete).not.toHaveBeenCalled();
    await user.keyboard("8");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
