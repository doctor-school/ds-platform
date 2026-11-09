import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3829 — the Academy reading page `/materials/[slug]` (048) is compared, as a
 * structure, with the vendored canvas `design-source/academy-material.dc.html`
 * (guest, the «обычное» state, a news item with no cover and no partner mark —
 * the shape of the golden material `golden.materials.published`,
 * packages/db/src/seed/golden): the page chrome (the back link) by kind +
 * visible label, the material's body blocks by SHAPE only — each block (a
 * paragraph, a heading, a list) is one repeated card, the canvas's `sc-for`
 * over its sample `blocks`. The body is the material's data, so its links are
 * compared as shapes, never as labels or counts. The canvas draws its long
 * body (`length` «длинный»): it carries every block shape the editor allows,
 * and its blocks read as shapes `[]` (no link) and `[link]` (one link, in a
 * paragraph). The golden body's blocks read as the same two shapes: its one
 * link sits in a list item, and a list block is one card.
 *
 * Live-stand tier (`live/academy/default`): the page reads
 * `GET /v1/public/materials/{slug}` from the api, which no CI double serves; a
 * slot hands the golden slug as `E2E_MATERIAL_SLUG`
 * (`tools/staging/live-tiers.mjs` → `seededEnv`). Without it the spec skips.
 *
 * The canvas is rendered by the real Claude Design runtime, offline; it
 * mounts the DS bundle built from this repo (`@ds/e2e/canvas-runtime`, #3798).
 */
const SLUG = process.env.E2E_MATERIAL_SLUG;

test.skip(
  !process.env.E2E_PORTAL_URL || !SLUG,
  "requires a live portal + a published material slug",
);

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy material page ≡ academy-material canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("the reading page has the canvas structure", async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto(`/materials/${SLUG}`, { waitUntil: "domcontentloaded" });
      await page.locator("main article h1").waitFor();
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "academy-material.dc.html",
        props: {
          signedIn: false,
          state: "обычное",
          kind: "новость",
          cover: "нет",
          length: "длинный",
          partnerMark: "нет",
        },
        section: {
          section: [
            "data-screen-label",
            "academy-material · новость · обычное",
          ],
          repeats: ["b"],
        },
        // The body is `RichTextContent`, the article's last child: one card
        // per top-level block.
        rendered: { root: "main", card: "article > div:last-child > *" },
      });
    });
  });
}
