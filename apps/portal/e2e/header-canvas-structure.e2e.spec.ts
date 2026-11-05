import {
  defineStorefrontFooterCanvasParity,
  defineStorefrontHeaderCanvasParity,
} from "@ds/e2e/canvas-structure";

/**
 * #3682 / #3727 — the Academy storefront header and footer are compared, as a
 * structure, with the vendored canvas `design-source/ds-shell.dc.html`
 * (host=academy, guest) at 320 / 390 / 1440: the interactive items of the bar
 * and of the `≡` menu, and the footer's links, in order, by kind and visible
 * label. `/documents` renders the shared chrome with no backend (028 V-4). The
 * signed-in header runs on the live tier
 * (`e2e/shell/header-canvas-structure-signed-in.spec.ts`). Decided deviations
 * live in `packages/e2e/lib/canvas-structure-allowlist.json`.
 */
defineStorefrontHeaderCanvasParity({ host: "academy", path: "/documents" });
defineStorefrontFooterCanvasParity({ host: "academy", path: "/documents" });
