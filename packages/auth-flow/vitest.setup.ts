import { vi } from "vitest";

import "@testing-library/jest-dom/vitest";

// input-otp's password-manager-badge heuristic schedules `window`-touching timers
// (a 1s `setInterval` reading `window.innerWidth`, plus a `setTimeout` cascade that
// probes `document.elementFromPoint`, which jsdom has no layout engine to provide).
// They fire in the gap between a test finishing and the jsdom environment tearing
// down, throwing an unhandled error that nondeterministically reds the whole unit
// job (#366). The badge heuristic is a browser-only affordance irrelevant to the
// door's value-flow tests, so force `pushPasswordManagerStrategy="none"` for every
// `OTPInput` under test — both PWM effects then early-return and schedule no timers,
// removing the leak at the root. Test-env only: the shipped focus screen keeps
// input-otp's default behaviour. Same mitigation as the design-system tier, which
// owns the widget (`packages/design-system/vitest.setup.ts`).
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

// Belt for the same heuristic when the widget reaches this tier through the
// design-system build rather than its source: jsdom has no layout engine, so
// `document.elementFromPoint` is simply absent and the polling timer throws.
// Return null — nothing is under the point, which is the truth here.
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (
    document as unknown as { elementFromPoint: () => Element | null }
  ).elementFromPoint = () => null;
}
