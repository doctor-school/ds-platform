---
title: "fumadocs 15→16 + Next 15→16 cascade upgrade (Design)"
description: "Single bundled PR upgrading apps/docs (fumadocs-mdx 14→15, fumadocs-core 15→16, fumadocs-ui 15→16, next 15→16) and apps/docs-cms (next 15→16), locked together by peer-dep coupling. Captures peer-cascade rationale, breaking-change matrix against actual usage surface, and verification plan."
slug: fumadocs-next-16-upgrade
status: Proposed
tracker: GitHub Issue #56
parent_issue: 56
predecessor_pr: 57
lang: en
---

# fumadocs 15→16 + Next 15→16 cascade upgrade (Design)

## 1. Context

PR #57 (closed Issue #54) bumped `fumadocs-mdx` from 11.10.1 to 14.2.14 — the last step compatible with the existing `fumadocs-core/ui@15` + `next@15` baseline. The follow-up (this design) tracks the remaining cascade to `fumadocs-mdx@15 + fumadocs-core@16 + fumadocs-ui@16 + next@16`.

The cascade is **not optional segmentation** — it is forced by peer-dep coupling. As of 2026-05-28 against the live npm registry:

| Package                | Version       | Peer-dep on cascade neighbours                         |
| ---------------------- | ------------- | ------------------------------------------------------ |
| `fumadocs-mdx@15.0.9`  | latest        | `fumadocs-core: ^16.7.0`, `next: ^15.3.0 \|\| ^16.0.0` |
| `fumadocs-core@16.9.2` | latest        | `next: 16.x.x` (hard), `react: ^19.2.0`                |
| `fumadocs-ui@16.9.2`   | latest        | (matches core@16)                                      |
| `next@16.2.6`          | latest stable | `react: ^19.2.0`                                       |

`fumadocs-core@16` hard-pins `next: 16.x.x`, so moving past `fumadocs-mdx@14` mandates Next 16. The four bumps form one atomic decision.

Per saved feedback `feedback-dep-bump-verify-abi-not-just-peers`, peer-ranges have already misled this repo once (the `mdx@14.3.1` codegen-split incident). This spec therefore enumerates the actual import surface and risks per file, not just declared peers.

## 2. Goals + non-goals

### Goals

1. `apps/docs` and `apps/docs-cms` build cleanly on Next 16 + fumadocs 16.
2. Existing fumadocs-rendered routes (`/`, `/adr/<slug>`, `/architecture/*`, etc.) render identically — no visual or routing regression.
3. Keystatic CMS UI at `apps/docs-cms/keystatic` stays functional under Next 16.
4. All CI jobs that touch docs continue to pass: `docs-build`, `glossary-mdx`, `glossary-roundtrip`, `spec-link`, `module-readme`.
5. Single revertable commit (or single PR) — rollback is one `git revert`.

### Non-goals

- Migrating other apps (`admin / api / cms / mobile / portal / promo`) — they are empty scaffolds with no `next` or `react` dependency yet. They will be born on Next 16 when first scaffolded.
- Adopting new Next 16 features (PPR, dynamicIO, new caching primitives). Pure plumbing upgrade.
- UI redesign or fumadocs-ui theming refresh.
- Codemod runs for `apps/docs` — async-params pattern is already in place.

## 3. Scope — exact pin changes

| File                         | Pin             | From      | To       |
| ---------------------------- | --------------- | --------- | -------- |
| `apps/docs/package.json`     | `fumadocs-mdx`  | `14.2.14` | `15.0.9` |
| `apps/docs/package.json`     | `fumadocs-core` | `15.7.13` | `16.9.2` |
| `apps/docs/package.json`     | `fumadocs-ui`   | `15.7.13` | `16.9.2` |
| `apps/docs/package.json`     | `next`          | `15.5.18` | `16.2.6` |
| `apps/docs-cms/package.json` | `next`          | `15.5.18` | `16.2.6` |
| `pnpm-lock.yaml`             | (regenerated)   | —         | —        |

**Expected code diff outside manifests + lockfile: zero.**

## 4. Actual usage surface

### 4.1 `apps/docs` — fumadocs consumers

| File                            | Imports                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `app/(docs)/[...slug]/page.tsx` | `fumadocs-ui/page`, `fumadocs-ui/mdx`, `next/navigation` |
| `app/(docs)/layout.tsx`         | `fumadocs-ui/layouts/docs`                               |
| `app/layout.tsx`                | `fumadocs-ui/provider`                                   |
| `app/layout.config.tsx`         | `fumadocs-ui/layouts/shared` (type-only)                 |
| `lib/source.ts`                 | `fumadocs-core/source`, `@/.source/server`               |
| `next.config.mjs`               | `fumadocs-mdx/next`                                      |
| `source.config.ts`              | `fumadocs-mdx/config`                                    |

All seven imports use top-level export paths that fumadocs has kept stable across the 15→16 transition (verified against `fumadocs-ui@16.9.2` package tree).

`app/(docs)/[...slug]/page.tsx` already uses the async dynamic-params pattern (`params: Promise<{ slug?: string[] }>` + `await props.params`) — the main Next 15→16 breaking contract is already satisfied.

### 4.2 `apps/docs-cms` — Keystatic + Next consumers

| File                                     | Imports                         |
| ---------------------------------------- | ------------------------------- |
| `keystatic.config.ts`                    | `@keystatic/core`               |
| `app/keystatic/keystatic.tsx`            | `@keystatic/next/ui/app`        |
| `app/api/keystatic/[...params]/route.ts` | `@keystatic/next/route-handler` |
| `app/page.tsx`                           | `next/navigation` (redirect)    |

