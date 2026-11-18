import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Unmount after each component test so a step's progress timer never leaks
// into the next test; a no-op for the node-environment model tests.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
