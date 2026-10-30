---
"@ds/schemas": minor
"@ds/design-system": minor
---

048 EARS-2 (#3511): the material body contract and its two consumers. `@ds/schemas` adds `materials/material-body.ts` — the allowlisted ProseMirror node/mark set, `materialBodySchema` (bounds: 60 000 text characters, 2 000 nodes, nesting depth 6, links ≤ 2048 characters and absolute `https:` / `http:` / `mailto:` only), `isAllowedMaterialLinkHref`, `emptyMaterialBody` and `bodyText`. `@ds/design-system` adds the `RichTextEditor` primitive (`./rich-text-editor`, TipTap trimmed to the allowlist) and the `RichTextContent` block (`./rich-text-content`, the shared renderer). Additive only — no existing export changes.
