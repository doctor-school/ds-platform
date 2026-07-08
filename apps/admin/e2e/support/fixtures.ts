import { test as base } from "playwright-bdd";
import { createBdd } from "playwright-bdd";
import { SESSION_COOKIE_NAME } from "./admin-session";

/**
 * Scenario-scoped world for the admin BDD steps — carries the created event id
 * across the arc's steps and the acting session's email. Kept tiny so the
 * subagent's return contract stays clean (heavy payloads never leave the browser
 * context).
 */
export interface AdminWorld {
  eventId?: string;
  email?: string;
  provider: string;
  embedRef: string;
}

// playwright-bdd's bddgen detects the custom test instance by the
// `base.extend({ fixture: async ({}, use) => … })` shape — a renamed first param
// breaks that detection, so the empty-pattern first arg is required here.
export const test = base.extend<{ world: AdminWorld }>({
  // eslint-disable-next-line no-empty-pattern -- bddgen requires the `({}, use)` shape (see above)
  world: async ({}, use) => {
    await use({ provider: "rutube", embedRef: "" });
  },
});

/** The admin origin under test (the running Next admin app that proxies `/v1/*`). */
export function adminOrigin(): string {
  return process.env.E2E_ADMIN_URL ?? "http://localhost:3200";
}

/** The session-cookie name to inject into the browser context. */
export { SESSION_COOKIE_NAME };

export const { Given, When, Then, Before } = createBdd(test);
