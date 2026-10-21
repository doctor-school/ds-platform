import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Same-origin BFF proxy upstream, as on both storefronts: the host's form-state
 * and record cookies are `__Host-` cookies the API sets, so the API must answer
 * under THIS origin — relative `/v1/*` fetches rewritten server-side to the api.
 * No CORS, no cross-origin cookie, no token in JS (ADR-0015 §4).
 */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

/**
 * 003 EARS-70 — the hardening of the answers `proxy.ts` never sees (the api
 * rewrite and Next's own assets; its matcher skips `/v1/*` and `/_next/*`).
 * Page answers get theirs, nonce CSP included, from the proxy; a second COOP
 * or CSP header on them would be a duplicate, so these rules name only those
 * two prefixes.
 */
const NON_PAGE_HARDENING = [
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes an `AGENTS.md` + `CLAUDE.md` into the app dir on `next dev`;
  // the repo's agent constitution is the root one. Off.
  agentRules: false,
  // Self-host as a Node container (ADR-0004 §2.3 / §18).
  output: "standalone",
  // Deterministic standalone layout: the server entry lands at
  // apps/login/server.js, the path apps/login/Dockerfile COPYs and
  // `pnpm ci:standalone-boot login` boots.
  outputFileTracingRoot: path.join(configDir, "../../"),
  // `@ds/auth-flow` ships .tsx with "use client" boundaries (ADR-0004 §6).
  transpilePackages: ["@ds/auth-flow", "@ds/design-system"],
  // Never advertise the framework on a security-sensitive host.
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: "/v1/:path*", destination: `${API_PROXY_TARGET}/v1/:path*` },
    ];
  },
  async headers() {
    return [
      { source: "/v1/:path*", headers: NON_PAGE_HARDENING },
      { source: "/_next/:path*", headers: NON_PAGE_HARDENING },
    ];
  },
};

export default config;
