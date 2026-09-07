import { test, expect } from "@playwright/test";

/**
 * 028 V-4 (EARS-2, EARS-3, EARS-4, EARS-5) — the Academy's own route projection
 * of the shared legal set, driven in the running UI: index → open «Политика
 * персональных данных и согласия» → the document body renders → the back link
 * returns to the index.
 *
 * Backend-free by construction: both routes read `@ds/legal-content` from disk at
 * build time and issue no api call, so this belongs in the hermetic
 * `playwright.ci.config.ts` tier rather than the dev-stand one. That is also what
 * makes it a real regression pin — nothing here can go green because a mock
 * answered.
 *
 * The assertions ride the design-system testids and the EXACT contact/requisites
 * strings, because those strings ARE the requirement (EARS-4, EARS-5); canvas
 * fidelity (spacing, poster, type scale) is the Stage-B live drive, not this tier.
 */

const POLICY_TITLE = "Политика персональных данных и согласия";

test.describe("028 Academy documents surface (V-4)", () => {
  test("028 EARS-2/3/4/5: the index lists one document, the contacts block and the requisites line", async ({
    page,
  }) => {
    await page.goto("/documents");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Документы и контакты",
    );

    // EARS-3 — exactly one row in slice 1.
    const rows = page.getByTestId("documents-list").getByRole("link");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText(new RegExp(POLICY_TITLE));

    // EARS-4 — the support mailbox and the channel chips, one shared caption.
    const contacts = page.getByTestId("documents-contacts");
    await expect(
      contacts.getByRole("link", { name: "academy@doctor.school" }),
    ).toHaveAttribute("href", "mailto:academy@doctor.school");
    await expect(
      contacts.getByRole("link", { name: "Telegram" }),
    ).toHaveAttribute("href", "https://t.me/doctorschool");
    await expect(
      contacts.getByText("Эфиры, фрагменты подкастов, новости проектов."),
    ).toBeVisible();

    // No stub destination anywhere on the surface.
    await expect(page.locator('a[href="#"]')).toHaveCount(0);

    // EARS-5 — the requisites line, verbatim.
    await expect(page.getByTestId("documents-requisites")).toHaveText(
      "ООО «Ивекскон» · ИНН 5032225006 · ОГРН 1155032013806 · Москва, ул. Енисейская д.2 с.2, офис 703",
    );
  });

  test("028 EARS-2: opening the policy from the index renders the document body, and the back link returns to the index", async ({
    page,
  }) => {
    await page.goto("/documents");
    await page.getByTestId("documents-list").getByRole("link").first().click();

    await expect(page).toHaveURL(/\/documents\/privacy-policy$/);
    const block = page.getByTestId("legal-document");
    await expect(block).toHaveAttribute("data-state", "normal");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      POLICY_TITLE,
    );
    await expect(page.getByTestId("legal-document-edition")).toContainText(
      "редакция от",
    );
    // A real body, not an empty shell: the block parses the published Markdown.
    await expect(page.getByTestId("legal-document-body")).not.toBeEmpty();

    await page.getByTestId("legal-document-back-bottom").click();
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByTestId("documents-list")).toBeVisible();
  });

  test("028 EARS-12: an unresolved slug answers 404 and renders the not-found state inside the shared shell", async ({
    page,
  }) => {
    const response = await page.goto("/documents/no-such-document");
    expect(response?.status()).toBe(404);

    await expect(page.getByTestId("legal-document")).toHaveAttribute(
      "data-state",
      "not-found",
    );
    await page.getByRole("link", { name: /Все документы платформы/ }).click();
    await expect(page).toHaveURL(/\/documents$/);
  });
});
