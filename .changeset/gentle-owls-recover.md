---
"@ds/portal": major
---

#1640: the public `/webinars` listing no longer 500s on a malformed `?cursor=`.
A cursor the api cannot decode is treated as "start from the first page" (the page
counter and the pagination links reset with it) instead of throwing, and the portal
gains an app-level error boundary built from `@ds/design-system` primitives, so any
remaining render failure shows a styled RU recovery page with retry instead of
Next's unstyled 500.
