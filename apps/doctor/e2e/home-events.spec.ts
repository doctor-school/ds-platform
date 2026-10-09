import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/**
 * Wave-2 entry gate §2.6 row 62 — 017 EARS-9, the doctor home nearest-events
 * block: the `@ds/events-storefront` block mounted by the home route with the
 * doctor host config. The upstream is the fixed stand-in
 * `e2e/support/doctor-events-api.mjs` (September 2026 fixtures): a guest reads
 * the general feed (evt-1 … evt-3 inside the default window); a remembered
 * specialty (the relayed `__Host-ds_specialty` cookie, row 13) reads the
 * targeted разборы of 20 September, past the default window. `POST
 * /__e2e/home` picks the `slow` / `empty` / `empty-adjacent` renders and
 * `POST /__e2e/feed` fails the read.
 *
 * With `HOME_EVENTS_EVIDENCE_DIR` set, the visual states are also captured
 * there (the PR's ui-evidence); the assertions run either way.
 */
const api = `http://127.0.0.1:${process.env.DOCTOR_EVENTS_FAKE_API_PORT ?? 3214}`;
const CARDIOLOGY = "00000000-0000-4000-8000-000000000001";
const EVIDENCE = process.env.HOME_EVENTS_EVIDENCE_DIR;

async function homeScenario(request: APIRequestContext, scenario: string) {
  await request.post(`${api}/__e2e/home`, { data: { scenario } });
}

async function feedFailing(request: APIRequestContext, failing: boolean) {
  await request.post(`${api}/__e2e/feed`, { data: { failing } });
}

async function rememberCardiology(context: BrowserContext) {
  await context.addCookies([
    {
      name: "__Host-ds_specialty",
      value: CARDIOLOGY,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    window.localStorage.setItem("ds-theme", value);
  }, theme);
}

async function capture(page: Page, name: string) {
  if (!EVIDENCE) return;
  await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
}

/** The hero and the catalog render and answer input whatever the block shows. */
async function expectRestUsable(page: Page, chosen: boolean) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (chosen) {
    await expect(page.getByTestId("specialty-change")).toBeEnabled();
  } else {
    const field = page.getByRole("searchbox", { name: "Поиск специальности" });
    await field.fill("Кардио");
    await expect(field).toHaveValue("Кардио");
    await field.fill("");
  }
}

function block(page: Page) {
  return page.getByTestId("home-events");
}

test.afterEach(async ({ request }) => {
  await homeScenario(request, "normal");
  await feedFailing(request, false);
});

const VIEWPORTS = [
  { name: "390", viewport: { width: 390, height: 844 } },
  { name: "1440", viewport: { width: 1440, height: 900 } },
] as const;
const THEMES = ["light", "dark"] as const;

