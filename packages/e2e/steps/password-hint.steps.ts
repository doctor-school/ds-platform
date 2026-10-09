import { expect, type Page } from "@playwright/test";

import { Given, Then, When } from "./support/auth-fixtures.js";

const registrationRequests = new WeakMap<Page, { count: number }>();
const passwordField = (page: Page) => page.getByTestId("register-password");
const passwordMessages = (page: Page) =>
  passwordField(page).locator("xpath=../..");

async function expectUntouchedRegistration(page: Page) {
  await expect(passwordField(page)).toHaveValue("");
  await expect(passwordField(page)).not.toBeFocused();
  await expect(passwordField(page)).toHaveAttribute("aria-invalid", "false");
  const interactions = await page.evaluate(
    () =>
      (
        window as unknown as {
          passwordHintInteractions: string[];
        }
      ).passwordHintInteractions,
  );
  expect(
    interactions,
    "no registration focus/input/blur/submit before proof",
  ).toEqual([]);
  expect(
    registrationRequests.get(page)?.count,
    "no registration command before the rule is visible",
  ).toBe(0);
}

Given("a visitor opens the registration form", async ({ page, world }) => {
  expect(world.host.id).toBe("academy");
  const requests = { count: 0 };
  registrationRequests.set(page, requests);
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/v1/auth/register"
    ) {
      requests.count += 1;
    }
  });
  await page.addInitScript(() => {
    const interactions: string[] = [];
    Object.defineProperty(window, "passwordHintInteractions", {
      value: interactions,
    });
    for (const type of ["focus", "input", "blur", "submit"]) {
      document.addEventListener(
        type,
        (event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-testid="registration-form"]')
          ) {
            interactions.push(type);
          }
        },
        true,
      );
    }
  });
  await page.goto(`${world.hostBaseUrl}/register`, { waitUntil: "load" });
  await expect(page.getByTestId("registration-form")).toBeVisible();
});

When(
  "the password field is rendered and before any interaction",
  async ({ page }) => {
    await expect(passwordField(page)).toBeVisible();
    await expectUntouchedRegistration(page);
  },
);

Then("the single rule {string} is visible", async ({ page }, rule: string) => {
  expect(rule).toBe("Не менее 8 символов");
  const field = passwordField(page);
  const descriptionIds = ((await field.getAttribute("aria-describedby")) ?? "")
    .trim()
    .split(/\s+/);
  expect(descriptionIds, "one associated password requirement").toHaveLength(1);
  expect(descriptionIds[0]).not.toBe("");
  const message = page.locator(`[id="${descriptionIds[0]}"]`);
  await expect(message).toBeVisible();
  await expect(message).toHaveText(/^Не менее 8 символов\.?$/);
  await expect(passwordMessages(page).locator("p:visible")).toHaveCount(1);
  await expect(
    page.getByTestId("registration-form").getByText(/^Не менее 8 символов\.?$/),
  ).toHaveCount(1);
  await expectUntouchedRegistration(page);
});

Then(
  "no requirement checklist, strength meter, or second requirement is shown",
  async ({ page }) => {
    await expect(passwordMessages(page)).toHaveText(
      /^Показать\s*Не менее 8 символов\.?$/,
    );
    await expect(
      page
        .getByTestId("registration-form")
        .locator(
          'ul:visible, ol:visible, [role="list"]:visible, meter:visible, progress:visible, [role="meter"]:visible, [role="progressbar"]:visible',
        ),
    ).toHaveCount(0);
    await expectUntouchedRegistration(page);
  },
);
