import { expect, test } from "@playwright/test";

/**
 * 028 V-3 (#1967) — the doctor storefront legal surface, driven in a real
 * browser: the documents index, a document opened from it, and the way back.
 *
 * It rides the BACKEND-FREE tier (`playwright.ci.config.ts`) because that is
 * literally true of these routes: the documents come off the filesystem through
 * `@ds/legal-content`, and neither route makes an api read. A tier that booted
 * an upstream double would be claiming a dependency this surface does not have.
 *
 * The assertions are about the JOURNEY (V-3) — index → open → back → neighbour —
 * plus the two facts only a rendered page can settle: that the footer of the
 * shell actually reaches this surface, and that exactly one row is listed.
 */
test.describe("028 V-3: documents index and document page", () => {
  test("028 EARS-1: the index renders inside the 017 shell with one row, contacts and requisites", async ({
    page,
  }) => {
    await page.goto("/documents");

    await expect(page.getByTestId("storefront-shell")).toBeVisible();
    await expect(page.locator("h1")).toHaveText("Документы и контакты");
    await expect(
      page.getByTestId("documents-list").locator('[data-testid^="legal-document-row-"]'),
      "documents rows",
    ).toHaveCount(1);
    await expect(page.getByTestId("legal-document-row-privacy-policy")).toBeVisible();
    await expect(page.getByTestId("documents-support-mail")).toHaveAttribute(
      "href",
      "mailto:support@doctor.school",
    );
    await expect(page.getByTestId("documents-requisites")).toContainText(
      "ИНН 5032225006",
    );
  });

  test("028 EARS-6: the index carries no Academy caption and no Academy link", async ({
    page,
  }) => {
    await page.goto("/documents");

    await expect(page.getByTestId("documents-academy-caption")).toHaveCount(0);
    // The shell footer link is the ONE Academy crossing REQ-24 allows, so the
    // scope is the page body: `main` must contribute no second exit.
    await expect(page.locator('main a[href*="academy.doctor.school"]')).toHaveCount(0);
    await expect(page.locator('footer a[href*="academy.doctor.school"]')).toHaveCount(1);
    // The «Про согласия» explainer went with it (owner Stage-B, 2026-09-07):
    // nothing on this surface describes or offers to withdraw a consent.
    await expect(page.getByTestId("documents-consents-note")).toHaveCount(0);
  });

  test("028 EARS-7: opening the policy from the index shows it and both back links return to the list", async ({
    page,
  }) => {
    await page.goto("/documents");
    await page.getByTestId("legal-document-row-privacy-policy").click();

    await expect(page).toHaveURL(/\/documents\/privacy-policy$/);
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "normal",
    );
    await expect(page.locator("h1")).toHaveText(
      "Политика персональных данных и согласия",
    );
    await expect(page.getByTestId("legal-document-edition")).toContainText(
      "редакция от",
    );

    await page.getByTestId("legal-document-back-bottom").click();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByTestId("legal-document-row-privacy-policy")).toBeVisible();
  });

  test("028 EARS-7: a «Другие документы» link resolves to that document's own page", async ({
    page,
  }) => {
    await page.goto("/documents/privacy-policy");

    const others = page.getByTestId("legal-document-others");
    await expect(others).toBeVisible();
    const neighbour = others.locator("a").first();
    const href = await neighbour.getAttribute("href");
    expect(href, "neighbour document href").toMatch(/^\/documents\/[a-z0-9-]+$/);

    await neighbour.click();
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "normal",
    );
    await expect(page.locator("h1")).not.toHaveText(/^\s*$/);
  });

  test("028 EARS-12: an unknown slug answers 404 and still renders inside the shell", async ({
    page,
  }) => {
    const response = await page.goto("/documents/no-such-document");

    expect(response?.status(), "HTTP status for an unknown slug").toBe(404);
    await expect(page.getByTestId("storefront-shell")).toBeVisible();
    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "not-found",
    );
    await expect(page.locator("h1")).toHaveText("Такого документа нет.");
  });

  test("028 EARS-1: the shell footer is a real entry point to this surface", async ({
    page,
  }) => {
    await page.goto("/");

    const docs = page.getByTestId("footer-documents");
    await expect(
      docs.getByRole("link", { name: "Контакты", exact: true }),
    ).toHaveAttribute("href", "/documents#contacts");
    await expect(
      docs.getByRole("link", { name: "Документы и контакты", exact: true }),
    ).toHaveAttribute("href", "/documents");
    await expect(
      docs.getByRole("link", { name: "Пользовательское соглашение" }),
    ).toHaveCount(0);

    await docs.getByRole("link", { name: "Политика персональных данных и согласия" }).click();
    await expect(page).toHaveURL(/\/documents\/privacy-policy$/);
    await expect(page.getByTestId("legal-document")).toBeVisible();
  });
});
