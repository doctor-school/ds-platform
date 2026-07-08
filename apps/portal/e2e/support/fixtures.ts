import { test as base, createBdd } from "playwright-bdd";

/**
 * Scenario-scoped world for the webinar BDD journeys — carries the event slug
 * under test across an arc's steps (the 005 registration journey pins the
 * `published` seed so the «мои события» + back-navigation steps target the same
 * event; the 004 discovery journey re-points it per lifecycle state). Kept tiny so
 * the subagent/lead return contract stays clean (heavy payloads never leave the
 * browser context).
 */
export interface JourneyWorld {
  /** The event slug the current scenario is driving (the `published` seed by default). */
  slug: string;
  /** The last navigation HTTP status, recorded by the 004 archived-link step (EARS-5). */
  lastStatus?: number;
}

// playwright-bdd's bddgen detects the custom test instance by the
// `base.extend({ fixture: async ({}, use) => … })` shape — a renamed first param
// breaks that detection, so the empty-pattern first arg is required here.
export const test = base.extend<{ world: JourneyWorld }>({
  // eslint-disable-next-line no-empty-pattern -- bddgen requires the `({}, use)` shape (see above)
  world: async ({}, use) => {
    await use({ slug: process.env.E2E_WEBINAR_SLUG ?? "seed-005-upcoming" });
  },
});

export const { Given, When, Then, Before } = createBdd(test);
