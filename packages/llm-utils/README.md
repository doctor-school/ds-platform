# `@ds/llm-utils`

Shared **LLM helper utilities** for the DS Platform AI stack (ADR-0007) — small,
framework-agnostic building blocks for assembling prompt context. Consumed as
**source `.ts`** (no build step); it depends only on `fast-glob`.

## Public surface

A single barrel export (`src/index.ts`, `main`/`types` point at source):

```ts
import { buildContext, buildSystemBlocks } from "@ds/llm-utils";
import type {
  BuildContextOpts,
  ContextInput,
  CachedBlock,
} from "@ds/llm-utils";
```

- `buildContext` / `buildSystemBlocks` — assemble system/context blocks (with
  cache-block support) from file globs and inputs.

## Build / test

Consumed as source, so there is no package-local build. It is type-checked and
tested through the workspace root fan-out:

```bash
pnpm typecheck   # turbo run typecheck (includes this package via consumers)
pnpm test        # turbo run test
```

## Owning ADR

- **ADR-0007** — AI stack. See also ADR-0010 (dual-LLM pattern) and ADR-0011
  (egress control plane) for how LLM calls are governed.
