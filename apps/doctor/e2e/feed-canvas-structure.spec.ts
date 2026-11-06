import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { DESIGN_SOURCE, openRuntimeCanvas } from "@ds/e2e/canvas-runtime";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3728 — the specialty feed's events block is compared, as a structure, with
 * the vendored page canvas `design-source/doctor-feed.dc.html` (section
 * «d-feed · события», guest): its chrome by kind + visible label, its
 * repeated event cards by SHAPE only — the canvas's sample events (titles,
 * count) are data and are never compared. The cards come from the events
 * tier's stand-in upstream (`e2e/support/doctor-events-api.mjs`), not from
 * the canvas. Only the events block is connected in release 1 (018 EARS-1),
 * so it is the one section checked.
 *
 * The canvas is rendered by the real Claude Design runtime (`@ds/e2e`
 * `canvas-runtime`, offline): its card canvas mounts
 * `DsDesignSystem.WebinarCard` from the DS bundle built from this repo's
 * `@ds/design-system` (#3798). The mobile branch is the canvas's own
 * `(max-width: 900px)` query on this viewport.
 */
const FEED = "/feed/travmatologiya-i-ortopediya";

for (const width of [390, 1440]) {
  test.describe(`#3728 feed events block ≡ doctor-feed canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    test("the events block has the canvas structure (chrome · card shapes)", async ({
      page,
      context,
    }) => {
      await context.clearCookies();
      await page.goto(FEED);
      await page.getByTestId("specialty-feed-events").waitFor();
      await expectSlotSectionMatchesCanvas(page, {
        canvas: "doctor-feed.dc.html",
        props: { loggedIn: false },
        section: {
          section: ["data-screen-label", "d-feed · события"],
          cards: ["unit-event-card"],
        },
        rendered: {
          root: '[data-testid="specialty-feed-events"]',
          card: "[data-webinar-card]",
        },
      });
    });
  });
}

/**
 * #3798 — the runtime canvas loader itself, on this tier (no app needed): the
 * six vendored canvases that load the DS bundle render with it — built from
 * this repo, offline — and a `dc-import` the runtime cannot fetch fails the
 * load with the runtime's own error instead of reading an empty placeholder.
 */
test.describe("#3798 runtime canvas loader", () => {
  for (const canvas of [
    "academy-home",
    "academy-material",
    "events-feed",
    "sign-in-refusal",
    "unit-event-card",
    "unit-feed-card",
  ]) {
    test(`the DS-bundle canvas ${canvas} renders from the bundle built from the repo`, async ({
      context,
    }) => {
      const runtime = await openRuntimeCanvas(context, `${canvas}.dc.html`);
      try {
        const global = await runtime.page.evaluate(
          () =>
            Object.keys(
              (window as { DsDesignSystem?: object }).DsDesignSystem ?? {},
            ).length,
        );
        expect(global).toBeGreaterThan(0);
      } finally {
        await runtime.close();
      }
    });
  }

  test("RED: a dc-import the runtime cannot fetch fails the load", async ({
    context,
  }) => {
    const root = mkdtempSync(join(tmpdir(), "canvas-runtime-"));
    copyFileSync(join(DESIGN_SOURCE, "support.js"), join(root, "support.js"));
    writeFileSync(
      join(root, "page.dc.html"),
      `<!DOCTYPE html><html><head><script src="./support.js"></script></head><body>` +
        `<x-dc><div data-screen-label="page"><a href="#">Все →</a><dc-import name="unit-missing"></dc-import></div></x-dc>` +
        `<script type="text/x-dc" data-dc-script data-props="{}">class Component extends DCLogic {}</script></body></html>`,
    );
    await expect(
      openRuntimeCanvas(context, "page.dc.html", { root }),
    ).rejects.toThrow("[dc-runtime] sibling fetch for <unit-missing/> failed");
  });
});
