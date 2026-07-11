# syntax=docker/dockerfile:1
# ds-admin production image — Next.js 16 + Refine CSR shell, standalone output
# (ADR-0004 §3/§5; next.config.ts `output: "standalone"`). Webinars wave-1
# operator surface (admin.doctor.school) — #729 / DSO-134, deploy-slice spec §2.1.
#
# Built ON-BOX (no registry) with the REPO ROOT as build context — see
# infra/deploy/compose/api-prod/compose.yml. Mirrors apps/portal/Dockerfile:
#   1. install the whole workspace (frozen lockfile),
#   2. `turbo run build` @ds/admin + its workspace deps (@ds/design-system token
#      generation, @ds/schemas dist) in dependency order,
#   3. ship ONLY Next's standalone server + static assets into a slim non-root
#      runtime. Next traces the monorepo root (outputFileTracingRoot pinned in
#      next.config.ts), so the standalone tree nests the app under apps/admin/
#      (server entry = apps/admin/server.js).
#
# The BFF is reached same-origin via next.config rewrites → API_PROXY_TARGET
# (the `__Host-ds_session` cookie is origin-locked, so /v1/* MUST be served
# under the admin origin — apps/admin/next.config.ts). No CORS.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
# API_PROXY_TARGET must be present at BUILD time: Next evaluates `rewrites()`
# during `next build` and freezes the destination into .next/routes-manifest.json
# — runtime env cannot change it (DSO-100 portal precedent). The default keeps
# local single-app builds working; the prod compose passes
# build.args API_PROXY_TARGET=http://api:3000. The ARG/ENV alone is NOT enough:
# the build runs through turbo, whose strict env mode strips undeclared vars —
# API_PROXY_TARGET is on the `build` task's `env` allowlist in turbo.json
# (declared for the portal, shared by every build task; #477).
ARG API_PROXY_TARGET=http://localhost:3000
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@ds/admin

FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Next standalone bundle (server + minimal traced node_modules, monorepo-nested).
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
# Static assets are NOT in standalone — copy them alongside.
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
# 3002 continues the prod compose port sequence (api 3000, portal 3001); the
# dev-script's 3200 is a workstation convention, not a container contract.
EXPOSE 3002
ENV PORT=3002 HOSTNAME=0.0.0.0
CMD ["node", "apps/admin/server.js"]
