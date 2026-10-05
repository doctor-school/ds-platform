import { test, expect, type Locator } from "@playwright/test";

/**
 * EventsFilter layout parity with `design-source/events-facets.dc.html`
 * (019 EARS-7, #2564) — what jsdom cannot see.
 *
 * The canvas draws a removable chip as «label  ✕»: the cross set visibly off
 * the label. Inside the inline-flex chip a text space collapses, so the unit
 * spaces them with a token gap; this spec measures the rendered boxes. The
 * canvas also draws «Только с НМО» bold (`font-bold` on the Switch). Computed
 * style / geometry only — never class strings (Turbopack mangles them).
 */

const SECTION = "section:has(h2:text-is('Events-filter'))";

/** The doctor «several applied» specimen, light cell. */
function doctorApplied(page: import("@playwright/test").Page): Locator {
  return page.locator(SECTION).locator("section[aria-label='Фильтры']").nth(2);
}

for (const viewport of [
  { name: "1440", width: 1440, height: 1000 },
  { name: "390", width: 390, height: 900 },
]) {
  test.describe(`EventsFilter @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("EARS-7: a removable chip sets the cross off its label, as the canvas draws it", async ({
      page,
    }) => {
      await page.goto("/primitives");
      const panel = doctorApplied(page);
      const chip = panel.getByRole("button", { name: "Убрать: Казань" });
      await chip.scrollIntoViewIfNeeded();
      await expect(chip).not.toHaveAttribute("aria-pressed");
      const label = chip.getByText("Казань", { exact: true });
      const cross = chip.locator("[aria-hidden='true']");
      const a = await label.boundingBox();
      const b = await cross.boundingBox();
      expect(a && b).toBeTruthy();
      // At least one space-width of air between the label and the cross.
      expect(b!.x - (a!.x + a!.width)).toBeGreaterThanOrEqual(4);
    });

    test("EARS-7: «Только с НМО» is bold, as the canvas draws it", async ({
      page,
    }) => {
      await page.goto("/primitives");
      const text = doctorApplied(page).getByText("Только с НМО", {
        exact: true,
      });
      const weight = await text.evaluate(
        (el) => getComputedStyle(el).fontWeight,
      );
      expect(Number(weight)).toBeGreaterThanOrEqual(700);
    });

    test("EARS-7: the panel holds the column without horizontal overflow", async ({
      page,
    }) => {
      await page.goto("/primitives");
      const panel = doctorApplied(page);
      await panel.scrollIntoViewIfNeeded();
      const overflow = await panel.evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
