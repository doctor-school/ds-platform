# syntax=docker/dockerfile:1
# ds-doctor production image — Next.js 16 App Router, standalone output (ADR-0004
# §2.3/§18; next.config.ts `output: "standalone"`). Mirrors apps/portal/Dockerfile.
#
# ADR-0015 §7: the deployment delta for the two-storefront topology is ONE more
# container and ONE more vhost (apps/doctor → the doctor storefront,
# academy.doctor.school → apps/portal). This image is that container, and #1723
# wired it in: `doctor` in infra/deploy/compose/api-prod/compose.yml behind the
# Caddy vhost new.doctor.school. That host is TEMPORARY — the root doctor.school
# cut-over waits on data migration and the retirement of the old site (owner
# decision on #1430, 2026-08-26).
#
# Built ON-BOX (no registry) with the REPO ROOT as build context. Multi-stage:
#   1. install the whole workspace (frozen lockfile),
#   2. `turbo run build` @ds/doctor + its workspace deps (@ds/design-system token
#      generation, @ds/schemas dist) in dependency order,
#   3. ship ONLY Next's standalone server + static assets into a slim non-root
#      runtime. Next traces the monorepo root, so the standalone tree nests the
#      app under apps/doctor/ (server entry = apps/doctor/server.js).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are INLINED into the client bundle at BUILD time, so the Yandex
# SmartCaptcha site key must arrive as a build-arg (not runtime env) — portal
# precedent. Empty is the local-dev default and renders no widget; production
# supplies the real key via the compose build arg (#1723) and `new.doctor.school`
# must also be on the SmartCaptcha resource's allowed domains. The SERVER half
# lives in api.env (SMARTCAPTCHA_SERVER_KEY), never here.
ARG NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY=
ENV NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY=$NEXT_PUBLIC_SMARTCAPTCHA_SITE_KEY
# API_PROXY_TARGET must be present at BUILD time: Next evaluates `rewrites()`
# during `next build` and freezes the destination into .next/routes-manifest.json
# — runtime env cannot change it (DSO-100 on-box find on the portal image: built
# without it, the app proxied /v1/* to the baked `?? "http://localhost:3000"`
# fallback → ECONNREFUSED, despite a correct runtime API_PROXY_TARGET).
# NOTE the ARG/ENV alone is NOT enough: the build runs through turbo, whose strict
# env mode strips undeclared vars from the task process — API_PROXY_TARGET must
# ALSO be on the `build` task's `env` allowlist in turbo.json (it already is,
# shared with the portal).
ARG API_PROXY_TARGET=http://localhost:3000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@ds/doctor

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next standalone bundle (server + minimal traced node_modules, monorepo-nested).
COPY --from=build --chown=node:node /repo/apps/doctor/.next/standalone ./
# Static assets + public are NOT in standalone — copy them alongside.
COPY --from=build --chown=node:node /repo/apps/doctor/.next/static ./apps/doctor/.next/static
COPY --from=build --chown=node:node /repo/apps/doctor/public ./apps/doctor/public
USER node
EXPOSE 3004
ENV PORT=3004 HOSTNAME=0.0.0.0
CMD ["node", "apps/doctor/server.js"]
