import "@testing-library/jest-dom/vitest";

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
