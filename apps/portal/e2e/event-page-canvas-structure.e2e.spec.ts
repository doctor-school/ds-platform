import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";

/**
 * #3829 — the Academy event page `/webinars/[slug]` is compared, as a
 * structure, with the vendored canvas `design-source/event-page.dc.html`
 * (`header` «Академия», `auth` «гость»): the poster «d-event · постер-шапка» —
 * its controls by kind + visible label, in order (breadcrumbs, chips) — in
 * each phase the seeded slugs reach: an upcoming эфир (`E2E_WEBINAR_SLUG`,
 * phase «до начала») and an ended one with a published montage
 * (`E2E_WEBINAR_SLUG_ENDED`, phase «прошло», recording «монтаж»).
 *
 * Live tier `live/academy/event-page` (`playwright.event-page.config.ts`),
 * beside `event-page-020.e2e.spec.ts`: a slot hands it the golden slugs
 * (`tools/staging/live-tiers.mjs` → `seededEnv`); each case skips when its
 * slug is absent, so a stray CI invocation is inert.
 *
 * Not compared: «d-event · открытая часть» — its program, speaker cards and
 * partner rows are drawn from the canvas's sample event (the `speakers` and
 * `format` props), so its controls are the event's data, not the page's
 * structure; the stand boards («d-event · стенд · …») are design notes, not
 * screens.
 *
 * The canvas is rendered by the real Claude Design runtime, offline
 * (`@ds/e2e/canvas-runtime`, #3798).
 */
const CASES = [
  {
    name: "до начала",
    slug: process.env.E2E_WEBINAR_SLUG,
    props: { phase: "до начала" },
  },
  {
    name: "прошло · монтаж",
    slug: process.env.E2E_WEBINAR_SLUG_ENDED,
    props: { phase: "прошло", recording: "монтаж" },
  },
] as const;

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy event page ≡ event-page canvas · guest · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const c of CASES) {
      test(`${c.name}: the poster has the canvas structure`, async ({
        page,
        context,
      }) => {
        test.skip(!c.slug, `requires a seeded slug for «${c.name}»`);
        await context.clearCookies();
        await page.goto(`/webinars/${c.slug}`, {
          waitUntil: "domcontentloaded",
        });
        await page.getByTestId("event-page-hero").waitFor();
        await expectSlotSectionMatchesCanvas(page, {
          canvas: "event-page.dc.html",
          props: {
            header: "Академия",
            auth: "гость",
            format: "эфир",
            pageState: "обычно",
            ...c.props,
          },
          section: {
            section: ["data-screen-label", "d-event · постер-шапка"],
          },
          rendered: { root: '[data-testid="event-page-hero"]' },
        });
      });
    }
  });
}
