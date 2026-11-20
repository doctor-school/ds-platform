import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";
import { isReactHydrated } from "@ds/e2e/sign-in";

import { DOCTOR_BASE } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_FEED_ADJACENT_CODE",
  "E2E_FEED_ADJACENT_EXPECT",
  "MAILPIT_URL",
]);

const SPECIALTY_CODE = process.env.E2E_FEED_ADJACENT_CODE!;

async function pickAndReadFeed(
  page: Page,
  choice: { method: string; path: string; storedIn: string },
) {
  await page.goto("/");
  const catalog = page.getByTestId("specialty-catalog");
  await expect(catalog).toHaveAttribute("data-state", "open");
  const expand = catalog.getByTestId("specialty-expand");
  await page.waitForFunction(isReactHydrated, await expand.elementHandle());
  await expand.click();
  const specialty = catalog
    .getByTestId("specialty-entry")
    .and(catalog.locator(`[data-code="${SPECIALTY_CODE}"]`));
  await expect(
    specialty,
    `specialty ${SPECIALTY_CODE} is in the full catalog`,
  ).toBeVisible();
  const specialtyName = (await specialty.innerText()).trim();

  const [saved] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === choice.path &&
        response.request().method() === choice.method,
    ),
    specialty.click(),
  ]);
  expect(saved.ok()).toBe(true);
  expect(await saved.json()).toMatchObject({
    storedIn: choice.storedIn,
    specialty: { code: SPECIALTY_CODE, name: specialtyName },
  });

  await expect(page).toHaveURL(
    new URL(`/feed/${SPECIALTY_CODE}`, DOCTOR_BASE).href,
  );
  const feed = page.getByTestId("specialty-feed");
  await expect(
    feed.getByRole("heading", { level: 1, name: specialtyName, exact: true }),
  ).toBeVisible();
  const events = feed.getByTestId("specialty-feed-events");
  await expect(
    events.getByRole("heading", { level: 2, name: "Ближайшие события" }),
  ).toBeVisible();
  await expect(events.getByTestId("events-feed-error")).toHaveCount(0);
  await expect(
    events
      .getByTestId("events-feed")
      .or(events.getByTestId("events-feed-empty")),
  ).toBeVisible();
  await expect(events.getByTestId("specialty-feed-all-events")).toHaveAttribute(
    "href",
    `/events?specialty=${SPECIALTY_CODE}`,
  );
  const value = feed.getByTestId("specialty-feed-value");
  await expect(
    value.getByRole("heading", { level: 2, name: "Зачем это мне" }),
  ).toBeVisible();
  await expect(
    value.getByTestId("specialty-feed-value-item").first(),
  ).toBeVisible();
  const adjacent = feed.getByTestId("specialty-feed-adjacent");
  await expect(
    adjacent.getByRole("heading", { level: 2, name: "Смежные области" }),
  ).toBeVisible();
  const adjacentSpecialties: [string, string][] = JSON.parse(
    process.env.E2E_FEED_ADJACENT_EXPECT!,
  );
  await expect(
    adjacent.getByTestId("specialty-feed-adjacent-item"),
  ).toHaveCount(adjacentSpecialties.length);
  for (const [code, name] of adjacentSpecialties) {
    const link = adjacent.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/feed/${code}`);
  }

  await page.goto("/");
  await expect(catalog).toHaveAttribute("data-state", "chosen");
  await expect(catalog.getByTestId("specialty-chosen")).toHaveText(
    specialtyName,
  );
}

test("D6: a guest picks a specialty, reads its feed and sees the saved choice on the next visit", async ({
  page,
}) => {
  await pickAndReadFeed(page, {
    method: "POST",
    path: "/v1/public/specialty-choice",
    storedIn: "session",
  });
});

test("D6: a signed-in doctor picks a specialty, reads its feed and sees the saved choice on the next visit", async ({
  browser,
  page,
}) => {
  test.setTimeout(240_000);
  const nonce = randomUUID();
  const account = {
    email: `e2e-specialty-${nonce}@ds.test`,
    password: `Doc-${nonce}-aA1!`,
  };
  await provisionConfirmedAccount(browser, "doctor", DOCTOR_BASE, account);
  await signInPageThroughHost(page, DOCTOR_BASE, account);
  await pickAndReadFeed(page, {
    method: "PUT",
    path: "/v1/me/specialty",
    storedIn: "profile",
  });
});
