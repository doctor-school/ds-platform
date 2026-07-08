import { test as base, createBdd } from "playwright-bdd";

/**
 * Scenario-scoped world for the 005 registration-journey BDD steps — carries the
 * event slug under test across the arc's steps (the guest journey pins the
 * `published` seed event so the «мои события» + back-navigation steps target the
 * same event). Kept tiny so the subagent/lead return contract stays clean (heavy
 * payloads never leave the browser context).
 */
export interface JourneyWorld {
  /** The event slug the current scenario is driving (the `published` seed by default). */
  slug: string;
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
