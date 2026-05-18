# DS Platform

Doctor.School medical-education platform (B2B sponsor → B2D doctor).

## Status

Phase 0 (greenfield, brainstorm complete). Pre-pilot target: 2026 Q3 (TBD).

## Stack

- **Backend:** NestJS + Zod + REST + openapi-typescript (ADR-0002); `apps/api/`
- **Data:** Postgres 17 + Drizzle + pgvector (ADR-0003); schemas in `packages/db/`, migrations in `apps/api/drizzle/`
- **Frontend:** Next.js 15 + Refine; 4 apps — `apps/promo/`, `apps/portal/`, `apps/admin/`, `apps/cms/` (Payload v3 content-only) (ADR-0004)
- **Mobile:** React Native + Expo + WatermelonDB (ADR-0005); `apps/mobile/`
- **Docs:** Fumadocs (`apps/docs/`) + Keystatic editor (`apps/docs-cms/`) + glossary.yaml in `apps/docs/content/product/glossary/` (ADR-0006)
- **AI dev loop:** Claude Code + Codex async + reviewer-bot (ADR-0007)
- **Repo:** pnpm workspaces + Turborepo + changesets + GitHub-hosted CI (ADR-0008)
- **Identity:** Authentik/Zitadel (ADR-0001 §8 — TBD per spike) + Cerbos RBAC (ADR-0003 §5)

Full reference: `apps/docs/content/adr/`.

Runtime/operational tooling (Coolify preview, Caddy, GlitchTip, Loki, Vault, Unleash): see [engineering-readiness spec](https://github.com/sidorovanthon/bbm/blob/main/docs/superpowers/specs/2026-05-12-ds-platform-engineering-readiness-design-en.md).

## Prerequisites

- Node 22 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` auto-fetches from `packageManager`)
- gh CLI (`brew install gh` / `winget install GitHub.cli`)

## Install + Run

```bash
pnpm install
pnpm bootstrap            # AI-agent live state snapshot
pnpm dev                  # all apps in parallel
pnpm --filter @ds/api dev   # single app
```

## Contribute

See AGENTS.md (universal constitution) and CLAUDE.md (Claude Code overlay).

## Owners

@sidorovanthon (Phase 0 single owner; CODEOWNERS splits at hire #2).
