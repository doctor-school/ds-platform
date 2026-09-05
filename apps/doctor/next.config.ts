import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Same-origin BFF proxy upstream — the SAME invariant the portal carries
 * (`apps/portal/next.config.ts`), re-stated here because it is per-ORIGIN and
 * therefore cannot be inherited: the session is carried by the
 * `__Host-ds_session` cookie, and the `__Host-` prefix LOCKS that cookie to the
 * exact origin that set it (no `Domain` attribute). `doctor.school` and
 * `academy.doctor.school` are different origins, so they hold SEPARATE session
 * cookies (ADR-0015 §4) — this app must therefore serve the BFF under its OWN
 * origin: relative `/v1/*` fetches with `credentials: "include"`, rewritten
 * server-side to the api upstream, so `Set-Cookie` lands on doctor.school where
 * `__Host-` accepts it. No CORS, no cross-origin cookie, no token in JS.
 *
 * Continuity between the two hosts is OIDC silent re-auth against the single
 * Zitadel identity (ADR-0015 §4) — never a shared cookie; the host is not an
 * authz boundary (the api re-checks every request).
 */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ?? "http://localhost:3000"
).replace(/\/$/, "");

const config: NextConfig = {
  reactStrictMode: true,
  // Next 16 writes an `AGENTS.md` + `CLAUDE.md` into the app dir on `next dev`.
  // This repo's agent constitution is the ROOT `AGENTS.md` (+ `CLAUDE.md`), and a
  // per-app generated copy would both shadow it for any agent opening
  // `apps/doctor/` and land as permanently untracked dirt in `git status`. Off.
  agentRules: false,
  // Self-host as a Node container, no Vercel runtime (ADR-0004 §2.3 / §18).
  output: "standalone",
  // Pin the file-tracing root to the monorepo root so the standalone layout is
  // DETERMINISTIC — the server entry lands at apps/doctor/server.js, exactly the
  // path apps/doctor/Dockerfile COPYs and `pnpm ci:standalone-boot doctor` boots.
  outputFileTracingRoot: path.join(configDir, "../../"),
  // Consume the internal packages as source (.tsx) — owned-code shadcn model
  // (ADR-0004 §6), no separate build step. `@ds/room` (#1722) is the shared live
  // room unit this app mounts at /events/:slug/room; it ships TypeScript sources
  // with "use client" boundaries, so it must be transpiled here exactly as the
  // design system is.
  transpilePackages: ["@ds/design-system", "@ds/room"],
  // Storefront → api proxy. Client-IP note (#1655): this rewrite forwards the
  // incoming request headers VERBATIM to the api, `x-forwarded-for` included, but
  // it does NOT append its own hop — Next's rewrite proxy (httpxy) enriches the
  // forwarded-* headers only under an `xfwd` option it never sets, and its
  // fallback middleware writes them only when absent. So the api receives exactly
  // the chain Caddy built (`<client>`, or `<client-supplied>, <client>` when the
  // caller sent one), and the api's address-predicate `trustProxy`
  // (apps/api/src/config/trust-proxy.ts) resolves the real client from it —
  // identically to the direct academy/api path, which is why that config keys on
  // trusted proxy ADDRESSES and not on a hop count. Next exposes no knob to turn
  // the appending on; nothing is needed, since the socket peer here is the
  // container network the api already trusts.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_PROXY_TARGET}/v1/:path*` }];
  },
};

export default config;
