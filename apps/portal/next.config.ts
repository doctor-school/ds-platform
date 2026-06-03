import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Self-host as a Node container, no Vercel runtime (ADR-0004 §2.3 / §18).
  output: "standalone",
  // Consume @ds/design-system as source (.tsx) — owned-code shadcn model,
  // no separate build step for the internal package (ADR-0004 §6).
  transpilePackages: ["@ds/design-system"],
};

export default config;
