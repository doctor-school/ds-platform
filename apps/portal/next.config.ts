import type { NextConfig } from "next";

/**
 * Same-origin BFF proxy upstream (#131, EARS-8 invariant). The session is carried
 * by the `__Host-ds_session` cookie, which `__Host-` LOCKS to the exact origin
 * that set it (no Domain attribute — see `apps/api/.../session.cookie.ts`). So the
 * portal must serve the BFF under its OWN origin: every auth form fetches the
 * relative `/v1/auth/*` path with `credentials: "include"`, Next rewrites it to
 * this upstream server-side, and the `Set-Cookie` comes back on the portal's
 * origin where `__Host-` accepts it. No CORS, no cross-origin cookie, no token in
 * JS. The upstream is env-driven so dev (local api on :3000) and prod (internal
 * service URL) differ by config only; the default targets the api's local port.
 */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

const config: NextConfig = {
  reactStrictMode: true,
  // Self-host as a Node container, no Vercel runtime (ADR-0004 §2.3 / §18).
  output: "standalone",
  // Consume @ds/design-system as source (.tsx) — owned-code shadcn model,
  // no separate build step for the internal package (ADR-0004 §6).
  transpilePackages: ["@ds/design-system"],
  // Reverse-proxy the live `/v1/*` BFF under the portal origin so the `__Host-`
  // session cookie is set/sent same-origin (see API_PROXY_TARGET above). The
  // capture covers the whole versioned api surface (`/v1/auth/*` today) so the
  // portal never needs CORS or an absolute api URL in client code.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_PROXY_TARGET}/v1/:path*` }];
  },
};

export default config;
