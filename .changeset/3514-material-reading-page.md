---
"@ds/design-system": minor
"@ds/portal": minor
"@ds/admin": minor
---

048 materials feed (#3514): the reading page. New block `MaterialArticle` (`@ds/design-system/material-article`, from the Stage-A-approved canvas `design-source/academy-material.dc.html`) — kind label, title, byline «<author> · <day>», the partner mark «Партнёрский материал · <name>» under the byline only when the read carries a partner, the cover only when there is one, the body through `RichTextContent`, plus its loading and error («Повторить») states. The Academy route `/materials/{slug}` renders it over `GET /v1/public/materials/{slug}` with the material title as the document title and the Academy not-found page for a draft, unknown or non-public material; the admin material form gains «Предпросмотр», a `Sheet` with the same `MaterialArticle` from the unsaved form state under «Предпросмотр — материал не опубликован». The doctor storefront keeps no `/materials` route (EARS-17).
