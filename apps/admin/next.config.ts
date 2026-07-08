import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * next-intl plugin (007 EARS-10). Points at the single-locale request config
 * (`i18n/request.ts`, fixed `ru`). No `[locale]` routing or middleware — the
 * admin surface is RU-only with no switcher (mirrors the portal, #177).
 */
const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Same-origin BFF proxy upstream (007 reuses the shipped 003 auth, no new auth
 * primitive). The `platform_admin` session is carried by the `__Host-ds_session`
 * cookie, which `__Host-` LOCKS to the exact origin that set it (no Domain
 * attribute). So the admin app must serve the BFF under its OWN origin: the
 * Refine auth/data providers fetch the relative `/v1/*` path with
 * `credentials: "include"`, Next rewrites it to this upstream server-side, and
 * the `Set-Cookie` comes back on the admin origin where `__Host-` accepts it. No
 * CORS, no cross-origin cookie, no token in JS — identical to the portal proxy.
 * The upstream is env-driven so dev (local api) and prod (internal service URL)
 * differ by config only.
 */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

const config: NextConfig = {
  reactStrictMode: true,
  // Self-host as a Node container, no Vercel runtime (ADR-0004 §2.3 / §18).
  output: "standalone",
  // Pin the file-tracing root to the monorepo root (two levels up from apps/admin)
  // so the standalone layout is deterministic (mirrors the portal, DSO-100).
  outputFileTracingRoot: path.join(configDir, "../../"),
  // Consume @ds/design-system as source (.tsx) — owned-code shadcn model,
  // no separate build step for the internal package (ADR-0004 §6).
  transpilePackages: ["@ds/design-system"],
  // Reverse-proxy the live `/v1/*` BFF under the admin origin so the `__Host-`
  // session cookie is set/sent same-origin (see API_PROXY_TARGET above).
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_PROXY_TARGET}/v1/:path*` }];
  },
};

export default withNextIntl(config);
