import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3889 — the doctor events feed `/events` is compared, as a structure, with
 * the vendored canvas `design-source/events-feed.dc.html` (`host` «витрина
 * врача», guest): the feed head «events-feed · шапка» — its controls by kind +
 * visible label, in order (the tense tabs, the view link) — for each tense the
 * route reaches (`/events`, `/events?tense=past`). The head is the one
 * `@ds/events-storefront` frame the Academy check
 * (`apps/portal/e2e/webinars-canvas-structure.spec.ts`, #3829) compares.
 *
 * Events tier (`playwright.events.config.ts`): the feed renders from the
 * tier's stand-in upstream (`e2e/support/doctor-events-api.mjs`), never from
 * the canvas's sample events.
 *
 * Not compared: «events-feed · лента» and «events-feed · идёт сейчас» — the
 * canvas draws them as one `DsDesignSystem.EventList` / `LiveEventStrip`
 * mount over its sample events, with no repeated-card host the slot reader
 * can count by shape, so their controls (one link per event) are data, not
 * structure; «events-feed · боковая колонка» — its facet options are the
 * upstream's projects / experts / topics (data). The «мои события» block is
 * signed-in only (this check is a guest).
 *
 * The canvas is rendered by the real Claude Design runtime, offline; it
 * mounts the DS bundle built from this repo (`@ds/e2e/canvas-runtime`, #3798).
 */
const TENSES = [
  { path: "/events", tense: "Будущие" },
  { path: "/events?tense=past", tense: "Прошедшие" },
] as const;

for (const width of [390, 1440]) {
  test.describe(`#3889 doctor /events ≡ events-feed canvas · guest · ${width}`, () => {
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
            host: "витрина врача",
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
