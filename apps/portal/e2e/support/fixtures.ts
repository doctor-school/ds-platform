import { test as base, createBdd } from "playwright-bdd";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Scenario-scoped world for the webinar BDD journeys — carries the event slug
 * under test across an arc's steps (the 005 registration journey pins the
 * `published` seed so the «мои события» + back-navigation steps target the same
 * event; the 004 discovery journey re-points it per lifecycle state; the 006 room
 * journey re-points it per room seed). Kept tiny so the subagent/lead return
 * contract stays clean (heavy payloads never leave the browser context).
 */
export interface JourneyWorld {
  /** The event slug the current scenario is driving (the `published` seed by default). */
  slug: string;
  /** The last navigation HTTP status, recorded by the 004 archived-link step (EARS-5). */
  lastStatus?: number;
  /**
   * 006 EARS-4 heartbeat counter — a mutable box the room journey's request
   * listener increments so the cadence/visibility steps can compare beats fired
   * across the Given/When/Then split (a plain number would not survive rebinding).
   */
  beats?: { count: number };
  /** 006 EARS-4 — the beat count captured at the instant the room tab was backgrounded. */
  beatsWhileHidden?: number;
  /**
   * 006 EARS-3 chat fan-out — the SECOND doctor's context/page (a distinct 003
   * session in the same live room). Closed by the `After` hook so the fresh
   * context never leaks past the scenario.
   */
  ctxB?: BrowserContext;
  pageB?: Page;
  /** 006 EARS-3 — the exact text doctor A posted, read back by doctor B's assertion. */
  chatMessage?: string;
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

export const { Given, When, Then, Before, After } = createBdd(test);
