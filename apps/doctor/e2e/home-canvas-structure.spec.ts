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
 * Connected: «d-home · события» (017 EARS-9) and «d-home · каталог
 * специальностей» (017 EARS-4, #3770): the field and «Показать весь список —
 * N ▾» as chrome (N read as `#` on both sides), the frequent-specialty chips
 * as repeated cards. Its one decided delta is the chip element — canvas
 * `link`, app `button`, because choosing a chip is the 017 EARS-6 command —
 * recorded in `canvas-structure-allowlist.json` `cardShapes`.
 *
 * The events stand-in serves a book equal to its frequent set, so the expand
 * control would be hidden; this spec extends the book it serves with «Другое»
 * — the entry the real book always carries and the frequent set never does
 * (017 EARS-5) — so the book is larger than the frequent set, as in
 * production. No canvas sample data reaches the app.
 *
 * Not compared: the hero (no `data-screen-label`, no control); «что
 * исследовать» and «лидерборд» (not shipped — EARS-10/11 land later).
 *
 * The canvas is rendered by the real Claude Design runtime, offline; the event
 * card canvas mounts `DsDesignSystem.WebinarCard` from the DS bundle built
 * from this repo (#3798), as in `feed-canvas-structure.spec.ts`.
 */
const PROPS = { loggedIn: false, specialtyChosen: false, catalogVariant: "Б" };

const BOOK_ROUTE = "**/v1/public/specialties";
const OTHER = {
  id: "00000000-0000-4000-8000-0000000000ff",
  code: "drugoe",
  name: "Другое",
  isOther: true,
};

for (const width of [390, 1440]) {
  test.describe(`#3757 doctor home ≡ doctor-home canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page, context }) => {
      await context.clearCookies();
      await page.route(BOOK_ROUTE, async (route) => {
        const served = (await (await route.fetch()).json()) as {
          entries: unknown[];
        };
        const entries = [...served.entries, OTHER];
        await route.fulfill({ json: { entries, total: entries.length } });
      });
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

    test("the specialty catalog has the canvas structure (chrome · chip shapes)", async ({
      page,
    }) => {
      await page.getByTestId("specialty-expand").waitFor();
      await page.getByTestId("specialty-entry").first().waitFor();
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-home.dc.html",
        props: PROPS,
        section: {
          section: ["data-screen-label", "d-home · каталог специальностей"],
          repeats: ["t"],
          maskDigits: true,
        },
        rendered: {
          root: '[data-testid="specialty-catalog"]',
          card: '[data-testid="specialty-entry"]',
        },
      });
    });
  });
}
