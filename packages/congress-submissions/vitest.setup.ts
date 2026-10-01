import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// A fixed, deliberately non-Moscow runtime zone (UTC+10): user-action times
// (changed / sent / withdrawn / autosaved) follow the viewer's zone, rule dates
// stay pinned to МСК — the tests must tell the two apart on any machine.
process.env.TZ = "Asia/Vladivostok";

// React Testing Library does not auto-unmount under `globals: true` in every
// runner configuration; unmount explicitly so the one-tap control's pending
// transition never leaks into the next test's assertions. Idempotent when
// nothing was rendered.
afterEach(() => {
  cleanup();
});
