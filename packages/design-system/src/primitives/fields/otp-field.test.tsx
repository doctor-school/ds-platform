import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Form, FormField } from "../form";

import { OtpField } from "./otp-field";

afterEach(cleanup);

/**
 * Regression harness for #212 / #211. Drives `<OtpField>` exactly
 * as `/login`, `/verify`, and `/reset` do — a real RHF `<FormField>` Controller
 * feeding the `field` — and asserts the controlled-value contract the #212 fix
 * restored: typed input must land in the RHF value, the field must wire RHF's `ref`
 * to the underlying input (the missing wiring that left the slotted field
 * half-bound), the charset governs what reaches the value, and a full-length code fires
 * `onComplete` (the auto-submit path #211 must preserve for the now-slotted login).
 *
 * NOTE: jsdom has no layout engine, so it cannot reproduce the *browser-only*
 * rendering desync this bug surfaced as; these tests pin the JS contract (value
 * ingestion, ref wiring, charset, onComplete) that the fix makes robust. The
 * live-browser proof on the dev-stand is the lead agent's verification step.
 */
function SlottedHarness({
  length,
  charset = "numeric",
  onValue,
  onComplete,
}: {
  length: number;
  charset?: "alphanumeric" | "numeric";
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
              charset={charset}
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

  it("uppercases lowercase keystrokes so the RHF value matches the UPPERCASE Zitadel code (#1109)", async () => {
    // charset="alphanumeric" (#1109): a lowercase keystroke lands an UPPERCASE
    // value in the RHF field — the field normalizes on change.
    const user = userEvent.setup();
    let latest = "";
    render(
      <SlottedHarness
        length={6}
        charset="alphanumeric"
        onValue={(v) => (latest = v)}
      />,
    );

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("pvdc3r");

    expect(latest).toBe("PVDC3R");
  });

  it("accepts letters under charset=alphanumeric", async () => {
    const user = userEvent.setup();
    let latest = "";
    render(
      <SlottedHarness
        length={6}
        charset="alphanumeric"
        onValue={(v) => (latest = v)}
      />,
    );

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
                  charset="numeric"
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

  it("renders a TEXT keyboard for the ALPHANUMERIC reg/reset code so mobile letters are reachable (#1110)", () => {
    // Root cause: input-otp's OTPInput defaults inputMode=\"numeric\", so a phone
    // pops the digits-only keypad and the letters of an alphanumeric code (PVDC3R)
    // are unreachable. charset=\"alphanumeric\" must override that to a text keyboard
    // (inputMode=\"text\") and auto-uppercase the key hints (autoCapitalize=\"characters\").
    render(<SlottedHarness length={6} charset="alphanumeric" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("inputmode", "text");
    expect(input).toHaveAttribute("autocapitalize", "characters");
  });

  it("applies NO uppercase text-transform to a slot — the value is normalised, never the glyphs (021 LD-9, #1547)", () => {
    // The alphanumeric code is uppercased in the VALUE (#1109) and again by the
    // server, so a CSS `text-transform` on the slot buys nothing and breaks the
    // rule that what the doctor sees is what they typed. A class assertion, not
    // a computed-style one: jsdom does not apply Tailwind, so the class IS the
    // observable. The rendered counterpart runs under mobile emulation in
    // `apps/doctor/e2e/register-validation.spec.ts`.
    const { container } = render(
      <SlottedHarness length={6} charset="alphanumeric" />,
    );

    const slots = container.querySelectorAll("div.aspect-square");
    expect(slots).toHaveLength(6);
    for (const slot of slots) {
      expect(slot.className).not.toMatch(/\buppercase\b/);
    }
  });

  it("keeps a NUMERIC keyboard for the digit login OTP (charset=numeric, #1110)", () => {
    // The login OTP is digits-only — charset=\"numeric\" must pin the numeric keypad
    // explicitly (never a text keyboard) and never force autoCapitalize.
    render(<SlottedHarness length={8} charset="numeric" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).not.toHaveAttribute("autocapitalize", "characters");
  });

  it("003 EARS-22: charset=numeric drops typed letters — only digits reach the value (#2636)", async () => {
    // Every mailed/texted code is six digits (003 EARS-29 amended, #2636): the
    // field must refuse a letter keystroke instead of filling a cell with it.
    const user = userEvent.setup();
    let latest = "";
    render(
      <SlottedHarness
        length={6}
        charset="numeric"
        onValue={(v) => (latest = v)}
      />,
    );

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.keyboard("12ab34");

    expect(latest).toBe("1234");
  });

  it("003 EARS-22: charset=numeric keeps only the digits of a paste and fills from the current cell (auth.dc.html, #2636)", async () => {
    const user = userEvent.setup();
    let latest = "";
    render(
      <SlottedHarness
        length={6}
        charset="numeric"
        onValue={(v) => (latest = v)}
      />,
    );

    const input = screen.getByRole("textbox");
    await user.click(input);
    await user.paste("PVDC3R");
    expect(latest).toBe("3");

    await user.paste("48 29-13");
    expect(latest).toBe("348291");
  });

  it("003 EARS-22: charset=numeric carries the canvas code-cell attributes (auth.dc.html, #2636)", () => {
    render(<SlottedHarness length={6} charset="numeric" />);

    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("pattern", "[0-9]*");
    expect(input).toHaveAttribute("autocapitalize", "off");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("does not schedule input-otp's window-polling PWM timer (#366, jsdom teardown flake)", () => {
    // input-otp's password-manager-badge heuristic schedules a 1s `setInterval`
    // whose body reads `window.innerWidth`. In jsdom that interval can fire in the
    // gap between a test finishing and the environment tearing down — throwing an
    // unhandled `ReferenceError: window is not defined` that red-lights the whole
    // `unit` job (#366). With `pushPasswordManagerStrategy="none"` forced for every
    // `OTPInput` under test (vitest.setup.ts), the PWM effects early-return and
    // schedule no such timer. This guards the root cause directly (deterministic),
    // not the nondeterministic symptom.
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { unmount } = render(<SlottedHarness length={6} />);
    const pwmIntervals = setIntervalSpy.mock.calls.filter(([, ms]) => ms === 1000);
    unmount();
    setIntervalSpy.mockRestore();
    expect(pwmIntervals).toHaveLength(0);
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
