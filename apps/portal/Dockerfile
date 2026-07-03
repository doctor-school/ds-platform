# syntax=docker/dockerfile:1
# ds-portal production image — Next.js 16 App Router, standalone output (ADR-0004
# §2.3/§18; next.config.ts `output: "standalone"`). DSO-100 spec §2.1.
#
# Built ON-BOX (no registry) with the REPO ROOT as build context — see
# infra/deploy/compose/api-prod/compose.yml. Multi-stage:
#   1. install the whole workspace (frozen lockfile),
#   2. `turbo run build` @ds/portal + its workspace deps (@ds/design-system token
#      generation, @ds/schemas dist) in dependency order,
#   3. ship ONLY Next's standalone server + static assets into a slim non-root
#      runtime. Next traces the monorepo root, so the standalone tree nests the
#      app under apps/portal/ (server entry = apps/portal/server.js).
#
# The BFF is reached same-origin via next.config rewrites → API_PROXY_TARGET
# (set to the internal compose URL http://api:3000 in api.env). No CORS.
#
# DSO-100: build-verified ON-BOX (api-prod, 2026-07-03) — the standalone COPY paths
# resolve as pinned (entry at apps/portal/server.js) and the portal serves on 3001.
# NOTE: API_PROXY_TARGET must arrive as a BUILD ARG (below) — Next freezes
# `rewrites()` destinations into .next/routes-manifest.json at build time.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are INLINED into the client bundle at BUILD time, so the Yandex
# SmartCaptcha site key must arrive as a build-arg (not runtime env). Empty by
# default — bot protection is OFF in the 003 slice (BOT_PROTECTION_ENABLED unset ⇒
# the field renders an inactive placeholder, portal still builds). Pass a real key
# via compose `build.args` to bake the live widget. The SERVER half lives in
# api.env (SMARTCAPTCHA_SERVER_KEY), never here.
ARG NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY=
ENV NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY=$NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY
# API_PROXY_TARGET must be present at BUILD time: Next evaluates `rewrites()` during
# `next build` and freezes the destination into .next/routes-manifest.json — runtime
# env cannot change it (DSO-100 on-box find: built without it, the portal proxied
# /v1/* to the baked `?? "http://localhost:3000"` fallback → ECONNREFUSED, despite a
# correct runtime API_PROXY_TARGET in its env). The default keeps local single-app
# builds working; the prod compose passes build.args API_PROXY_TARGET=http://api:3000.
# NOTE the ARG/ENV alone is NOT enough: the build runs through turbo, whose strict
# env mode strips undeclared vars from the task process — API_PROXY_TARGET must ALSO
# be on the `build` task's `env` allowlist in turbo.json (DSO-100 second on-box find:
# with the ARG but no allowlist, the manifest still baked the localhost fallback).
ARG API_PROXY_TARGET=http://localhost:3000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@ds/portal

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next standalone bundle (server + minimal traced node_modules, monorepo-nested).
COPY --from=build --chown=node:node /repo/apps/portal/.next/standalone ./
# Static assets + public are NOT in standalone — copy them alongside.
COPY --from=build --chown=node:node /repo/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build --chown=node:node /repo/apps/portal/public ./apps/portal/public
USER node
EXPOSE 3001
ENV PORT=3001 HOSTNAME=0.0.0.0
CMD ["node", "apps/portal/server.js"]
