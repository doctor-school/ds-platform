import { expect, type Page } from "@playwright/test";

import { baseUrlFor, hostById } from "../hosts.js";
import { Given, Then, When } from "./support/fixtures.js";

async function hydrated(page: Page): Promise<void> {
  // 008 EARS-3: the server-rendered control precedes its client handler.
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle");
}

function toggle(page: Page) {
  return page.getByTestId("storefront-header").getByTestId("theme-toggle");
}

async function dark(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    document.documentElement.classList.contains("dark"),
  );
}

Given(
  "a guest opens the configured Academy landing with the shared shell",
  async ({ page, host }) => {
    expect(host.id).toBe("academy");
    await page.context().clearCookies();
    const origin = new URL(baseUrlFor(host)).origin;
    expect(
      (
        await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" })
      )?.status(),
    ).toBe(200);
    await expect(page).toHaveURL(
      (url) => url.origin === origin && url.pathname === "/",
    );
    await expect(page.getByTestId("storefront-header")).toBeVisible();
    await expect(page.getByTestId("storefront-footer")).toBeVisible();
  },
);

When(
  "the guest opens the Academy landing and discovery listing",
  async ({ page, host }) => {
    // 008 EARS-9 amendment 2026-08-17.
    expect(
      (await page.goto("/", { waitUntil: "domcontentloaded" }))?.status(),
    ).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Каркас приложения")).toHaveCount(0);
    expect(
      (
        await page.goto(host.eventsPath, { waitUntil: "domcontentloaded" })
      )?.status(),
    ).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Расписание эфиров", exact: true }),
    ).toBeVisible();
  },
);

Then(
  "both public surfaces replace the retired «Каркас приложения» scaffold",
  async ({ page }) => {
    await expect(page.getByText("Каркас приложения")).toHaveCount(0);
  },
);

Given("a user on any portal page in the light theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  expect((await page.goto("/", { waitUntil: "load" }))?.status()).toBe(200);
  await hydrated(page);
  await expect(page.getByTestId("theme-toggle")).toHaveCount(1);
  await expect(toggle(page)).toBeVisible();
  await expect.poll(() => dark(page)).toBe(false);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await expect(toggle(page)).toHaveAttribute(
    "aria-label",
    "Включить тёмную тему",
  );
});

When("the user activates the theme toggle", async ({ page }) => {
  await toggle(page).click();
});

Then("the portal switches to the dark theme", async ({ page }) => {
  await expect.poll(() => dark(page)).toBe(true);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect(toggle(page)).toHaveAttribute(
    "aria-label",
    "Включить светлую тему",
  );
});

Then(
  'the preference is persisted in localStorage under "ds-theme"',
  async ({ page }) => {
    expect(await page.evaluate(() => localStorage.getItem("ds-theme"))).toBe(
      "dark",
    );
  },
);

Then(
  "the preference survives a page reload and navigation",
  async ({ page, host }) => {
    await page.reload({ waitUntil: "load" });
    await hydrated(page);
    await expect.poll(() => dark(page)).toBe(true);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
    await page
      .getByTestId("storefront-header")
      .getByTestId("shell-nav-desktop")
      .getByRole("link", { name: "Эфиры", exact: true })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === host.eventsPath);
    await hydrated(page);
    await expect.poll(() => dark(page)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("ds-theme"))).toBe(
      "dark",
    );
    await expect(toggle(page)).toHaveAttribute(
      "aria-label",
      "Включить светлую тему",
    );
    await toggle(page).click();
    await expect.poll(() => dark(page)).toBe(false);
    await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect(toggle(page)).toHaveAttribute(
      "aria-label",
      "Включить тёмную тему",
    );
    expect(await page.evaluate(() => localStorage.getItem("ds-theme"))).toBe(
      "light",
    );
  },
);

Given(
  "a visitor is on the doctor storefront's documents list",
  async ({ page }) => {
    const doctorOrigin = new URL(baseUrlFor(hostById("doctor"))).origin;
    const response = await page.goto(`${doctorOrigin}/documents`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(
      (url) => url.origin === doctorOrigin && url.pathname === "/documents",
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Документы и контакты",
        exact: true,
      }),
    ).toBeVisible();
  },
);

When("they reach the end of the list", async ({ page }) => {
  await page.getByTestId("documents-list").scrollIntoViewIfNeeded();
  await page.getByTestId("storefront-footer").scrollIntoViewIfNeeded();
});

Then(
  "no caption or link to the Academy is shown on the page",
  async ({ page }) => {
    const academyOrigin = new URL(baseUrlFor(hostById("academy"))).origin;
    await expect(page.getByTestId("documents-academy-caption")).toHaveCount(0);
    await expect(page.locator(`main a[href^="${academyOrigin}"]`)).toHaveCount(
      0,
    );
    await expect(page.getByTestId("documents-consents-note")).toHaveCount(0);
  },
);

Then(
  "the only Academy crossing on the storefront stays the footer link",
  async ({ page }) => {
    const academyOrigin = new URL(baseUrlFor(hostById("academy"))).origin;
    await expect(
      page.locator(`footer a[href^="${academyOrigin}"]`),
    ).toHaveCount(1);
  },
);
