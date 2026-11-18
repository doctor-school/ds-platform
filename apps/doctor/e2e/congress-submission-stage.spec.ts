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
  "E2E_DOCTOR_CONGRESS_SLUG",
  "MAILPIT_URL",
]);

test("046 EARS-9: a doctor registers for an event and submits an oral talk from the cabinet", async ({
  browser,
  page,
}) => {
  // The remote slot serves the sign-in host and the storefront in this journey.
  test.setTimeout(240_000);
  const slug = process.env.E2E_DOCTOR_CONGRESS_SLUG!;
  const eventPath = "/events/" + encodeURIComponent(slug);
  const eventUrl = new URL(eventPath, DOCTOR_BASE).href;
  const congressUrl = new URL("/account/congress", DOCTOR_BASE).href;
  const nonce = randomUUID();
  const account = {
    email: "e2e-congress-" + nonce + "@ds.test",
    password: "Doc-" + nonce + "-aA1!",
  };
  await provisionConfirmedAccount(browser, "doctor", DOCTOR_BASE, account);
  await signInPageThroughHost(page, DOCTOR_BASE, account);

  await page.goto(congressUrl, { waitUntil: "domcontentloaded" });
  const eventLink = page.getByRole("link", { name: /Страница Конгресса/ });
  const oral = page.getByTestId("congress-pick-oral");
  const needsRegistration = page.getByText(
    "Сначала зарегистрируйтесь участником Конгресса",
    { exact: true },
  );
  await expect(eventLink).toHaveAttribute("href", eventPath);
  await expect(needsRegistration).toBeVisible();
  await expect(oral).toHaveCount(0);

  await eventLink.click();
  await expect(page).toHaveURL(eventUrl);
  const register = page.getByTestId("event-register-one-tap");
  await expect(register).toBeVisible();
  await register.click();
  await expect(page.getByText("Вы записаны", { exact: true })).toBeVisible();
  await expect(register).toHaveCount(0);

  await page.goto(congressUrl, { waitUntil: "domcontentloaded" });
  await expect(eventLink).toHaveAttribute("href", eventPath);
  await expect(needsRegistration).toHaveCount(0);
  await oral.getByRole("button", { name: "Начать заявку →" }).click();
  const status = page.getByTestId("congress-status-plate");
  await expect(status).toHaveText("Черновик");

  const author = page.getByTestId("congress-author").first();
  await author.getByRole("button", { name: "Изменить" }).click();
  await author.getByLabel("Фамилия", { exact: true }).fill("Иванова");
  await author.getByLabel("Имя", { exact: true }).fill("Мария");
  await author
    .getByLabel("Место работы", { exact: true })
    .fill("Тестовая клиника");
  await author.getByRole("button", { name: "Готово" }).click();

  const title = "Результаты тестового наблюдения " + nonce.slice(0, 8);
  await page.getByLabel("Тема", { exact: true }).fill(title);
  await page
    .getByLabel("Образовательная цель")
    .fill("Обсудить оценку результатов наблюдения.");
  const description = page.getByLabel("Краткое содержание");
  await description.fill("Методы наблюдения, результаты и выводы.");
  await description.blur();
  await expect(page.getByTestId("congress-save-state")).toContainText(
    "Сохранено",
  );

  const consent = page.getByRole("checkbox", { name: /Согласие на обработку/ });
  await consent
    .locator("xpath=ancestor::label[1]")
    .click({ position: { x: 8, y: 10 } });
  await expect(consent).toBeChecked();
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByText("Отправить заявку в программный комитет?"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Да, отправить" }).click();
  await expect(status).toHaveText("Отправлена");

  await page.goto(congressUrl, { waitUntil: "domcontentloaded" });
  const submission = page
    .getByTestId("congress-row")
    .filter({ hasText: title });
  await expect(submission).toHaveCount(1);
  await expect(submission).toHaveAttribute("data-status", "submitted");
  await expect(submission).toContainText("Отправлена");
});
