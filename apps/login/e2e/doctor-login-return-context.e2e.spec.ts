import { expect, test, type Page } from "@playwright/test";

import {
  authRequestId,
  doorPath,
  fulfillHostRedirect,
  hostRoute,
  isIdpCallback,
} from "./support/sign-in-door";

/**
 * 021 #1945 — where a signed-in doctor actually LANDS on the doctor storefront.
 *
 * The gate hands `/login?returnTo=/webinars/<slug>` to whichever host the doctor
 * is on: that value is the ONE canonical return target 005 EARS-2 defined, and
 * the guard (`parseReturnTarget`) is what rebuilds it. But `/webinars/*` is a
 * route on `academy.doctor.school`; this storefront serves the same эфир at
 * `/events/<slug>` (020-design §1 route table). Navigating to the canonical
 * value verbatim therefore ended a perfectly successful sign-in on a 404.
 *
 * #3172 — the door renders on the sign-in host from the entry intent; the
 * landing it publishes is decided on the SERVER from the event read this
 * tier's double answers (`support/sign-in-entry-api.mjs`). The sign-in POST
 * is fulfilled at the network edge with the host's success answer, so the
 * assertion is about the NAVIGATION the host performs.
 */

/** The slug the upstream double answers for; anything else is a real 404. */
const KNOWN = "prp-pri-gonartroze";

/** The canonical gate arrival — the value the participation CTA emits. */
function arrival(slug: string): string {
  // #3172 — the storefront entry records the gate target as the EARS-71
  // intent (doctor tier, `storefront-entry.spec.ts`); the door renders on the
  // sign-in host from it.
  return doorPath("doctor", "login", { eventTarget: slug });
}

function passwordForm(page: Page) {
  return page.getByTestId("password-login-form");
}

test.describe("021 #1945: the doctor host's sign-in landing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("021 #1945: the door publishes this host's own event route as the landing", async ({
    page,
  }) => {
    await page.goto(arrival(KNOWN));

    await expect(page.locator("[data-login-landing]")).toHaveAttribute(
      "data-login-landing",
      `/events/${KNOWN}`,
    );

    // The hand-off into sign-up still carries the CANONICAL target: the landing
    // is a host projection, not a second vocabulary, so `/register` re-parses
    // exactly what the gate minted.
    await expect(
      page.getByRole("link", { name: "Создать аккаунт" }),
    ).toHaveAttribute(
      "href",
      new RegExp(
        `^/register\\?authRequest=${authRequestId("doctor", "login", { eventTarget: KNOWN })}(&|$)`,
      ),
    );
  });

  test("021 #1945: a successful sign-in leaves the door by the host's success answer", async ({
    page,
  }) => {
    await page.route(hostRoute("/v1/auth/login"), fulfillHostRedirect);

    await page.goto(arrival(KNOWN));

    const form = passwordForm(page);
    await form
      .getByLabel("Электронная почта или телефон")
      .fill("doctor@clinic.ru");
    await form.getByLabel("Пароль", { exact: true }).fill("correct-horse-1");
    await page.getByTestId("password-login-submit").click();

    // #3172 — the host follows its success answer to the IdP callback; the
    // эфир landing itself (`/events/<slug>`, its page shell) is the
    // storefront callback's, proven by the stand journeys (`packages/e2e`).
    await page.waitForURL(isIdpCallback);
  });
});
