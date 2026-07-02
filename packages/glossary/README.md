# @ds/glossary

Canonical domain-glossary ids and i18n label bundles for the DS Platform monorepo
(ADR-0006 §6.2).

## What this package exports

- `GLOSSARY_IDS` / `GlossaryId` / `GLOSSARY_TERMS` — `@ds/glossary` (or `@ds/glossary/ids`).
- i18n label bundles — `@ds/glossary/messages/<lang>/glossary.json` (`{ id: { title, description } }`).

```ts
import { GLOSSARY_IDS, type GlossaryId } from "@ds/glossary";
```

## Source of truth → generation

The source of truth is the Keystatic file-per-term glossary at
`apps/docs/content/product/glossary/*.md`. Each term declares its canonical id in
the body via `**Canonical id:** \`snake_id\``.

`src/ids.ts` and `messages/**/glossary.json` are **GENERATED — do not edit by hand.**
Regenerate with:

```sh
pnpm generate:glossary   # or: pnpm --filter @ds/glossary generate
```

The generated `src/ids.ts` is committed to Git so it resolves on a fresh checkout.
The `glossary-roundtrip` CI guard (`tools/lint/glossary-roundtrip-lint.ts`) keeps
the generated id-set in lockstep with the glossary source.

## Not yet built (tracked)

- ESLint rule `@ds/glossary-canonical-ids` + its `glossary-ids` CI job — deferred:
  the canonical id `doctor_guest` collides with the live RBAC role wire-value used
  as a string literal across auth/authz/db, which the rule (as sketched in
  ADR-0006 §6.3) would flag repo-wide. Needs a scoping design before it can land.
- Payload Glossary Collection sync (ADR-0006 §6.5) — deferred; its consumer app is
  not wired yet.
