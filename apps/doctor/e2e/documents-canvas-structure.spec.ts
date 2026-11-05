import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3757 — the documents list `/documents` and a document page
 * `/documents/[slug]` are compared, section by section, with the vendored
 * canvases `design-source/doctor-docs.dc.html` and `design-source/document.dc.html`
 * (guest, doctor storefront): each section's chrome by kind + visible label,
 * its repeated rows by SHAPE only (`@ds/e2e/canvas-slots`). The rows are the
 * published set of `@ds/legal-content` (028), never the canvases' sample rows.
 * Decided chrome deviations (028 EARS-4 RuTube, EARS-6 no Academy crossing,
 * and the owner's PR #2009 Stage-B round 1 removal of the Academy caption and
 * the «Про согласия» block nested in «d-docs · документы») live in
 * `canvas-structure-allowlist.json`.
 *
 * Not compared: «document · подвал документа» (the canvas draws no control in it;
 * the edition line is the poster's on the page), the document's table of
 * contents and back link (drawn outside every labelled section) and the
 * document text (data, not structure).
 */
const DOCUMENT = "/documents/privacy-policy";

for (const width of [390, 1440]) {
  const isMobile = width < 900;

  test.describe(`#3757 documents list ≡ doctor-docs canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    const input = { props: { loggedIn: false }, state: { isMobile } };

    test.beforeEach(async ({ page, context }) => {
      await context.clearCookies();
      await page.goto("/documents");
      await page.getByTestId("documents-page").waitFor();
    });

    test("the poster has the canvas structure", async ({ page }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-docs.dc.html",
        input,
        section: { section: ["data-screen-label", "d-docs · постер-шапка"] },
        rendered: { root: '[data-testid="documents-page"] > div:first-child' },
      });
    });

    test("the documents section has the canvas structure (row shapes)", async ({
      page,
    }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-docs.dc.html",
        input,
        section: {
          section: ["data-screen-label", "d-docs · документы"],
          repeats: ["doc"],
        },
        rendered: {
          root: 'section[aria-labelledby="documents-heading"]',
          card: '[data-testid^="legal-document-row-"]',
        },
      });
    });

    test("the contacts section has the canvas structure", async ({ page }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-docs.dc.html",
        input,
        section: { section: ["data-screen-label", "d-docs · контакты"] },
        rendered: { root: "section#contacts" },
      });
    });
  });

  test.describe(`#3757 document page ≡ document canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    const input = {
      props: { loggedIn: false, shell: "витрина врача" },
      state: { isMobile },
    };

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
        input,
        section: { section: ["data-screen-label", "document · постер-шапка"] },
        rendered: { root: '[data-testid="legal-document"] > div:first-child' },
      });
    });

    test("the other documents section has the canvas structure (row shapes)", async ({
      page,
    }) => {
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "document.dc.html",
        input,
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
