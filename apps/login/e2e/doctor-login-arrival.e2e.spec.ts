import { DEFAULT_AUTH_FLOW_COPY } from "@ds/auth-flow/copy";
import { test, expect } from "@playwright/test";

import { doorPath } from "./support/sign-in-door";

/**
 * 021 #1955 — the return-context copy of the doctor sign-in door, beside the
 * registration door's (moved from `apps/doctor/e2e/login-arrival.spec.ts`,
 * #3172). The storefront's `/login?returnTo=…` and `/register?returnTo=…` are
 * 303 entries that record the эфир as the auth request's intent (doctor tier,
 * `storefront-entry.spec.ts`); the card and its line render here, on the
 * sign-in host, from the event read this tier's double answers
 * (`support/sign-in-entry-api.mjs`). The signed-in redirect of the same entry
 * stays on the doctor tier (`login-arrival.spec.ts`).
 */
const KNOWN = "prp-pri-gonartroze";
const EVENT_TITLE = "PRP при гонартрозе";

/** The login door's own assurance line — sign-in returns the doctor on the spot. */
const LOGIN_ASSURANCE = DEFAULT_AUTH_FLOW_COPY.returnContext.login;
/** The registration door's line — it must NOT appear on the sign-in door. */
const REGISTER_ASSURANCE = DEFAULT_AUTH_FLOW_COPY.returnContext.register;

test("021 #1955: the sign-in door promises the return happens on SIGN-IN, not after an email", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(doorPath("doctor", "login", { eventTarget: KNOWN }));

  const panel = page.getByTestId("return-context-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-webinar-card]")).toContainText(EVENT_TITLE);

  await expect(panel).toContainText(LOGIN_ASSURANCE);
  await expect(panel).not.toContainText(REGISTER_ASSURANCE);
});

test("021 #1955: the registration door beside it keeps its own confirmation wording", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(doorPath("doctor", "register", { eventTarget: KNOWN }));

  const panel = page.getByTestId("return-context-panel");
  await expect(panel).toContainText(REGISTER_ASSURANCE);
  await expect(panel).not.toContainText(LOGIN_ASSURANCE);
});
