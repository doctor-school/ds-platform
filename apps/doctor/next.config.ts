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
  // Consume @ds/design-system as source (.tsx) — owned-code shadcn model
  // (ADR-0004 §6), no separate build step for the internal package.
  transpilePackages: ["@ds/design-system"],
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_PROXY_TARGET}/v1/:path*` }];
  },
};

export default config;
