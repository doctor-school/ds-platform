import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3829 — the Academy documents list `/documents` and a document page
 * `/documents/[slug]` are compared, section by section, with the vendored
 * canvases `design-source/academy-docs.dc.html` and `design-source/document.dc.html`
 * (`shell` «Академия»), guest: each section's chrome by kind + visible label,
 * its repeated rows by SHAPE only (`@ds/e2e/canvas-slots`). The rows are the
 * published set of `@ds/legal-content` (028), never the canvases' sample rows.
 * Both pages read a workspace package from disk and issue no api call (028
 * V-4), so they are hermetic on the backend-free tier.
 *
 * Not compared: «a-docs · контакты» — on its first run (#3829 PR body) the
 * page drew RuTube where the canvas draws YouTube (028 EARS-4) and none of the
 * two CJM exits the canvas nests in it («a-docs · выходы»: «Для инвесторов …»,
 * «Для экспертов …»), with no recorded decision on the exits yet; «a-docs ·
 * реквизиты» (a text line, no control). On the document
 * page «document · подвал документа» (no control drawn), the table of contents
 * and back link (drawn outside every labelled section) and the document text
 * (data, not structure) — as in the doctor-storefront check
 * (`apps/doctor/e2e/documents-canvas-structure.spec.ts`).
 *
 * The canvases are rendered by the real Claude Design runtime, offline
 * (`@ds/e2e/canvas-runtime`, #3798).
 */
const DOCUMENT = "/documents/privacy-policy";

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy documents list ≡ academy-docs canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    const props = { loggedIn: false };

    test.beforeEach(async ({ page, context }) => {
      await context.clearCookies();
      await page.goto("/documents");
      await page.getByTestId("documents-list").waitFor();
    });

    test("the poster has the canvas structure", async ({ page }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "academy-docs.dc.html",
        props,
        section: { section: ["data-screen-label", "a-docs · постер-шапка"] },
        rendered: { root: "main div:has(> div > h1)" },
      });
    });

    test("the documents section has the canvas structure (row shapes)", async ({
      page,
    }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "academy-docs.dc.html",
        props,
        section: {
          section: ["data-screen-label", "a-docs · документы"],
          repeats: ["doc"],
        },
        rendered: {
          root: "section#documents",
          card: '[data-testid^="legal-document-row-"]',
        },
      });
    });
  });

  test.describe(`#3829 Academy document page ≡ document canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    const props = { loggedIn: false, shell: "Академия" };

    test.beforeEach(async ({ page, context }) => {
      await context.clearCookies();
      await page.goto(DOCUMENT);
      await page
        .locator('[data-testid="legal-document"][data-state="normal"]')
        .waitFor();
    });

    test("the poster has the canvas structure", async ({ page }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "document.dc.html",
        props,
        section: { section: ["data-screen-label", "document · постер-шапка"] },
        rendered: { root: '[data-testid="legal-document"] > div:first-child' },
      });
    });

    test("the other documents section has the canvas structure (row shapes)", async ({
      page,
    }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "document.dc.html",
        props,
        section: {
          section: ["data-screen-label", "document · другие документы"],
          repeats: ["doc"],
        },
        rendered: {
          root: '[data-testid="legal-document-others"]',
          card: '[data-testid^="legal-document-row-"]',
        },
      });
    });
  });
}
