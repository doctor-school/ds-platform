import { expect, type Page } from "@playwright/test";
import { listDocuments, loadDocument } from "@ds/legal-content";

import { baseUrlFor, HOSTS, type HostConfig } from "../hosts.js";
import { Given, Then, When } from "./support/fixtures.js";

async function openHome(page: Page, host: HostConfig): Promise<void> {
  expect(host.id).toBe("doctor");
  const origin = new URL(baseUrlFor(host)).origin;
  const response = await page.goto(`${origin}/`, { waitUntil: "load" });
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(
    (url) => url.origin === origin && url.pathname === "/",
  );
  await expect(page.getByTestId("storefront-shell")).toBeVisible();
  await expect(page.getByTestId("storefront-hero")).toBeVisible();
  await expect(page.getByTestId("specialty-catalog")).toHaveAttribute(
    "data-state",
    "open",
  );
  await expect(page.getByTestId("specialty-catalog")).not.toHaveAttribute(
    "aria-busy",
    "true",
  );
}

When("a visitor opens the storefront home page", async ({ page, host }) => {
  await openHome(page, host);
});

When("any visitor opens the storefront home page", async ({ page, host }) => {
  await openHome(page, host);
});

Then("the footer shows the «Документы и контакты» links", async ({ page }) => {
  const docs = page.getByTestId("footer-documents");
  await docs.scrollIntoViewIfNeeded();
  await expect(docs).toBeVisible();
  const targets = [
    ["Документы и контакты", "/documents"],
    ["Политика персональных данных и согласия", "/documents/privacy-policy"],
    ["Контакты", "/documents#contacts"],
  ] as const;
  await expect(docs.getByRole("link")).toHaveCount(targets.length);
  for (const [label, href] of targets) {
    await expect(
      docs.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", href);
    const response = await page.request.get(href);
    expect(response.status(), `${href} resolves`).toBe(200);
  }
});

Then(
  "exactly one Academy link exists on the rendered page, in the footer",
  async ({ page }) => {
    const origin = new URL(baseUrlFor(HOSTS.academy)).origin;
    await expect(page.locator(`a[href^="${origin}"]`)).toHaveCount(1);
    await expect(
      page.getByTestId("storefront-footer").locator(`a[href^="${origin}"]`),
    ).toHaveCount(1);
    await expect(
      page.getByTestId("storefront-header").locator(`a[href^="${origin}"]`),
    ).toHaveCount(0);
    await expect(page.getByTestId("footer-cross")).toContainText(
      "Academy.Doctor.School",
    );
    await expect(page.getByTestId("footer-cross")).toContainText(
      "Закулисье платформы: проекты, эксперты, партнёры.",
    );
  },
);

Then("it targets the Academy home page", async ({ page }) => {
  const origin = new URL(baseUrlFor(HOSTS.academy)).origin;
  await expect(page.locator(`a[href^="${origin}"]`)).toHaveAttribute(
    "href",
    `${origin}/`,
  );
});

Then(
  "no project card, Academy podcast, partner news block or backstage navigation entry is present",
  async ({ page }) => {
    const mentions =
      (await page.locator("body").innerText()).match(/Academy/giu) ?? [];
    expect(mentions).toHaveLength(1);
    await expect(
      page.locator(
        '[data-testid*="project-card"], [data-testid*="podcast"], [data-testid*="partner-news"]',
      ),
    ).toHaveCount(0);
    await expect(
      page.locator("main, header, nav").getByRole("link", {
        name: /закулисье|подкаст|проекты|новости партнёров/iu,
      }),
    ).toHaveCount(0);
  },
);

Then("no «Что исследовать» block renders on the page", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "Что исследовать", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(
      '[data-testid*="explore"], [data-screen-label*="что исследовать"]',
    ),
  ).toHaveCount(0);
});

