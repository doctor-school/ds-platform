---
"@ds/doctor": minor
---

028 EARS-1,3,4,5,6 (#1967) — the doctor storefront gains «Документы и контакты»:
`/documents` (the published-documents list, support contacts and the operator's
requisites) and `/documents/:slug` (one document inside the storefront shell,
rendered by the shared `@ds/design-system` legal-document block). The footer
links now point at real routes instead of forward-referencing anchors.

Also fixes the packaging of `@ds/legal-content`: its published texts are read at
runtime with `fs`, so Next's module tracer left them out of the standalone output
the production image ships — the list would have been empty and every document
URL a 404 in production. `outputFileTracingIncludes` now carries them.
