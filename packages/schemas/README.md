# `@ds/schemas`

The DS Platform **API contract SSOT** — the **Zod** schemas every surface shares
(ADR-0002 §3, ADR-0006 §6.2). Framework-agnostic (depends on `zod` only): the
API validates against these, the frontends resolve forms against them, and the
generated SDK derives its types from them. **Edit the schema here, not a copy.**

## Public surface

Subpath exports (see `package.json` `exports`), compiled to `dist/`:

```ts
import {} from /* … */ "@ds/schemas"; // the schema barrel
import {} from /* … */ "@ds/schemas/health"; // health-check contracts
```

- `.` — the primary schema exports (auth, registration, domain contracts).
- `./health` — health/readiness contracts.

Because this is the wire SSOT, a schema message baked here outranks a portal
error-map — export bare regex/constants as the SSOT rather than duplicating rules
downstream.

## Build / test

```bash
pnpm --filter @ds/schemas build      # tsc -b → dist/
pnpm --filter @ds/schemas typecheck  # tsc --noEmit
pnpm --filter @ds/schemas test       # vitest run
pnpm --filter @ds/schemas clean      # rm -rf dist .tsbuildinfo
```

## Owning ADRs

- **ADR-0002 §3** — backend core stack (Zod as the REST contract).
- **ADR-0006 §6.2** — documentation & SSOT.
