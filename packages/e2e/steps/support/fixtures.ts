import { test as base, createBdd } from "playwright-bdd";

import { baseUrlFor, hostById, type HostConfig } from "../../hosts.js";

/**
 * The SHARED step world for the C6 regression contract (staging/regression-
 * contour tech spec §6.1, Issue #2067).
 *
 * §6.1: step definitions live in ONE package for both hosts, and «a host-specific
 * step reads a `HostConfig` field of the step package». That is exactly what the
 * `host` fixture provides: the Playwright PROJECT NAME is the host id
 * (`academy` / `doctor`, see `playwright.config.ts`), so every step can read the
 * active host's fields without a single `if (host === "doctor")` at a call site.
 *
 * Keeping the world tiny is deliberate — heavy payloads stay inside the browser
 * context, never in the fixture.
 */
export interface StepWorld {
  /** The storefront the current project drives. */
  host: HostConfig;
  /** The host's base URL, for the steps that need an absolute address. */
  hostBaseUrl: string;
  /** The seed name of the golden doctor the scenario signed in, if it did. */
  signedInAs?: string;
  /** Slice-1 legal document named by the active 028 scenario background. */
  legalDocumentTitle?: string;
  /** Legal entity named by the active 028 scenario background. */
  legalEntity?: string;
  /** Actual slot date of the named golden upcoming event (seed time is relative). */
  upcomingStartsAt?: string;
}

// playwright-bdd's bddgen detects the custom test instance by the
// `base.extend({ fixture: async ({}, use) => … })` shape — a renamed first param
// breaks that detection, so the empty-pattern first arg is required here.
export const test = base.extend<{ host: HostConfig; world: StepWorld }>({
  // eslint-disable-next-line no-empty-pattern -- bddgen requires the `({}, use)` shape (see above)
  host: async ({}, use, testInfo) => {
    await use(hostById(testInfo.project.name));
  },
  world: async ({ host }, use) => {
    await use({ host, hostBaseUrl: baseUrlFor(host) });
  },
});

export const { Given, When, Then, Before, After } = createBdd(test);
