---
"@ds/storefront-shell": patch
"@ds/schemas": patch
"@ds/auth-flow": patch
"@ds/events-storefront": patch
---

The header «Войти / Регистрация» brings the visitor back to the event page and
never registers them (#2487): on both storefronts, on an event page the guest
link carries that page as a land-only return — the page plus the fixed
`?intent=land` marker, one shape in `@ds/schemas`
(`formatLandOnlyReturnTarget` / `parseLandOnlyReturnTarget`). The doors carry it
end-to-end (the same-origin guard keeps exactly this marker, so the parking
cookie keeps it too) and the shared completion lands on the page without
`RegisterForEvent`. The event page's own registration button is unchanged. Home,
feeds and the auth doors keep the bare route.
