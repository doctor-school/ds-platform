import { defineStorefrontHeaderCanvasParity } from "@ds/e2e/canvas-structure";

/**
 * #3682 — the doctor storefront header is compared, as a structure, with the
 * vendored canvas `design-source/ds-shell.dc.html` (host=doctor, guest) at
 * 320 / 390 / 1440: the interactive items of the bar and of the `≡` menu, in
 * order, by kind and visible label. Decided deviations live in
 * `packages/e2e/lib/canvas-structure-allowlist.json`.
 */
defineStorefrontHeaderCanvasParity({ host: "doctor", path: "/" });
