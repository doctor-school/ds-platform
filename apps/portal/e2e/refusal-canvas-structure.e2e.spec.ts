import { test } from "@playwright/test";
import { expectSlotSectionMatchesCanvas } from "@ds/e2e/canvas-slots";
import { REFUSED_ENTRIES } from "@ds/e2e/storefront-entry";

/**
 * #3829 — the Academy refusal page (003 EARS-72, the page the storefront gate
 * rewrites a refused door to, `app/auth/refused`) is compared with the vendored
 * canvas `design-source/sign-in-refusal.dc.html` (`host` «Академия»): the
 * page's controls by kind + visible label, in order. Each state the route can
 * reach is opened by its own door against the shared internal-API double
 * (`packages/e2e/doubles/storefront-internal-api.mjs`), as in
 * `storefront-entry-refusal.e2e.spec.ts`. The countdown label carries a live
 * number, so digits are masked on both sides. The owner texts rotate at random
 * in the product (headings and body copy are not controls and are not read).
 *
 * The canvas is rendered by the real Claude Design runtime, offline; it mounts
 * `Button` / `Link` from the DS bundle built from this repo (#3798).
 */
const STATES = [
  {
    name: "лимит · отсчёт · way out to the эфир",
    door: REFUSED_ENTRIES.rateLimitedFromEvent,
    props: { state: "лимит", countdown: "идёт", origin: "эфир" },
    label: "лимит · отсчёт",
  },
  {
    name: "лимит · retry open · way out home",
    door: REFUSED_ENTRIES.rateLimitedBare,
    props: { state: "лимит", countdown: "закончился", origin: "другое" },
    label: "лимит · можно",
  },
  {
    name: "сбой · way out home",
    door: REFUSED_ENTRIES.unavailable,
    props: { state: "сбой", countdown: "идёт", origin: "другое" },
    label: "сбой",
  },
] as const;

for (const width of [390, 1440]) {
  test.describe(`#3829 Academy refusal page ≡ sign-in-refusal canvas · ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const state of STATES) {
      test(`${state.name}: the page has the canvas structure`, async ({
        page,
        context,
      }) => {
        await context.clearCookies();
        await page.goto(state.door);
        await page.getByRole("heading", { level: 1 }).waitFor();
        await expectSlotSectionMatchesCanvas(page, {
          canvas: "sign-in-refusal.dc.html",
          props: { host: "Академия", texts: "1", ...state.props },
          section: {
            section: [
              "data-screen-label",
              `sign-in-refusal · Академия · ${state.label} · тексты 1`,
            ],
            maskDigits: true,
          },
          rendered: { root: "main" },
        });
      });
    }
  });
}
