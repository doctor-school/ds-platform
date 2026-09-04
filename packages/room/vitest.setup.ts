import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// React Testing Library does not auto-unmount under `globals: true` in every
// runner configuration; unmount explicitly so a room hook's effect cleanup
// (the EARS-18 watchdog / retry timers) always runs before the next test arms
// its own timers. Idempotent when nothing was rendered.
afterEach(() => {
  cleanup();
});
