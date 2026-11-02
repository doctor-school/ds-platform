import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * 017 EARS-9 (#1485) — the doctor home's nearest-events block: the shared
 * `@ds/events-storefront` preview of the upcoming feed mounted by the home
 * route with the doctor host config. The upstream is the events tier's fixed
 * stand-in `e2e/support/doctor-events-api.mjs`; `POST /__e2e/feed` fails,
 * empties or holds the feed read. Targeting itself is proven against the real
 * database in the api e2e spec; here the relayed specialty cookie only has to
 * leave the block rendering the read it answers.
 *
 * With `HOME_EVENTS_EVIDENCE_DIR` set, each state is also captured there (the
 * PR's ui-parity evidence) in the theme `HOME_EVENTS_THEME` names (`light` by
 * default); the assertions run either way.
 */
const API = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const EVIDENCE = process.env.HOME_EVENTS_EVIDENCE_DIR;
const THEME = process.env.HOME_EVENTS_THEME === "dark" ? "dark" : "light";

async function feedControl(
  request: APIRequestContext,
  control: { failing?: boolean; empty?: boolean; delayMs?: number },
) {
  await request.post(`${API}/__e2e/feed`, { data: control });
}

async function rememberSpecialty(context: BrowserContext) {
  await context.addCookies([
    {
      name: "__Host-ds_specialty",
      value: "00000000-0000-4000-8000-000000000001",
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

async function capture(page: Page, name: string) {
  if (!EVIDENCE) return;
  await block(page).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${EVIDENCE}/${name}-${THEME}.png`,
    fullPage: true,
  });
}

function block(page: Page) {
  return page.getByTestId("home-events");
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

    test("017 EARS-9: a guest's home shows the first three upcoming feed cards under «Ближайшие события», and «Все события →» lands on /events", async ({
      page,
    }) => {
      await page.goto("/");
      await expect(block(page).getByTestId("home-events-eyebrow")).toHaveText(
        "События",
      );
      await expect(
        block(page).getByRole("heading", { level: 2, name: "Ближайшие события" }),
      ).toBeVisible();
      const cards = block(page).getByTestId("home-events-cards");
      await expect(cards.locator("[data-webinar-card]")).toHaveCount(3);
      await expect(cards.locator('a[href="/events/evt-1"]').first()).toBeVisible();
      // A preview, not the feed: no day groups, no «Показать ещё», no calendar.
      await expect(block(page).locator('section[id^="day-"]')).toHaveCount(0);
      await expect(block(page).getByTestId("events-feed-show-more")).toHaveCount(0);
      await expectRestUsable(page);
      await capture(page, `home-events-guest-${viewport.width}`);

      const axe = await new AxeBuilder({ page })
        .include('[data-testid="home-events"]')
        .analyze();
      expect(axe.violations).toEqual([]);

      await block(page).getByTestId("home-events-all").click();
      await expect(page).toHaveURL(/\/events$/);
      await expect(page.getByTestId("events-feed")).toBeVisible();
    });

    test("017 EARS-9: with a remembered specialty and a session the block renders the read the relayed cookie answers, the registered cards marked", async ({
      page,
      context,
    }) => {
      await rememberSpecialty(context);
      await context.addCookies([
        {
          name: "__Host-ds_session",
          value: "e2e-doctor",
          domain: "127.0.0.1",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);
      await page.goto("/");
      const cards = block(page).getByTestId("home-events-cards");
      await expect(cards.locator("[data-webinar-card]")).toHaveCount(3);
      await expect(cards).toContainText("Вы записаны");
      await capture(page, `home-events-specialty-${viewport.width}`);
    });

    test("017 EARS-9: no upcoming event — the block states the empty copy with its pointer into /events", async ({
      page,
      request,
    }) => {
      await feedControl(request, { empty: true });
      await page.goto("/");
      const empty = block(page).getByTestId("home-events-empty");
      await expect(empty).toContainText(
        "Пока ничего не запланировано по вашей специальности",
      );
      await expect(empty).toContainText("Посмотрите события смежных областей");
      await expect(empty.getByRole("link", { name: "все события →" })).toHaveAttribute(
        "href",
        "/events",
      );
      await expectRestUsable(page);
      await capture(page, `home-events-empty-${viewport.width}`);
    });

    test("017 EARS-9: a failed read states «Не удалось загрузить события.», the page stays usable, and «Обновить» recovers the cards in place", async ({
      page,
      request,
    }) => {
      await feedControl(request, { failing: true });
      await page.goto("/");
      const error = block(page).getByTestId("home-events-error");
      await expect(error).toContainText("Не удалось загрузить события.");
      await expectRestUsable(page);
      await capture(page, `home-events-error-${viewport.width}`);

      await feedControl(request, {});
      const url = page.url();
      await error.getByRole("button", { name: "Обновить" }).click();
      await expect(
        block(page).getByTestId("home-events-cards").locator("[data-webinar-card]"),
      ).toHaveCount(3);
      await expect(block(page).getByTestId("home-events-error")).toHaveCount(0);
      // Replaced in place: no navigation, no route refresh of the page.
      expect(page.url()).toBe(url);
    });

    test("017 EARS-9: while the read is in flight the block shows three card skeletons and the rest of the page is already usable", async ({
      page,
      request,
    }) => {
      await feedControl(request, { delayMs: 4000 });
      await page.goto("/", { waitUntil: "commit" });
      const skeleton = block(page).getByTestId("home-events-skeleton");
      await expect(skeleton).toBeVisible();
      await expect(skeleton.locator(":scope > *")).toHaveCount(3);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await capture(page, `home-events-loading-${viewport.width}`);
      await expect(
        block(page).getByTestId("home-events-cards").locator("[data-webinar-card]"),
      ).toHaveCount(3, { timeout: 15_000 });
    });
  });
}
