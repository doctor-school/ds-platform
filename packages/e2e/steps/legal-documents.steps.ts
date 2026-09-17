import { expect, type Page } from "@playwright/test";

import type { HostConfig } from "../hosts.js";
import { Given, Then, When, type StepWorld } from "./support/fixtures.js";

const DOCUMENTS_PATH = "/documents";
const POLICY_PATH = "/documents/privacy-policy";
const POLICY_TITLE = "Политика персональных данных и согласия";
const POLICY_BODY_SENTINEL = "Настоящая политика обработки персональных данных";
const REQUISITES =
  "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703";

async function expectPath(page: Page, path: string): Promise<void> {
  await page.waitForURL((url) => url.pathname === path);
  expect(new URL(page.url()).pathname, "active document journey path").toBe(
    path,
  );
}

async function expectHostShell(page: Page, host: HostConfig): Promise<void> {
  await expect(page.getByTestId("storefront-header")).toBeVisible();
  await expect(page.getByTestId("storefront-footer")).toBeVisible();
  await expect(page.getByTestId("footer-giant")).toHaveText(
    host.legalDocuments.shellWordmark,
  );
}

async function openDocumentsIndex(
  page: Page,
  host: HostConfig,
  title: string,
  legalEntity: string,
): Promise<void> {
  const response = await page.goto(DOCUMENTS_PATH, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok(), `${host.id} documents index response`).toBe(true);
  await expectPath(page, DOCUMENTS_PATH);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Документы и контакты",
      exact: true,
    }),
  ).toBeVisible();
  await expectHostShell(page, host);

  const rows = page
    .getByTestId("documents-list")
    .locator('[data-testid^="legal-document-row-"]');
  await expect(rows, "slice-1 document rows").toHaveCount(1);
  await expect(
    page.getByTestId("legal-document-row-privacy-policy"),
  ).toContainText(title);

  const contacts = page.getByTestId(host.legalDocuments.contactsTestId);
  await expect(contacts).toBeVisible();
  await expect(
    contacts.locator(`a[href="${host.legalDocuments.supportMailto}"]`),
  ).toBeVisible();

  const requisites = page.getByTestId("documents-requisites");
  await expect(requisites).toHaveText(REQUISITES);
  await expect(requisites).toContainText(legalEntity);
  await expect(requisites).not.toContainText(/лицензи/iu);
}

Given(
  "the documents list holds exactly one entry in slice 1: {string}",
  async ({ world }, title: string) => {
    expect(title, "the approved slice-1 policy title").toBe(POLICY_TITLE);
    world.legalDocumentTitle = title;
  },
);

Given(
  "the requisites line names {string} with ИНН, ОГРН and legal address, no licence number",
  async ({ world }, legalEntity: string) => {
    expect(legalEntity, "the slice-1 legal entity").toBe("ООО «Ивекскон»");
    world.legalEntity = legalEntity;
  },
);

async function openActiveHostDocuments({
  page,
  world,
}: {
  page: Page;
  world: StepWorld;
}): Promise<void> {
  if (!world.legalDocumentTitle || !world.legalEntity) {
    throw new Error("028 scenario background did not initialise legal content");
  }
  await openDocumentsIndex(
    page,
    world.host,
    world.legalDocumentTitle,
    world.legalEntity,
  );
}

Given(
  "a visitor opens the doctor storefront's {string} page",
  async ({ page, world }, pageTitle: string) => {
    expect(pageTitle, "documents index title").toBe("Документы и контакты");
    await openActiveHostDocuments({ page, world });
  },
);

Given(
  "a visitor opens the Academy's {string} page",
  async ({ page, world }, pageTitle: string) => {
    expect(pageTitle, "documents index title").toBe("Документы и контакты");
    await openActiveHostDocuments({ page, world });
  },
);

When("they open {string}", async ({ page }, title: string) => {
  expect(title, "requested legal document").toBe(POLICY_TITLE);
  await page.getByTestId("legal-document-row-privacy-policy").click();
  await expectPath(page, POLICY_PATH);
});

Then(
  "the document page shows its title, {string} and the body",
  async ({ page }, editionLabel: string) => {
    expect(editionLabel, "edition placeholder in the scenario").toBe(
      "редакция от <дата>",
    );
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "normal",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: POLICY_TITLE, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("legal-document-edition")).toHaveText(
      /^редакция от \d{2}\.\d{2}\.\d{4}$/,
    );
    await expect(page.getByTestId("legal-document-body")).toContainText(
      POLICY_BODY_SENTINEL,
    );
  },
);

Then("a back link returns to the documents list", async ({ page, world }) => {
  await page.getByTestId("legal-document-back-bottom").click();
  await expectPath(page, DOCUMENTS_PATH);
  await expect(
    page.getByTestId("legal-document-row-privacy-policy"),
  ).toBeVisible();
  await expectHostShell(page, world.host);
});

Then(
  "{string} lists the remaining published documents",
  async ({ page }, sectionTitle: string) => {
    expect(sectionTitle, "neighbour section title").toBe("Другие документы");

    // The preceding back-link step intentionally completed the public round trip.
    // Re-open the policy to pin the final V-3 neighbour-link assertion too.
    await page.getByTestId("legal-document-row-privacy-policy").click();
    await expectPath(page, POLICY_PATH);

    const others = page.getByTestId("legal-document-others");
    await expect(others).toBeVisible();
    const neighbour = others.locator("a").first();
    const href = await neighbour.getAttribute("href");
    expect(href, "neighbour document href").toMatch(
      /^\/documents\/(?!privacy-policy$)[a-z0-9-]+$/,
    );
    await neighbour.click();
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "normal",
    );
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(
      /^\s*$/,
    );
  },
);

Then(
  "the rendered title and body match the doctor storefront's copy of the same document",
  async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: POLICY_TITLE, exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("legal-document-body")).toContainText(
      POLICY_BODY_SENTINEL,
    );
  },
);

Then(
  "the page is rendered in the Academy's own 008 shell",
  async ({ page, world }) => {
    // `@host:both` executes this shared-content scenario in both projects. The
    // active project's HostConfig is the evidence for its own thin projection.
    await expectHostShell(page, world.host);
  },
);
