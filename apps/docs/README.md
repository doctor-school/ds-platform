# `@ds/docs`

The DS Platform **documentation site** — ADRs, feature/tech specs, the skill
catalog, and the product glossary, rendered with **Fumadocs** (Next.js App
Router) (ADR-0006). This is the read/render surface; content is authored as MDX
in `content/` (and edited through `@ds/docs-cms`, the Keystatic companion).

## Public surface

A Next.js app served at the docs URL. Content and rendering:

```
content/          # the SSOT MDX corpus
├── adr/          # architecture decision records (0001–00NN, EN+RU)
├── specs/        # feature / product / tech specs
├── skills/       # project skill catalog (SKILL.md — the path is the contract)
└── product/glossary/   # file-per-term glossary
app/              # Fumadocs App Router pages
source.config.ts  # fumadocs-mdx source definition (runs on postinstall)
```

`content/` is authoritative for ADRs, specs, and skills referenced across the
repo — links elsewhere point at these paths.

## Build / test

```bash
pnpm --filter @ds/docs dev        # next dev --webpack
pnpm --filter @ds/docs build      # next build --webpack
pnpm --filter @ds/docs start      # next start
pnpm --filter @ds/docs typecheck  # tsc --noEmit
pnpm --filter @ds/docs lint       # next lint
```

`postinstall` runs `fumadocs-mdx` to generate the MDX source index.

## Owning ADR

- **ADR-0006** — documentation & SSOT (Fumadocs + Keystatic + glossary).
