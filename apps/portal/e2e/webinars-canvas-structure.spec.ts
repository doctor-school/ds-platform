import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3829 — the Academy events feed `/webinars` is compared, as a structure,
 * with the vendored canvas `design-source/events-feed.dc.html` (`host`
 * «Академия», guest): the feed head «events-feed · шапка» — its controls by
 * kind + visible label, in order (the tense tabs, the view link) — for each
 * tense the route reaches (`/webinars`, `/webinars?tense=past`).
 *
 * Live-stand tier (`live/academy/default`), as `webinars-feed-view.spec.ts`:
 * the feed renders from the api over the seeded events, so a bare CI run
 * (no `E2E_PORTAL_URL`) skips.
 *
 * Not compared: «events-feed · лента» and «events-feed · идёт сейчас» — the
 * canvas draws them as one `DsDesignSystem.EventList` / `LiveEventStrip`
 * mount over its sample events, with no repeated-card host the slot reader
 * can count by shape, so their controls (one link per event) are data, not
 * structure; «events-feed · боковая колонка» — its facet options are the
 * seeded projects / experts / topics (data). The «мои события» block is
 * signed-in only (`webinars-feed-view.spec.ts` keeps the feed guest).
 *
 * The canvas is rendered by the real Claude Design runtime, offline; it
 * mounts the DS bundle built from this repo (`@ds/e2e/canvas-runtime`, #3798).
 */
test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

const TENSES = [
  { path: "/webinars", tense: "Будущие" },
  { path: "/webinars?tense=past", tense: "Прошедшие" },
] as const;

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy /webinars ≡ events-feed canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const { path, tense } of TENSES) {
      test(`${tense}: the feed head has the canvas structure`, async ({
        page,
        context,
      }) => {
        await context.clearCookies();
        await page.goto(path, { waitUntil: "domcontentloaded" });
        await page.getByTestId("events-tense-tabs").waitFor();
        await expectSlotSectionMatchesCanvas(page, {
          canvas: "events-feed.dc.html",
          props: {
            host: "Академия",
            signedIn: false,
            view: "лента",
            tense,
            state: "обычное",
          },
          section: { section: ["data-screen-label", "events-feed · шапка"] },
          rendered: { root: '[data-feed-block="head"]' },
        });
      });
    }
  });
}
