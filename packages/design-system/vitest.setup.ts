import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import "@testing-library/jest-dom/vitest";

import { installOrphanTimerTracking, flushOrphanTimers } from "./orphan-timers.setup";

// #441: input-otp@1.4.2 schedules an uncleaned 0/10/50ms setTimeout triple on every
// value/focus change (its `syncTimeouts` helper); a timer scheduled by a suite's
// last keystrokes fires AFTER the jsdom env is torn down and reds the whole `unit`
// job with `ReferenceError: window is not defined` (same class as #366/#405/#408,
// but a setTimeout — neither the #377 PWM mock below nor the #408 interval guard
// covers it). Track every pending setTimeout with its scheduling stack; after each
// test (this hook runs LAST — afterEach is LIFO, and setup-file hooks register
// first) unmount and defuse the orphans. The known upstream defect (input-otp
// frames) is cleared silently; any OTHER leaked timer is OUR defect and fails the
// test right here, attributably, instead of as an intermittent CI teardown flake.
// Adopted from the portal's #434 guard (PR #442) — rationale + contract tests:
// ./orphan-timers.setup.ts / ./src/orphan-timers.test.tsx. Doc:
// apps/docs/content/architecture/component-testing.md → "The #434/#441 orphan-timer guard".
installOrphanTimerTracking();

afterEach(() => {
  cleanup(); // idempotent — guarantees unmount before the orphan sweep
  const { foreign } = flushOrphanTimers();
  if (foreign.length > 0) {
    const sites = foreign
      .map((o, i) => `  [${i + 1}] delay=${String(o.delay)}\n${o.stack}`)
      .join("\n");
    throw new Error(
      `#441 orphan-timer guard: ${foreign.length} setTimeout(s) outlived the test past unmount. ` +
        `Clear timers in the owning effect's cleanup (or drive the test on fake timers).\n${sites}`,
    );
  }
});

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
