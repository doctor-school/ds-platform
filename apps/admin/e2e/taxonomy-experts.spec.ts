import { expect, test, type Page } from "@playwright/test";
import {
  bootstrapAdminSession,
  bootstrapDoctorSession,
  type BootstrapResult,
} from "./support/admin-session";
import { totpCode } from "./support/totp";

/**
 * 012 EARS-19/20 — real Refine → NestJS → Postgres expert authoring.
 * Manual dev-stand flow; no mocked directory or mutation response is used.
 */
const ORIGIN = process.env.E2E_ADMIN_URL ?? "http://localhost:3200";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

async function signInAsAdmin(
  page: Page,
  credentials?: BootstrapResult,
): Promise<void> {
  const { email, password } =
    credentials ?? (await bootstrapAdminSession(ORIGIN));
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

async function openExpertCreate(page: Page): Promise<void> {
  await page.goto("/experts/create");
  await page.waitForURL(/\/experts\/create$/);
  await expect(
    page.getByRole("combobox", { name: "Пользователь" }),
  ).toBeEnabled({ timeout: 20_000 });
}

async function selectUser(page: Page, identifier: string): Promise<void> {
  await page.getByRole("combobox", { name: "Пользователь" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Поиск пользователя" })
    .fill(identifier);
  await page.getByText(identifier, { exact: true }).click();
}

async function fillRequiredNames(
  page: Page,
  familyName: string,
  givenName = "Иван",
  patronymic = "Сергеевич",
): Promise<void> {
  await page.getByTestId("expert-family-name").fill(familyName);
  await page.getByTestId("expert-given-name").fill(givenName);
  await page.getByTestId("expert-patronymic").fill(patronymic);
}

test.describe.configure({ mode: "serial" });

test.describe("012 EARS-19/20 — Expert authoring", () => {
  test("EARS-20: structured names reject and accept, slug stays server-owned, and the generated public link copies", async ({
    page,
    context,
  }) => {
    await signInAsAdmin(page);
    await openExpertCreate(page);

    // Reject every changed free-text kind: both required boxes and the shared
    // 80-character name-part bound render RU inline before a request leaves.
    await page.getByTestId("submit-expert").click();
    await expect(page.getByText("Обязательное поле.")).toHaveCount(2);
    await fillRequiredNames(
      page,
      "Я".repeat(81),
      "И".repeat(81),
      "О".repeat(81),
    );
    await page.getByTestId("submit-expert").click();
    await expect(
      page.getByText("Слишком длинное значение — сократите текст."),
    ).toHaveCount(3);

    // Accept Cyrillic names (no mask), optional patronymic, and a standalone
    // Expert: the closed User selector remains deliberately empty.
    const familyName = `Петров-${Date.now()}`;
    await fillRequiredNames(page, familyName, "Иван", "Сергеевич");
    await expect(page.getByTestId("expert-slug")).toHaveCount(0);
    await expect(page.getByTestId("expert-public-link-note")).toContainText(
      "Адрес сгенерирует сервер",
    );
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await expect(page.getByTestId("expert-heading")).toContainText(familyName);
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");
    await expect(page.getByTestId("expert-initials")).toHaveText("ПИ");
    await expect(page.getByTestId("expert-slug")).toHaveCount(0);
    const publicUrl = await page.getByTestId("expert-public-link").innerText();
    expect(publicUrl).toMatch(
      /^https:\/\/academy\.doctor\.school\/experts\/petrov-/,
    );

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: ORIGIN,
    });
    await page.getByTestId("expert-copy-public-link").click();
    await expect(page.getByTestId("expert-copy-public-link")).toHaveText(
      "Ссылка скопирована",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(publicUrl);

    // Latin is equally valid free name text, and the retained MediaDropzone still
    // rejects a non-image in the browser.
    await page.getByTestId("expert-family-name").fill("Petrov-Smirnov");
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.setInputFiles("#photo", {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    await expect(page.getByTestId("expert-photo-error")).toBeVisible();
    await page.setInputFiles("#photo", {
      name: "photo.png",
      mimeType: "image/png",
      buffer: PNG_1x1,
    });
    await expect(page.getByAltText("Фото эксперта")).toBeVisible();
  });

  test("EARS-19: an existing User links explicitly, duplicate ownership returns RU 409, and unlink persists", async ({
    page,
    context,
  }) => {
    const candidate = await bootstrapDoctorSession(ORIGIN);
    const admin = await bootstrapAdminSession(ORIGIN);
    await signInAsAdmin(page, admin);

    // Open two forms before either mutation: both receive the same eligible User.
    // The second becomes intentionally stale after the first link and exercises
    // the real transaction-level duplicate-owner refusal.
    const stalePage = await context.newPage();
    await Promise.all([openExpertCreate(page), openExpertCreate(stalePage)]);

    await fillRequiredNames(page, `Связанный-${Date.now()}`);
    await selectUser(page, candidate.email);
    await expect(page.getByTestId("expert-user-unlink")).toBeVisible();
    await fillRequiredNames(
      stalePage,
      `Конфликт-${Date.now()}`,
      "Мария",
      "Ивановна",
    );
    await selectUser(stalePage, candidate.email);

    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await stalePage.getByTestId("submit-expert").click();
    await expect(stalePage.getByTestId("create-error")).toContainText(
      "Этот пользователь уже связан с другим экспертом. Ничего не изменилось — обновите страницу и выберите другого.",
    );
    await expect(stalePage).toHaveURL(/\/experts\/create$/);

    await page.getByTestId("expert-user-unlink").click();
    await expect(page.getByTestId("expert-user-unlink")).toHaveCount(0);
    await page.getByTestId("submit-expert").click();
    await expect(page.getByTestId("update-saved")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByTestId("expert-user-unlink")).toHaveCount(0);
  });

  test("EARS-23: the operator explicitly loads page 2 and selects its eligible User", async ({
    page,
  }) => {
    const searchPrefix = `page-${Date.now()}`;
    const candidates = await Promise.all(
      Array.from({ length: 26 }, () =>
        bootstrapDoctorSession(ORIGIN, searchPrefix),
      ),
    );
    const pageTwoCandidate = candidates
      .map((candidate) => candidate.email)
      .sort((left, right) => left.localeCompare(right))
      .at(-1)!;
    await signInAsAdmin(page);
    await openExpertCreate(page);

    const selector = page.getByRole("combobox", { name: "Пользователь" });
    await selector.click();
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Поиск пользователя" })
      .fill(searchPrefix);
    const loadMore = page.getByRole("button", {
      name: "Загрузить ещё пользователей",
    });
    await expect(loadMore).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(pageTwoCandidate, { exact: true })).toHaveCount(
      0,
    );

    await loadMore.click();
    await expect(
      page.getByText(pageTwoCandidate, { exact: true }),
    ).toBeVisible();
    await page.getByText(pageTwoCandidate, { exact: true }).click();
    await expect(page.getByTestId("expert-user-unlink")).toBeVisible();
    await expect(selector).toContainText(pageTwoCandidate);

    await fillRequiredNames(page, `Страница-${Date.now()}`);
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await page.reload();
    await expect(
      page.getByRole("combobox", { name: /Пользователь/ }),
    ).toContainText(pageTwoCandidate, { timeout: 20_000 });
  });
});
