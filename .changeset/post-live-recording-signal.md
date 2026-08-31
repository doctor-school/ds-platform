---
"@ds/api": minor
"@ds/portal": minor
"@ds/design-system": minor
---

Publicly readable post-live event page: `GET /v1/public/events/:idOrSlug` now carries the source-free recording projection (`state`, `primaryKind`, `secondaryKind`, `posterUrl`, `expectedBy`) and the portal event page renders the recording signal on an ended event — a `success` badge in the hero plus the kind/duration meta — while an archived event keeps its «в архиве» notice untouched (014 EARS-4). Adds a `success` variant to the design-system `Badge` primitive.
