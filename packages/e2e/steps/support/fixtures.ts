import type { Page } from "@playwright/test";
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
  /** Actual slot date of the named golden recorded event. */
  recordedStartsAt?: string;
  /** State the 019 events-feed journey carries from one step to the next. */
  eventsFeed?: EventsFeedWorld;
}

/** What one 019 events-feed scenario remembers between its steps. */
export interface EventsFeedWorld {
  /** Feed URLs (path + query) in the order the journey left them. */
  history: string[];
  /**
   * What the browser sent while a failed block's «Повторить» ran (#2832):
   * the block-retry server-action POSTs, the page re-reads (an RSC route
   * fetch or a document load), the «Идёт сейчас» re-reads, and the one
   * action answer's body.
   */
  retry?: {
    actions: number;
    pageReads: number;
    liveReads: number;
    answer: string;
  };
  /** The card the journey opened, read from the rendered feed. */
  card?: { title: string; href: string };
  /** `YYYY-MM-DD` of the day picked in the compact month. */
  pickedDay?: string;
  /** The accessible name of the compact-month day button that was picked. */
  pickedLabel?: string;
  /** The day groups the feed held before the day was picked. */
  groupsBeforeDay?: number;
  /** Day-group top offsets and the scroll position before the day pick. */
  groupTopsBeforeDay?: Record<string, number>;
  scrollBeforeDay?: number;
  /** The past screen before «Показать ещё»: its card count and the step it promised. */
  pastBefore?: { cards: number; step: number; from: string | null };
  /** The horizon before «Показать ещё» on «Будущие». */
  horizonBefore?: {
    to: string | null;
    days: number;
    cards: number;
    step: number;
  };
  /** The same URL opened in a second, cookie-free browser context. */
  freshPage?: Page;
  /** The name search no event matches (EARS-9). */
  noMatchQuery?: string;
  /** The Academy events screen opened beside the doctor one (EARS-18). */
  academyPage?: Page;
  /** What the admin editor made through the real admin (EARS-17). */
  editor?: EditorWrites;
}

/** The 012 / 007 records an `@editor-write` scenario made, for its own cleanup. */
export interface EditorWrites {
  /** The editor's page, signed in on the admin origin in its own context. */
  page: Page;
  kind?: { title: string; detailUrl: string; retired: boolean };
  event?: { id: string; title: string };
  /** The kind set of the 3/9 scenario: the run's token its event titles carry, its kinds and events. */
  run?: {
    token: string;
    kinds: { title: string; detailUrl: string; retired: boolean }[];
    events: { id: string; title: string; kindTitle: string }[];
  };
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
