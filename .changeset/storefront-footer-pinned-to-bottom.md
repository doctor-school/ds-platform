---
"@ds/portal": patch
"@ds/doctor": patch
"@ds/design-system": patch
---

Pin the shared storefront footer to the viewport bottom on short pages of both storefronts (#2228): the Academy root layout becomes a min-full-height flex column with the route content growing, and the cabinet screens / profile block stop claiming a full viewport of their own so the footer follows the content instead of dropping a viewport below the fold.