Then(
  "no format card, sample lesson count, duration or step figure from the canvas renders",
  async ({ page }) => {
    const main = page.locator("main");
    for (const sample of [
      "Школа ортобиологии — путь в новую специальность",
      "Компрессионные переломы позвонков: что видно на рентгене",
      "Клинический случай: боль в колене у бегуна 42 лет",
      "Уже записались 37 ортопедов",
      "уроков в программе",
      "14 мин",
      "Урок дня · 23 августа",
      "Шаг 1",
      "Шаг 2",
      "Шаг 3",
    ]) {
      await expect(main.getByText(sample, { exact: true })).toHaveCount(0);
    }
    await expect(main.getByText(/Цикл из 12 уроков/iu)).toHaveCount(0);
    await expect(main.locator('[data-testid*="format-card"]')).toHaveCount(0);
  },
);

Then(
  "no «Все школы», «Все уроки» or «Все разборы» link renders",
  async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /Все школы|Все уроки|Все разборы/u }),
    ).toHaveCount(0);
  },
);

Then(
  "no empty box, skeleton or «скоро» marker stands in for the block",
  async ({ page }) => {
    const main = page.locator("main");
    await expect(main.getByText(/скоро|готовится/iu)).toHaveCount(0);
    await expect(
      main.locator(
        '[data-testid*="skeleton"], [data-slot="skeleton"], [aria-busy="true"], section:empty',
      ),
    ).toHaveCount(0);
  },
);

Then("the home page reads as complete without it", async ({ page }) => {
  // 017 EARS-10: positively check the shipped composition; EARS-9 is #1485.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: "Поиск специальности",
    exact: true,
  });
  await expect(search).toBeVisible();
  await expect(search).toBeEditable();
  expect(await page.getByTestId("specialty-entry").count()).toBeGreaterThan(0);
  const footer = page.getByTestId("storefront-footer");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer).toBeInViewport();
  await expect(page.getByTestId("footer-documents")).toBeVisible();
});

Given(
  /^"([^"]+)" has no approved content file in packages\/legal-content$/u,
  async ({ host }, title: string) => {
    expect(["doctor", "academy"]).toContain(host.id);
    expect(title).toBe("Лицензия на образовательную деятельность");
    const published = listDocuments();
    expect(published.length).toBeGreaterThan(0);
    expect(
      published.some((doc) => /лицензи/iu.test(doc.frontmatter.title)),
    ).toBe(false);
    expect(loadDocument("no-such-document")).toBeUndefined();
  },
);

When("a visitor views either host's documents list", async ({ page, host }) => {
  const origin = new URL(baseUrlFor(host)).origin;
  const response = await page.goto(`${origin}/documents`);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(
    (url) => url.origin === origin && url.pathname === "/documents",
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Документы и контакты",
      exact: true,
    }),
  ).toBeVisible();
  const published = listDocuments("policy");
  expect(published.length).toBeGreaterThan(0);
  const rows = page
    .getByTestId("documents-list")
    .locator('[data-testid^="legal-document-row-"]');
  await expect(rows).toHaveCount(published.length);
  for (const doc of published) {
    const row = page.getByTestId(`legal-document-row-${doc.slug}`);
    await expect(row).toContainText(doc.frontmatter.title);
    await expect(row).toHaveAttribute("href", `/documents/${doc.slug}`);
  }
});

Then("no row for the licence document is rendered", async ({ page }) => {
  await expect(
    page.getByTestId("documents-list").getByText(/лицензи/iu),
  ).toHaveCount(0);
  await expect(page.getByTestId("documents-requisites")).not.toContainText(
    /лицензи/iu,
  );
});

Then(
  "requesting {string} returns HTTP 404 showing the not-found document dataState, not a placeholder page",
  async ({ page, host }, path: string) => {
    expect(path).toBe("/documents/no-such-document");
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL((url) => url.pathname === path);
    await expect(page.getByTestId("storefront-header")).toBeVisible();
    await expect(page.getByTestId("storefront-footer")).toBeVisible();
    await expect(page.getByTestId("footer-giant")).toHaveText(
      host.legalDocuments.shellWordmark,
    );
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "not-found",
    );
    await expect(page.locator("h1")).toHaveText("Такого документа нет.");
    await expect(page.getByTestId("legal-document-body")).toHaveCount(0);
  },
);
