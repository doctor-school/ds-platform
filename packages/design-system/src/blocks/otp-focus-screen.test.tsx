import * as React from "react";
import { useForm, type ControllerRenderProps } from "react-hook-form";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { Form, FormField } from "../primitives/form";

import { OtpFocusScreen } from "./otp-focus-screen";

// #405 — deterministic class guard. The block owns a live resend countdown
// (`useResendCountdown`, a real 1s `setInterval`); a tick that fires after jsdom
// teardown throws an unhandled `ReferenceError: window is not defined` that
// nondeterministically red-lights the whole `unit` job. A fake-timer render swaps
// `globalThis.setInterval` for vitest's fake, BYPASSING this spy — so any 1000ms
// interval observed here means a test rendered a LIVE cooldown under REAL timers, the
// exact pattern that leaks at teardown. Failing it locally and deterministically
// converts the intermittent teardown flake into a hard, attributable red — and closes
// the class: a future test that re-introduces a real-timer countdown trips the guard
// immediately, not three CI cycles later. (input-otp's own PWM timer is a separate
// class, already neutralised package-wide in vitest.setup.ts via #377.)
let setIntervalSpy: MockInstance<typeof globalThis.setInterval>;
beforeEach(() => {
  setIntervalSpy = vi.spyOn(globalThis, "setInterval");
});
afterEach(() => {
  // Unmount FIRST so the countdown effect's `clearInterval` runs, then assert no real
  // 1s interval was ever scheduled, then restore the spy + the real clock.
  cleanup();
  const realSecondIntervals = setIntervalSpy.mock.calls.filter(
    ([, ms]) => ms === 1000,
  );
  setIntervalSpy.mockRestore();
  vi.useRealTimers();
  expect(realSecondIntervals).toHaveLength(0);
});

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
 *
 * #405 — TIMER DISCIPLINE: the block owns a LIVE resend countdown (`useResendCountdown`,
 * a real 1s `setInterval`). Rendering ANY `cooldownSeconds > 0` under REAL timers lets a
 * tick fire in the gap between the test finishing and jsdom tearing down — throwing an
 * unhandled `ReferenceError: window is not defined` that red-lights the whole `unit` job
 * (the same teardown race as #366, but a DIFFERENT root timer: the countdown, not
 * input-otp's password-manager badge — that one is already neutralised package-wide in
 * vitest.setup.ts, so #366's fix did not cover this file). The invariant that closes the
 * class: every test that renders a live cooldown MUST drive it on FAKE timers
 * (`vi.useFakeTimers()` + `vi.advanceTimersByTime`), so no real interval can outlive the
 * environment. Tests that render `cooldownSeconds={0}` schedule no interval and may use
 * real timers (needed by `userEvent`, which hangs under fake timers — see the portal
 * `verify`/`reset` suites for the same split).
 */
function Harness({
  length = 6,
  cooldownSeconds = 0,
  resendNonce = 0,
  isSubmitting = false,
  onSubmit = (e: React.FormEvent) => e.preventDefault(),
  onResend = () => {},
  onChangeMethod = () => {},
  onComplete,
}: {
  length?: number;
  cooldownSeconds?: number;
  resendNonce?: number;
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
            charset="numeric"
            title="Enter code"
            sentToLabel="Code sent to a•••@p•••.com"
            codeLabel="Code"
            submitLabel="Verify"
            resendLabel="Resend"
            resendCountdownLabel={(s) => `Resend in ${s}s`}
            changeMethodLabel="Change method"
            cooldownSeconds={cooldownSeconds}
            resendNonce={resendNonce}
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

  it("restarts the cooldown on a resendNonce bump without remounting (unchanged duration)", () => {
    vi.useFakeTimers();
    try {
      // A resend re-issues the SAME 30s cooldown; the duration value does not
      // change, so re-seeding cannot key off `cooldownSeconds` alone. The app
      // bumps `resendNonce` instead — the block must restart the countdown
      // without the consumer having to remount-by-key (#266; the #237 hack).
      const { rerender } = render(
        <Harness cooldownSeconds={30} resendNonce={0} />,
      );
      const resend = screen.getByTestId("otp-resend");
      expect(resend).toHaveTextContent("Resend in 30s");

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(resend).toHaveTextContent("Resend in 25s");

      // Same duration, bumped nonce → countdown restarts from 30, still the same
      // mounted block (no `key` change).
      rerender(<Harness cooldownSeconds={30} resendNonce={1} />);
      expect(resend).toHaveTextContent("Resend in 30s");
      expect(resend).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders the countdown with tabular-nums so the digits do not jitter (#267)", () => {
    // FAKE timers even though the assertion is synchronous (#405): a live cooldown
    // schedules a real 1s `setInterval` whose post-teardown tick throws
    // `window is not defined`. Faking the clock means no real interval is ever
    // scheduled, so nothing can outlive the environment.
    vi.useFakeTimers();
    try {
      render(<Harness cooldownSeconds={9} />);
      const resend = screen.getByTestId("otp-resend");
      // Fixed-width digits keep the label from shifting as the seconds tick down.
      expect(resend).toHaveClass("tabular-nums");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires onResend when the (enabled) resend control is clicked", async () => {
    const onResend = vi.fn();
    const user = userEvent.setup();
    // cooldownSeconds={0} → resend enabled immediately and NO countdown interval is
    // scheduled, so real timers (which `userEvent` needs) cannot leak a timer (#405).
    render(<Harness cooldownSeconds={0} onResend={onResend} />);
    await user.click(screen.getByTestId("otp-resend"));
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it("fires onChangeMethod / back when the change-method control is clicked", async () => {
    const onChangeMethod = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChangeMethod={onChangeMethod} />); // cooldown defaults to 0 (no interval)
    await user.click(screen.getByTestId("otp-change-method"));
    expect(onChangeMethod).toHaveBeenCalledTimes(1);
  });

  it("auto-submits (fires onComplete) once the fixed-length code lands", async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Harness length={6} onComplete={onComplete} />); // cooldown defaults to 0 (no interval)
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
