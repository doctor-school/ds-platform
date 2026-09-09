# DS Platform

Doctor.School medical-education platform (B2B sponsor → B2D doctor).

## Status

Phase 0 (greenfield, brainstorm complete). Pre-pilot target: 2026 Q3 (TBD).

## Stack

- **Backend:** NestJS + Zod + REST + openapi-typescript (ADR-0002); `apps/api/`
- **Data:** Postgres 17 + Drizzle + pgvector (ADR-0003); schemas in `packages/db/`, migrations in `apps/api/drizzle/`
- **Frontend:** Next.js 16 + Refine; 5 apps — `apps/doctor/` (`doctor.school` storefront), `apps/portal/` (`academy.doctor.school`), `apps/promo/`, `apps/admin/`, `apps/cms/` (Payload v3 content-only) (ADR-0004, two-storefront topology ADR-0015)
- **Mobile:** React Native + Expo + WatermelonDB (ADR-0005); `apps/mobile/`
- **Docs:** Fumadocs (`apps/docs/`) + glossary in `apps/docs/content/product/glossary/` (ADR-0006)
- **AI dev loop:** Claude Code and local Codex with shared disciplines and independent interactive review (ADR-0007); no automated reviewer-bot
- **Repo:** pnpm workspaces + Turborepo + changesets + GitHub Actions CI on GitHub-hosted runners (ADR-0008 §2.8)
- **Identity:** Zitadel (ADR-0001 §8, closed per DSP-209) + Cerbos RBAC (ADR-0003 §5)

Full reference: `apps/docs/content/adr/`.

Runtime/operational tooling (Coolify preview, Caddy, GlitchTip, Loki, Vault, Unleash): see [engineering-readiness spec](apps/docs/content/specs/tech/2026-05-12-engineering-readiness-design-en.md).

## Prerequisites

- Node 24 LTS (`nvm use` reads `.nvmrc`)
- pnpm 10 (`corepack enable` auto-fetches from `packageManager`)
- gh CLI (`brew install gh` / `winget install GitHub.cli`)

CI and application images select Node 24; `engines.node` retains the supported
developer runtime range. `Runtime images` CI builds all four production
Dockerfiles, exercises API `pnpm deploy --prod --legacy` packaging and migrations
against an isolated database, then verifies HTTP readiness inside each image.
It uploads the readiness result, Node version and image ID as CI artifacts.

## Install + Run

```bash
pnpm install
pnpm bootstrap            # AI-agent live state snapshot
pnpm backlog:triage       # per-Issue readiness from the blocked_by graph (not labels)
pnpm dev                  # all apps in parallel
pnpm --filter @ds/api dev   # single app
```

## Contribute

Read [AGENTS.md](AGENTS.md) and [portable agent discipline](apps/docs/content/agent-discipline.md) for both harnesses. [CLAUDE.md](CLAUDE.md) adds only Claude Code bindings; Codex loads roles from `.codex/agents/` and project skills through the `.agents/skills` bridge materialized by `pnpm install`. Hooks are capabilities to verify, not implied guarantees: see [adapter diagnostics](tools/hooks/README.md). Instruction budgets: `pnpm lint:instruction-budget` checks both root sets; `--harness codex` / `--harness claude` inspects one.

## Owners

@sidorovanthon (Phase 0 single owner; CODEOWNERS splits at hire #2).
