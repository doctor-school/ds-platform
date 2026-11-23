import { test, expect } from "@playwright/test";

// 004 EARS-4 — live guest registration link and mobile hero geometry.
// The academy/event-page tier supplies the event for each lifecycle state.
const BASE = process.env.E2E_PORTAL_URL ?? "http://localhost:3001";
const SLUG = process.env.E2E_WEBINAR_SLUG;
const SLUG_LIVE = process.env.E2E_WEBINAR_SLUG_LIVE;
const SLUG_ENDED = process.env.E2E_WEBINAR_SLUG_ENDED;
const SLUG_HIDDEN = process.env.E2E_WEBINAR_SLUG_HIDDEN;
const SLUG_ARCHIVE = process.env.E2E_WEBINAR_SLUG_ARCHIVE;

test.skip(!process.env.E2E_PORTAL_URL, "requires a live portal");

test("004 EARS-4: a live event shows the hero signal and links guests to registration with the event context", async ({
  page,
  context,
}) => {
  test.skip(!SLUG_LIVE, "requires a seeded live event slug");
  await context.clearCookies();
  await page.goto(`${BASE}/webinars/${SLUG_LIVE}`, {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("event-page-hero-status")).toHaveText("В эфире");
  const cta = page.getByRole("link", { name: "Участвовать", exact: true });
  await expect(cta).toHaveCount(1);
  await expect(cta).toHaveAttribute(
    "href",
    `/register?returnTo=${encodeURIComponent(`/webinars/${SLUG_LIVE}`)}`,
  );
});

/**
 * 004 EARS-4 (mobile geometry regression, #1810) — the hero lifecycle plate is a
 * STATUS SIGNAL: a chip whose label is half off-screen («СК» of «СКРЫТО») tells a
 * phone visitor nothing. The plate sits in the hero's `statusPlate` slot next to
 * the title column, so its geometry is owned by `EventPageHero`
 * (`@ds/design-system`) — this pin measures the rendered chip, per public
 * lifecycle state, at the three narrow widths the audience actually carries
 * (390 = iPhone 14/15, 360 = the common Android floor, 320 = the smallest
 * phone viewport still in use, where the overflow measured worst). `live` is excluded: it is
 * a different plate (single `variant="live"` badge, EARS-4 swap).
 *
 * The assertion is a bounding box, not a class: `boundingBox()` resolves the real
 * post-transform rect, so the plate's `rotate-3` overflow counts as overflow.
 */
test.describe("004 EARS-4 hero status plate — mobile viewport containment (e2e)", () => {
  const NARROW_WIDTHS = [390, 360, 320] as const;

  for (const [state, slug, label] of [
    ["published", SLUG, /^Скоро/u],
    ["ended", SLUG_ENDED, /Эфир завершён/u],
    ["hidden", SLUG_HIDDEN, /Скрыто/u],
    ["in_archive", SLUG_ARCHIVE, null],
  ] as const) {
    for (const width of NARROW_WIDTHS) {
      test(`004 EARS-4: hero status chip bounding box lies inside a ${width}px viewport for the ${state} lifecycle state`, async ({
        page,
        context,
      }) => {
        test.skip(!slug, `requires a seeded ${state} event slug`);

        await context.clearCookies();
        await page.setViewportSize({ width, height: 900 });
        const response = await page.goto(`${BASE}/webinars/${slug}`, {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status()).toBe(200);

        const plate = page.getByTestId("event-page-hero-status");
        if (label) {
          await expect(plate).toContainText(label);
        } else {
          // The archived event's hero carries only its recording signal (014).
          await expect(plate.getByTestId("recording-badge")).toBeVisible();
        }
        await expect(plate).toBeVisible();

        const box = await plate.boundingBox();
        expect(
          box,
          "the hero status plate must have a layout box",
        ).not.toBeNull();
        // Left edge inside the viewport…
        expect(
          Math.round(box!.x),
          `plate left edge (${state} @ ${width}px)`,
        ).toBeGreaterThanOrEqual(0);
        // …and the whole chip, rotation included, inside the right edge.
        expect(
          Math.round(box!.x + box!.width),
          `plate right edge (${state} @ ${width}px)`,
        ).toBeLessThanOrEqual(width);

        // The page itself must not gain a horizontal scroll because of it.
        const overflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `document horizontal overflow @ ${width}px`,
        ).toBeLessThanOrEqual(0);
      });
    }
  }
});
