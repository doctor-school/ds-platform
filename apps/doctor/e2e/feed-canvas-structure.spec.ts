import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";
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
 * The canvas mounts `DsDesignSystem.WebinarCard`; the DS bundle is not
 * vendored, so the repository's `@ds/design-system` component of that name
 * renders the canvas's card props (`support/render-ds-component.ts`, in its
 * own process — see there why not in the worker).
 */
const FEED = "/feed/travmatologiya-i-ortopediya";

const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const RENDERER = fileURLToPath(new URL("./support/render-ds-component.ts", import.meta.url));

const renderComponent = (name: string, props: Record<string, unknown>): string => {
  const run = spawnSync(process.execPath, [TSX_CLI, RENDERER, name, JSON.stringify(props)], {
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`render ${name} failed: ${run.stderr}`);
  return run.stdout;
};

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
        input: { props: { loggedIn: false }, state: { isMobile: width < 900 } },
        section: { section: ["data-screen-label", "d-feed · события"], cards: ["unit-event-card"] },
        rendered: { root: '[data-testid="specialty-feed-events"]', card: "[data-webinar-card]" },
        renderComponent,
      });
    });
  });
}