No direct use of dynamic Next APIs (`cookies()`, `headers()`, `draftMode()`, `params`) — Keystatic owns the Next contract through its adapters.

## 5. Breaking-change matrix

| Change                                                                  | Source                    | Affects                                               | Mitigation                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Async dynamic APIs (`params`, `searchParams`, `cookies()`, `headers()`) | Next 15→16                | `apps/docs` page route                                | **Already migrated** — async params in place (verified in `app/(docs)/[...slug]/page.tsx`).                                                                                   |
| Default caching: `fetch` no longer cached by default                    | Next 15→16                | Neither app uses `fetch` in SSR paths today           | No-op.                                                                                                                                                                        |
| Turbopack as default dev/build engine                                   | Next 16                   | Both apps                                             | Both use stock `next dev`/`next build`. If Turbopack regresses on fumadocs MDX pipeline, fall back to webpack via `--webpack` flag.                                           |
| React 19.2 peer requirement                                             | fumadocs-core 16, next 16 | Both apps                                             | Already on `react@19.2.6` / `react-dom@19.2.6`. ✓                                                                                                                             |
| `zod: 4.x.x` listed in `fumadocs-core@16` peers                         | fumadocs-core 16          | None — `apps/docs` does not import `zod`              | Expected to be `peerDependenciesMeta.optional`. If pnpm errors on install, add `pnpm.peerDependencyRules.allowedVersions` or `ignoreMissing` for `zod` scoped to `apps/docs`. |
| `@keystatic/next@5.0.4` peer-range `next: ">=14"`                       | Keystatic                 | `apps/docs-cms`                                       | Range satisfies Next 16 on paper; verify via local dev-server + UI navigation (risk R1 below). If broken, pin `next` to last 15.x in `apps/docs-cms` and reopen this Issue.   |
| fumadocs-mdx codegen output shape                                       | fumadocs-mdx 14→15        | `apps/docs/lib/source.ts` (`@/.source/server` import) | Same import surface as 14.2.14; if changed, follow the v15 release notes (already established once in PR #57).                                                                |

## 6. Risk register

| #      | Risk                                                                                                    | Likelihood                                                        | Verification                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **R1** | Keystatic ABI break on Next 16 (wide-open peer-range hides incompat)                                    | Medium — wide ranges are unreliable for libs using Next internals | `pnpm --filter docs-cms build`; `pnpm --filter docs-cms dev` → manually open `/keystatic`, edit one entry, save |
| **R2** | fumadocs-core/ui 16 API drift on our 7-file surface                                                     | Low — stable export paths                                         | `pnpm --filter docs build`; dev-server open `/`, `/adr/0004`, `/adr/0006` (heaviest ADR pages)                  |
| **R3** | fumadocs-mdx@15 codegen shape change                                                                    | Low — minor major, post-split                                     | `pnpm --filter docs typecheck` after `postinstall`                                                              |
| **R4** | pnpm install hard-errors on `zod: 4.x.x` optional peer                                                  | Low                                                               | If it occurs, add `pnpm.peerDependencyRules.ignoreMissing: ["zod"]` (scoped)                                    |
| **R5** | CI-chain regressions (`docs-build`, `glossary-mdx`, `glossary-roundtrip`, `spec-link`, `module-readme`) | Low — none of these touch Next runtime directly                   | Full CI run on branch before merge                                                                              |

## 7. Verification plan

Order matters — cheapest signal first.

1. `pnpm install` after pin changes; capture peer-dep warnings.
2. `pnpm --filter docs typecheck` — catches R3 cheapest.
3. `pnpm --filter docs build` — covers R2 + fumadocs static export.
4. `pnpm --filter docs-cms build` — covers R1 ABI surface at compile time.
5. `pnpm --filter docs dev` — open `/`, `/adr/0004`, `/adr/0006`; check console for hydration errors.
6. `pnpm --filter docs-cms dev` — open `/keystatic`; navigate one collection; edit + save one entry.
7. Push branch, watch full CI matrix.

Promotion gate: all six local checks green **and** all CI jobs green → `gh pr merge --auto`.

## 8. Rollback

Single PR → single revert. `git revert <merge-commit>` restores the Next 15 + fumadocs 15 baseline. The Issue is reopened with the failure mode documented in a follow-up comment.

If only `apps/docs-cms` fails (R1) but `apps/docs` is healthy, the **first** rollback step is to pin `apps/docs-cms` back to `next@15.5.18` in a small follow-up PR, leaving `apps/docs` on the new cascade. This is allowed because each app declares its own `next` independently — there is no workspace-wide Next pin.

## 9. Out of scope (deferred)

- Migrating `apps/admin / api / cms / mobile / portal / promo` onto Next 16 — they are empty scaffolds today; they will be born on Next 16 when scaffolded.
- Adopting `dynamicIO` or `cacheLife` / `cacheTag` for `apps/docs` — purely additive features, separate follow-up Issue if value emerges.
- Fumadocs search / typed-routes adapters that pull in `zod@4` — none currently in use.

## 10. References

- Predecessor: PR #57 (Issue #54) — `fumadocs-mdx` 11 → 14
- Parent Issue: #56
- Saved feedback informing this spec:
  - `feedback-dep-bump-verify-pins-first`
  - `feedback-dep-bump-verify-abi-not-just-peers`
  - `feedback-specs-bilingual-only-for-product`
