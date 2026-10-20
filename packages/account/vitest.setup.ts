import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Unmount explicitly after each test so the cabinet's load effect never leaks
// into the next test's assertions. Idempotent when nothing was rendered.
afterEach(() => {
  cleanup();
});

// jsdom ships no ResizeObserver and no `document.elementFromPoint`; the phone
// row's slotted code input (`input-otp`) uses both. The tests assert value flow,
// not geometry, so a no-op observer and a null hit are sufficient — the same
// stubs `apps/portal/vitest.setup.ts` installs.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (
    globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }
  ).ResizeObserver = ResizeObserverStub;
}
if (typeof document !== "undefined" && !document.elementFromPoint) {
  (
    document as unknown as { elementFromPoint: () => Element | null }
  ).elementFromPoint = () => null;
}
