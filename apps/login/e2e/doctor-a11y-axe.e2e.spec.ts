import AxeBuilder from "@axe-core/playwright";
import { MAIN_LANDMARK_RULES } from "@ds/e2e";
import { test, expect } from "@playwright/test";

import { doorPath, hostRoute } from "./support/sign-in-door";

/**
 * The doctor storefront's sign-in and registration doors, scanned in every
 * state that carries an a11y risk (moved from
 * `apps/doctor/e2e/a11y-axe.e2e.spec.ts`, #3172): the storefront's `/login`
 * and `/register` are 303 entries now, and the forms render on the sign-in
 * host from the entry hand-over (`support/sign-in-entry-api.mjs`). The
 * doctor `/reset` two-stage matrix rides `reset-axe.e2e.spec.ts` beside the
 * Academy's.
 *
 * WCAG 2.0/2.1 A+AA plus the one-`<main>` landmark rules (`MAIN_LANDMARK_RULES`)
 * and an exactly-one-non-empty-`h1` check; no rule is allowlisted.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const REGISTER = doorPath("doctor", "register");
const LOGIN = doorPath("doctor", "login");

/**
 * 021 EARS-1 / EARS-16 — the registration route joins the gate the day it ships.
 *
 * A form surface fails differently from a content surface, so this scans the two
 * states that carry the a11y risk: the resting form (label/control association,
 * the disabled submit's `aria-describedby` reason) and the error state (the
 * `aria-invalid` + message linkage that makes a rejection audible rather than
 * merely red). The route takes no backend read, so no route mock is needed.
 */
for (const [state, drive] of [
  ["resting", async () => {}],
  [
    "error",
    async (page: import("@playwright/test").Page) => {
      await page.getByTestId("register-email").fill("not-an-address");
      await page.getByTestId("register-email").blur();
      await page.getByTestId("register-password").fill("short");
      await page.getByTestId("register-password").blur();
      await expect(page.locator('[aria-invalid="true"]').first()).toBeVisible();
    },
  ],
  [
    // 021 EARS-5 (#1541) — the two-tier consent block with both access
    // conditions granted. The CHECKED state is scanned separately because it is
    // where the block's own a11y risk lives: the grouped tier-1 frame with its
    // heading, the composition statement carried as the checkbox's label, and
    // the reason line the submit still points at once both are ticked.
    "consents granted",
    async (page: import("@playwright/test").Page) => {
      for (const id of ["register-medworker", "register-partner-data"]) {
        await page.getByTestId(id).locator("xpath=ancestor::label[1]").click();
        await expect(page.getByTestId(id)).toBeChecked();
      }
    },
  ],
  [
    // 021 EARS-19 (#1558) — the POST-SUBMIT state the wired command opens. It is
    // a whole second composition on this route (the canonical
    // `<EmailConfirmCard>` block: a slotted code field, a live resend countdown,
    // an alert row and the «← Изменить почту» back link), reachable
    // only by actually submitting — so without this case the gate would scan the
    // door and never the screen behind it.
    "post-submit confirmation",
    async (page: import("@playwright/test").Page) => {
      await page.route(hostRoute("/v1/storefront/doctor/register"), (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "pending_verification" }),
        }),
      );
      await page.getByTestId("register-email").fill("doctor@clinic.ru");
      await page.getByTestId("register-password").fill("correct horse battery");
      for (const id of ["register-medworker", "register-partner-data"]) {
        await page.getByTestId(id).locator("xpath=ancestor::label[1]").click();
        await expect(page.getByTestId(id)).toBeChecked();
      }
      await page.getByTestId("register-submit").click();
      await expect(page.getByTestId("verify-submit")).toBeVisible();
    },
  ],
] as const) {
  test(`021 EARS-1 /register passes WCAG 2 A/AA + one-h1 check (${state})`, async ({
    page,
  }) => {
    await page.goto(REGISTER);
    await drive(page);

    const h1 = page.locator("h1");
    await expect(h1, "h1 count on /register").toHaveCount(1);
    await expect(h1, "h1 text on /register").not.toHaveText(/^\s*$/);

    const results = await new AxeBuilder({ page })
      .options({ rules: MAIN_LANDMARK_RULES })
      .withTags(WCAG_TAGS)
      .analyze();

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, `axe violations on /register (${state})`).toEqual([]);
  });
}

/**
 * #1933 — the sign-in route joins the gate the day it ships, exactly as
 * `/register` did. The card is the shared `<LoginCard>` block, but a block is
 * only as accessible as the page that composes it: the method tablist, the
 * heading hierarchy under the auth frame and the `role="alert"` error linkage
 * are page-level facts, and only a composed-page scan can see them. Two states,
 * for the reason the registration block states — a resting form and a rejected
 * one fail differently. The route takes no backend read that can fail the
 * render, so no route mock is needed for the resting state; the error state
 * fulfills the sign-in POST with a 401 at the network edge.
 */
for (const [state, drive] of [
  ["resting", async () => {}],
  [
    "error",
    async (page: import("@playwright/test").Page) => {
      await page.route(hostRoute("/v1/auth/login"), (route) =>
        route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ statusCode: 401, message: "Unauthorized" }),
        }),
      );
      const form = page.getByTestId("password-login-form");
      await form
        .getByLabel("Электронная почта или телефон")
        .fill("doctor@clinic.ru");
      await form
        .getByLabel("Пароль", { exact: true })
        .fill("wrong-password-123");
      await page.getByTestId("password-login-submit").click();
      // #2027 — the operation-level failure stands in `AuthCard.errorBanner`
      // above the card title (canvas `auth.dc.html:56-61`), outside the form.
      await expect(
        page.getByTestId("login-screen").getByRole("alert"),
      ).toBeVisible();
    },
  ],
] as const) {
  test(`017 #1933 /login passes WCAG 2 A/AA + one-h1 check (${state})`, async ({
    page,
  }) => {
    await page.goto(LOGIN);
    await drive(page);

    const h1 = page.locator("h1");
    await expect(h1, "h1 count on /login").toHaveCount(1);
    await expect(h1, "h1 text on /login").not.toHaveText(/^\s*$/);

    const results = await new AxeBuilder({ page })
      .options({ rules: MAIN_LANDMARK_RULES })
      .withTags(WCAG_TAGS)
      .analyze();

    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target).flat(),
    }));
    expect(summary, `axe violations on /login (${state})`).toEqual([]);
  });
}
