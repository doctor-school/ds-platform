import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  provisionConfirmedAccount,
  signInPageThroughHost,
} from "@ds/e2e/host-sign-in";

import { DOCTOR_BASE } from "./support/doctor-session";
import { requireLiveStandEnv } from "./support/live-stand-env";

requireLiveStandEnv([
  "E2E_DOCTOR_URL",
  "E2E_DOCTOR_ONE_TAP_LIVE_SLUG",
  "MAILPIT_URL",
]);

test("005 EARS-1: a signed-in doctor registers in one tap and finds the event in My Events", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const slug = process.env.E2E_DOCTOR_ONE_TAP_LIVE_SLUG!;
  const eventPath = `/events/${encodeURIComponent(slug)}`;
  const eventUrl = new URL(eventPath, DOCTOR_BASE).href;
  const myEventsUrl = new URL("/account/events", DOCTOR_BASE).href;
  const eventCard = page.locator("[data-webinar-card]").filter({
    has: page.locator(`a[href="${eventPath}"]`),
  });

  // The roster is append-only. A new doctor lets every run use the same event.
  const nonce = randomUUID();
  const account = {
    email: `e2e-4117-${nonce}@ds.test`,
    password: `Doc-${nonce}-aA1!`,
  };
  await provisionConfirmedAccount(browser, "doctor", DOCTOR_BASE, account);
  await signInPageThroughHost(page, DOCTOR_BASE, account);

  await page.goto(myEventsUrl);
  await expect(
    page.getByRole("heading", { name: "Мои события" }),
  ).toBeVisible();
  await expect(eventCard).toHaveCount(0);

  await page.goto(eventUrl);
  const oneTap = page.getByTestId("event-register-one-tap");
  await expect(oneTap).toBeVisible();
  const registered = page.getByText("Вы записаны", { exact: true });
  await expect(registered).toHaveCount(0);
  await oneTap.click();
  await expect(registered).toBeVisible();
  await expect(oneTap).toHaveCount(0);
  await expect(page).toHaveURL(eventUrl);

  await page.goto(myEventsUrl);
  await expect(
    page.getByRole("heading", { name: "Мои события" }),
  ).toBeVisible();
  await expect(eventCard).toHaveCount(1);
  await expect(eventCard).toBeVisible();
});
