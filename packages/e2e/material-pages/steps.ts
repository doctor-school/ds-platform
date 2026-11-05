import { expect } from "@playwright/test";
import { test as base, createBdd } from "playwright-bdd";
import {
  startMaterialPages,
  type MaterialPages,
} from "../lib/material-pages.js";
import { waitForClientReady } from "../lib/page-ready.js";

export const test = base.extend<{
  materialPages: MaterialPages;
  documentStatus: { value?: number };
}>({
  // eslint-disable-next-line no-empty-pattern -- bddgen detects the custom test instance from this shape.
  materialPages: async ({}, use) => {
    const runtime = await startMaterialPages();
    try {
      await use(runtime);
    } finally {
      await runtime.stop();
    }
  },
  // eslint-disable-next-line no-empty-pattern -- each scenario owns its response status.
  documentStatus: async ({}, use) => {
    await use({});
  },
});
const { Given, When, Then, After } = createBdd(test);

After(async ({ page, materialPages, $testInfo }) => {
  await $testInfo.attach("material-server-reads", {
    body: JSON.stringify(materialPages.transport.reads),
    contentType: "application/json",
  });
  await $testInfo.attach("material-browser", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

Given(
  "the published expert {string} is in the experts directory",
  async ({ materialPages }, fullName: string) => {
    await materialPages.expert(fullName);
  },
);
Given(
  "the news item {string} is published with the slug {string}",
  async ({ materialPages }, title: string, slug: string) => {
    await materialPages.material(title, slug, true);
  },
);
Given(
  "the draft news item {string} with the slug {string}",
  async ({ materialPages }, title: string, slug: string) => {
    await materialPages.material(title, slug, false);
  },
);
Given("the material read fails once", async ({ materialPages }) => {
  materialPages.transport.failOnce("otkryt-nabor-centrov");
});
When(
  "a visitor opens {string} on the Academy",
  async ({ page, materialPages, documentStatus }, path: string) => {
    documentStatus.value =
      (await page.goto(materialPages.portal + path))?.status() ?? 0;
  },
);
When(
  "a doctor opens {string} on doctor.school",
  async ({ page, materialPages, documentStatus }, path: string) => {
    documentStatus.value =
      (await page.goto(materialPages.doctor + path))?.status() ?? 0;
  },
);
Then(
  "the page shows the error state with «Повторить»",
  async ({ page, materialPages, $testInfo }) => {
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    expect(
      materialPages.transport.reads.filter((read) => read.injected),
    ).toHaveLength(1);
    await $testInfo.attach("material-read-error", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  },
);
When("the visitor chooses «Повторить»", async ({ page }) => {
  await waitForClientReady(page);
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
});
Then(
  "the reading page shows {string}",
  async ({ page, materialPages }, title: string) => {
    await expect(
      page
        .getByRole("article")
        .getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Повторить", exact: true }),
    ).toHaveCount(0);
    const reads = materialPages.transport.reads.filter(
      (read) => read.path === "/v1/public/materials/otkryt-nabor-centrov",
    );
    expect(reads.filter((read) => read.injected)).toHaveLength(1);
    expect(reads[0]).toEqual({
      path: "/v1/public/materials/otkryt-nabor-centrov",
      status: 503,
      injected: true,
    });
    expect(reads.at(-1)).toEqual({
      path: "/v1/public/materials/otkryt-nabor-centrov",
      status: 200,
      injected: false,
    });
  },
);
Then(
  "the Academy not-found page is shown",
  async ({ page, materialPages, documentStatus, $testInfo }) => {
    expect(documentStatus.value).toBe(404);
    await expect(page.getByRole("article")).toHaveCount(0);
    await $testInfo.attach("academy-draft-404", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const content = await page.locator("main").innerText();
    expect(
      (
        await page.goto(
          `${materialPages.portal}/materials/missing-${materialPages.token}`,
        )
      )?.status(),
    ).toBe(404);
    expect(await page.locator("main").innerText()).toBe(content);
    expect(
      (
        await page.goto(
          `${materialPages.portal}/missing-${materialPages.token}`,
        )
      )?.status(),
    ).toBe(404);
    expect(await page.locator("main").innerText()).toBe(content);
  },
);
Then(
  "the doctor storefront's not-found page is shown",
  async ({ page, materialPages, documentStatus, $testInfo }) => {
    expect(documentStatus.value).toBe(404);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(
      page.getByText("Открыт набор центров в исследование PRP", {
        exact: true,
      }),
    ).toHaveCount(0);
    await $testInfo.attach("doctor-material-404", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    const content = await page.locator("body").innerText();
    expect(
      (
        await page.goto(
          `${materialPages.doctor}/missing-${materialPages.token}`,
        )
      )?.status(),
    ).toBe(404);
    expect(await page.locator("body").innerText()).toBe(content);
  },
);
Then(
  "the doctor storefront home has no rail «Новости, блог и видео»",
  async ({ page, materialPages }) => {
    expect((await page.goto(materialPages.doctor))?.status()).toBe(200);
    await expect(
      page.getByText("Новости, блог и видео", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText("Открыт набор центров в исследование PRP", {
        exact: true,
      }),
    ).toHaveCount(0);
  },
);
