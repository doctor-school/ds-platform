# design-sync notes — @ds/design-system → Claude Design

Target: «Doctor.School Design System», `https://claude.ai/design/p/1366789c-9a05-4137-952e-61147c7a9550` (pinned in `config.json`). Shape `package` — the repo has no Storybook; `apps/showcase` is the repo's own catalogue, not a Storybook.

## How this repo builds (read before every re-sync)

- The package ships **source only** (`exports` → `src/*.ts(x)`, no `dist/`, no `.d.ts`; each app compiles Tailwind itself). `cfg.buildCmd` runs `.design-sync/prepare.mjs`, which stages a package-shaped build in the gitignored `packages/design-system/.ds-sync-pkg/`: a `package.json` (real name/version, `types` → `types/ds-entry.d.ts`), `index.mjs` re-exporting `src/index.ts` **and** `src/blocks/index.ts` (the `@ds/design-system/blocks` entry — without it 40+ blocks are missing), a `tsc --emitDeclarationOnly` type tree, and `ds.css`.
- `ds.css` = Tailwind 4 CLI compile of `.design-sync/tailwind-input.css` (`globals.css` + `@source "./previews"`). It needs `.ds-sync/node_modules/.bin/tailwindcss` (`@tailwindcss/cli@4.3.3`, installed with the converter deps). **Re-run prepare after editing any preview** so the classes it uses get emitted; `preview-rebuild.mjs` alone does not recompile CSS.
- `@ds/schemas` must be built first (`pnpm -F @ds/schemas build`) or esbuild fails with `[WORKSPACE_SIBLING]`.
- Converter deps (in `.ds-sync/`): `esbuild ts-morph @types/react playwright@1.63.0 @tailwindcss/cli@4.3.3 tailwindcss@4.3.3`. playwright 1.63.0 matches the cached `chromium-1243`.
- Build command (repo root): `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules packages/design-system/node_modules --entry packages/design-system/.ds-sync-pkg/index.mjs --out ./ds-bundle` (driver: same flags on `resync.mjs`).
- Config paths `srcDir`/`cssEntry`/`tsconfig` are relative to the staged `.ds-sync-pkg/` (the converter's package dir), hence `../src` etc.

## Component list

- 131 components. `componentSrcMap` pins every compound subpart (`DialogContent`, `TableRow`, `FormLabel`, …) to its parent's source file so it groups with the parent (fuzzy-find misses them → `general`), and excludes the six Zod `*FieldSchema` exports (not components). A new subpart export lands in `general` until pinned — regenerate pins by the same rule.
- Groups: `primitives`, `blocks`, `fields` (from source dirs).

## Fonts

- Inter: Google Fonts `@import url(...)` at the top of `tailwind-input.css` — the same source the apps use via `next/font/google`. Validate prints `[FONT_REMOTE]` (expected).
- Tactic Sans Extended / Century Gothic / Montserrat are RESERVED brand faces in the token map (brand-token-map spec: promo/logo/social only, licensed, loaded by no product surface). Listed in `runtimeFontPrefixes` to silence `[FONT_MISSING]`; designs fall back to Inter exactly as the product does. If a surface ever loads them, ship them via `extraFonts` instead.

## Previews

- Authored for every component in `.design-sync/previews/` from `apps/showcase/app/{primitives,blocks}/*-view.tsx` compositions. Overlays (`Dialog*`, `AlertDialog*`, `Sheet*`) render open with `cardMode: single` + viewport; wide blocks use `cardMode: column`.
- Product copy rule baked into previews and `conventions.md`: cost is «N Pul», never «бесплатно»/roubles.

## Authoring gotchas (folded from the 2026-10-01 wave)

- Inline spacing: there are no `--spacing-N` vars; use `calc(var(--spacing) * N)` or the semantic `--space-*` tokens. Fraction widths (`w-3/5`) and `gap-1.5/2.5` are absent from the compiled CSS until a preview uses them and prepare re-runs.
- Capture frame is 900x700 and viewport-only: anything taller (~650px+) or behind the 901px `layout:` breakpoint needs `cardMode: column` + `viewport` (Container, EventPageShell, AuthLayout, AuthShell, RegisterCard, AccountProfileCard, LegalDocument, WebinarStatusCard, WebinarRecordingPlaque, EventPageHero, DataTable). Sheet viewports stay >= 1024 wide (`size` and modality are viewport-owned). Exception: WebinarRoomLayout is `cardMode: column` with no viewport override — at 1280 its desktop JS layout runs inside the 390px mobile wrapper and breaks; the default frame shows the mobile room correctly.
- Harness false positive: `package-validate`/`package-capture` treat a cell whose text starts with the warning glyph as a crashed cell. The DS `FormError` banner and `FormMessage`/`FormErrorSummary` start with it. Error-state cells therefore lead with a `sr-only` caption (auth cards) or realistic preceding content (Form*). Remove when the harness detects crashes by marker.
- react-hook-form interop works: previews import `useForm` from `react-hook-form`; the bundle's `Form`/`FormField` share the context.
- Not on the public module: `FormError`, `useForm` (OtpFocusScreen is shown through LoginCard's code stage; AuthCard's error-banner cell dropped).
- `.d.ts` loses `| null`: EventSignupCard `cta.href`/`reason`/`presenceCount` are `string | null` and the card checks `!== null`; previews pass explicit `null`. Same trap for designs — `conventions.md` does not cover it yet.
- Combobox has no `open` prop: closed states only. MonthPicker open cell reserves room with padding (absolute popover).
- Product copy: the showcase and `packages/auth-flow` copy still contain «Бесплатно…» strings; previews replace them («N Pul»).
- Skipped (floor card): SmartCaptcha, BotProtectionField — invisible Yandex captcha, nothing renders at rest without the remote script. Interaction-only states (hover/focus/drag, Combobox panel, focused OTP slot) are not shown.

## Known render warns

- `[RENDER_THIN] variants render identically` on WebinarRoomLayout: the sheet shows the two cells differ (MobileWithSlimBar adds the context bar under the player); the check's measurement collapses on the room's fixed-height mobile frame. Recorded, not a defect.
- `[FONT_REMOTE]` Inter — expected.

## Re-sync risks

- `prepare.mjs` mirrors the package's public entries by hand (root + `blocks`). A new `exports` subpath that is not re-exported from either entry (e.g. `./events-filter` style) is invisible to the sync — check `package.json` `exports` vs the two index files.
- Previews copy showcase compositions; prop renames in the DS break them (`preview build failed` in the build log, or a runtime crash on a missing field → floor card). esbuild does not typecheck, so check previews with `tsc` first and without the converter: a throwaway tsconfig extending `packages/design-system/tsconfig.json` with `include` = `.design-sync/previews/*.tsx` and `paths` for `@ds/design-system` (a file re-exporting `src/index.ts` + `src/blocks/index.ts`), `@ds/schemas` (`packages/schemas/src/index.ts`) and `react`/`react/jsx-runtime` (the package's `@types/react`). It runs under the package's `exactOptionalPropertyTypes`: omit a prop rather than pass `undefined`.
- The bundle CSS only contains utilities used by DS sources + previews; designs that use other Tailwind classes silently get nothing (documented in `conventions.md`).
- Inter loads from fonts.googleapis.com at runtime (network-fetched asset).
