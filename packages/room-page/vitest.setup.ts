import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import "@testing-library/jest-dom/vitest";

// Unmount explicitly after each test so one render never leaks into the next
// test's assertions; reset the theme the header cluster's toggle may set. The
// server-page suite runs in the node environment, where there is no DOM.
afterEach(() => {
  if (typeof document === "undefined") return;
  cleanup();
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});
