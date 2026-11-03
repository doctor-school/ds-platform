import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

/**
 * 017 EARS-9 (#1485) — the doctor home's nearest events ARE the events page's
 * day feed block (019 EARS-3/EARS-9, `@ds/events-storefront/feed`), capped to
 * three cards with «Все события». The upstream is the events tier's fixed
 * stand-in `e2e/support/doctor-events-api.mjs`; `POST /__e2e/feed` fails or
 * empties the feed read and `GET /__e2e/feed` reports the cookie the last
 * upcoming read relayed. Targeting itself is the service's, proven against the
 * real database in the api e2e spec; here the home relays the remembered
 * specialty and renders the read it answers.
 *
 * With `HOME_EVENTS_EVIDENCE_DIR` set, each state is also captured there (the
 * PR's ui-parity evidence) in the theme `HOME_EVENTS_THEME` names (`light` by
 * default); the assertions run either way.
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const EVIDENCE = process.env.HOME_EVENTS_EVIDENCE_DIR;
const THEME = process.env.HOME_EVENTS_THEME === "dark" ? "dark" : "light";
const CAP = 3;

async function feedControl(
  request: APIRequestContext,
  control: { failing?: boolean; empty?: boolean },
) {
  await request.post(`${API}/__e2e/feed`, { data: control });
}

async function lastFeedCookie(request: APIRequestContext): Promise<string> {
  const answer = await request.get(`${API}/__e2e/feed`);
  return ((await answer.json()) as { lastCookie: string | null }).lastCookie ?? "";
}

/**
 * The `__Host-` prefix is https-only in Chromium and this tier serves http, so
 * the remembered specialty and the session ride a request HEADER — exactly
 * what the route reads and relays (the events-live spec's idiom). The two are
 * driven apart: with both, the doctor proxy first adopts the guest choice into
 * the profile (017 EARS-7), which this tier's stand-in does not answer.
 */
const SPECIALTY_COOKIE =
  "__Host-ds_specialty=00000000-0000-4000-8000-000000000001";

function block(page: Page) {
  return page.getByTestId("home-events");
}

function cards(page: Page) {
  return block(page).getByTestId("events-feed").locator("[data-webinar-card]");
}

async function capture(page: Page, name: string) {
  if (!EVIDENCE) return;
  await block(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${EVIDENCE}/${name}-${THEME}.png`,
    fullPage: true,
  });
}

/** The hero and the catalog render and answer input whatever the block shows. */
async function expectRestUsable(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const field = page.getByRole("searchbox").first();
  await field.fill("Кардио");
  await expect(field).toHaveValue("Кардио");
  await field.fill("");
}

test.beforeEach(async ({ page }) => {
  // The FOUC guard reads the stored theme before paint.
  await page.addInitScript((value) => {
    window.localStorage.setItem("ds-theme", value);
  }, THEME);
});

test.afterEach(async ({ request }) => {
  await feedControl(request, {});
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`017 EARS-9 at ${viewport.width} px`, () => {
    test.use({ viewport });

    test("017 EARS-9: a guest's home shows the events feed block capped to three cards under «Ближайшие события», and «Все события» lands on /events", async ({
      page,
      request,
    }) => {
      await page.goto("/");
      await expect(
        block(page).getByRole("heading", { level: 2, name: "Ближайшие события" }),
      ).toBeVisible();
      await expect(cards(page)).toHaveCount(CAP);
      expect(await lastFeedCookie(request)).not.toContain("__Host-ds_specialty=");
      const all = block(page).getByTestId("events-feed-show-more");
      await expect(all).toHaveText("Все события");
      await expect(all).toHaveAttribute("href", "/events");
      await expectRestUsable(page);
      await capture(page, `home-events-guest-${viewport.width}`);

      const axe = await new AxeBuilder({ page })
        .include('[data-testid="home-events"]')
        .analyze();
      expect(axe.violations).toEqual([]);

      await all.click();
      await expect(page).toHaveURL(/\/events$/);
      await expect(page.getByTestId("events-feed")).toBeVisible();
    });

    test("017 EARS-9: with a remembered specialty the home's feed read relays it, so the capped block shows the targeted read", async ({
      page,
      request,
    }) => {
      await page.setExtraHTTPHeaders({ cookie: SPECIALTY_COOKIE });
      await page.goto("/");
      await expect(cards(page)).toHaveCount(CAP);
      expect(await lastFeedCookie(request)).toContain(SPECIALTY_COOKIE);
      await expect(block(page).getByTestId("events-feed-show-more")).toHaveText(
        "Все события",
      );
      await expectRestUsable(page);
      await capture(page, `home-events-specialty-${viewport.width}`);
    });

    test("017 EARS-9: a signed-in doctor's capped block marks the cards the doctor is registered for", async ({
      page,
    }) => {
      await page.setExtraHTTPHeaders({ cookie: "__Host-ds_session=e2e-doctor" });
      await page.goto("/");
      await expect(cards(page)).toHaveCount(CAP);
      await expect(block(page).getByTestId("events-feed")).toContainText(
        "Вы записаны",
      );
    });

    test("017 EARS-9: no upcoming event — the capped block states the feed's empty render (019 EARS-9)", async ({
      page,
      request,
    }) => {
      await feedControl(request, { empty: true });
      await page.goto("/");
      await expect(block(page).getByTestId("events-feed-empty")).toBeVisible();
      await expect(cards(page)).toHaveCount(0);
      await expectRestUsable(page);
      await capture(page, `home-events-empty-${viewport.width}`);
    });

    test("017 EARS-9: a failed read states the feed's cause, the page stays usable, and «Повторить» recovers the capped block in place", async ({
      page,
      request,
    }) => {
      await feedControl(request, { failing: true });
      await page.goto("/");
      const error = block(page).getByTestId("events-feed-error");
      await expect(error).toContainText("Не удалось загрузить ленту событий");
      await expectRestUsable(page);
      await capture(page, `home-events-error-${viewport.width}`);

      await feedControl(request, {});
      const url = page.url();
      await error.getByRole("button", { name: "Повторить" }).click();
      await expect(cards(page)).toHaveCount(CAP);
      await expect(block(page).getByTestId("events-feed-show-more")).toHaveText(
        "Все события",
      );
      await expect(block(page).getByTestId("events-feed-error")).toHaveCount(0);
      // Replaced in place: no navigation, no route refresh of the page.
      expect(page.url()).toBe(url);
    });
  });
}
