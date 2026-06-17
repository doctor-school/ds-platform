import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Component-test config for `@ds/design-system` (#235). The package now owns the
// field primitives (#197) and the auth blocks (#235 / #227), so the slotted-OTP
// regression (#212) test and the new OtpFocusScreen tests run here against a jsdom
// DOM. Scoped to the co-located test files under src; the Style-Dictionary `build`
// task emits no JS into dist, so a plain src include is unambiguous.
// `@vitejs/plugin-react` provides the JSX transform.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
