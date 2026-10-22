# syntax=docker/dockerfile:1
# ds-login production image (the sign-in host, ADR-0015 §4) — Next.js 16 App Router, standalone output (ADR-0004
# §2.3/§18; next.config.ts `output: "standalone"`). Mirrors apps/login/Dockerfile.
#
# Built, pushed and booted by runtime-images.yml; the stage/prod service and
# the `login.doctor.school` vhost that run it are #3171.
#
# Built ON-BOX (no registry) with the REPO ROOT as build context. Multi-stage:
#   1. install the whole workspace (frozen lockfile),
#   2. `turbo run build` @ds/login + its workspace deps (@ds/design-system token
#      generation, @ds/schemas dist) in dependency order,
#   3. ship ONLY Next's standalone server + static assets into a slim non-root
#      runtime. Next traces the monorepo root, so the standalone tree nests the
#      app under apps/login/ (server entry = apps/login/server.js).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# ENVIRONMENT-AGNOSTIC IMAGE (#2981): one build runs on stage and prod, so the
# build bakes no per-environment value. The SmartCaptcha site key is RUNTIME env
# (SMARTCAPTCHA_SITE_KEY, read per request by the @ds/auth-flow server mounts);
# only a value identical in every environment, like API_PROXY_TARGET below, is a
# build arg.
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
RUN pnpm turbo run build --filter=@ds/login

FROM node:24-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next standalone bundle (server + minimal traced node_modules, monorepo-nested).
COPY --from=build --chown=node:node /repo/apps/login/.next/standalone ./
# Static assets + public are NOT in standalone — copy them alongside.
COPY --from=build --chown=node:node /repo/apps/login/.next/static ./apps/login/.next/static
COPY --from=build --chown=node:node /repo/apps/login/public ./apps/login/public
USER node
EXPOSE 3005
# Idle keep-alive above every client of this server (#2682): Caddy keeps its
# upstream connections ~120 s idle and the /v1 rewrite forwards the api's
# `Keep-Alive: timeout=72`; Node's 5 s default let a client write onto a socket
# the server was closing. tools/ci/next-keep-alive.test.mjs pins the value.
ENV PORT=3005 HOSTNAME=0.0.0.0 KEEP_ALIVE_TIMEOUT=125000
CMD ["node", "apps/login/server.js"]
