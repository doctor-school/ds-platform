import { expect } from "@playwright/test";
import { Then, When } from "../support/fixtures";

When(
  "the operator opens the standalone Expert creation form",
  async ({ page }) => {
    await page.goto("/experts/create");
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toContainText("Без учётной записи");
  },
);

Then(
  "the Expert form has no slug editor and explains its generated address",
  async ({ page }) => {
    await expect(page.getByTestId("expert-slug")).toHaveCount(0);
    await expect(page.getByTestId("expert-public-link-note")).toContainText(
      "Адрес сгенерирует сервер",
    );
  },
);

When(
  "the operator saves unique Cyrillic Expert names without selecting a User",
  async ({ page, world }) => {
    world.expert = {
      familyName: `Петров-${Date.now()}`,
      givenName: "Иван",
      patronymic: "Сергеевич",
    };
    await page.getByTestId("expert-family-name").fill(world.expert.familyName);
    await page.getByTestId("expert-given-name").fill(world.expert.givenName);
    await page.getByTestId("expert-patronymic").fill(world.expert.patronymic);
    await page.getByTestId("submit-expert").click();
    await page.waitForURL(/\/experts\/[0-9a-f-]{36}$/);
  },
);

Then(
  "the saved Expert detail retains those names as a draft with initials and no User",
  async ({ page, world }) => {
    if (!world.expert) throw new Error("Expert names were not authored");
    // Reload proves persistence, rather than only optimistic form state.
    await page.reload();
    await expect(page.getByTestId("expert-heading")).toHaveText(
      `${world.expert.familyName} ${world.expert.givenName} ${world.expert.patronymic}`,
    );
    await expect(page.getByTestId("expert-family-name")).toHaveValue(
      world.expert.familyName,
    );
    await expect(page.getByTestId("expert-given-name")).toHaveValue(
      world.expert.givenName,
    );
    await expect(page.getByTestId("expert-patronymic")).toHaveValue(
      world.expert.patronymic,
    );
    await expect(page.getByTestId("expert-status")).toHaveText("Черновик");
    await expect(page.getByTestId("expert-initials")).toHaveText("ПИ");
    await expect(
      page.getByRole("combobox", { name: "Пользователь" }),
    ).toContainText("Без учётной записи");
    await expect(page.getByTestId("expert-user-unlink")).toHaveCount(0);
  },
);

Then(
  "the Expert detail exposes its generated canonical public link without a slug editor",
  async ({ page, world }) => {
    if (!world.expert) throw new Error("Expert names were not authored");
    await expect(page.getByTestId("expert-slug")).toHaveCount(0);
    world.expert.publicUrl = await page
      .getByTestId("expert-public-link")
      .innerText();
    expect(world.expert.publicUrl).toMatch(
      /^https:\/\/academy\.doctor\.school\/experts\/petrov-/,
    );
  },
);

When(
  "the operator copies the Expert public link",
  async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(page.url()).origin,
    });
    await page.getByTestId("expert-copy-public-link").click();
  },
);

Then(
  "the clipboard contains that exact generated public link",
  async ({ page, world }) => {
    if (!world.expert?.publicUrl)
      throw new Error("Expert public link was not read");
    await expect(page.getByTestId("expert-copy-public-link")).toHaveText(
      "Ссылка скопирована",
    );
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(world.expert.publicUrl);
  },
);
