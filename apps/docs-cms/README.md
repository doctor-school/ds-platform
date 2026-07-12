# `@ds/docs-cms`

The **Keystatic editor** for the documentation content owned by `@ds/docs`
(ADR-0006). A thin Next.js App Router app that hosts the Keystatic admin UI so
docs/glossary content can be edited in a form-based CMS while remaining
git-backed MDX — the same `content/` corpus `@ds/docs` renders.

## Public surface

A Next.js app (runs on port 3001 by default) exposing the Keystatic admin:

```
keystatic.config.ts  # collections / singletons → the docs content model
app/                  # Keystatic App Router mount
```

Edits are committed back to the git-tracked content the docs site renders; this
app is the authoring surface, `@ds/docs` is the reader surface.

## Build / test

```bash
pnpm --filter @ds/docs-cms dev        # next dev -p 3001
pnpm --filter @ds/docs-cms build      # next build
pnpm --filter @ds/docs-cms start      # next start -p 3001
pnpm --filter @ds/docs-cms typecheck  # tsc --noEmit
pnpm --filter @ds/docs-cms lint       # next lint
```

## Owning ADR

- **ADR-0006** — documentation & SSOT (Keystatic-managed content).