for (const { name: vp, viewport } of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`017 EARS-9 at ${vp} px, ${theme}`, () => {
      test.use({ viewport });
      test.beforeEach(async ({ page }) => {
        await useTheme(page, theme);
      });

      async function open(page: Page, waitUntil: "load" | "commit" = "load") {
        await page.goto("/", { waitUntil });
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      }

      test("NEW: doctor home — before a choice the nearest events render general as cards with the compact month, and «Все события» lands on /events (row 62)", async ({
        page,
      }) => {
        await open(page);
        await expect(block(page).getByTestId("home-events-kicker")).toHaveText("События");
        await expect(block(page).getByRole("heading", { level: 2, name: "Ближайшие события" })).toBeVisible();
        const cards = block(page).getByTestId("home-events-cards");
        for (const id of ["evt-1", "evt-2", "evt-3"]) {
          await expect(cards.locator(`a[href="/events/${id}"]`).first()).toBeVisible();
        }
        await expect(cards.getByRole("listitem")).toHaveCount(3);
        await expect(block(page).getByTestId("events-compact-month")).toBeVisible();
        await expectRestUsable(page, false);
        await capture(page, `home-general-${vp}-${theme}`);

        await block(page).getByTestId("home-events-all").click();
        await expect(page).toHaveURL(/\/events$/);
        await expect(page.getByTestId("events-feed")).toBeVisible();
      });

      test("NEW: doctor home — after a choice the block renders targeted from the relayed specialty (row 62, row 13)", async ({
        context,
        page,
      }) => {
        await rememberCardiology(context);
        await open(page);
        await expect(block(page).getByTestId("home-events-kicker")).toHaveText(
          "По вашей специальности и смежным областям",
        );
        const cards = block(page).getByTestId("home-events-cards");
        // The targeted разборы lie past the default window: the block widened once.
        for (const id of ["evt-5", "evt-6", "evt-7"]) {
          await expect(cards.locator(`a[href="/events/${id}"]`).first()).toBeVisible();
        }
        await expect(cards.locator('a[href="/events/evt-1"]')).toHaveCount(0);
        await expect(block(page).getByTestId("events-compact-month")).toBeVisible();
        await expectRestUsable(page, true);
        await capture(page, `home-targeted-${vp}-${theme}`);
      });

      test("NEW: doctor home — card skeletons while the read is in flight, then the cards; the hero and catalog stay usable (row 62)", async ({
        page,
        request,
      }) => {
        await homeScenario(request, "slow");
        await open(page, "commit");
        await expect(block(page).getByTestId("home-events-skeleton")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await capture(page, `home-loading-${vp}-${theme}`);
        await expect(block(page).getByTestId("home-events-cards")).toBeVisible();
        await expect(block(page).getByTestId("home-events-skeleton")).toHaveCount(0);
        await expectRestUsable(page, false);
      });

      test("NEW: doctor home — a targeted empty read with no adjacent area states it alone, no link (row 62)", async ({
        context,
        page,
        request,
      }) => {
        await homeScenario(request, "empty");
        await rememberCardiology(context);
        await open(page);
        const empty = block(page).getByTestId("home-events-empty");
        await expect(empty).toContainText("Пока ничего не запланировано по вашей специальности");
        await expect(block(page).getByTestId("home-events-adjacent")).toHaveCount(0);
        await expect(block(page).getByTestId("events-compact-month")).toHaveCount(0);
        await expectRestUsable(page, true);
        await capture(page, `home-empty-${vp}-${theme}`);
      });

      test("NEW: doctor home — a targeted empty read with adjacent areas points at them, and the link lands on /events (row 62)", async ({
        context,
        page,
        request,
      }) => {
        await homeScenario(request, "empty-adjacent");
        await rememberCardiology(context);
        await open(page);
        const empty = block(page).getByTestId("home-events-empty");
        await expect(empty).toContainText("Пока ничего не запланировано по вашей специальности");
        await expect(empty).toContainText("Посмотрите события смежных областей — все события →");
        await expectRestUsable(page, true);
        await capture(page, `home-empty-adjacent-${vp}-${theme}`);
        await block(page).getByTestId("home-events-adjacent").click();
        await expect(page).toHaveURL(/\/events$/);
      });

      test("NEW: doctor home — an empty general read states it with no adjacent link (row 62)", async ({
        page,
        request,
      }) => {
        await homeScenario(request, "empty");
        await open(page);
        const empty = block(page).getByTestId("home-events-empty");
        await expect(empty).toContainText("Пока ничего не запланировано");
        await expect(empty).not.toContainText("по вашей специальности");
        await expect(block(page).getByTestId("home-events-adjacent")).toHaveCount(0);
        await expectRestUsable(page, false);
      });

      test("NEW: doctor home — a failed read states the cause in Russian and «Обновить» recovers it (row 62)", async ({
        page,
        request,
      }) => {
        await feedFailing(request, true);
        await open(page);
        const error = block(page).getByTestId("home-events-error");
        await expect(error).toContainText("Не удалось загрузить события.");
        await expectRestUsable(page, false);
        await capture(page, `home-error-${vp}-${theme}`);

        await feedFailing(request, false);
        await error.getByRole("button", { name: "Обновить" }).click();
        await expect(block(page).getByTestId("home-events-cards")).toBeVisible();
        await expect(block(page).getByTestId("home-events-error")).toHaveCount(0);
        await expectRestUsable(page, false);
      });
    });
  }
}

test.describe("017 EARS-7 × EARS-9 at 1440 px", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("NEW: doctor home — choosing a specialty in the catalog re-targets the nearest events with no reload (row 62)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(block(page).getByTestId("home-events-kicker")).toHaveText("События");
    await page
      .getByTestId("specialty-entry")
      .filter({ hasText: "Кардиология" })
      .first()
      .click();
    await expect(page.getByTestId("specialty-chosen")).toContainText("Кардиология");
    await expect(block(page).getByTestId("home-events-kicker")).toHaveText(
      "По вашей специальности и смежным областям",
    );
    await expect(
      block(page).getByTestId("home-events-cards").locator('a[href="/events/evt-5"]').first(),
    ).toBeVisible();
  });
});

test.describe("017 EARS-9 × 017 EARS-14 — playwright-axe on the block", () => {
  for (const theme of THEMES) {
    for (const state of ["cards", "empty-adjacent", "error"] as const) {
      test(`NEW: doctor home — the nearest-events block in its ${state} render has no WCAG 2.1 AA violation (${theme})`, async ({
        context,
        page,
        request,
      }) => {
        await useTheme(page, theme);
        if (state === "empty-adjacent") {
          await homeScenario(request, "empty-adjacent");
          await rememberCardiology(context);
        }
        if (state === "error") await feedFailing(request, true);
        await page.goto("/");
        const testId = { cards: "home-events-cards", "empty-adjacent": "home-events-empty", error: "home-events-error" }[state];
        await expect(block(page).getByTestId(testId)).toBeVisible();
        const results = await new AxeBuilder({ page })
          .include('[data-testid="home-events"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target).flat() })),
        ).toEqual([]);
      });
    }
  }
});
