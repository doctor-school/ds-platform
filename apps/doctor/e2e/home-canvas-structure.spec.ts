import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3757 — the doctor home `/` is compared, section by section, with the
 * vendored page canvas `design-source/doctor-home.dc.html` (guest, no
 * remembered specialty — the catalog open in Stage-A variant Б, 017 EARS-4):
 * each section's chrome by kind + visible label, its repeated items by SHAPE
 * only (`@ds/e2e/canvas-slots`). The event cards come from the events tier's
 * stand-in upstream, never from the canvas's sample data.
 *
 * Connected: «d-home · события» (017 EARS-9). Not compared: the hero (no
 * `data-screen-label`, no control); «каталог специальностей» (its entry
 * chips render as buttons where the canvas draws links, and the expand label
 * drops the canvas's «▾» — no recorded decision yet, #3757 PR body);
 * «что исследовать» and «лидерборд» (not shipped — EARS-10/11 land later).
 *
 * The canvas is rendered by the real Claude Design runtime, offline; the event
 * card canvas mounts `DsDesignSystem.WebinarCard` from the DS bundle built
 * from this repo (#3798), as in `feed-canvas-structure.spec.ts`.
 */
const PROPS = { loggedIn: false, specialtyChosen: false, catalogVariant: "Б" };

for (const width of [390, 1440]) {
  test.describe(`#3757 doctor home ≡ doctor-home canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page, context }) => {
      await context.clearCookies();
      await page.goto("/");
    });

    test("the events section has the canvas structure (chrome · card shapes)", async ({
      page,
    }) => {
      await page
        .locator('[data-testid="home-events"] [data-webinar-card]')
        .first()
        .waitFor();
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-home.dc.html",
        props: PROPS,
        section: {
          section: ["data-screen-label", "d-home · события"],
          cards: ["unit-event-card"],
        },
        rendered: {
          root: '[data-testid="home-events"]',
          card: "[data-webinar-card]",
        },
      });
    });
  });
}
