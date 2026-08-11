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
  /**
   * The 011 MFA journey's scenario state (`steps/mfa.steps.ts`). Optional
   * because the 007 scenarios never establish it — a scenario that submits a
   * code without having provisioned an operator first is a mis-wired feature
   * file, and the steps say so rather than resolving to a blank account.
   */
  mfa?: MfaWorld;
  /** The last raw admin-route probe made from the page (011 EARS-2). */
  probe?: { status: number; body: string };
}

/** Scenario state for the 011 admin MFA journey. */
export interface MfaWorld {
  email: string;
  password: string;
  /** The secret the enrollment screen rendered — what the operator's app holds. */
  secret?: string;
  /** Login-form submissions this scenario performed, retries included. */
  signIns: number;
  /** Primary-auth POSTs the BROWSER actually made — must never exceed `signIns`. */
  loginPosts: string[];
  /** The last TOTP time step a code was spent in (a code is single-use). */
  lastSpentCounter: number;
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
