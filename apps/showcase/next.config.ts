import type { NextConfig } from "next";

/**
 * Minimal Next config for the design-system showcase (design-system-showcase
 * spec §2.1). Unlike the product apps, the showcase has no BFF, no i18n routing,
 * and no API proxy — it is a pure viewer of `@ds/design-system`. The only thing
 * it shares with the product apps is how it consumes the package:
 * `transpilePackages` pulls the design-system in as source (.tsx), the owned-code
 * shadcn model with no separate build step for the internal package (ADR-0004 §6).
 */
const config: NextConfig = {
  reactStrictMode: true,
  // Self-host as a Node container, no Vercel runtime (ADR-0004 §2.3 / §18).
  output: "standalone",
  // Consume @ds/design-system as source (.tsx) — identical wiring to the product
  // apps so the showcase renders the SAME components through the SAME pipeline.
  transpilePackages: ["@ds/design-system"],
};

export default config;
