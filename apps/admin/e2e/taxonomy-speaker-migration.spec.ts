import { expect, test, type Page } from "@playwright/test";
import { bootstrapAdminSession } from "./support/admin-session";
import { totpCode } from "./support/totp";

const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

async function signInAsAdmin(page: Page): Promise<void> {
  const { email, password } = await bootstrapAdminSession(ORIGIN);
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await page
    .getByTestId("mfa-enroll-form")
    .getByRole("textbox")
    .fill(totpCode(secret));
  await page.waitForURL(/\/events/, { timeout: 20_000 });
}

async function selectFirstComboboxOption(page: Page, testId: string) {
  await page.getByTestId(testId).getByRole("combobox").click();
  const option = page.getByRole("option").first();
  await expect(option).toBeVisible();
  await option.click();
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-24 — provenance-safe speaker migration", () => {
  test("EARS-24: operator explicitly resolves the retained queue and completes guarded cutover", async ({
    page,
  }) => {
    await signInAsAdmin(page);

    await page.getByTestId("nav-speaker-migration").click();
    await page.waitForURL(/\/speaker-migration$/);
    await expect(page.getByTestId("speaker-migration-table")).toBeVisible();
    await expect(page.getByTestId("speaker-migration-pagination")).toBeVisible();
    await expect(page.getByTestId("speaker-migration-filters")).toBeVisible();

    const rows = page.getByTestId(/^speaker-migration-row-/);
    expect(await rows.count()).toBeGreaterThanOrEqual(3);
    const first = rows.nth(0);
    await expect(first.getByTestId("source-name")).not.toBeEmpty();
    await expect(first.getByTestId("source-event-id")).not.toBeEmpty();
    await expect(first.getByTestId("source-position")).not.toBeEmpty();
    await expect(first.getByTestId("source-fingerprint")).not.toBeEmpty();
    await expect(first.getByTestId("source-classification")).toHaveText(
      /^(Без совпадения|Неоднозначно|Дубликат)$/,
    );
    await expect(first.getByTestId("source-disposition")).toHaveText(
      "Не разобрано",
    );
    await expect(page.getByText(/предложенн|автоматическ.*совпад/i)).toHaveCount(
      0,
    );

    await page.getByTestId("speaker-migration-cutover").click();
    await page.getByTestId("speaker-migration-cutover-confirm").click();
    await expect(page.getByTestId("speaker-migration-cutover-error")).toContainText(
      "Сначала разберите все записи",
    );

    await first.getByTestId("speaker-migration-resolve").click();
    await page.getByTestId("resolution-existing-expert").click();
    await selectFirstComboboxOption(page, "resolution-expert");
    await page.getByTestId("resolution-role").fill("Докладчик");
    await page.getByTestId("resolution-position").fill("0");
    let conflictInjected = false;
    const conflictRoute = async (route: import("@playwright/test").Route) => {
      conflictInjected = true;
      await route.fulfill({
        status: 409,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Conflict",
          status: 409,
          errorCode: "SPEAKER_POSITION_OCCUPIED",
          traceId: "ears-24-ui-conflict",
        }),
      });
    };
    await page.route(
      "**/speaker-migration-reviews/**/resolve",
      conflictRoute,
    );
    await page.getByTestId("resolution-submit").click();
    await expect(page.getByRole("alert")).toContainText("уже заняты");
    expect(conflictInjected).toBe(true);
    await page.unroute(
      "**/speaker-migration-reviews/**/resolve",
      conflictRoute,
    );
    const existingRequest = page.waitForRequest((request) =>
      request.url().includes("/speaker-migration-reviews/") &&
      request.url().endsWith("/resolve"),
    );
    await page.getByTestId("resolution-submit").click();
    expect((await existingRequest).postDataJSON()).toMatchObject({
      disposition: "existing_expert",
      role: "Докладчик",
      position: 0,
    });
    await expect(first.getByTestId("source-disposition")).toHaveText(
      "Связано с экспертом",
    );
    await page.reload();
    await expect(
      page.getByTestId(/^speaker-migration-row-/).nth(0).getByTestId(
        "source-disposition",
      ),
    ).toHaveText("Связано с экспертом");

    const second = page.getByTestId(/^speaker-migration-row-/).nth(1);
    await second.getByTestId("speaker-migration-resolve").click();
    await page.getByTestId("resolution-created-expert").click();
    await page.getByTestId("resolution-submit").click();
    await expect(page.getByRole("alert")).toContainText(
      "Проверьте обязательные поля",
    );
    const uniqueFamilyName = `Миграционный-${Date.now()}`;
    await page.getByTestId("resolution-family-name").fill(uniqueFamilyName);
    await page.getByTestId("resolution-given-name").fill("Эксперт");
    await page.getByTestId("resolution-patronymic").fill("Тестович");
    await page.getByTestId("resolution-professional-role").fill("Кардиолог");
    await page.getByTestId("resolution-role").fill("Модератор");
    await page.getByTestId("resolution-position").fill("1");
    const createdRequest = page.waitForRequest((request) =>
      request.url().endsWith("/resolve"),
    );
    await page.getByTestId("resolution-submit").click();
    expect((await createdRequest).postDataJSON()).toEqual({
      disposition: "created_expert",
      expert: {
        familyName: uniqueFamilyName,
        givenName: "Эксперт",
        patronymic: "Тестович",
        professionalRole: "Кардиолог",
      },
      role: "Модератор",
      position: 1,
    });
    await expect(second.getByTestId("source-disposition")).toHaveText(
      "Создан эксперт",
    );

    const third = page.getByTestId(/^speaker-migration-row-/).nth(2);
    await third.getByTestId("speaker-migration-resolve").click();
    await page.getByTestId("resolution-content-removed").click();
    await page.getByTestId("resolution-submit").click();
    await expect(third.getByTestId("source-disposition")).toHaveText(
      "Контент удалён",
    );

    const unresolved = () =>
      page
        .getByTestId(/^speaker-migration-row-/)
        .filter({ hasText: "Не разобрано" });
    while (await unresolved().count()) {
      await unresolved().first().getByTestId("speaker-migration-resolve").click();
      await page.getByTestId("resolution-content-removed").click();
      await page.getByTestId("resolution-submit").click();
    }
    await expect(page.getByTestId("speaker-migration-resolved-empty")).toBeVisible();

    await page.getByTestId("speaker-migration-cutover").click();
    const cutoverRequest = page.waitForRequest((request) =>
      request.url().endsWith("/speaker-migration-reviews/cutover"),
    );
    await page.getByTestId("speaker-migration-cutover-confirm").click();
    expect((await cutoverRequest).postData()).toBeNull();
    await expect(page.getByTestId("speaker-migration-cutover-success")).toContainText(
      "Переход завершён",
    );
    await expect(unresolved()).toHaveCount(0);
    await expect(page.locator('input[name="speakers"]')).toHaveCount(0);
    await expect(page.getByText(/свободн.*имя.*спикер/i)).toHaveCount(0);
  });
});
