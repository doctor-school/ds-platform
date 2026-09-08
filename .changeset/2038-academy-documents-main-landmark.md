---
"@ds/portal": patch
---

028 EARS-15 — the Academy's `/documents`, `/documents/[slug]` and the segment's
not-found shell each render a single `main` landmark. The root layout renders
`{children}` straight into `<body>` and the shared `LegalDocument` block owns
only its own container, so the content landmark is page-owned on this host; these
three routes were the only Academy pages missing it. Semantic wrapper only — no
class, copy, order or layout change.
