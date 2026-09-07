---
"@ds/design-system": minor
---

028 EARS-7,11,14 — shared legal-document reading surface. Adds the `LegalDocument`
block (hero poster, one-source table of contents, Markdown body, «Другие документы»
catalogue, four `state` values inside one shell), the `ContactChip` primitive, the
`parseLegalDocument` Markdown helper, the `updated` («обновлено») `Badge` variant, and
the `loading` / `error` / `not-found` `EmptyState` variants. Additive only — existing
`Badge` and `EmptyState` variants are unchanged.
