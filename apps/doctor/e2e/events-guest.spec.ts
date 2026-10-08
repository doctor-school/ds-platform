import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 019 EARS-12 (kept) + EARS-11 as amended 2026-10-05 — the guest and the
 * signed-in reader of the one feed view (wave-2 entry gate §2.4, rows 40–42,
 * 46).
 *
 *  1. The READ is whole for a guest: every block a signed-in reader gets except
 *     «Мои события», with no account band (row 41, owner 2026-10-06 §2.8 A4).
 *  2. A card is ONE link to its event page and carries no action of its own
 *     (row 40, §2.8 A3): a guest signs up on the event page, where the
 *     one-tap sign-up lives (#2005), and the package resume returns there
 *     (row 42) — so no feed hand-off and no `?resume=` re-seat exist.
 *  3. A signed-in doctor's «Мои события» cut: the nearest three registered
 *     upcoming events, the live one excluded, with «Все мои события →»; absent
 *     for a doctor with no registrations (row 46).
 *
 * Upstream is the fixed stand-in (`e2e/support/doctor-events-api.mjs`): the
 * `__Host-ds_session` cookie rides a request HEADER, because the `__Host-`
 * prefix is https-only in Chromium and this tier serves the built app over
 * http; the header is exactly what the route reads (`forwardedSessionFrom`).
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;

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

test.afterEach(async ({ request }) => {
  await request.post(`${API}/__e2e/live`, { data: { scenario: "none" } });
});

test("gate rows 40–41: a guest reads every block but «Мои события», with no account band and no card action", async ({
  page,
  context,
  request,
}) => {
  await request.post(`${API}/__e2e/live`, {
    data: { scenario: "unregistered" },
  });
  await context.clearCookies();
  await page.goto("/events");

  // Nothing is withheld from a signed-out reader: the same day groups and
  // cards the signed-in reader gets, the live block included.
  await expect(page.getByTestId("events-tense-tabs")).toBeVisible();
  await expect(page.getByTestId("events-live-block")).toBeVisible();
  await expect(page.locator('section[id^="day-"]')).toHaveCount(2);
  const cards = page.locator("[data-webinar-card]");
  await expect(cards).toHaveCount(3);

  // «Мои события» is a signed-in reader's block only.
  await expect(page.getByTestId("events-my-events")).toHaveCount(0);
  await expect(page.getByTestId("events-my-events-skeleton")).toHaveCount(0);

  // No account band, no hand-off.
  await expect(page.getByTestId("events-guest-gate")).toHaveCount(0);
  await expect(page.getByText("Участвовать — нужна регистрация.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Участвовать ↗" })).toHaveCount(0);
  await expect(page.locator('a[href^="/register"]')).toHaveCount(0);

  // Each upcoming card is ONE labelled link to its own event page.
  for (const [index, slug] of ["evt-1", "evt-2", "evt-3"].entries()) {
    const links = cards.nth(index).getByRole("link");
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", `/events/${slug}`);
    await expect(links).toHaveAccessibleName(`Событие ${slug}`);
  }
});

test("gate row 42: a `resume` parameter re-seats nothing — the return lands on the event page, not the feed", async ({
  page,
  context,
}) => {
  await context.clearCookies();
  await page.goto("/events?from=2026-09-01&to=2026-09-29&resume=evt-3");

  // The horizon in the URL is served whole; `resume` is not feed state any
  // more, so no card is focused and the page reads from its top.
  await expect(page.locator('section[id^="day-"]')).toHaveCount(3);
  await expect(page.locator("[data-webinar-card] a:focus")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("gate row 46: a signed-in doctor sees the nearest three registered upcoming events, the live one excluded, and «Все мои события →»", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ cookie: "__Host-ds_session=e2e-doctor" });
  await page.goto("/events");

  const mine = page.getByTestId("events-my-events");
  await expect(mine).toBeVisible();
  await expect(mine.getByText("Мои события", { exact: true })).toBeVisible();
  // The fixture holds five registrations out of order: one live (it is in the
  // live block's domain) and four upcoming — the cut is the nearest three.
  const rows = mine.locator("li a");
  await expect(rows).toHaveCount(3);
  expect(
    await rows.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")),
    ),
  ).toEqual(["/events/evt-1", "/events/evt-2", "/events/evt-3"]);
  await expect(mine.locator('a[href="/events/mine-live"]')).toHaveCount(0);
  await expect(mine.locator('a[href="/events/evt-4"]')).toHaveCount(0);

  const all = mine.getByRole("link", { name: "Все мои события →" });
  await expect(all).toHaveAttribute("href", "/account/events");

  // The feed marks the cards this doctor holds a registration for.
  await expect(
    page
      .locator("[data-webinar-card]")
      .filter({ hasText: "Событие evt-1" })
      .locator("[data-registered-marker]"),
  ).toHaveText(/Вы записаны/);

  // No account band for a signed-in reader either.
  await expect(page.getByTestId("events-guest-gate")).toHaveCount(0);
});

test("gate row 46: a signed-in doctor with no registrations gets no «Мои события» block", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    cookie: "__Host-ds_session=e2e-doctor-empty",
  });
  await page.goto("/events");

  await expect(page.getByTestId("events-feed")).toBeVisible();
  await expect(page.getByTestId("events-my-events")).toHaveCount(0);
  await expect(page.getByTestId("events-my-events-error")).toHaveCount(0);
});

/**
 * Stage-B evidence, not a gate: the four presentations of the guest feed the
 * PR body cites. Runs only when `E2E_SHOT_DIR` is set.
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
    await expect(page.getByTestId("events-feed")).toBeVisible();
    await shoot(page, shot.name);
  }
});
