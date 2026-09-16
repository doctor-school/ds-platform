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

test.describe("017 EARS-1 (#2228): the shared footer is pinned to the viewport bottom", () => {
  test("EARS-1.12: on a short page the footer's bottom edge meets the viewport bottom — no bare background under it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto("/documents");
    await expect(page.getByTestId("storefront-footer")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const footer = document.querySelector('[data-testid="storefront-footer"]');
      const rect = footer!.getBoundingClientRect();
      return {
        footerBottom: Math.round(rect.bottom + window.scrollY),
        documentHeight: document.documentElement.scrollHeight,
        viewport: window.innerHeight,
      };
    });
    // The document is exactly one viewport tall and the footer closes it.
    expect(geometry.documentHeight, "document height").toBe(geometry.viewport);
    expect(geometry.footerBottom, "footer bottom edge").toBe(geometry.viewport);
  });
});

/**
 * 017 EARS-1 (#2234) — the giant footer wordmark is FITTED to its box, not
 * merely scaled by a coefficient that happens to look right on one screen: at
 * every viewport the whole word reads and `overflow: hidden` clips nothing.
 *
 * The canvas (`design-source/ds-shell.dc.html`) fits it with a ResizeObserver
 * that lands the measured glyph run at 96.5% of the footer box; the code
 * reproduces that with a text-length-derived `cqw` coefficient. This row pins
 * the OUTCOME — the run fits, the run still fills, the page does not scroll
 * sideways — so a future re-fit by any mechanism stays honest.
 */
const GIANT_FIT_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

test.describe("017 EARS-1 (#2234): the giant footer wordmark fits its box at every width", () => {
  for (const viewport of GIANT_FIT_VIEWPORTS) {
    test(`EARS-1.13: at ${viewport.width}px the Doctor wordmark reads whole — no clipped glyphs, no horizontal page scroll`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.goto("/documents");
      await expect(page.getByTestId("footer-giant")).toBeVisible();

      const geometry = await page.evaluate(() => {
        const giant = document.querySelector('[data-testid="footer-giant"]')!;
        const box = giant.parentElement!;
        const run = document.createRange();
        run.selectNodeContents(giant);
        return {
          text: giant.textContent ?? "",
          fontSize: Number.parseFloat(getComputedStyle(giant).fontSize),
          boxWidth: box.getBoundingClientRect().width,
          runWidth: run.getBoundingClientRect().width,
          giantScrollWidth: giant.scrollWidth,
          giantClientWidth: giant.clientWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          documentClientWidth: document.documentElement.clientWidth,
        };
      });

      expect(geometry.text, "wordmark").toBe("Doctor.School");
      // The whole glyph run lives inside the clipping box…
      expect(geometry.runWidth, "run width vs box width").toBeLessThanOrEqual(
        geometry.boxWidth,
      );
      expect(geometry.giantScrollWidth, "giant scrollWidth").toBeLessThanOrEqual(
        geometry.giantClientWidth,
      );
      // …and it still FILLS it: a "fit" that shrank the wordmark to a caption
      // would pass the clipping check and lose the approved canvas look.
      expect(geometry.runWidth, "run width fills the box").toBeGreaterThan(
        geometry.boxWidth * 0.9,
      );
      // Nothing the footer paints may push the page sideways.
      expect(
        geometry.documentScrollWidth,
        "document scrollWidth",
      ).toBeLessThanOrEqual(geometry.documentClientWidth);
    });
  }
});
