import { test, expect } from "@playwright/test";

/**
 * Residual Academy legal-surface checks after the shared 028 V-4 journey moved
 * to `packages/e2e` in #2255.
 *
 * Backend-free by construction: both routes read `@ds/legal-content` from disk at
 * build time and issue no api call, so this belongs in the hermetic
 * `playwright.ci.config.ts` tier rather than the dev-stand one. That is also what
 * makes it a real regression pin — nothing here can go green because a mock
 * answered.
 *
 * The exact contact/requisites assertions remain because they cover EARS-3/4/5,
 * beyond the selected shared EARS-1/2 path. The unknown-slug and footer geometry
 * regressions are likewise not duplicates of the backfilled journey.
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
    ).toHaveAttribute("href", "https://t.me/DoctorSchool");
    await expect(
      contacts.getByRole("link", { name: "ВКонтакте" }),
    ).toHaveAttribute("href", "https://vk.ru/doctor.school");
    await expect(
      contacts.getByRole("link", { name: "RuTube" }),
    ).toHaveAttribute("href", "https://rutube.ru/channel/33533508/");
    await expect(page.getByText("YouTube")).toHaveCount(0);
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

test.describe("008 EARS-14 (#2228): the shared footer is pinned to the viewport bottom", () => {
  test("EARS-14.4: on a short page the footer's bottom edge meets the viewport bottom — no bare background under it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1400 });
    await page.goto("/documents");
    await expect(page.getByTestId("storefront-footer")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const footer = document.querySelector(
        '[data-testid="storefront-footer"]',
      );
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
 * 008 EARS-14 (#2234) — the giant footer wordmark is FITTED to its box, not
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

test.describe("008 EARS-14 (#2234): the giant footer wordmark fits its box at every width", () => {
  for (const viewport of GIANT_FIT_VIEWPORTS) {
    test(`EARS-14.5: at ${viewport.width}px the Academy wordmark reads whole — no clipped glyphs, no horizontal page scroll`, async ({
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

      expect(geometry.text, "wordmark").toBe("Academy.Doctor.School");
      // The whole glyph run lives inside the clipping box…
      expect(geometry.runWidth, "run width vs box width").toBeLessThanOrEqual(
        geometry.boxWidth,
      );
      expect(
        geometry.giantScrollWidth,
        "giant scrollWidth",
      ).toBeLessThanOrEqual(geometry.giantClientWidth);
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
