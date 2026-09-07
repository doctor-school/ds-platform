import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// React Testing Library does not auto-unmount under `globals: true` in every
// runner configuration; unmount explicitly so the one-tap control's pending
// transition never leaks into the next test's assertions. Idempotent when
// nothing was rendered.
afterEach(() => {
  cleanup();
});
