import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 019 EARS-12 (#1527) — the guest read path, the «Участвовать ↗» hand-off into
 * 021 and the EXACT return.
 *
 * The three halves of EARS-12, each with its own failure this pins:
 *
 *  1. The READ is whole for a guest. The failure guarded against is a gate over
 *     the feed — a signed-out visitor seeing fewer days, fewer cards or a
 *     teaser. So the guest assertions are the SAME counts `events-feed.spec.ts`
 *     makes with the same fixture, taken with no cookie at all.
 *  2. The hand-off carries the current feed URL. The failure is a return target
 *     hand-assembled on the screen: the decoded `returnTo` is asserted as an
 *     EXACT string, so any host-local ordering or extra key breaks the test
 *     rather than quietly shipping a second return vocabulary (021 LD-3).
 *  3. The return re-seats the doctor on the SAME card. The failure is a return
 *     that lands on the right URL but at the top of a long feed, leaving the
 *     doctor to find their event again.
 *
 * Upstream is the fixed stand-in (`e2e/support/doctor-events-api.mjs`); the
 * guard's own algebra is pinned by `packages/schemas` unit specs and the api
 * e2e, not re-proven here.
 */
const CTA_LABEL = "Участвовать ↗";

/**
 * `E2E_SHOT_DIR` opts into the Stage-B evidence PNGs the PR body cites; unset,
 * the spec still asserts — the images are evidence for a human, not the gate.
 */
const SHOT_DIR = process.env.E2E_SHOT_DIR;
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function shoot(page: Page, name: string, fullPage = true) {
  if (!SHOT_DIR) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`), fullPage });
}

/** The `returnTo` a card's CTA carries, decoded back to the feed URL it restores. */
async function decodedReturnTo(href: string | null): Promise<string> {
  expect(href).not.toBeNull();
  expect(href!.startsWith("/register?returnTo=")).toBe(true);
  return decodeURIComponent(href!.slice("/register?returnTo=".length));
}

test("019 EARS-12: a guest reads the whole feed and every open card offers the hand-off", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/events");

  // Identical to what EARS-3 asserts for the same fixture: nothing is withheld
  // from a signed-out reader.
  await expect(page.locator("[data-events-feed]")).toBeVisible();
  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  await expect(page.locator("[data-webinar-card]")).toHaveCount(3);

  const ctas = page.getByRole("link", { name: CTA_LABEL });
  await expect(ctas).toHaveCount(3);

  // Asserted verbatim, defaults included: the target is the CODEC's canonical
  // rendering of the query the guest is reading — `tense` and `specialty` are
  // materialised because the feed schema defaults them, and `resume` comes
  // last. A host that hand-assembled the string would land on a shorter one.
  const returnTo = await decodedReturnTo(await ctas.first().getAttribute("href"));
  expect(returnTo).toBe(
    "/events?tense=upcoming&specialty=mine-and-adjacent&resume=evt-1",
  );
});

test("019 EARS-12: the current feed URL rides the hand-off into registration", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/events?from=2026-09-01&to=2026-09-29");

  // evt-3 is the third card of the widened horizon; its hand-off must restore
  // the horizon the guest was actually reading, in the codec's own key order
  // with `resume` last.
  const cta = page
    .locator("[data-webinar-card]")
    .nth(2)
    .getByRole("link", { name: CTA_LABEL });
  const returnTo = await decodedReturnTo(await cta.getAttribute("href"));
  expect(returnTo).toBe(
    "/events?tense=upcoming&from=2026-09-01&to=2026-09-29&specialty=mine-and-adjacent&resume=evt-3",
  );
});

test("019 EARS-12: the guest gate band states the account requirement and offers no second path", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/events");

  const band = page.getByTestId("events-guest-gate");
  await expect(band).toBeVisible();
  await expect(band.getByText("Участвовать — нужна регистрация.")).toBeVisible();
  await expect(
    band.getByText(
      "После регистрации вы вернётесь ровно сюда, к выбранному событию.",
    ),
  ).toBeVisible();
  // The card CTA is the action; a second link here would be a competing one.
  await expect(band.locator("a")).toHaveCount(0);
});

test("019 EARS-12: the return lands on the same card with its action focused", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/events?from=2026-09-01&to=2026-09-29&resume=evt-3");

  // The anchor MOVES the feed, it never narrows it: the widened horizon is
  // still served whole.
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);

  const card = page
    .locator("[data-webinar-card]")
    .filter({ has: page.locator('a[href="/events/evt-3"]') });
  await expect(card).toBeInViewport();
  await expect(card.getByRole("link", { name: CTA_LABEL })).toBeFocused();
});

test("019 EARS-12: a signed-in doctor gets the event page, not the hand-off, and no gate band", async ({
  page,
  context,
}) => {
  // The fixture session read answers the forwarded cookie, so the SAME feed is
  // rendered for the other viewer — the difference EARS-12 allows is where the
  // card action points, and nothing else.
  await context.clearCookies();
  // The session cookie rides a request HEADER rather than `addCookies`:
  // `__Host-ds_session` carries the `__Host-` prefix, which Chromium stores on
  // an https origin only, and this tier serves the built app over http. The
  // header is exactly what the route reads (`forwardedSessionFrom` takes
  // `cookie` off the incoming request), so this drives the real server path
  // rather than routing around it.
  await page.setExtraHTTPHeaders({ cookie: "__Host-ds_session=e2e-doctor" });
  await page.goto("/events");

  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  await expect(page.getByTestId("events-guest-gate")).toHaveCount(0);

  const cta = page
    .locator("[data-webinar-card]")
    .first()
    .getByRole("link", { name: CTA_LABEL });
  await expect(cta).toHaveAttribute("href", "/events/evt-1");
});

/**
 * Stage-B evidence, not a gate: the four presentations the PR body cites plus
 * the one interaction EARS-12 owns — the guest CTA hand-off and the focused
 * card the `?resume=` return lands on. Runs only when `E2E_SHOT_DIR` is set.
 */
test("019 EARS-12: the guest feed renders at desktop and mobile in light and dark", async ({
  page,
  context,
}) => {
  test.skip(!SHOT_DIR, "evidence capture — set E2E_SHOT_DIR to opt in");
  await context.clearCookies();

  for (const shot of [
    { name: "desktop-light", size: DESKTOP, theme: "light" },
    { name: "desktop-dark", size: DESKTOP, theme: "dark" },
    { name: "mobile-light", size: MOBILE, theme: "light" },
    { name: "mobile-dark", size: MOBILE, theme: "dark" },
  ] as const) {
    await page.setViewportSize(shot.size);
    await page.emulateMedia({ colorScheme: shot.theme });
    await page.goto("/events", { waitUntil: "domcontentloaded" });
    await page.evaluate((theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
    }, shot.theme);
    await expect(page.getByTestId("events-guest-gate")).toBeVisible();
    await shoot(page, shot.name);
  }

  // The interaction: the returning doctor's card, scrolled into view with its
  // «Участвовать ↗» focused and hovered — the visible proof of «resumed on the
  // same card».
  await page.setViewportSize(DESKTOP);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/events?from=2026-09-01&to=2026-09-29&resume=evt-3", {
    waitUntil: "domcontentloaded",
  });
  const resumed = page
    .locator("[data-webinar-card]")
    .filter({ has: page.locator('a[href="/events/evt-3"]') })
    .getByRole("link", { name: CTA_LABEL });
  await expect(resumed).toBeFocused();
  await resumed.hover();
  // Viewport-only: the whole point of the shot is WHERE the page is scrolled to.
  await shoot(page, "interactions-guest-cta-handoff", false);
});
