import { vi } from "vitest";

import "@testing-library/jest-dom/vitest";

// input-otp's password-manager-badge heuristic schedules `window`-touching timers
// (a 1s `setInterval` reading `window.innerWidth`, plus a `setTimeout` cascade that
// probes `document.elementFromPoint`). In jsdom these can fire in the gap between a
// test finishing and the environment tearing down, throwing an unhandled
// `ReferenceError: window is not defined` that nondeterministically red-lights the
// whole `unit` job (#366) — the `elementFromPoint` stub below only covered the
// `setTimeout` branch, not the `setInterval`. The badge heuristic is a browser-only
// affordance irrelevant to these value-flow tests, so force
// `pushPasswordManagerStrategy="none"` for every `OTPInput` under test — both PWM
// effects then early-return and schedule no timers, removing the leak at the root.
// Test-env only: production `InputOTP` keeps input-otp's default behaviour.
vi.mock("input-otp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("input-otp")>();
  const { createElement, forwardRef } = await import("react");
  const OTPInput = forwardRef<unknown, Record<string, unknown>>((props, ref) =>
    createElement(actual.OTPInput, {
      pushPasswordManagerStrategy: "none",
      ...props,
      ref,
    }),
  );
  (OTPInput as { displayName?: string }).displayName = "OTPInputPwmDisabledMock";
  return { ...actual, OTPInput };
});

// jsdom ships no ResizeObserver; `input-otp` observes the hidden input to size its
// slots, so without this stub the slotted widget throws on mount. A no-op observer
// is sufficient — the tests assert value flow, not pixel geometry.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// jsdom has no layout engine, so `document.elementFromPoint` is absent. `input-otp`'s
// password-manager-badge heuristic polls it on a timer; without this stub the timer
// throws an unhandled error after the test completes. Return null (no element hit).
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (
    document as unknown as { elementFromPoint: () => Element | null }
  ).elementFromPoint = () => null;
}
