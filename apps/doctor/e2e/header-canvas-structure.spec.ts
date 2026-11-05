import {
  defineStorefrontFooterCanvasParity,
  defineStorefrontHeaderCanvasParity,
} from "@ds/e2e/canvas-structure";

/**
 * #3682 / #3727 — the doctor storefront header and footer are compared, as a
 * structure, with the vendored canvas `design-source/ds-shell.dc.html`
 * (host=doctor, guest) at 320 / 390 / 1440: the interactive items of the bar
 * and of the `≡` menu, and the footer's links, in order, by kind and visible
 * label. The signed-in header runs on the live tier (`shell-live.spec.ts`).
 * Decided deviations live in `packages/e2e/lib/canvas-structure-allowlist.json`.
 */
defineStorefrontHeaderCanvasParity({ host: "doctor", path: "/" });
defineStorefrontFooterCanvasParity({ host: "doctor", path: "/" });
