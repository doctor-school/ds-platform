import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Unmount explicitly after each test so the recording player's retry timer and
// frame never leak into the next test's assertions. Idempotent when nothing
// was rendered.
afterEach(() => {
  cleanup();
});
