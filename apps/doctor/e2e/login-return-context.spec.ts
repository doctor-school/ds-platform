import { expect, test, type Page } from "@playwright/test";

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
 * This tier — and not the backend-free `login.spec.ts` one — because the landing
 * is decided on the SERVER, before the first byte of HTML, from a read of the
 * event the target names (`playwright.return-context.config.ts`, booted against
 * `e2e/support/return-context-api.mjs`). The sign-in POST itself is fulfilled at
 * the network edge exactly as `login.spec.ts` fulfils its 401, so the assertion
 * is about the NAVIGATION the host performs, never about the api's session.
 */

/** The slug the upstream double answers for; anything else is a real 404. */
const KNOWN = "prp-pri-gonartroze";

/** The canonical gate arrival — the value the participation CTA emits. */
function arrival(slug: string): string {
  const params = new URLSearchParams({ returnTo: `/webinars/${slug}` });
  return `/login?${params.toString()}`;
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
      `/register?returnTo=${encodeURIComponent(`/webinars/${KNOWN}`)}`,
    );
  });

  test("021 #1945: a successful sign-in lands on the эфир, not on a 404", async ({
    page,
  }) => {
    await page.route("**/v1/auth/login", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      }),
    );

    await page.goto(arrival(KNOWN));

    const form = passwordForm(page);
    await form.getByLabel("Почта или телефон").fill("doctor@clinic.ru");
    await form.getByLabel("Пароль", { exact: true }).fill("correct-horse-1");
    await page.getByTestId("password-login-submit").click();

    await expect(page).toHaveURL(new RegExp(`/events/${KNOWN}$`));
    // The landing genuinely RENDERS — a 404 page also has a URL, so the page's
    // own shell is what proves the doctor arrived at the эфир.
    await expect(page.getByTestId("event-page-shell")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
