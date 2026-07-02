import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { installOrphanTimerTracking, flushOrphanTimers } from "./orphan-timers";

// #434: input-otp@1.4.2 schedules an uncleaned 0/10/50ms setTimeout triple on
// every value/focus change; a timer scheduled by a suite's last keystrokes fires
// AFTER the jsdom env is torn down and reds the whole `unit` job with
// `ReferenceError: window is not defined` (same class as #405). Track every
// pending setTimeout with its scheduling stack; after each test (this hook runs
// LAST — afterEach is LIFO, and setup-file hooks register first) unmount and
// defuse the orphans. The known upstream defect (input-otp frames) is cleared
// silently; any OTHER leaked timer is OUR defect and fails the test right here,
// attributably, instead of as an intermittent CI teardown flake. Rationale +
// contract tests: ./orphan-timers.ts / ./orphan-timers.test.tsx.
installOrphanTimerTracking();

afterEach(() => {
  cleanup(); // idempotent — guarantees unmount before the orphan sweep
  const { foreign } = flushOrphanTimers();
  if (foreign.length > 0) {
    const sites = foreign
      .map((o, i) => `  [${i + 1}] delay=${String(o.delay)}\n${o.stack}`)
      .join("\n");
    throw new Error(
      `#434 orphan-timer guard: ${foreign.length} setTimeout(s) outlived the test past unmount. ` +
        `Clear timers in the owning effect's cleanup (or drive the test on fake timers).\n${sites}`,
    );
  }
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
