# syntax=docker/dockerfile:1
# ds-api production image — NestJS 11 + Fastify, ESM (ADR-0002). DSO-100 spec §2.1.
#
# Built with the REPO ROOT as build context, in two places today:
#   - GitHub Actions (`.github/workflows/runtime-images.yml`) builds every image once
#     per `main` merge / internal PR and pushes it to the container registry
#     (infra/deploy/README.md → Container registry), with its digest recorded in the
#     run's `images-<sha>.json` artifact;
#   - ON-BOX, by infra/deploy/compose/api-prod/compose.yml (`build.context` = repo
#     root, `dockerfile` = apps/api/Dockerfile) — production only, until it too
#     switches to pulling by digest (#2981). Stage slots already pull the recorded
#     digest and never build (tools/staging/slot.mjs).
# Multi-stage:
#   base    corepack/pnpm.
#   deps    install the whole workspace (frozen lockfile) — shared by build+migrate-tree.
#   build   `turbo run build` @ds/api + its workspace deps (@ds/db, @ds/schemas) via
#           the repo's own build graph (turbo `^build`), then `pnpm deploy` assembles
#           a self-contained prod tree (app dist + deps' dist + prod-only node_modules).
#   migrate-tree  `pnpm deploy` of @ds/db — the package that owns drizzle.config.ts and
#           carries drizzle-kit + tsx (devDependencies) next to drizzle-orm + pg; tsx
#           runs the stage golden seed (`seed:golden`) from the same image.
#   migrate one-shot drizzle-kit migrate target: that @ds/db tree + the committed
#           migrations (apps/api/drizzle) + drizzle.config.ts, nothing else — run by
#           `docker compose run --rm migrate` at deploy BEFORE the runtime `api`
#           comes up (README apply step). The `--prod` runtime tree deliberately
#           excludes drizzle-kit, so migrations run from this image, never from the
#           runtime image.
#   runtime slim non-root image that runs `node dist/main.js`.
#
# DSO-100: build-verified ON-BOX (api-prod, 2026-07-03) — image builds, boots, and
# passes /v1/health + /v1/ready against the prod data plane (2026-07-03: postgres+
# pgvector; /v1/ready also reports objectStorage since #2821).
# `pnpm deploy` REQUIRES `--legacy` on pnpm 10 (ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE
# otherwise — this workspace does not set inject-workspace-packages).
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
# Whole monorepo (context = repo root; .dockerignore keeps the tar lean). The full
# workspace install is shared by build + migrate-tree.
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# Build @ds/api and everything it depends on, in dependency order (turbo ^build).
RUN pnpm turbo run build --filter=@ds/api
# Assemble a self-contained, prod-only deployment of @ds/api into /out.
RUN pnpm --filter=@ds/api deploy --prod --legacy /out

# Migration tree: a self-contained deployment of @ds/db WITH its devDependencies
# (drizzle-kit is one), not the whole workspace install. Deployed at the SAME absolute
# path the `migrate` image uses, so pnpm's bin shims and hoisted store resolve as built.
FROM deps AS migrate-tree
RUN pnpm --filter=@ds/db deploy --legacy /migrate/packages/db

# One-shot migration runner (deploy-time; NOT a long-running service). Layout mirrors
# the repo so the committed config's CWD-relative paths hold: CWD = apps/api,
# config = ../../packages/db/drizzle.config.ts, migrations out = ../../apps/api/drizzle.
# DATABASE_URL is injected from api.env by the compose `migrate` service (points at
# the data-prod PRIVATE IP / ds_prod). `drizzle:migrate:ci` = a bare
# `drizzle-kit migrate` (NO dev:snapshot wrapper — that is a dev-stand-only alias).
# The root package.json carries the `packageManager` pin; `corepack install` caches
# that pnpm in the image so `pnpm run` never downloads it at deploy time.
FROM base AS migrate
WORKDIR /migrate
COPY package.json ./package.json
RUN corepack install
COPY --from=migrate-tree /migrate/packages/db ./packages/db
COPY packages/db/drizzle.config.ts ./packages/db/drizzle.config.ts
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/drizzle ./apps/api/drizzle
ENV PATH=/migrate/packages/db/node_modules/.bin:$PATH
WORKDIR /migrate/apps/api
CMD ["pnpm", "run", "drizzle:migrate:ci"]

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node
# The BFF binds the port from api.env (PORT, default 3000); Caddy reaches it over
# the compose network. EXPOSE is documentation only.
EXPOSE 3000
CMD ["node", "dist/main.js"]
