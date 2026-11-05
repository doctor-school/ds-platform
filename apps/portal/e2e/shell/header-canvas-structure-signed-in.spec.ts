import { test } from "@playwright/test";
import { defineStorefrontHeaderCanvasParity } from "@ds/e2e/canvas-structure";
import { LIVE_STAND, provisionLoggedInDoctor } from "../support/doctor-session";

/**
 * #3727 — the Academy header for a SIGNED-IN doctor against the vendored canvas
 * `design-source/ds-shell.dc.html` (host=academy, `loggedIn: true`) at
 * 320 / 390 / 1440: bar and `≡` menu, in order, by kind and visible label.
 * LIVE_STAND tier: the session is a fresh 003 doctor, provisioned the way every
 * signed-in shell spec of this tier provisions one. The guest header and the
 * footer run backend-free in `e2e/header-canvas-structure.e2e.spec.ts`.
 */
test.skip(!LIVE_STAND, "requires a live portal + real Zitadel + Mailpit");

defineStorefrontHeaderCanvasParity({
  host: "academy",
  path: "/documents",
  signIn: async (page) => {
    await provisionLoggedInDoctor(page);
  },
});
