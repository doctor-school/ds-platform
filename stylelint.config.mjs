/**
 * Stylelint config — #234 design-system lint guardrails (spec §4 level 2,
 * CSS-declaration side of "scale discipline").
 *
 * The rhythmguard ESLint plugin (eslint.config.js) governs scale discipline in
 * Tailwind CLASS STRINGS (`p-[13px]` in TSX). This config is its CSS-declaration
 * counterpart: rhythmguard's `use-scale` flags raw off-scale spacing in authored
 * CSS (`padding: 13px`) and autofixes to the nearest scale value.
 *
 * SINGLE SOURCE OF TRUTH (#234): the allowed spacing scale (px) is DERIVED from
 * the generated `allowed-tokens.json` (`spacingScalePx`, computed from the
 * `space.*` token VALUES, not the inert `--spacing-N` theme keys — see the
 * decision-debt note in style-dictionary.config.mjs), so styling, the class-
 * string ESLint gate, and this CSS gate all share one generated scale.
 *
 * SCOPE: authored CSS only. The GENERATED `tokens.css` is ignored — it is the
 * token source itself (it legitimately defines the `--space-*` values and uses
 * raw oklch/px primitives), so linting it would be linting the source of truth
 * against itself. App/design-system `globals.css` are mostly `@import` + a small
 * hand-authored base layer, which this gate keeps on-scale.
 */
import { readFileSync } from "node:fs";

const allowedTokens = JSON.parse(
  readFileSync(
    new URL(
      "./packages/design-system/src/styles/allowed-tokens.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

export default {
  plugins: ["stylelint-plugin-rhythmguard"],
  rules: {
    "rhythmguard/use-scale": [
      true,
      {
        properties: [
          /^margin(?:-.+)?$/,
          /^padding(?:-.+)?$/,
          /^gap$/,
          /^row-gap$/,
          /^column-gap$/,
          /^inset(?:-.+)?$/,
          /^top$/,
          /^right$/,
          /^bottom$/,
          /^left$/,
        ],
        scale: allowedTokens.spacingScalePx,
      },
    ],
  },
  ignoreFiles: [
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/coverage/**",
    "**/out/**",
    // The GENERATED token source — never lint the SoT against itself.
    "packages/design-system/src/styles/tokens.css",
  ],
};
