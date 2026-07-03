# syntax=docker/dockerfile:1
# ds-api production image — NestJS 11 + Fastify, ESM (ADR-0002). DSO-100 spec §2.1.
#
# Built ON-BOX (no registry) with the REPO ROOT as build context — see
# infra/deploy/compose/api-prod/compose.yml (`build.context` = repo root,
# `dockerfile` = apps/api/Dockerfile). Multi-stage:
#   base    corepack/pnpm.
#   deps    install the whole workspace (frozen lockfile) — shared by build+migrate.
#   build   `turbo run build` @ds/api + its workspace deps (@ds/db, @ds/schemas) via
#           the repo's own build graph (turbo `^build`), then `pnpm deploy` assembles
#           a self-contained prod tree (app dist + deps' dist + prod-only node_modules).
#   migrate one-shot drizzle-kit migrate target (carries drizzle-kit + the migrations
#           + drizzle.config) — run by `docker compose run --rm migrate` at deploy
#           BEFORE the runtime `api` comes up (README apply step). The `--prod`
#           runtime tree deliberately excludes drizzle-kit, so migrations run from
#           this fuller stage, never from the runtime image.
#   runtime slim non-root image that runs `node dist/main.js`.
#
# ⚠ DSO-100: authored from the monorepo build contract; NOT yet build-verified on
# the box (no local Docker on the authoring host). First on-box `docker compose
# build` is the verification gate before this is called done. `pnpm deploy` (pnpm
# 10) assembles /out from the workspace graph — verify it resolves the workspace
# deps on the first build; if pnpm 10 needs `--legacy`, add it here.
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
# Whole monorepo (context = repo root; .dockerignore keeps the tar lean). The full
# workspace install (incl. dev deps like drizzle-kit) is shared by build + migrate.
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
# Build @ds/api and everything it depends on, in dependency order (turbo ^build).
RUN pnpm turbo run build --filter=@ds/api
# Assemble a self-contained, prod-only deployment of @ds/api into /out.
RUN pnpm --filter=@ds/api deploy --prod /out

# One-shot migration runner (deploy-time; NOT a long-running service). Reuses the
# full install (drizzle-kit is a devDependency, absent from the runtime image) and
# the committed migrations under apps/api/drizzle + packages/db/drizzle.config.ts.
# DATABASE_URL is injected from api.env by the compose `migrate` service (points at
# the data-prod PRIVATE IP / ds_prod). `drizzle:migrate:ci` = a bare
# `drizzle-kit migrate` (NO dev:snapshot wrapper — that is a dev-stand-only alias).
FROM deps AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "run", "drizzle:migrate:ci"]

FROM node:22-slim AS runtime
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
