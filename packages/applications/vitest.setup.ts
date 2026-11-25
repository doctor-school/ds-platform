import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Unmount explicitly after each test so one render's pending submission never
// leaks into the next test's assertions. Idempotent when nothing was rendered.
afterEach(() => {
  cleanup();
});

// The specialty Combobox (Radix Popover + cmdk) measures and scrolls its list;
// jsdom implements neither.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
